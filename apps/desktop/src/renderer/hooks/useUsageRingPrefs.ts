import { useSyncExternalStore } from "react";
import { readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

export const plusUsageWindows = ["lowest", "5h", "1w"] as const;
export type PlusUsageWindow = typeof plusUsageWindows[number];

export interface UsageRingPrefs {
  /** 是否在导航栏设置上方显示 Codex 剩余额度圆环。 */
  enabled: boolean;
  /** 剩余额度（%）低于该值时圆环变黄，否则保持常态颜色（白色）。 */
  threshold: number;
  showCodexLogo: boolean;
  plusWindow: PlusUsageWindow;
}

export const usageRingThresholdRange = { min: 0, max: 100 } as const;
export const defaultUsageRingPrefs: UsageRingPrefs = { enabled: true, threshold: 10, showCodexLogo: true, plusWindow: "lowest" };

const key = "vela.usageRing";

export function clampUsageRingThreshold(value: number): number {
  if (!Number.isFinite(value)) return defaultUsageRingPrefs.threshold;
  return Math.min(usageRingThresholdRange.max, Math.max(usageRingThresholdRange.min, Math.round(value)));
}

const accept = (value: unknown): value is Partial<UsageRingPrefs> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function normalizeUsageRingPrefs(value: Partial<UsageRingPrefs>): UsageRingPrefs {
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaultUsageRingPrefs.enabled,
    threshold: typeof value.threshold === "number" ? clampUsageRingThreshold(value.threshold) : defaultUsageRingPrefs.threshold,
    showCodexLogo: typeof value.showCodexLogo === "boolean" ? value.showCodexLogo : defaultUsageRingPrefs.showCodexLogo,
    plusWindow: value.plusWindow && plusUsageWindows.includes(value.plusWindow) ? value.plusWindow : defaultUsageRingPrefs.plusWindow,
  };
}

let current = normalizeUsageRingPrefs(readStoredState<Partial<UsageRingPrefs>>(key, {}, accept));
const listeners = new Set<() => void>();

export function setUsageRingPrefs(patch: Partial<UsageRingPrefs>) {
  current = normalizeUsageRingPrefs({ ...current, ...patch });
  try { uiStorage.setItem(key, JSON.stringify(current)); }
  catch (error) { log.error(`failed to save UI preference ${key}`, error); }
  listeners.forEach(listener => listener());
}

/** The same record also owns visible settings. Remove only hidden overrides, even when undoing later. */
export function resetHiddenUsageRingPrefs(): (() => void) | null {
  const saved = readStoredState<Partial<UsageRingPrefs>>(key, {}, accept);
  const next = { ...saved };
  const undo: Partial<UsageRingPrefs> = {};
  if (saved.threshold !== undefined && saved.threshold !== defaultUsageRingPrefs.threshold) {
    undo.threshold = saved.threshold;
    delete next.threshold;
  }
  if (saved.showCodexLogo !== undefined && saved.showCodexLogo !== defaultUsageRingPrefs.showCodexLogo) {
    undo.showCodexLogo = saved.showCodexLogo;
    delete next.showCodexLogo;
  }
  if (!Object.keys(undo).length) return null;
  function apply(value: Partial<UsageRingPrefs>) {
    uiStorage.setItem(key, JSON.stringify(value));
    current = normalizeUsageRingPrefs(value);
    listeners.forEach(listener => listener());
  }
  apply(next);
  return () => apply({ ...readStoredState<Partial<UsageRingPrefs>>(key, {}, accept), ...undo });
}

export function useUsageRingPrefs(): UsageRingPrefs {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}
