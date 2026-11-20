import { createContext } from "react";
import { emptyConflictsState, type ConflictsState } from "@vela/shared";

export interface ConflictContextValue {
  state: ConflictsState;
  dismissedTurns: ReadonlyMap<string, number>;
  dismissTurn: (conversationId: string, turnStartedAt: number) => void;
  openOverview: () => void;
  openConversation: (conversationId: string) => void;
  /** 把对话转到新建的独立 worktree，并切到其中的新对话；失败时抛错。 */
  moveToWorktree: (conversationId: string) => Promise<void>;
}

// 放在组件文件之外，避免 Fast Refresh 时 Provider 与 Consumer 身份分离。
export const ConflictContext = createContext<ConflictContextValue>({
  state: emptyConflictsState,
  dismissedTurns: new Map(),
  dismissTurn: () => undefined,
  openOverview: () => undefined,
  openConversation: () => undefined,
  moveToWorktree: async () => undefined,
});
