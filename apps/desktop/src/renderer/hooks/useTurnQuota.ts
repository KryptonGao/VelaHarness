import type { UsageLimits } from "@vela/shared";
import { useSyncExternalStore } from "react";
import { computeTurnQuota, type TurnQuotaWindow } from "../components/turn-quota";
import { usageLimitProvider } from "./useUsageLimits";

/** 运行中每隔多久读一次额度；接口不贵，但也不需要比计时更密。 */
const pollMs = 15_000;
/** 一轮结束后额度的统计可能稍有延迟，隔一会儿再读一次取最终值。 */
const settleMs = 5_000;
const storageKey = "vela.turnQuota.v1";
const maxStored = 200;

interface Entry {
  baseline: UsageLimits | null;
  windows: TurnQuotaWindow[];
  timer: number | null;
  settle: number | null;
  /** 防止同一轮并发请求互相覆盖。 */
  seq: number;
}

const entries = new Map<number, Entry>();
const listeners = new Set<() => void>();
const empty: TurnQuotaWindow[] = [];
let version = 0;
let stored: Record<string, TurnQuotaWindow[]> | null = null;

function loadStored(): Record<string, TurnQuotaWindow[]> {
  if (stored) return stored;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    stored = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    stored = {};
  }
  return stored!;
}

function persist(startedAt: number, windows: TurnQuotaWindow[]): void {
  const all = loadStored();
  all[String(startedAt)] = windows;
  // 只保留最近的若干轮：键是毫秒时间戳，数值越大越新。
  const keys = Object.keys(all).sort((a, b) => Number(a) - Number(b));
  for (const key of keys.slice(0, Math.max(0, keys.length - maxStored))) delete all[key];
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    // 存不下就只在本次运行内显示。
  }
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

async function read(): Promise<UsageLimits | null> {
  try {
    const limits = await window.vela?.getUsageLimits?.(usageLimitProvider);
    return limits && limits.windows.length > 0 ? limits : null;
  } catch {
    return null;
  }
}

async function sample(startedAt: number, entry: Entry): Promise<void> {
  const seq = ++entry.seq;
  const limits = await read();
  if (!limits || seq !== entry.seq) return;
  if (!entry.baseline) {
    entry.baseline = limits;
    return;
  }
  const windows = computeTurnQuota(entry.baseline, limits);
  const same = windows.length === entry.windows.length
    && windows.every((window, index) => window.windowMinutes === entry.windows[index].windowMinutes && window.consumedPercent === entry.windows[index].consumedPercent);
  if (same) return;
  entry.windows = windows;
  persist(startedAt, windows);
  notify();
}

/**
 * 开始（或恢复）统计一轮对话消耗的额度。第一次调用时读取基线，之后每隔 pollMs 读一次。
 * 只对 ChatGPT 登录的 GPT 有意义；其他提供方不要调用。
 */
export function startTurnQuota(startedAt: number): void {
  let entry = entries.get(startedAt);
  if (!entry) {
    entry = { baseline: null, windows: loadStored()[String(startedAt)] ?? [], timer: null, settle: null, seq: 0 };
    entries.set(startedAt, entry);
  }
  if (entry.settle !== null) window.clearTimeout(entry.settle);
  entry.settle = null;
  if (entry.timer !== null) return;
  const current = entry;
  void sample(startedAt, current);
  current.timer = window.setInterval(() => void sample(startedAt, current), pollMs);
}

/** 这一轮结束（或不再显示）：立刻读一次，稍后再读一次作为最终值。 */
export function finishTurnQuota(startedAt: number): void {
  const entry = entries.get(startedAt);
  if (!entry) return;
  if (entry.timer !== null) window.clearInterval(entry.timer);
  entry.timer = null;
  if (!entry.baseline) return;
  void sample(startedAt, entry);
  if (entry.settle !== null) window.clearTimeout(entry.settle);
  entry.settle = window.setTimeout(() => {
    entry.settle = null;
    void sample(startedAt, entry);
  }, settleMs);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 某一轮（以开始时间标识）消耗的额度窗口；没有记录时为空数组。 */
export function useTurnQuota(startedAt: number | undefined): readonly TurnQuotaWindow[] {
  useSyncExternalStore(subscribe, () => version);
  if (startedAt === undefined) return empty;
  return entries.get(startedAt)?.windows ?? loadStored()[String(startedAt)] ?? empty;
}
