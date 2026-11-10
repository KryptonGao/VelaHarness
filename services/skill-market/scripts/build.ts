#!/usr/bin/env node
// 在本机建置并签名市场内容：从固定的上游 commit 取文件，生成 manifest 与目录，写到 public/，
// 同时生成客户端的内置目录。私钥只在本机读取。
//
//   pnpm market:build                    按 catalog.json 里固定的 commit 重新建置
//   pnpm market:build --update           先把所有 Skill 的 commit 更新到上游当前 HEAD 再建置
//   pnpm market:build --update docx pdf  只更新指定的 Skill
//
// 更新后用 `git diff services/skill-market/public` 审核上游改了什么，满意再 commit、push。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marketplacePublicKeys } from "../../../packages/shared/src/marketplace-config.ts";
import {
  parseMarketplaceCatalog,
  parseMarketplaceEntry,
  parseMarketplaceManifest,
} from "../../../packages/shared/src/marketplace-protocol.ts";
import { assembleCatalog, assembleSkill, findSkillDirectory, renderBuiltinCatalog, signBytes, type BuiltSkill, type SourceEntry, type UpstreamFile } from "./build-lib.ts";
import { loadMarketPrivateKey, rawPublicKey } from "./keys.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "../..");
const catalogPath = join(root, "catalog.json");
const publicDir = join(root, "public", "v1");
const cacheDir = join(root, ".cache", "upstream");
const builtinPath = join(repoRoot, "packages/shared/src/marketplace-builtin.ts");

