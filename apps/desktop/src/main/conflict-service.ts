import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createWorktree, currentHead, resolveRepoRoot } from "@vela/workspace";
import {
  conflictLimits, createLogger, relativePath,
  type ConflictsState, type ConversationEditSummary, type FileOverlap, type MoveToWorktreeResult,
} from "@vela/shared";
import { writeJsonAtomic } from "./atomic-json";

const log = createLogger("conflicts");

export interface ConflictRuntime {
  /** 未归档且仍存在的对话；否则返回 null，它的记录会被丢弃。 */
  conversation(id: string): { title: string; cwd: string; hasWorkspace: boolean } | null;
  createConversation(cwd: string): Promise<string>;
  /** 受管 worktree 的根目录。 */
  worktreeRoot: string;
}

interface FileRecord { editedAt: number; edits: number }
interface Tracked { cwd: string; files: Map<string, FileRecord> }
interface StoredStore { schemaVersion: 1; conversations: Record<string, { cwd: string; files: Array<{ path: string; editedAt: number; edits: number }> }> }

/** 状态推导的输入：一个对话近期改过的文件，路径均为绝对路径。 */
export interface ConflictEntry {
  conversationId: string;
  title: string;
  cwd: string;
  files: ReadonlyMap<string, FileRecord>;
}

/** 纯函数：窗口内的改动汇总，以及被两个以上对话改过的文件。 */
export function buildConflictsState(entries: readonly ConflictEntry[], now: number, windowMs: number = conflictLimits.windowMs): ConflictsState {
  const cutoff = now - windowMs;
  const conversations: ConversationEditSummary[] = [];
  const byPath = new Map<string, Array<{ conversationId: string; title: string; editedAt: number; relativePath: string }>>();
  for (const entry of entries) {
    const files = [...entry.files]
      .filter(([, record]) => record.editedAt >= cutoff)
      .map(([path, record]) => ({ path, relativePath: relativePath(path, entry.cwd), editedAt: record.editedAt, edits: record.edits }))
      .sort((a, b) => b.editedAt - a.editedAt || a.path.localeCompare(b.path));
    if (files.length === 0) continue;
    conversations.push({ conversationId: entry.conversationId, title: entry.title, cwd: entry.cwd, files });
    for (const file of files) {
      const list = byPath.get(file.path) ?? [];
      list.push({ conversationId: entry.conversationId, title: entry.title, editedAt: file.editedAt, relativePath: file.relativePath });
      byPath.set(file.path, list);
    }
  }
  conversations.sort((a, b) => b.files[0]!.editedAt - a.files[0]!.editedAt || a.conversationId.localeCompare(b.conversationId));
  const overlaps: FileOverlap[] = [];
  for (const [path, list] of byPath) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.editedAt - a.editedAt || a.conversationId.localeCompare(b.conversationId));
    overlaps.push({
      path,
      relativePath: list[0]!.relativePath,
      conversations: list.map(({ conversationId, title, editedAt }) => ({ conversationId, title, editedAt })),
    });
  }
  overlaps.sort((a, b) => b.conversations[0]!.editedAt - a.conversations[0]!.editedAt || a.path.localeCompare(b.path));
  return { conversations, overlaps, windowMs, error: null };
}

export class ConflictService {
  private readonly tracked = new Map<string, Tracked>();
  private readonly listeners = new Set<() => void>();
  private saveTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private error: string | null = null;
  private readonly moving = new Set<string>();

  constructor(private readonly file: string, private readonly runtime: ConflictRuntime, private readonly clock: () => number = Date.now) {}

