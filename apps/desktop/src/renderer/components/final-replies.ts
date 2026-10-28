import { recommendedActionsToolName } from "@vela/shared";
import type { UiMessage } from "../hooks/useSession";

/**
 * 一轮里留在折叠区外的「最终回复」。
 *
 * 只取最后一条有文字的消息会出问题：模型常在带 recommend_actions 的长答案之后再补一句
 * 「已完成。」，结果只有这一句露在外面，真正的答案反而被折进「用时」里。
 * 所以从最后一条文字往前，把中间没有做过实际工作（只隔着 recommend_actions 或纯思考）的
 * 文字消息一并算进来；一旦遇到别的工具调用就停下，那之前的文字属于过程。
 */
export function selectFinalReplies(assistants: readonly UiMessage[]): UiMessage[] {
  let last = assistants.length - 1;
  while (last >= 0 && assistants[last]!.text.trim().length === 0) last -= 1;
  if (last < 0) return [];

  const replies = [assistants[last]!];
  for (let index = last - 1; index >= 0; index -= 1) {
    const message = assistants[index]!;
    if (!message.tools.every((tool) => tool.name === recommendedActionsToolName)) break;
    if (message.text.trim().length > 0) replies.unshift(message);
  }
  return replies;
}
