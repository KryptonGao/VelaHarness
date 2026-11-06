import { useSyncExternalStore } from "react";
import { isBoolean, readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

const key = "vela.combinedModePicker";

/** 合并模式选择器：把对话模式和执行权限放进同一个菜单。默认开启；关闭后回到两个独立的胶囊。 */
let current = readStoredState<boolean>(key, true, isBoolean);
const listeners = new Set<() => void>();

export function setCombinedModePicker(enabled: boolean) {
  current = enabled;
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function useCombinedModePicker(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
