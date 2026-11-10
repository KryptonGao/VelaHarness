import { type MarketplaceSkillId, marketplaceSkills } from "@vela/shared";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const maxFiles = 400;
const maxFileBytes = 20 * 1024 * 1024;
const maxTotalBytes = 60 * 1024 * 1024;
const requestTimeoutMs = 30_000;
const requestAttempts = 3;
const downloadConcurrency = 6;

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

export interface InstallMarketplaceOptions {
  agentDir: string;
  id: MarketplaceSkillId;
  /** 测试时替换网络请求。 */
  fetch?: typeof fetch;
  /** 要下载的分支或提交，默认仓库的默认分支（HEAD）。 */
  ref?: string;
}

/**
 * 在仓库文件列表里找 Skill 所在目录：目录名等于 dir（缺省为 Skill 名称）且含 SKILL.md。
 * 仓库会把 Skill 放在 skills/、skills/分类/ 等不同深度，所以不写死路径；
 * 多处同名时跳过隐藏目录，再取最浅的一个。
 */
function findSkillDirectory(paths: readonly string[], name: string): string | null {
  const matches = paths
    .filter((path) => path.endsWith("/SKILL.md"))
    .map((path) => path.slice(0, -"/SKILL.md".length))
    .filter((dir) => dir.split("/").pop() === name);
  matches.sort((left, right) => {
    const hidden = Number(left.split("/").some((part) => part.startsWith("."))) -
      Number(right.split("/").some((part) => part.startsWith(".")));
    return hidden || left.split("/").length - right.split("/").length;
  });
  return matches[0] ?? null;
}

/**
 * 把市场里的 Skill 从上游仓库下载到 `<agentDir>/skills/<skill>`，效果等同于
 * `npx skills add <source> --skill <skill>`，但不需要本机装有 Node。
 * 先下载到临时目录，全部成功后再移入；失败不会留下半个 Skill，
 * 目标目录已存在时不会覆盖，避免冲掉用户自己的同名 Skill。
 */
export async function installMarketplaceSkill(options: InstallMarketplaceOptions): Promise<string> {
  const entry = marketplaceSkills.find((item) => item.id === options.id);
  if (!entry) throw new Error("Skill 不正确");
  const request = options.fetch ?? fetch;
  const ref = options.ref ?? "HEAD";
  const skillsDir = join(options.agentDir, "skills");
  const destination = join(skillsDir, entry.skill);
  if (await stat(destination).then(() => true, () => false)) {
    throw new Error("Vela 的 Skill 目录里已经有同名文件夹");
  }

  const tree = await getJson<{ tree?: TreeEntry[]; truncated?: boolean }>(
    request,
    `https://api.github.com/repos/${entry.source}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  // 列表被截断时可能漏掉文件，宁可不装也不装出半个 Skill。
  if (tree.truncated) throw new Error("无法读取市场 Skill 列表");
  const blobs = (tree.tree ?? []).filter((item) => item.type === "blob");
  const directory = findSkillDirectory(blobs.map((item) => item.path), entry.dir ?? entry.skill);
  if (!directory) throw new Error("市场里找不到这个 Skill");
  const prefix = `${directory}/`;
  const files = blobs.filter((item) => item.path.startsWith(prefix));
  if (files.length > maxFiles) throw new Error("这个 Skill 的文件太多，已取消安装");
  if (files.reduce((sum, item) => sum + (item.size ?? 0), 0) > maxTotalBytes) {
    throw new Error("这个 Skill 太大，已取消安装");
  }

  await mkdir(skillsDir, { recursive: true });
  const staging = await mkdtemp(join(skillsDir, `.install-${entry.skill}-`));
  try {
    let total = 0;
    let next = 0;
    // 少量并发下载；任何一个失败就停止其余的，整体报错。
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const file = files[next++] as TreeEntry;
        const target = safeJoin(staging, file.path.slice(prefix.length));
        const bytes = await getBytes(
          request,
          `https://raw.githubusercontent.com/${entry.source}/${encodeURIComponent(ref)}/${file.path
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
        );
        total += bytes.byteLength;
        if (bytes.byteLength > maxFileBytes || total > maxTotalBytes) throw new Error("这个 Skill 太大，已取消安装");
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
      }
    };
    await Promise.all(Array.from({ length: Math.min(downloadConcurrency, files.length) }, worker));
    await rename(staging, destination);
    return destination;
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** 拒绝 `..`、绝对路径等会逃出目标目录的路径。 */
function safeJoin(root: string, relative: string): string {
  if (!relative || relative.includes("\0") || relative.includes("\\")) throw new Error("市场 Skill 包含不安全的路径");
  const target = resolve(root, relative);
  const base = resolve(root);
  if (!target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) {
    throw new Error("市场 Skill 包含不安全的路径");
  }
  return target;
}

async function send(request: typeof fetch, url: string): Promise<Response> {
  let failure: Error | null = null;
  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    let response: Response;
    try {
      response = await request(url, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Vela" },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      failure = new Error("无法连接 GitHub，请检查网络后重试");
      continue;
    }
    if (response.ok) return response;
    // 限流和 4xx 重试没有意义；服务端 5xx 多是暂时的，值得再试。
    if (response.status === 403 || response.status === 429) throw new Error("GitHub 暂时限制了请求，请稍后重试");
    failure = new Error("下载 Skill 失败，请稍后重试");
    if (response.status < 500) throw failure;
  }
  throw failure ?? new Error("下载 Skill 失败，请稍后重试");
}

async function getJson<T>(request: typeof fetch, url: string): Promise<T> {
  return (await (await send(request, url)).json()) as T;
}

async function getBytes(request: typeof fetch, url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await send(request, url)).arrayBuffer());
}
