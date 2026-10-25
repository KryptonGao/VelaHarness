import { thinkingLevels, type AppLocale, type MemoryLoadReport, type ModelCatalog, type SideChatMessage, type SideChatStoredEntry, type SideChatThread, type ThinkingLevel } from "@vela/shared";
import { tr } from "../locale";
import { uiStorage } from "../ui-storage";
import { composeQuotes } from "./selection-actions";

/** 侧边聊天自己的模型与推理强度，与主对话互不影响。 */
export interface SideChatModelChoice {
  provider: string;
  id: string;
  thinkingLevel: ThinkingLevel;
}

const choiceKey = "vela.sideChat.model";

/** 新开侧边聊天时沿用上一次的选择；没有时用当前主对话的模型。 */
export function readSideChatChoice(fallback: SideChatModelChoice | null): SideChatModelChoice | null {
  try {
    const raw = uiStorage.getItem(choiceKey);
    const parsed = raw ? JSON.parse(raw) as Partial<SideChatModelChoice> : null;
    if (parsed && typeof parsed.provider === "string" && typeof parsed.id === "string" &&
      (thinkingLevels as readonly unknown[]).includes(parsed.thinkingLevel)) {
      return { provider: parsed.provider, id: parsed.id, thinkingLevel: parsed.thinkingLevel as ThinkingLevel };
    }
  } catch {
    // 读不到时用主对话的模型。
  }
  return fallback;
}

export function writeSideChatChoice(choice: SideChatModelChoice): void {
  try {
    uiStorage.setItem(choiceKey, JSON.stringify(choice));
  } catch {
    // 只影响下次新开时的默认值。
  }
}

/** 所选模型在目录里的名字和可选推理强度；模型已移除时只能选「关闭」。 */
export function sideChatModelInfo(catalog: ModelCatalog | null, choice: SideChatModelChoice | null): {
  label: string | null;
  levels: ThinkingLevel[];
  level: ThinkingLevel;
} {
  const model = choice ? catalog?.models.find((item) => item.provider === choice.provider && item.id === choice.id) : undefined;
  // 侧边聊天没有 SubAgent，不提供 Ultra。
  const supported = model?.thinkingLevels.filter((level) => level !== "ultra");
  const levels: ThinkingLevel[] = supported?.length ? supported : ["off"];
  const wanted = choice?.thinkingLevel ?? "off";
  // 新模型不支持原来的强度时取不超过它的最高一档。
  const rank = (level: ThinkingLevel) => thinkingLevels.indexOf(level);
  const level = levels.includes(wanted) ? wanted
    : [...levels].reverse().find((candidate) => rank(candidate) <= rank(wanted)) ?? levels[0]!;
  return { label: model?.name ?? (choice ? `${choice.provider}/${choice.id}` : null), levels, level };
}

export interface SideChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 用户消息附带的引用（从对话里选中的文字），发给模型时放在正文前面。 */
  quotes?: string[];
  /** 正在流式接收。 */
  pending?: boolean;
  /** 用户停止或出错时中断，text 是已收到的部分。 */
  stopped?: boolean;
}

/** 落盘用：只保存有文字的消息，丢掉还没开始的占位回复；流式中的半截回复按已停止保存。 */
export function sideChatStoredEntries(entries: readonly SideChatEntry[]): SideChatStoredEntry[] {
  return entries.filter((entry) => entry.text.trim()).map((entry) => ({
    id: entry.id,
    role: entry.role,
    text: entry.text,
    ...(entry.quotes?.length ? { quotes: entry.quotes } : {}),
    ...(entry.stopped || entry.pending ? { stopped: true } : {}),
  }));
}

export function sideChatEntriesFromStored(stored: readonly SideChatStoredEntry[]): SideChatEntry[] {
  return stored.map((entry) => ({
    id: entry.id,
    role: entry.role,
    text: entry.text,
    ...(entry.quotes?.length ? { quotes: entry.quotes } : {}),
    ...(entry.stopped ? { stopped: true } : {}),
  }));
}

/**
 * 各侧边聊天标签最新的消息。标签因切换项目而卸载后再回来时，从这里恢复，
 * 不必等磁盘读取，也不会回到打开时的旧快照。
 */
const liveEntries = new Map<string, SideChatEntry[]>();

export function rememberSideChatEntries(threadId: string, entries: SideChatEntry[]): void {
  liveEntries.set(threadId, entries);
}

export function recallSideChatEntries(threadId: string): SideChatEntry[] | undefined {
  return liveEntries.get(threadId);
}

