import { useSyncExternalStore } from "react";
import { uiSandboxLimits } from "@vela/shared";

/** 正在运行的微应用：同时最多两个，超过要先停掉一个。 */
const running = new Set<string>();
const listeners = new Set<() => void>();
let snapshot = 0;

function emit(): void {
  snapshot = running.size;
  for (const listener of listeners) listener();
}

export function tryStartApp(key: string): boolean {
  if (running.has(key)) return true;
  if (running.size >= uiSandboxLimits.maxRunning) return false;
  running.add(key);
  emit();
  return true;
}

export function stopApp(key: string): void {
  if (running.delete(key)) emit();
}

export function useRunningAppCount(): number {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => 0);
}
