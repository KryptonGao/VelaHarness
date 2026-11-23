import type { IconName } from "./icons";
import { tr } from "../locale";

export const conversationDetails = {
  trace: { label: () => tr("轨迹", "Trace"), icon: "history" },
  usage: { label: () => tr("使用统计", "Usage"), icon: "chart-bar" },
  context: { label: () => tr("上下文", "Context"), icon: "brain" },
  budget: { label: () => tr("上限设置", "Limit settings"), icon: "sliders" },
} satisfies Record<string, { label(): string; icon: IconName }>;

export type ConversationDetail = keyof typeof conversationDetails;
export const conversationDetailKeys = Object.keys(conversationDetails) as ConversationDetail[];
export type ConversationViewKey = "chat" | "versionControl" | ConversationDetail;

export function isConversationDetail(key: string): key is ConversationDetail {
  return Object.hasOwn(conversationDetails, key);
}

export function isEmptyConversationView(key: ConversationViewKey, emptyConversation: boolean) {
  return emptyConversation && isConversationDetail(key) && key !== "budget";
}
