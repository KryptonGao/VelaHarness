import { createContext, useContext } from "react";
import type { ThinkingGroupMode } from "../hooks/usePreferences";

/** 思考分组方式由偏好决定,聊天视图和子代理面板各自读取,不必逐层传 prop。 */
export const ThinkingGroupModeContext = createContext<ThinkingGroupMode>("single");

export function useThinkingGroupMode(): ThinkingGroupMode {
  return useContext(ThinkingGroupModeContext);
}
