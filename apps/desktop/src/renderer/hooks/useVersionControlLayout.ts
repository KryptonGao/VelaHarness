import { useSyncExternalStore } from "react";
import { readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

/** Keep the original interface unless the review layout is explicitly selected. */
export const versionControlLayouts = ["classic", "review"] as const;
export type VersionControlLayout = (typeof versionControlLayouts)[number];

const key = "vela.versionControlLayout";
const accept = (value: unknown): value is VersionControlLayout => versionControlLayouts.some(layout => layout === value);

let current: VersionControlLayout = readStoredState<VersionControlLayout>(key, "classic", accept);
const listeners = new Set<() => void>();

export function setVersionControlLayout(layout: VersionControlLayout) {
  current = accept(layout) ? layout : "classic";
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function useVersionControlLayout(): VersionControlLayout {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
