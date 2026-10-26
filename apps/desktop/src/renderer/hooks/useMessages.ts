import { useCallback, useSyncExternalStore } from "react";
import { emptyMessages, messageScope, type MessageStore } from "./message-store";

const noSubscription = () => () => {};
const emptySnapshot = () => emptyMessages;
const noMessagesSnapshot = () => true;

export function useMessages(store: MessageStore | undefined, conversationId: string | null, agentId?: string) {
  const scope = conversationId ? messageScope(conversationId, agentId) : null;
  const subscribe = useCallback((listener: () => void) =>
    store && scope ? store.subscribe(scope, listener) : noSubscription(), [store, scope]);
  const getSnapshot = useCallback(() =>
    store && scope ? store.getSnapshot(scope) : emptyMessages, [store, scope]);
  return useSyncExternalStore(subscribe, getSnapshot, emptySnapshot);
}

/** 只关心对话是否为空:快照是布尔值,流式 delta 不改变它时不会触发重渲染。 */
export function useMessagesEmpty(store: MessageStore | undefined, conversationId: string | null) {
  const scope = conversationId ? messageScope(conversationId) : null;
  const subscribe = useCallback((listener: () => void) =>
    store && scope ? store.subscribe(scope, listener) : noSubscription(), [store, scope]);
  const getSnapshot = useCallback(() =>
    !store || !scope || store.getSnapshot(scope).length === 0, [store, scope]);
  return useSyncExternalStore(subscribe, getSnapshot, noMessagesSnapshot);
}
