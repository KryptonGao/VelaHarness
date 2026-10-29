import { useSyncExternalStore } from "react";
import { readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

/** classic：只有侧边栏；rail：最左侧多一列分类图标栏，页面入口移到那里。 */
export const navLayouts = ["classic", "rail"] as const;
export type NavLayout = (typeof navLayouts)[number];

const key = "vela.navLayout";
const accept = (value: unknown): value is NavLayout => navLayouts.some(layout => layout === value);

let current: NavLayout = readStoredState<NavLayout>(key, "classic", accept);
const listeners = new Set<() => void>();

export function setNavLayout(layout: NavLayout) {
  current = layout;
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

export function useNavLayout() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
