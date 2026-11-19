import type { UsageLimits } from "@vela/shared";
import { trf } from "../locale";
import { windowLabel } from "./usage-limit-format";

/** 一轮对话在某个额度窗口里消耗的百分点。 */
export interface TurnQuotaWindow {
  windowMinutes: number;
  consumedPercent: number;
}

/**
 * 本轮消耗 = 当前已用百分比 − 本轮开始时的已用百分比，按窗口时长配对。
 * 窗口在本轮中途重置时已用百分比会下降，此时只能确定「重置后」的部分，取当前值作为下限。
 * 开始时没有的窗口（账号计划变化）不计；Pro 等只有周额度的账号自然只剩一个窗口。
 */
export function computeTurnQuota(baseline: UsageLimits, current: UsageLimits): TurnQuotaWindow[] {
  const result: TurnQuotaWindow[] = [];
  for (const window of current.windows) {
    const before = baseline.windows.find((item) => item.windowMinutes === window.windowMinutes);
    if (!before) continue;
    const consumed = window.usedPercent >= before.usedPercent ? window.usedPercent - before.usedPercent : window.usedPercent;
    result.push({ windowMinutes: window.windowMinutes, consumedPercent: consumed });
  }
  return result.sort((a, b) => a.windowMinutes - b.windowMinutes);
}

/** 消耗量的数字：不足 0.1% 写 <0.1%，10% 以下保留一位小数，更大取整。 */
export function consumedText(percent: number): string {
  if (!(percent > 0)) return "0%";
  if (percent < 0.1) return "<0.1%";
  if (percent < 10) return `${Math.round(percent * 10) / 10}%`;
  return `${Math.round(percent)}%`;
}

/** 「消耗 5 小时额度 0.4% · 每周额度 0.1%」；没有可显示的窗口返回 null。 */
export function turnQuotaText(windows: readonly TurnQuotaWindow[]): string | null {
  if (windows.length === 0) return null;
  const parts = windows.map((window) => `${windowLabel(window.windowMinutes)} ${consumedText(window.consumedPercent)}`);
  return trf("消耗 {0}", "Used {0}", parts.join(" · "));
}
