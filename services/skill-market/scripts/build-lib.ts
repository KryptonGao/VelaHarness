import { createHash, sign, type KeyObject } from "node:crypto";
import {
  isSafeMarketplacePath,
  marketplaceLimits,
  marketplaceProtocolSchema,
  type MarketplaceCatalogEntry,
  type MarketplaceCatalogFile,
  type MarketplaceManifestFile,
  type MarketplaceSkillEntry,
} from "../../../packages/shared/src/marketplace-protocol.ts";

/** 目录来源文件里的一条：本地条目加上维护者审核过的上游 commit。 */
export interface SourceEntry extends MarketplaceSkillEntry {
  commit: string;
}

export interface UpstreamFile {
  /** 相对于 Skill 目录的路径。 */
  path: string;
  bytes: Uint8Array;
}

export interface BuiltSkill {
  entry: SourceEntry;
  manifest: MarketplaceManifestFile;
  manifestBytes: Uint8Array;
  files: UpstreamFile[];
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 在仓库文件列表里找 Skill 所在目录：目录名等于 name 且含 SKILL.md。
 * 上游会把 Skill 放在 skills/、skills/分类/ 等不同深度，所以不写死路径；
 * 多处同名时跳过隐藏目录，再取最浅的一个。
 */
export function findSkillDirectory(paths: readonly string[], name: string): string | null {
  const matches = paths
    .filter((path) => path.endsWith("/SKILL.md"))
    .map((path) => path.slice(0, -"/SKILL.md".length))
    .filter((dir) => dir.split("/").pop() === name);
  matches.sort((left, right) => {
    const hidden =
      Number(left.split("/").some((part) => part.startsWith("."))) - Number(right.split("/").some((part) => part.startsWith(".")));
    return hidden || left.split("/").length - right.split("/").length;
  });
  return matches[0] ?? null;
}

/**
 * Static Assets 按 URL 路径提供文件，且会丢弃 .DS_Store、node_modules、.git。
 * 路径里有会被 URL 改写的字符，或会被丢弃的片段，部署后客户端就取不到，所以构建时直接拒绝。
 */
const servablePath = /^[A-Za-z0-9._@+=,~-]+(?:\/[A-Za-z0-9._@+=,~-]+)*$/;
const droppedSegments = new Set([".DS_Store", "node_modules", ".git"]);

export function assertServablePath(path: string): void {
  if (!isSafeMarketplacePath(path) || !servablePath.test(path) || path.split("/").some((part) => droppedSegments.has(part))) {
    throw new Error(`无法分发的文件路径：${path}`);
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

/** 由上游文件生成 manifest；超出安装端上限的 Skill 在这里就失败，不等用户安装时才发现。 */
export function assembleSkill(entry: SourceEntry, upstreamPath: string, input: readonly UpstreamFile[]): BuiltSkill {
  const files = [...input].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (!files.some((file) => file.path === "SKILL.md")) throw new Error(`${entry.id}：缺少 SKILL.md`);
  if (files.length > marketplaceLimits.maxFiles) throw new Error(`${entry.id}：文件数超过 ${marketplaceLimits.maxFiles}`);
  let total = 0;
  for (const file of files) {
    assertServablePath(file.path);
    if (file.bytes.byteLength > marketplaceLimits.maxFileBytes) throw new Error(`${entry.id}：${file.path} 超过单文件上限`);
    total += file.bytes.byteLength;
  }
  if (total > marketplaceLimits.maxTotalBytes) throw new Error(`${entry.id}：总大小超过上限`);
  const manifest: MarketplaceManifestFile = {
    schema: marketplaceProtocolSchema,
    id: entry.id,
    skill: entry.skill,
    version: entry.commit.slice(0, 7),
    source: entry.source,
    commit: entry.commit,
    upstreamPath,
    files: files.map((file) => ({ path: file.path, size: file.bytes.byteLength, sha256: sha256Hex(file.bytes) })),
  };
  return { entry, manifest, manifestBytes: jsonBytes(manifest), files };
}

export function assembleCatalog(skills: readonly BuiltSkill[]): { catalog: MarketplaceCatalogFile; bytes: Uint8Array } {
  const entries = skills.map((built): MarketplaceCatalogEntry => {
    const { commit, ...rest } = built.entry;
    return {
      ...rest,
      version: built.manifest.version,
      commit,
      manifestSha256: sha256Hex(built.manifestBytes),
      fileCount: built.manifest.files.length,
      totalBytes: built.manifest.files.reduce((sum, file) => sum + file.size, 0),
    };
  });
  const catalog: MarketplaceCatalogFile = { schema: marketplaceProtocolSchema, skills: entries };
  return { catalog, bytes: jsonBytes(catalog) };
}

/** 与更新包同一格式：64 字节 Ed25519 签名的 base64 文本。 */
export function signBytes(bytes: Uint8Array, privateKey: KeyObject): string {
  return `${sign(null, bytes, privateKey).toString("base64")}\n`;
}

/** 内置目录：与云端目录同源，云端不可用时客户端回退到它。 */
export function renderBuiltinCatalog(entries: readonly MarketplaceSkillEntry[]): string {
  const lines = entries.map((entry) => {
    const fields: string[] = [
      `id: ${JSON.stringify(entry.id)}`,
      `source: ${JSON.stringify(entry.source)}`,
      `skill: ${JSON.stringify(entry.skill)}`,
    ];
    if (entry.dir) fields.push(`dir: ${JSON.stringify(entry.dir)}`);
    fields.push(`category: ${JSON.stringify(entry.category)}`);
    if (entry.description) fields.push(`description: ${JSON.stringify(entry.description)}`);
    if (entry.mcp?.length) fields.push(`mcp: ${JSON.stringify(entry.mcp)}`);
    return `  { ${fields.join(", ")} },`;
  });
  return [
    "// 由 `pnpm market:build` 根据 services/skill-market/catalog.json 生成，请勿手改。",
    'import type { MarketplaceSkillEntry } from "./marketplace-protocol";',
    "",
    "/** 内置的市场目录：云端目录不可用或验签失败时使用。 */",
    "export const marketplaceSkills: readonly MarketplaceSkillEntry[] = [",
    ...lines,
    "];",
    "",
  ].join("\n");
}
