export const marketplaceCategories = ["office", "agent", "docs", "frontend", "engineering"] as const;

export type MarketplaceCategory = (typeof marketplaceCategories)[number];

export type MarketplaceSkillId = string;

export interface MarketplaceSkillEntry {
  id: MarketplaceSkillId;
  /** 上游 GitHub 仓库。 */
  source: string;
  /** Skill 名称（SKILL.md 里的 name），也是安装后的目录名。 */
  skill: string;
  /** 上游目录名与 Skill 名称不同时填写。 */
  dir?: string;
  category: MarketplaceCategory;
  /** 英文简介；界面里没有对应翻译的新 Skill 用它兜底。 */
  description?: string;
  /** 这个 Skill 自带或依赖的 MCP Server；没有就不填，详情页也就不显示 MCP 一栏。 */
  mcp?: readonly { name: string; description: string }[];
}

/**
 * Skill 市场的线上格式。构建脚本、Worker 和客户端共用这里的类型与校验，
 * 三方对“什么是合法的目录和 manifest”只有一个答案。
 * 目录与 manifest 都是「原始字节 + 独立 .sig 签名」：先验字节，再解析，不做规范化。
 */

export const marketplaceProtocolSchema = 1;

/** 目录和 manifest 允许的上限；构建脚本与客户端使用同一组数字。 */
export const marketplaceLimits = {
  maxFiles: 400,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 60 * 1024 * 1024,
} as const;

const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const skillNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isMarketplaceId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

/** 目录里一个 Skill 的条目：在本地条目的基础上加上固定的 commit 与 manifest 摘要。 */
export interface MarketplaceCatalogEntry extends MarketplaceSkillEntry {
  /** 内容版本，目前取固定 commit 的前 7 位。 */
  version: string;
  /** 维护者审核过的上游 commit。 */
  commit: string;
  /** manifest.json 原始字节的 SHA-256；目录因此也钉住了每个 manifest。 */
  manifestSha256: string;
  fileCount: number;
  totalBytes: number;
}

export interface MarketplaceCatalogFile {
  schema: typeof marketplaceProtocolSchema;
  skills: MarketplaceCatalogEntry[];
}

export interface MarketplaceManifestFile {
  schema: typeof marketplaceProtocolSchema;
  id: string;
  skill: string;
  version: string;
  source: string;
  commit: string;
  /** Skill 在上游仓库里的目录，只用于审计。 */
  upstreamPath: string;
  files: { path: string; size: number; sha256: string }[];
}

type Raw = Record<string, unknown>;

/** 相对路径只能由普通片段组成；拒绝绝对路径、`..`、反斜杠、控制字符。 */
export function isSafeMarketplacePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function record(value: unknown, what: string): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what} 格式不正确`);
  return value as Raw;
}

function text(value: unknown, what: string, pattern?: RegExp): string {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) throw new Error(`${what} 格式不正确`);
  return value;
}

function count(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${what} 格式不正确`);
  return value;
}

/** 本地条目的公共字段：目录来源文件、内置目录和云端目录用同一套校验。 */
export function parseMarketplaceEntry(input: unknown): MarketplaceSkillEntry {
  const raw = record(input, "目录条目");
  const category = raw.category;
  if (!marketplaceCategories.includes(category as never)) throw new Error("目录条目 category 格式不正确");
  const entry: MarketplaceSkillEntry = {
    id: text(raw.id, "目录条目 id", idPattern),
    source: text(raw.source, "目录条目 source", repoPattern),
    skill: text(raw.skill, "目录条目 skill", skillNamePattern),
    category: category as MarketplaceSkillEntry["category"],
  };
  if (raw.dir !== undefined) entry.dir = text(raw.dir, "目录条目 dir", skillNamePattern);
  if (raw.description !== undefined) entry.description = text(raw.description, "目录条目 description");
  if (raw.mcp !== undefined) {
    if (!Array.isArray(raw.mcp)) throw new Error("目录条目 mcp 格式不正确");
    entry.mcp = raw.mcp.map((item) => {
      const server = record(item, "目录条目 mcp");
      return { name: text(server.name, "mcp name"), description: text(server.description, "mcp description") };
    });
  }
  return entry;
}

export function parseMarketplaceCatalog(json: string): MarketplaceCatalogFile {
  const root = record(JSON.parse(json), "目录");
  if (root.schema !== marketplaceProtocolSchema) throw new Error("目录版本不受支持");
  if (!Array.isArray(root.skills)) throw new Error("目录格式不正确");
  const seen = new Set<string>();
  const skills = root.skills.map((item): MarketplaceCatalogEntry => {
    const raw = record(item, "目录条目");
    const entry = parseMarketplaceEntry(raw);
    if (seen.has(entry.id)) throw new Error("目录里有重复的 id");
    seen.add(entry.id);
    return {
      ...entry,
      version: text(raw.version, "目录条目 version"),
      commit: text(raw.commit, "目录条目 commit", commitPattern),
      manifestSha256: text(raw.manifestSha256, "目录条目 manifestSha256", sha256Pattern),
      fileCount: count(raw.fileCount, "目录条目 fileCount"),
      totalBytes: count(raw.totalBytes, "目录条目 totalBytes"),
    };
  });
  return { schema: marketplaceProtocolSchema, skills };
}

export function parseMarketplaceManifest(json: string): MarketplaceManifestFile {
  const raw = record(JSON.parse(json), "manifest");
  if (raw.schema !== marketplaceProtocolSchema) throw new Error("manifest 版本不受支持");
  if (!Array.isArray(raw.files)) throw new Error("manifest 格式不正确");
  const seen = new Set<string>();
  const files = raw.files.map((item) => {
    const file = record(item, "manifest 文件条目");
    const path = text(file.path, "manifest 文件路径");
    if (!isSafeMarketplacePath(path)) throw new Error("市场 Skill 包含不安全的路径");
    // 大小写不敏感的文件系统会把这类路径写到同一个文件上。
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error("manifest 里有重复的文件路径");
    seen.add(key);
    return { path, size: count(file.size, "manifest 文件大小"), sha256: text(file.sha256, "manifest 文件哈希", sha256Pattern) };
  });
  return {
    schema: marketplaceProtocolSchema,
    id: text(raw.id, "manifest id", idPattern),
    skill: text(raw.skill, "manifest skill", skillNamePattern),
    version: text(raw.version, "manifest version"),
    source: text(raw.source, "manifest source", repoPattern),
    commit: text(raw.commit, "manifest commit", commitPattern),
    upstreamPath: text(raw.upstreamPath, "manifest upstreamPath"),
    files,
  };
}
