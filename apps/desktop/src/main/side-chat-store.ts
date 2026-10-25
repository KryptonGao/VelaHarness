import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SideChatStoredEntry, SideChatThread } from "@vela/shared";
import { writeJsonAtomic } from "./atomic-json";

const maxWorkspaceLength = 4096;
const maxThreads = 50;
const maxEntries = 400;
const maxEntryChars = 100_000;
const maxQuotes = 20;
const maxQuoteChars = 20_000;
const maxIdLength = 100;

interface ProjectFile {
  version: 1;
  workspace: string;
  threads: SideChatThread[];
}

export function parseSideChatWorkspace(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > maxWorkspaceLength || raw.includes("\0")) throw new Error("侧边聊天项目不正确");
  return raw;
}

export function parseSideChatThreadId(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > maxIdLength) throw new Error("侧边聊天不正确");
  return raw;
}

function parseEntry(raw: unknown): SideChatStoredEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id || item.id.length > maxIdLength) return null;
  if ((item.role !== "user" && item.role !== "assistant") || typeof item.text !== "string") return null;
  if (!item.text.trim() || item.text.length > maxEntryChars) return null;
  const quotes = Array.isArray(item.quotes)
    ? item.quotes.filter((quote): quote is string => typeof quote === "string" && quote.length <= maxQuoteChars).slice(0, maxQuotes)
    : [];
  return {
    id: item.id,
    role: item.role,
    text: item.text,
    ...(quotes.length > 0 ? { quotes } : {}),
    ...(item.stopped === true ? { stopped: true } : {}),
  };
}

/** 校验并规整一段侧边聊天：丢掉空消息与格式不对的消息，只保留最近的消息。 */
export function parseSideChatThread(raw: unknown): SideChatThread {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("侧边聊天不正确");
  const input = raw as Record<string, unknown>;
  const id = parseSideChatThreadId(input.id);
  if (typeof input.number !== "number" || !Number.isInteger(input.number) || input.number < 1 || input.number > 10_000) {
    throw new Error("侧边聊天不正确");
  }
  if (!Array.isArray(input.entries)) throw new Error("侧边聊天不正确");
  const entries = input.entries.map(parseEntry).filter((entry): entry is SideChatStoredEntry => entry !== null).slice(-maxEntries);
  const updatedAt = typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now();
  return { id, number: input.number, updatedAt, entries };
}

/**
 * 侧边聊天历史：每个项目（工作区目录）一个文件，放在资料目录的 `side-chats/` 下。
 * 同一项目的所有对话和标签读写同一份；没有项目的对话共用 workspace 为空字符串的那一份。
 * 读写同步完成，Electron 主进程里的调用天然串行，不会互相覆盖。
 */
export class SideChatStore {
  constructor(private readonly directory: string) {}

  private fileFor(workspace: string): string {
    return join(this.directory, `${createHash("sha256").update(workspace).digest("hex").slice(0, 32)}.json`);
  }

  private read(workspace: string): SideChatThread[] {
    let raw: string;
    try {
      raw = readFileSync(this.fileFor(workspace), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 文件损坏时当作没有历史，下一次保存会覆盖。
      return [];
    }
    const threads = (parsed as { threads?: unknown } | null)?.threads;
    if (!Array.isArray(threads)) return [];
    const result: SideChatThread[] = [];
    for (const thread of threads) {
      try {
        const next = parseSideChatThread(thread);
        if (next.entries.length > 0) result.push(next);
      } catch {
        // 跳过无法识别的条目。
      }
    }
    return result;
  }

  private write(workspace: string, threads: SideChatThread[]): void {
    if (threads.length === 0) {
      rmSync(this.fileFor(workspace), { force: true });
      return;
    }
    mkdirSync(this.directory, { recursive: true });
    const file: ProjectFile = { version: 1, workspace, threads };
    writeJsonAtomic(this.fileFor(workspace), file, 2);
  }

  list(workspace: string): SideChatThread[] {
    return this.read(workspace).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  save(workspace: string, thread: SideChatThread): void {
    const others = this.read(workspace).filter((item) => item.id !== thread.id);
    if (thread.entries.length === 0) {
      this.write(workspace, others);
      return;
    }
    const next = [...others, thread].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, maxThreads);
    this.write(workspace, next);
  }

  remove(workspace: string, threadId: string): void {
    this.write(workspace, this.read(workspace).filter((item) => item.id !== threadId));
  }
}
