import { lstat, readdir, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { storageCategoryIds, type StorageCategory, type StorageCategoryId, type StorageConversation, type StorageDisk, type StorageOverview } from "@vela/shared";

/** 资料目录顶层条目所属的类别；没有列出的都算「其他」。 */
const homeEntries: Readonly<Record<string, StorageCategoryId>> = {
  "sessions": "conversations",
  "conversations.json": "conversations",
  "side-chats": "conversations",
  "traces": "traces",
  "subagents": "subagents",
  "checkpoints": "checkpoints",
  "skills": "skills",
  "worktrees": "worktrees",
  "logs": "logs",
  "updates": "updates",
};

/** Electron 数据目录里可以随时重建、由「清除缓存」回收的文件夹。 */
export const cacheFolders = ["Cache", "Code Cache"] as const;

const conversationIdPattern = /^[A-Za-z0-9_-]+$/;
const topConversations = 8;

export function isConversationId(value: string): boolean {
  return conversationIdPattern.test(value);
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

interface Measured { bytes: number; files: number }

/**
 * 统计目录占用。不跟随符号链接；多个路径指向同一份内容（硬链接，检查点就是这样共用文件的）时只算一次，
 * `seen` 在一次扫描里共用，所以类别之间也不会重复计算。
 */
export async function measurePath(path: string, seen: Set<string> = new Set(), exclude: ReadonlySet<string> = new Set()): Promise<Measured> {
  const total: Measured = { bytes: 0, files: 0 };
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (exclude.has(current)) continue;
    const stat = await lstat(current).catch(error => { if (missing(error)) return null; throw error; });
    if (!stat) continue;
    if (stat.isDirectory()) {
      const names = await readdir(current).catch(error => { if (missing(error)) return [] as string[]; throw error; });
      for (const name of names) stack.push(join(current, name));
    } else if (stat.isFile()) {
      if (stat.nlink > 1) {
        const key = `${stat.dev}:${stat.ino}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      total.bytes += stat.size;
      total.files += 1;
    }
  }
  return total;
}

async function entries(directory: string): Promise<string[]> {
  return readdir(directory).catch(error => { if (missing(error)) return []; throw error; });
}

/** 资料目录所在磁盘的总容量和可用空间。 */
export async function readDisk(path: string): Promise<StorageDisk> {
  const stats = await statfs(path);
  return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
}

export interface ScanOptions {
  home: string;
  /** Electron 数据目录；缓存文件夹从这里统计。 */
  userData: string;
  titleOf: (conversationId: string) => string | null;
  /** 轨迹正在被使用（已载入内存）的对话。 */
  traceInUse: (conversationId: string) => boolean;
}

export async function scanStorage(options: ScanOptions): Promise<StorageOverview> {
  const { home, userData } = options;
  const seen = new Set<string>();
  const totals = new Map<StorageCategoryId, Measured>(storageCategoryIds.map(id => [id, { bytes: 0, files: 0 }]));
  const add = (id: StorageCategoryId, measured: Measured) => {
    const total = totals.get(id)!;
    total.bytes += measured.bytes;
    total.files += measured.files;
  };

  const cachePaths = cacheFolders.map(name => join(userData, name));
  // 开发时 Electron 数据目录可能放在资料目录里面，缓存已单独统计，不能在「其他」里再算一次。
  const exclude = new Set(cachePaths);

  for (const name of await entries(home)) {
    add(homeEntries[name] ?? "other", await measurePath(join(home, name), seen, exclude));
  }
  for (const path of cachePaths) add("cache", await measurePath(path, seen));

  const categories: StorageCategory[] = storageCategoryIds.map(id => ({ id, ...totals.get(id)! }));
  return {
    home,
    totalBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
    categories,
    conversations: await largestConversations(options),
    measuredAt: Date.now(),
  };
}

async function largestConversations(options: ScanOptions): Promise<StorageConversation[]> {
  const { home } = options;
  const sizes = new Map<string, { bytes: number; traceBytes: number }>();
  const entry = (id: string) => {
    let value = sizes.get(id);
    if (!value) sizes.set(id, value = { bytes: 0, traceBytes: 0 });
    return value;
  };
  const fileSize = async (path: string) => (await lstat(path).catch(() => null))?.size ?? 0;

  for (const name of await entries(join(home, "traces"))) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    const size = await fileSize(join(home, "traces", name));
    entry(id).bytes += size;
    entry(id).traceBytes += size;
  }
  for (const name of await entries(join(home, "sessions"))) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(name.lastIndexOf("_") + 1, -".jsonl".length);
    if (id) entry(id).bytes += await fileSize(join(home, "sessions", name));
  }
  for (const id of await entries(join(home, "subagents"))) {
    entry(id).bytes += (await measurePath(join(home, "subagents", id))).bytes;
  }

  return [...sizes]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, topConversations)
    .map(([id, size]) => ({ id, title: options.titleOf(id), bytes: size.bytes, traceBytes: size.traceBytes, traceInUse: options.traceInUse(id) }));
}

export interface CleanOutcome {
  freedBytes: number;
  removedFiles: number;
  skipped: number;
}

/** 删除轨迹文件；正在使用的对话保留，避免记录器继续往已删除的文件里写。 */
export async function cleanTraces(home: string, inUse: (conversationId: string) => boolean): Promise<CleanOutcome> {
  const outcome: CleanOutcome = { freedBytes: 0, removedFiles: 0, skipped: 0 };
  const directory = join(home, "traces");
  for (const name of await entries(directory)) {
    if (!name.endsWith(".jsonl")) continue;
    if (inUse(name.slice(0, -".jsonl".length))) { outcome.skipped += 1; continue; }
    const path = join(directory, name);
    const size = (await lstat(path).catch(() => null))?.size ?? 0;
    await rm(path, { force: true });
    outcome.freedBytes += size;
    outcome.removedFiles += 1;
  }
  return outcome;
}

export async function deleteTrace(home: string, conversationId: string, inUse: (conversationId: string) => boolean): Promise<CleanOutcome> {
  if (!isConversationId(conversationId)) throw new Error("对话标识不正确");
  if (inUse(conversationId)) return { freedBytes: 0, removedFiles: 0, skipped: 1 };
  const path = join(home, "traces", `${conversationId}.jsonl`);
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isFile()) return { freedBytes: 0, removedFiles: 0, skipped: 0 };
  await rm(path, { force: true });
  return { freedBytes: stat.size, removedFiles: 1, skipped: 0 };
}

/** 删除今天之前的日志文件；今天的仍在写入，保留。 */
export async function cleanLogs(home: string, now: Date = new Date()): Promise<CleanOutcome> {
  const outcome: CleanOutcome = { freedBytes: 0, removedFiles: 0, skipped: 0 };
  const directory = join(home, "logs");
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const name of await entries(directory)) {
    const path = join(directory, name);
    const stat = await lstat(path).catch(() => null);
    if (!stat?.isFile()) continue;
    if (stat.mtimeMs >= startOfToday) { outcome.skipped += 1; continue; }
    await rm(path, { force: true });
    outcome.freedBytes += stat.size;
    outcome.removedFiles += 1;
  }
  return outcome;
}

/** 删除已下载但未安装的更新包。调用方要先确认没有正在下载或等待安装的更新。 */
export async function cleanUpdateStaging(home: string): Promise<CleanOutcome> {
  const directory = join(home, "updates", "staging");
  const measured = await measurePath(directory);
  await rm(directory, { recursive: true, force: true });
  return { freedBytes: measured.bytes, removedFiles: measured.files, skipped: 0 };
}
