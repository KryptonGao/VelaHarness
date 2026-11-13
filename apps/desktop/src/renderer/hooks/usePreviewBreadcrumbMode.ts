import { useSyncExternalStore } from "react";
import { readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

export const previewBreadcrumbModes = ["scroll", "hover"] as const;
export type PreviewBreadcrumbMode = (typeof previewBreadcrumbModes)[number];

const key = "vela.previewBreadcrumbMode";
const accept = (value: unknown): value is PreviewBreadcrumbMode => previewBreadcrumbModes.some(mode => mode === value);

let current = readStoredState<PreviewBreadcrumbMode>(key, "scroll", accept);
const listeners = new Set<() => void>();

export function setPreviewBreadcrumbMode(mode: PreviewBreadcrumbMode) {
  current = accept(mode) ? mode : "scroll";
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function usePreviewBreadcrumbMode(): PreviewBreadcrumbMode {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
