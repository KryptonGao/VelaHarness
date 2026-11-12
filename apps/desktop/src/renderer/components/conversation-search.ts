import { displayConversationTitle } from "./conversation-title";
import type { ConversationSummary } from "@vela/shared";
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
