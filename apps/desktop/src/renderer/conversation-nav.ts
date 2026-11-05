import type { ConversationSummary } from "@vela/shared";
import { groupActiveConversations, searchActiveConversations } from "./components/conversation-search";
import { activityReason, groupActivityConversations, type ActivityOptions, type SidebarView } from "./components/conversation-activity";

/** 按侧边栏当前视图里从上到下的顺序排列聊天,键盘切换聊天时按这个顺序走。 */
export function sidebarConversationOrder(
  conversations: readonly ConversationSummary[],
  view: SidebarView,
  options: ActivityOptions,
  untitledLabel: string,
  now = Date.now(),
): ConversationSummary[] {
  const list = [...conversations];
  if (view === "activity") return groupActivityConversations(list, options, now).flatMap(group => group.conversations);
  const grouped = groupActiveConversations(list, "", untitledLabel).flatMap(group => group.conversations);
  const standalone = searchActiveConversations(list, "", untitledLabel).filter(conversation => conversation.hasWorkspace === false);
  return [...grouped, ...standalone];
}

/** 当前聊天前/后一个;走到头时绕回另一端。当前聊天不在列表里(新对话)时,从头/尾开始。 */
export function adjacentConversation(
  order: readonly ConversationSummary[],
  activeId: string | null,
  direction: 1 | -1,
): ConversationSummary | null {
  if (order.length === 0) return null;
  const index = order.findIndex(conversation => conversation.id === activeId);
  if (index === -1) return direction === 1 ? order[0] : order[order.length - 1];
  if (order.length === 1) return null;
  return order[(index + direction + order.length) % order.length];
}

/** 当前聊天之后第一个等待回答或出错的聊天,到末尾后绕回开头;没有需要关注的聊天时返回 null。 */
export function nextAttentionConversation(
  order: readonly ConversationSummary[],
  activeId: string | null,
  options: ActivityOptions,
): ConversationSummary | null {
  const needsAttention = (conversation: ConversationSummary) => {
    const reason = activityReason(conversation, options);
    return reason === "waiting" || reason === "error";
  };
  const start = order.findIndex(conversation => conversation.id === activeId);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(start + step + order.length) % order.length];
    if (candidate.id !== activeId && needsAttention(candidate)) return candidate;
  }
  return null;
}
