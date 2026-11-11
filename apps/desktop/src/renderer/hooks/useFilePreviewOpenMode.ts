import { useSyncExternalStore } from "react";
import { readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

export const filePreviewOpenModes = ["new-tab", "current-tab"] as const;
export type FilePreviewOpenMode = (typeof filePreviewOpenModes)[number];

const key = "vela.filePreviewOpenMode";
const accept = (value: unknown): value is FilePreviewOpenMode => filePreviewOpenModes.some(mode => mode === value);

let current: FilePreviewOpenMode = readStoredState<FilePreviewOpenMode>(key, "new-tab", accept);
const listeners = new Set<() => void>();

export function setFilePreviewOpenMode(mode: FilePreviewOpenMode) {
  current = accept(mode) ? mode : "new-tab";
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function useFilePreviewOpenMode(): FilePreviewOpenMode {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
