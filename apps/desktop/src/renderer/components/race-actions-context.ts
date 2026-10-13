import { createContext } from "react";
import type { Race } from "@vela/shared";

// 与 recipe-actions-context 一样放在组件模块之外，保持 Fast Refresh 下 Provider 与 Consumer 的身份一致。
export const RaceActionsContext = createContext<{
  /** 赛马启动后：打开工作台里的赛马分页。 */
  started: (race: Race) => void;
  /** 当前工作区已有的赛马数量；用于模式菜单里的「查看赛马」入口。 */
  count: number;
  open: () => void;
} | null>(null);
