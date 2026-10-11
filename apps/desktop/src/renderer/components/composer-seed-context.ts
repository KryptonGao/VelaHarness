import { createContext, useContext, useEffect, useRef } from "react";

/** 要填入某个对话输入框的一段文本，例如任务交接包。输入框在对话匹配时取走它。 */
export interface ComposerSeed {
  /** 每次预填唯一，用来确认取走的是同一份。 */
  id: string;
  conversationId: string;
  text: string;
}

// 放在组件文件之外，避免 Fast Refresh 时 Provider 与 Consumer 身份分离。
export const ComposerSeedContext = createContext<{
  seed: ComposerSeed | null;
  consume: (id: string) => void;
} | null>(null);

/** 输入框用：当前对话有待填入的文本时调用 apply，并把它标记为已取走。 */
export function useComposerSeed(conversationId: string | null, apply: (text: string) => void): void {
  const context = useContext(ComposerSeedContext);
  const seed = context?.seed ?? null;
  const consume = context?.consume;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!seed || seed.conversationId !== conversationId) return;
    applyRef.current(seed.text);
    consume?.(seed.id);
  }, [seed?.id, seed?.conversationId, conversationId]);
}
