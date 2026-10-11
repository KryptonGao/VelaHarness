import { useSyncExternalStore } from "react";
import type { IntelligentUiState } from "@vela/shared";

/**
 * Intelligent UI 的设置属于主进程；渲染层在这里缓存一份并通知订阅者，
 * 设置页修改后，聊天里的微应用立刻按新设置显示或停用。
 */
let state: IntelligentUiState | null = null;
let loading = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function load(): void {
  if (loading || state) return;
  loading = true;
  // 设置读不到（桥缺失或失败）时按「关闭」处理，绝不能让界面渲染因此抛错。
  try {
    void window.vela?.getIntelligentUi?.().then(
      value => { state = value; emit(); },
      () => { loading = false; },
    );
  } catch {
    loading = false;
  }
}

export function publishIntelligentUiState(next: IntelligentUiState): void {
  state = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  load();
  return () => { listeners.delete(listener); };
}

/** 沙盒微应用是否已被用户打开。设置还没读到时按「关闭」处理。 */
export function useMicroAppsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => state?.microApps === true, () => false);
}
