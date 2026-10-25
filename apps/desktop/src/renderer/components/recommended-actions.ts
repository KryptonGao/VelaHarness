import { recommendedActionsToolName, type RecommendedActions } from "@vela/shared";
import type { UiMessage } from "../hooks/useSession";

export interface TurnRecommendation {
  /** 产生这组推荐的 recommend_actions 工具调用 id，用来记住用户已经关闭了哪一张。 */
  id: string;
  recommendation: RecommendedActions;
}

/** 最后一轮（最后一条用户消息之后）里模型给出的推荐操作；本轮没有或还没完成时返回 null。 */
export function latestRecommendedActions(messages: readonly UiMessage[]): TurnRecommendation | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") return null;
    for (let toolIndex = message.tools.length - 1; toolIndex >= 0; toolIndex--) {
      const tool = message.tools[toolIndex]!;
      if (tool.name === recommendedActionsToolName && tool.status === "done" && tool.activity?.recommendedActions) {
        return { id: tool.id, recommendation: tool.activity.recommendedActions };
      }
    }
  }
  return null;
}
