import { createContext, useContext } from "react";

/**
 * 当前正在运行的这一轮里,最新一次提交的待办工具 id。
 * 没有 Provider 时(例如子代理面板)保持旧行为;有 Provider 时,不是它的待办清单都算已结束。
 */
export const PlanLiveContext = createContext<{ liveToolId: string | null } | null>(null);

/** 这条待办所属的任务是否已经结束:轮次已结束,或已被本轮更新的待办取代。 */
export function usePlanEnded(toolId: string | undefined): boolean {
  const live = useContext(PlanLiveContext);
  return live !== null && live.liveToolId !== toolId;
}
