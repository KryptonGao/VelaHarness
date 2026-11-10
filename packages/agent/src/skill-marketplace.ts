import {
  isMarketplaceId,
  marketplaceCloudUrl,
  marketplaceLimits,
  marketplacePublicKeys,
  marketplaceSkills,
  parseMarketplaceCatalog,
  parseMarketplaceManifest,
  type MarketplaceCatalogEntry,
  type MarketplaceListing,
  type MarketplaceSkillId,
} from "@vela/shared";
import { verifySignature } from "@vela/shared/signature";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const requestTimeoutMs = 30_000;
/** 目录和统计只影响列表展示，等太久不如直接用内置目录。 */
const listingTimeoutMs = 8_000;
const requestAttempts = 3;
const downloadConcurrency = 6;

export interface MarketplaceClientOptions {
  /** 测试时替换网络请求。 */
  fetch?: typeof fetch;
  /** 云端服务地址，默认取配置，也可用环境变量 VELA_MARKET_URL 覆盖。 */
  baseUrl?: string;
  /** 验签用的公钥，默认是内置的市场公钥。 */
  publicKeys?: readonly string[];
}

export interface InstallMarketplaceOptions extends MarketplaceClientOptions {
  agentDir: string;
  id: MarketplaceSkillId;
}

function serviceUrl(options: MarketplaceClientOptions): string | null {
  const base = (options.baseUrl ?? process.env.VELA_MARKET_URL ?? marketplaceCloudUrl).trim().replace(/\/+$/, "");
  return base || null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 取一份已签名的内容：字节与 .sig 都取到，验签通过才返回字节。 */
async function fetchSigned(
  request: typeof fetch,
  url: string,
  publicKeys: readonly string[],
  timeoutMs: number,
  attempts: number,
): Promise<Uint8Array> {
  const [bytes, signature] = await Promise.all([
    getBytes(request, url, timeoutMs, attempts),
    getBytes(request, `${url}.sig`, timeoutMs, attempts),
  ]);
  if (!verifySignature(bytes, new TextDecoder().decode(signature), publicKeys)) {
    throw new Error("Skill 签名验证失败，已取消安装");
  }
  return bytes;
}

/** 云端目录：验签通过才采用。任何失败都返回 null，由调用方回退到内置目录。 */
async function loadCloudCatalog(request: typeof fetch, base: string, publicKeys: readonly string[]): Promise<MarketplaceCatalogEntry[] | null> {
  try {
    const bytes = await fetchSigned(request, `${base}/v1/catalog.json`, publicKeys, listingTimeoutMs, 1);
    const { skills } = parseMarketplaceCatalog(new TextDecoder().decode(bytes));
    return skills.length > 0 ? skills : null;
  } catch {
    return null;
  }
}

/** 安装次数只用于展示，不签名；格式不对或取不到就当作没有。 */
async function loadInstalls(request: typeof fetch, base: string): Promise<Record<string, number> | null> {
  try {
    const body = JSON.parse(new TextDecoder().decode(await getBytes(request, `${base}/v1/stats.json`, listingTimeoutMs, 1))) as {
      installs?: unknown;
    };
    if (typeof body.installs !== "object" || body.installs === null || Array.isArray(body.installs)) return null;
    const installs: Record<string, number> = {};
    for (const [id, count] of Object.entries(body.installs)) {
      if (isMarketplaceId(id) && typeof count === "number" && Number.isSafeInteger(count) && count >= 0) installs[id] = count;
    }
    return installs;
  } catch {
    return null;
  }
}

/**
 * 市场列表：优先用云端目录，云端不可用或验签失败时回退到内置目录。
 * 目录来源不影响安装的安全：安装始终要通过 manifest 验签。
 */
export async function loadMarketplaceListing(options: MarketplaceClientOptions = {}): Promise<MarketplaceListing> {
  const base = serviceUrl(options);
  const builtin: MarketplaceListing = { skills: [...marketplaceSkills], source: "builtin", installs: null };
  if (!base) return builtin;
  const request = options.fetch ?? fetch;
  const [catalog, installs] = await Promise.all([
    loadCloudCatalog(request, base, options.publicKeys ?? marketplacePublicKeys),
    loadInstalls(request, base),
  ]);
  if (!catalog) return builtin;
  return {
    skills: catalog.map(({ id, source, skill, dir, category, description, mcp }) => ({
      id,
      source,
      skill,
      category,
      ...(dir ? { dir } : {}),
      ...(description ? { description } : {}),
      ...(mcp ? { mcp } : {}),
    })),
    source: "cloud",
    installs,
  };
}

/**
 * 把市场里的 Skill 安装到 `<agentDir>/skills/<skill>`。
 * 来源是云端分发、由市场私钥签名的 manifest：先验签，再逐文件核对大小和 SHA-256，
 * 任何一步不符都取消安装。先下载到临时目录，全部通过后再移入；失败不会留下半个 Skill，
 * 目标目录已存在时不会覆盖，避免冲掉用户自己的同名 Skill。
 */
export async function installMarketplaceSkill(options: InstallMarketplaceOptions): Promise<string> {
  if (!isMarketplaceId(options.id)) throw new Error("Skill 不正确");
  const base = serviceUrl(options);
  if (!base) throw new Error("市场服务暂时不可用，请稍后重试");
  const request = options.fetch ?? fetch;
  const publicKeys = options.publicKeys ?? marketplacePublicKeys;

  // 目录用来确定安装目录名；云端目录里的 manifestSha256 还会钉住 manifest，
  // 回退到内置目录时没有这一层，但 manifest 验签仍然必须通过。
  const catalog = await loadCloudCatalog(request, base, publicKeys);
  const entry = catalog?.find((item) => item.id === options.id) ?? marketplaceSkills.find((item) => item.id === options.id);
  if (!entry) throw new Error("市场里找不到这个 Skill");
  const pinned = catalog?.find((item) => item.id === options.id)?.manifestSha256;

  const skillsDir = join(options.agentDir, "skills");
  const destination = join(skillsDir, entry.skill);
  if (await stat(destination).then(() => true, () => false)) {
    throw new Error("Vela 的 Skill 目录里已经有同名文件夹");
  }

  // 只有安装流程会请求 manifest，服务端以此统计安装次数。
  const skillUrl = `${base}/v1/skills/${encodeURIComponent(options.id)}`;
  const manifestBytes = await fetchSigned(request, `${skillUrl}/manifest.json`, publicKeys, requestTimeoutMs, requestAttempts);
  if (pinned && sha256(manifestBytes) !== pinned) throw new Error("Skill 文件校验失败，已取消安装");
  let manifest;
  try {
    manifest = parseMarketplaceManifest(new TextDecoder().decode(manifestBytes));
  } catch (error) {
    // 签名有效但内容不合规：路径问题保持原提示，其余统一报数据格式错误。
    throw new Error(error instanceof Error && error.message === "市场 Skill 包含不安全的路径" ? error.message : "市场数据格式不正确，已取消安装");
  }
  // 签名对的 manifest 也不能张冠李戴：必须就是请求的这个 Skill。
  if (manifest.id !== options.id || manifest.skill !== entry.skill) throw new Error("Skill 文件校验失败，已取消安装");
  const { files } = manifest;
  if (!files.some((file) => file.path === "SKILL.md")) throw new Error("Skill 文件校验失败，已取消安装");
  if (files.length > marketplaceLimits.maxFiles) throw new Error("这个 Skill 的文件太多，已取消安装");
  if (files.some((file) => file.size > marketplaceLimits.maxFileBytes) || files.reduce((sum, file) => sum + file.size, 0) > marketplaceLimits.maxTotalBytes) {
    throw new Error("这个 Skill 太大，已取消安装");
  }

  await mkdir(skillsDir, { recursive: true });
  const staging = await mkdtemp(join(skillsDir, `.install-${entry.skill}-`));
  try {
    let next = 0;
    // 少量并发下载；任何一个失败就停止其余的，整体报错。
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const file = files[next++] as (typeof files)[number];
        const target = safeJoin(staging, file.path);
        const bytes = await getBytes(
          request,
          `${skillUrl}/files/${file.path.split("/").map(encodeURIComponent).join("/")}`,
          requestTimeoutMs,
          requestAttempts,
        );
        if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) throw new Error("Skill 文件校验失败，已取消安装");
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

async function getBytes(request: typeof fetch, url: string, timeoutMs: number, attempts: number): Promise<Uint8Array> {
  let failure: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    let response: Response;
    try {
      response = await request(url, { headers: { "User-Agent": "Vela" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      failure = new Error("无法连接市场服务，请检查网络后重试");
      continue;
    }
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (response.status === 404) throw new Error("市场里找不到这个 Skill");
    // 4xx 重试没有意义；服务端 5xx 多是暂时的，值得再试。
    failure = new Error("下载 Skill 失败，请稍后重试");
    if (response.status < 500) throw failure;
  }
  throw failure ?? new Error("下载 Skill 失败，请稍后重试");
}
