import { tr } from "../locale";

/** 主进程为未命名对话存的占位标题（持久化值，不能随界面语言变）。 */
export const PLACEHOLDER_CONVERSATION_TITLE = "新对话";

/** 显示用标题：空标题和占位标题统一换成当前界面语言的「新对话」。 */
export function displayConversationTitle(title: string | null | undefined, untitledLabel: string = tr("新对话", "New chat")): string {
  return !title || title === PLACEHOLDER_CONVERSATION_TITLE ? untitledLabel : title;
}