/** 已删除的聊天：仍在途中的回复收尾时不能再把它写回磁盘。 */
const deletedThreads = new Set<string>();

export function forgetSideChatEntries(threadId: string): void {
  liveEntries.delete(threadId);
  deletedThreads.add(threadId);
}

export function isSideChatDeleted(threadId: string): boolean {
  return deletedThreads.has(threadId);
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

/** 聊天列表里的名字：第一条用户消息（单行截断），还没有消息时叫「新聊天」。 */
export function sideChatTitle(entries: readonly SideChatStoredEntry[]): string {
  const first = entries.find((entry) => entry.role === "user" && oneLine(entry.text));
  return first ? clip(oneLine(first.text), 40) : tr("新聊天", "New chat");
}

/** 列表里的预览：最后一条消息，单行。 */
export function sideChatPreview(entries: readonly SideChatStoredEntry[]): string {
  const last = [...entries].reverse().find((entry) => oneLine(entry.text));
  return last ? clip(oneLine(last.text), 120) : "";
}

export interface SideChatSearchHit {
  thread: SideChatThread;
  /** 命中正文时的片段，用于在列表里高亮；只命中名字时为 null。 */
  snippet: { before: string; match: string; after: string } | null;
}

/** 按名字和全部消息搜索，不区分大小写；空查询返回全部，保持原有顺序。 */
export function searchSideChats(threads: readonly SideChatThread[], query: string): SideChatSearchHit[] {
  const needle = oneLine(query).toLowerCase();
  if (!needle) return threads.map((thread) => ({ thread, snippet: null }));
  const hits: SideChatSearchHit[] = [];
  for (const thread of threads) {
    let snippet: SideChatSearchHit["snippet"] = null;
    for (const entry of thread.entries) {
      const text = oneLine(entry.text);
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const start = Math.max(0, at - 18);
      snippet = {
        before: `${start > 0 ? "…" : ""}${text.slice(start, at)}`,
        match: text.slice(at, at + needle.length),
        after: clip(text.slice(at + needle.length), 80),
      };
      break;
    }
    if (snippet || sideChatTitle(thread.entries).toLowerCase().includes(needle)) hits.push({ thread, snippet });
  }
  return hits;
}

/** 列表右侧的时间：今天显示时刻，昨天写「昨天」，一周内写星期，更早写日期。 */
export function sideChatTimeLabel(updatedAt: number, now: number, locale: AppLocale): string {
  const day = (time: number) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };
  const days = Math.round((day(now) - day(updatedAt)) / 86_400_000);
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(updatedAt);
  if (days <= 0) return format({ hour: "2-digit", minute: "2-digit" });
  if (days === 1) return tr("昨天", "Yesterday");
  if (days < 7) return format({ weekday: "short" });
  return format({ year: new Date(now).getFullYear() === new Date(updatedAt).getFullYear() ? undefined : "numeric", month: "numeric", day: "numeric" });
}

/** 发给模型的历史：只要有文字的消息，丢掉还没开始的占位回复。 */
export function sideChatRequestMessages(entries: readonly SideChatEntry[]): SideChatMessage[] {
  return entries.filter((entry) => entry.text.trim()).map((entry) => ({ role: entry.role, text: composeQuotes(entry.quotes ?? [], entry.text) }));
}

/** 重试时回到最后一条用户消息为止，后面中断的回复丢掉。没有用户消息时返回 null。 */
export function sideChatRetryHistory(entries: readonly SideChatEntry[]): SideChatEntry[] | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]!.role === "user") return entries.slice(0, index + 1);
  }
  return null;
}

/** 记忆状态的简短说明；还没发过消息时传 null。 */
export function sideChatMemoryLabel(context: { memory: readonly MemoryLoadReport[]; memoryEnabled: boolean } | null): string {
  if (!context) return tr("带入长期记忆", "Uses long-term memory");
  if (!context.memoryEnabled) return tr("记忆已关闭", "Memory is off");
  const memory = context.memory;
  const loaded = memory.filter((item) => item.status === "loaded" && item.bytes > 0);
  if (loaded.length === 0) return tr("没有可带入的记忆", "No memory to include");
  const scopes = new Set(loaded.map((item) => item.scope));
  if (scopes.has("global") && scopes.has("project")) return tr("已带入全局与项目记忆", "Global and project memory included");
  return scopes.has("project") ? tr("已带入项目记忆", "Project memory included") : tr("已带入全局记忆", "Global memory included");
}
