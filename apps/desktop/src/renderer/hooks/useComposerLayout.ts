import { useSyncExternalStore } from "react";
import { readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

/** classic 是原有样式；calm 保留结构、整理质感；capsule 把输入收成一条膠囊。 */
export const composerLayouts = ["classic", "calm", "capsule"] as const;
export type ComposerLayout = (typeof composerLayouts)[number];

const key = "vela.composerLayout";
const accept = (value: unknown): value is ComposerLayout => composerLayouts.includes(value as ComposerLayout);

let current: ComposerLayout = readStoredState<ComposerLayout>(key, "classic", accept);
const listeners = new Set<() => void>();

function applyDataset() {
  if (typeof document !== "undefined") document.documentElement.dataset.composerLayout = current;
}
applyDataset();

export function setComposerLayout(layout: ComposerLayout) {
  current = layout;
  applyDataset();
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function useComposerLayout(): ComposerLayout {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
