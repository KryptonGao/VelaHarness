import { displayConversationTitle } from "./conversation-title";
import { parseSearchQuery, type ConversationSearchFilters, type ConversationSummary } from "@vela/shared";
import { conversationWorkspace } from "./workspace-names";

export interface ConversationGroup {
  cwd: string;
  name: string;
  conversations: ConversationSummary[];
}

export function workspaceName(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || cwd;
}

/** 首条消息发送后才进入列表；兼容未提供计数的旧会话摘要。 */
export function isListedConversation(conversation: ConversationSummary): boolean {
  return conversation.archivedAt === null && conversation.messageCount !== 0;
}

/** 所有关键词均可在标题或工作区路径中命中，保留全局最近使用排序。 */
export function searchActiveConversations(
  conversations: ConversationSummary[],
  query: string,
  untitledLabel: string,
): ConversationSummary[] {
  const keywords = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return conversations.filter(conversation => {
    if (!isListedConversation(conversation)) return false;
    const searchable = `${displayConversationTitle(conversation.title, untitledLabel)}\n${conversation.hasWorkspace === false ? "" : conversationWorkspace(conversation)}`.toLocaleLowerCase();
    return keywords.every(keyword => searchable.includes(keyword));
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function groupActiveConversations(
  conversations: ConversationSummary[],
  query: string,
  untitledLabel: string,
): ConversationGroup[] {
  const byWorkspace = new Map<string, ConversationSummary[]>();
  for (const conversation of searchActiveConversations(conversations, query, untitledLabel)) {
    if (conversation.hasWorkspace === false) continue;
    const workspace = conversationWorkspace(conversation);
    const list = byWorkspace.get(workspace) ?? [];
    list.push(conversation);
    byWorkspace.set(workspace, list);
  }
  return [...byWorkspace].map(([cwd, list]) => ({ cwd, name: workspaceName(cwd), conversations: list }));
}

export type DatePreset = "any" | "day" | "week" | "month" | "quarter" | "custom";

/** What the search dialog's filters are set to. Dates for "custom" are yyyy-mm-dd, as a date input gives them. */
export interface SearchScope {
  /** `undefined` for every project, "" for chats that have none. */
  workspace?: string;
  datePreset: DatePreset;
  from: string;
  to: string;
  includeArchived: boolean;
  includeTools: boolean;
}

export const defaultSearchScope: SearchScope = {
  datePreset: "any", from: "", to: "", includeArchived: true, includeTools: true,
};

const presetDays: Record<Exclude<DatePreset, "any" | "custom">, number> = { day: 1, week: 7, month: 30, quarter: 90 };

function localDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Time bounds of a scope: from inclusive, to exclusive. A custom end date includes that whole day. */
export function scopeRange(scope: SearchScope, now = Date.now()): { from?: number; to?: number } {
  if (scope.datePreset === "any") return {};
  if (scope.datePreset !== "custom") return { from: now - presetDays[scope.datePreset] * 86_400_000 };
  const from = localDay(scope.from);
  const to = localDay(scope.to);
  if (to) to.setDate(to.getDate() + 1);
  return { ...(from ? { from: from.getTime() } : {}), ...(to ? { to: to.getTime() } : {}) };
}

/** The filters the main process applies to message search. */
export function scopeFilters(scope: SearchScope, now = Date.now()): ConversationSearchFilters {
  return {
    ...(scope.workspace !== undefined ? { workspace: scope.workspace } : {}),
    ...scopeRange(scope, now),
    includeArchived: scope.includeArchived,
    includeTools: scope.includeTools,
  };
}

/** Project a chat belongs to as the search index records it: "" when it has none. */
export function searchWorkspace(conversation: Pick<ConversationSummary, "cwd" | "worktree" | "hasWorkspace">): string {
  return conversation.hasWorkspace === false ? "" : conversationWorkspace(conversation);
}

/**
 * Chats whose title or project path contain every keyword, newest first, inside the scope.
 * Archived chats only show up once something is typed; the empty search stays the list of recent chats.
 */
export function searchConversationTitles(
  conversations: ConversationSummary[],
  query: string,
  untitledLabel: string,
  scope: SearchScope,
  now = Date.now(),
): ConversationSummary[] {
  const keywords = parseSearchQuery(query).map(keyword => keyword.toLocaleLowerCase());
  const range = scopeRange(scope, now);
  return conversations.filter(conversation => {
    if (conversation.messageCount === 0) return false;
    if (conversation.archivedAt !== null && !(scope.includeArchived && keywords.length > 0)) return false;
    if (scope.workspace !== undefined && searchWorkspace(conversation) !== scope.workspace) return false;
    if (range.from !== undefined && conversation.updatedAt < range.from) return false;
    if (range.to !== undefined && conversation.updatedAt >= range.to) return false;
    const searchable = `${displayConversationTitle(conversation.title, untitledLabel)}\n${conversation.hasWorkspace === false ? "" : conversationWorkspace(conversation)}`.toLocaleLowerCase();
    return keywords.every(keyword => searchable.includes(keyword));
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Projects to offer in the filter, the most recently used first. "" stands for chats without a project. */
export function searchProjects(conversations: readonly ConversationSummary[]): string[] {
  const latest = new Map<string, number>();
  for (const conversation of conversations) {
    if (conversation.messageCount === 0) continue;
    const path = searchWorkspace(conversation);
    latest.set(path, Math.max(latest.get(path) ?? 0, conversation.updatedAt));
  }
  return [...latest].sort((a, b) => b[1] - a[1]).map(([path]) => path);
}
