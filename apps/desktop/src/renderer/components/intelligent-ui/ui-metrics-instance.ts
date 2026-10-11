import { useSyncExternalStore } from "react";
import { UiMetrics, type UiMetricsSummary } from "@vela/shared";
import { uiStorage } from "../../ui-storage";

/**
 * 渲染层共用的本地指标（IUI-13）。只保存聚合计数；界面内容、输入值、事件时间线都不落盘，也不上传。
 */
const metricsKey = "vela.ui.metrics";
const inspectorKey = "vela.ui.inspector";
const saveDelayMs = 1_500;

export const uiMetrics = new UiMetrics();

try { uiMetrics.restore(uiStorage.getItem(metricsKey)); } catch { /* 存储不可用时指标只在本次运行里有效。 */ }

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
let cached: { version: number; summary: UiMetricsSummary } | null = null;

uiMetrics.subscribe(() => {
  version += 1;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { uiStorage.setItem(metricsKey, uiMetrics.serialize()); } catch { /* 忽略 */ }
  }, saveDelayMs);
});

function summarySnapshot(): UiMetricsSummary {
  if (!cached || cached.version !== version) cached = { version, summary: uiMetrics.summary() };
  return cached.summary;
}

/** 订阅聚合指标。快照按版本缓存，没有变化时引用不变。 */
export function useUiMetricsSummary(): UiMetricsSummary {
  return useSyncExternalStore(listener => uiMetrics.subscribe(listener), summarySnapshot, summarySnapshot);
}

export function resetUiMetrics(): void {
  uiMetrics.reset();
  try { uiStorage.removeItem(metricsKey); } catch { /* 忽略 */ }
}

// ---------- 开发检查器开关 ----------

const inspectorListeners = new Set<() => void>();

function readInspector(): boolean {
  try { return uiStorage.getItem(inspectorKey) === "1"; } catch { return false; }
}

let inspectorOn = readInspector();

export function setUiInspectorEnabled(enabled: boolean): void {
  inspectorOn = enabled;
  try {
    if (enabled) uiStorage.setItem(inspectorKey, "1");
    else uiStorage.removeItem(inspectorKey);
  } catch { /* 忽略 */ }
  for (const listener of inspectorListeners) listener();
}

/** 检查器默认只在开发版出现；正式版需要在设置里手动打开。 */
export function useUiInspectorEnabled(): boolean {
  return useSyncExternalStore(
    listener => { inspectorListeners.add(listener); return () => { inspectorListeners.delete(listener); }; },
    () => inspectorOn || import.meta.env?.DEV === true,
    () => false,
  );
}

export function uiInspectorPreference(): boolean {
  return inspectorOn;
}
