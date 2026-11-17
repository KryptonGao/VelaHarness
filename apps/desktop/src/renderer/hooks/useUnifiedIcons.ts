import { useSyncExternalStore } from "react";
import { isBoolean, readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

const key = "vela.unifiedIcons";

/** 统一图标：开启后界面图标换成同一套 MingCute 图标；默认关闭，沿用原版手绘图标。 */
let current = readStoredState<boolean>(key, false, isBoolean);
const listeners = new Set<() => void>();

export function setUnifiedIcons(enabled: boolean) {
  if (enabled === current) return;
  current = enabled;
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function getUnifiedIcons(): boolean {
  return current;
}

export function useUnifiedIcons(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
    () => current,
  );
}
