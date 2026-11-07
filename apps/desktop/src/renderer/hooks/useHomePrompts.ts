import { useSyncExternalStore } from "react";
import { isBoolean, readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

const key = "vela.homePrompts";

/** 新对话首页的预设提示词卡片:默认显示,可在卡片组上直接关闭,也可在设置里重新打开。 */
let current = readStoredState<boolean>(key, true, isBoolean);
const listeners = new Set<() => void>();

export function setHomePrompts(enabled: boolean) {
  current = enabled;
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function useHomePrompts(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
