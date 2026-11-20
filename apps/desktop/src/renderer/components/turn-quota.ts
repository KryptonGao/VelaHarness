import type { UsageLimits } from "@vela/shared";

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

/** 胶囊里的窗口名：5h、1w，其余按天 / 小时 / 分钟。 */
export function quotaWindowName(minutes: number): string {
  if (minutes === 10080) return "1w";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** 四舍五入到整数百分比；不到 1% 写 <1%。 */
export function consumedText(percent: number): string {
  const rounded = Math.round(percent);
  return rounded < 1 ? "<1%" : `${rounded}%`;
}