function git(cwd: string, args: string[]): Buffer {
  return execFileSync("git", args, { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function readSource(): SourceEntry[] {
  const raw = JSON.parse(readFileSync(catalogPath, "utf8")) as { skills?: unknown };
  if (!Array.isArray(raw.skills)) throw new Error("catalog.json 格式不正确");
  const seen = new Set<string>();
  return raw.skills.map((item) => {
    const entry = parseMarketplaceEntry(item);
    const commit = (item as { commit?: unknown }).commit;
    if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${entry.id}：commit 必须是 40 位小写十六进制`);
    if (seen.has(entry.id)) throw new Error(`${entry.id}：id 重复`);
    seen.add(entry.id);
    return { ...entry, commit };
  });
}

function writeSource(entries: readonly SourceEntry[]): void {
  const skills = entries.map((entry) => {
    const { id, source, skill, dir, category, description, mcp, commit } = entry;
    return { id, source, skill, ...(dir ? { dir } : {}), category, ...(description ? { description } : {}), ...(mcp ? { mcp } : {}), commit };
  });
  writeFileSync(catalogPath, `${JSON.stringify({ skills }, null, 2)}\n`);
}

function repoDir(source: string): string {
  const dir = join(cacheDir, source.replace("/", "__"));
  mkdirSync(dir, { recursive: true });
  // 缓存目录在本仓库里面：不能用 `git rev-parse` 判断，它会找到外层仓库，把上游文件拉进错误的 remote。
  if (!existsSync(join(dir, ".git"))) {
    git(dir, ["init", "-q"]);
    git(dir, ["remote", "add", "origin", `https://github.com/${source}.git`]);
  }
  return dir;
}

/** 只拉取固定的那一个 commit，不碰 HEAD；已经在本地缓存里就不再联网。 */
function ensureCommit(source: string, commit: string): string {
  const dir = repoDir(source);
  try {
    git(dir, ["cat-file", "-e", `${commit}^{commit}`]);
  } catch {
    git(dir, ["fetch", "--depth", "1", "-q", "origin", commit]);
  }
  return dir;
}

function upstreamHead(source: string): string {
  const out = git(repoDir(source), ["ls-remote", "origin", "HEAD"]).toString("utf8").trim();
  const sha = out.split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${source}：读不到上游 HEAD`);
  return sha;
}

function fetchSkill(entry: SourceEntry): BuiltSkill {
  const dir = ensureCommit(entry.source, entry.commit);
  const listing = git(dir, ["ls-tree", "-r", "-z", entry.commit]).toString("utf8").split("\0").filter(Boolean);
  // 每行是 `<mode> <type> <oid>\t<path>`。
  const blobs = listing.map((line) => {
    const tab = line.indexOf("\t");
    const [mode = "", type = "", oid = ""] = line.slice(0, tab).split(" ");
    return { mode, type, oid, path: line.slice(tab + 1) };
  });
  const upstreamPath = findSkillDirectory(
    blobs.map((item) => item.path),
    entry.dir ?? entry.skill,
  );
  if (!upstreamPath) throw new Error(`${entry.id}：在 ${entry.source}@${entry.commit.slice(0, 7)} 里找不到这个 Skill`);
  const prefix = `${upstreamPath}/`;
  const files: UpstreamFile[] = [];
  for (const item of blobs.filter((blob) => blob.path.startsWith(prefix))) {
    // 符号链接和子模块拿不到可核对的内容，宁可让构建失败也不悄悄漏掉。
    if (item.type !== "blob" || item.mode === "120000") throw new Error(`${entry.id}：${item.path} 是符号链接或子模块，无法分发`);
    files.push({ path: item.path.slice(prefix.length), bytes: new Uint8Array(git(dir, ["cat-file", "blob", item.oid])) });
  }
  return assembleSkill(entry, upstreamPath, files);
}

function main(): void {
  const args = process.argv.slice(2);
  const updateIndex = args.indexOf("--update");
  let entries = readSource();

  if (updateIndex >= 0) {
    const wanted = args.slice(updateIndex + 1).filter((arg) => !arg.startsWith("--"));
    for (const id of wanted) if (!entries.some((entry) => entry.id === id)) throw new Error(`catalog.json 里没有 ${id}`);
    const heads = new Map<string, string>();
    entries = entries.map((entry) => {
      if (wanted.length && !wanted.includes(entry.id)) return entry;
      const head = heads.get(entry.source) ?? upstreamHead(entry.source);
      heads.set(entry.source, head);
      if (head !== entry.commit) console.log(`${entry.id}: ${entry.commit.slice(0, 7)} -> ${head.slice(0, 7)}`);
      return { ...entry, commit: head };
    });
    writeSource(entries);
  }

  // 只用内置公钥里有的私钥签名，避免签出客户端无法验证的内容。
  const privateKey = loadMarketPrivateKey();
  if (!marketplacePublicKeys.includes(rawPublicKey(privateKey))) {
    throw new Error("私钥对应的公钥不在 packages/shared/src/marketplace-config.ts 的 marketplacePublicKeys 里，已停止。");
  }

  const built = entries.map((entry) => {
    const skill = fetchSkill(entry);
    console.log(`${entry.id.padEnd(32)} ${String(skill.files.length).padStart(3)} files  @${entry.commit.slice(0, 7)}`);
    return skill;
  });

  // 重新生成 public/v1，下架的 Skill 随之消失。
  rmSync(publicDir, { recursive: true, force: true });
  for (const skill of built) {
    const base = join(publicDir, "skills", skill.entry.id);
    for (const file of skill.files) {
      const target = join(base, "files", file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }
    writeFileSync(join(base, "manifest.json"), skill.manifestBytes);
    writeFileSync(join(base, "manifest.json.sig"), signBytes(skill.manifestBytes, privateKey));
    parseMarketplaceManifest(new TextDecoder().decode(skill.manifestBytes));
  }
  const { bytes: catalogBytes } = assembleCatalog(built);
  parseMarketplaceCatalog(new TextDecoder().decode(catalogBytes));
  writeFileSync(join(publicDir, "catalog.json"), catalogBytes);
  writeFileSync(join(publicDir, "catalog.json.sig"), signBytes(catalogBytes, privateKey));

  writeFileSync(builtinPath, renderBuiltinCatalog(entries));
  console.log(`\n已输出 ${built.length} 个 Skill 到 ${publicDir}\n内置目录已更新：${builtinPath}`);
}

main();