  init(): void {
    try {
      const store = JSON.parse(readFileSync(this.file, "utf8")) as StoredStore;
      if (store.schemaVersion !== 1 || !store.conversations || typeof store.conversations !== "object") throw new Error("schema");
      for (const [id, item] of Object.entries(store.conversations)) {
        if (!item || typeof item.cwd !== "string" || !isAbsolute(item.cwd) || !Array.isArray(item.files)) continue;
        const files = new Map<string, FileRecord>();
        for (const entry of item.files) {
          if (entry && typeof entry.path === "string" && isAbsolute(entry.path) && entry.path.length <= conflictLimits.pathLength
            && Number.isFinite(entry.editedAt) && Number.isInteger(entry.edits) && entry.edits > 0) {
            files.set(entry.path, { editedAt: entry.editedAt, edits: entry.edits });
          }
        }
        if (files.size > 0) this.tracked.set(id, { cwd: item.cwd, files });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      // 这只是辅助提醒，坏文件不阻塞应用；下次写入会覆盖它。
      log.error("conflict store load failed", error);
    }
  }

  /** 一次成功的 edit / write。路径相对对话工作目录解析，工作目录之外的绝对路径也照常记录。 */
  record(conversationId: string, cwd: string, rawPath: string, at: number = this.clock()): void {
    const trimmed = rawPath.trim();
    if (!trimmed || trimmed.length > conflictLimits.pathLength || trimmed.includes("\0") || !conversationId || !isAbsolute(cwd)) return;
    const path = resolve(cwd, trimmed);
    let entry = this.tracked.get(conversationId);
    if (!entry || entry.cwd !== cwd) {
      // 对话换了工作目录就不再沿用旧记录，路径语义已经变了。
      entry = { cwd, files: new Map() };
      this.tracked.set(conversationId, entry);
    }
    const previous = entry.files.get(path);
    entry.files.set(path, { editedAt: Math.max(at, previous?.editedAt ?? 0), edits: (previous?.edits ?? 0) + 1 });
    if (entry.files.size > conflictLimits.maxFilesPerConversation) {
      const oldest = [...entry.files].sort((a, b) => a[1].editedAt - b[1].editedAt)[0]!;
      entry.files.delete(oldest[0]);
    }
    this.changed();
  }

  forget(conversationId: string): void {
    if (this.tracked.delete(conversationId)) this.changed();
  }

  list(now: number = this.clock()): ConflictsState {
    const cutoff = now - conflictLimits.windowMs;
    const entries: ConflictEntry[] = [];
    let pruned = false;
    for (const [id, tracked] of this.tracked) {
      const conversation = this.runtime.conversation(id);
      if (!conversation) { this.tracked.delete(id); pruned = true; continue; }
      for (const [path, record] of tracked.files) {
        if (record.editedAt < cutoff) { tracked.files.delete(path); pruned = true; }
      }
      if (tracked.files.size === 0) { this.tracked.delete(id); pruned = true; continue; }
      entries.push({ conversationId: id, title: cleanTitle(conversation.title), cwd: tracked.cwd, files: tracked.files });
    }
    if (pruned) this.scheduleSave();
    return { ...buildConflictsState(entries, now), error: this.error };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * 从对话所在仓库的 HEAD 新建分支 worktree，并在其中新建一个对话。
   * 原对话在原目录里的未提交改动不会搬过去，原对话也保持不动；
   * 新对话的输入框会带上这些文件清单，方便继续。
   */
  async moveToWorktree(rawId: unknown): Promise<MoveToWorktreeResult> {
    if (typeof rawId !== "string" || !rawId) throw new Error("对话 ID 不正确");
    const conversationId = rawId;
    const conversation = this.runtime.conversation(conversationId);
    if (!conversation || !conversation.hasWorkspace) throw new Error("对话不存在或没有工作区");
    if (this.moving.has(conversationId)) throw new Error("正在转移这个对话");
    this.moving.add(conversationId);
    try {
      const repoRoot = await resolveRepoRoot(conversation.cwd);
      if (!repoRoot) throw new Error("这个工作区不是 Git 仓库，无法创建 worktree");
      const head = await currentHead(repoRoot).catch(() => null);
      if (!head) throw new Error("仓库还没有提交，无法从 HEAD 创建 worktree");
      const branch = `vela/task-${randomBytes(4).toString("hex")}`;
      const created = await createWorktree(repoRoot, { branch, newBranch: true, startPoint: head.sha }, this.runtime.worktreeRoot);
      if (!created.ok || !created.path) throw new Error(created.message || "worktree 创建失败");
      const inner = relative(repoRoot, conversation.cwd);
      const insideRepo = inner !== "" && !inner.startsWith("..") && !isAbsolute(inner);
      const targetCwd = insideRepo ? join(created.path, inner) : created.path;
      const newId = await this.runtime.createConversation(targetCwd);
      const files = [...(this.tracked.get(conversationId)?.files.keys() ?? [])]
        .map(path => relativePath(path, repoRoot))
        .sort();
      return { conversationId: newId, branch, worktree: created.path, seed: buildSeed(conversation.title, repoRoot, branch, head.sha, files) };
    } finally {
      this.moving.delete(conversationId);
    }
  }

  /** 应用退出前把待写的记录落盘。 */
  dispose(): void {
    if (this.emitTimer) { clearTimeout(this.emitTimer); this.emitTimer = null; }
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; this.save(); }
    this.listeners.clear();
  }

  private changed(): void {
    this.scheduleSave();
    if (this.emitTimer) return;
    // 一轮 edit 往往连着好几次，合并成一次通知。
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      for (const listener of [...this.listeners]) {
        try { listener(); } catch (error) { log.error("conflict listener failed", error); }
      }
    }, 200);
    this.emitTimer.unref?.();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1_000);
    this.saveTimer.unref?.();
  }

  private save(): void {
    const store: StoredStore = { schemaVersion: 1, conversations: {} };
    for (const [id, tracked] of this.tracked) {
      store.conversations[id] = {
        cwd: tracked.cwd,
        files: [...tracked.files].map(([path, record]) => ({ path, ...record })),
      };
    }
    try { writeJsonAtomic(this.file, store); this.error = null; }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); log.error("conflict store write failed", error); }
  }
}

function cleanTitle(title: string): string {
  const text = title.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text || "Untitled";
}

const seedFileLimit = 30;

function buildSeed(title: string, originalCwd: string, branch: string, sha: string, files: string[]): string {
  const lines = [
    `Continue the task from the conversation "${cleanTitle(title)}" in this isolated git worktree (branch ${branch}, created from ${sha.slice(0, 7)}).`,
    `That conversation was editing the same checkout as another conversation, so it was moved here. Its uncommitted edits stay in ${originalCwd} and are NOT in this worktree.`,
  ];
  if (files.length > 0) {
    lines.push("", "Files it had already edited there:");
    for (const file of files.slice(0, seedFileLimit)) lines.push(`- ${file}`);
    if (files.length > seedFileLimit) lines.push(`- … and ${files.length - seedFileLimit} more`);
  }
  lines.push("", "Re-read the files you need before changing them.");
  return lines.join("\n");
}
