import { createContext, useContext, useMemo, useRef } from "react";
import type { ThinkingGroupMode } from "../hooks/usePreferences";
import type { UiMessage } from "../hooks/useSession";
import { thinkingModelName, type ThinkingModelLabel } from "../thinking-model";

/** 思考分组方式由偏好决定,聊天视图和子代理面板各自读取,不必逐层传 prop。 */
export const ThinkingGroupModeContext = createContext<ThinkingGroupMode>("single");

export function useThinkingGroupMode(): ThinkingGroupMode {
  return useContext(ThinkingGroupModeContext);
}

export const ThinkingModelCatalogContext = createContext<readonly ThinkingModelLabel[]>([]);

/** 为主对话和子代理补充各自来源模型的显示名，并保留未变化消息的引用。 */
export function useNamedThinkingMessages(messages: UiMessage[]): UiMessage[] {
  const models = useContext(ThinkingModelCatalogContext);
  const cache = useRef(new WeakMap<UiMessage, { name: string; message: UiMessage }>());
  return useMemo(() => messages.map(message => {
    const name = thinkingModelName(message, models);
    if (name === undefined || name === message.modelName) return message;
    const previous = cache.current.get(message);
    if (previous?.name === name) return previous.message;
    const named = { ...message, modelName: name };
    cache.current.set(message, { name, message: named });
    return named;
  }), [messages, models]);
}
