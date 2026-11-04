import { useSyncExternalStore } from "react";
import { isBoolean, readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

const key = "vela.minimalStart";

/** 极简起始页:新对话只留输入框,不显示问候、预设提示词和背景水印。 */
let current = readStoredState<boolean>(key, false, isBoolean);
const listeners = new Set<() => void>();

export function setMinimalStart(enabled: boolean) {
  current = enabled;
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function useMinimalStart(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
