import { useSyncExternalStore } from "react";
import { createLogger } from "../logger";
import { uiStorage } from "../ui-storage";
import { isBoolean, readStoredState } from "./useStoredState";

const key = "vela.combinedModelPicker";
const log = createLogger("preferences");
let current = readStoredState(key, false, isBoolean);
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return current;
}

export function setCombinedModelPicker(enabled: boolean) {
  if (current === enabled) return;
  current = enabled;
  try { uiStorage.setItem(key, JSON.stringify(enabled)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function useCombinedModelPicker() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
