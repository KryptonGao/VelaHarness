import type { UsageLimits, UsageLimitWindow } from "@vela/shared";
import type { PlusUsageWindow } from "../hooks/useUsageRingPrefs";
import { activeIntlLocale, tr, trf } from "../locale";

const warnPercent = 75;
const dangerPercent = 90;

/** 圆环上显示的值：各窗口里已用百分比最高的那个。 */
export function peakUsedPercent(limits: UsageLimits): number {
  return Math.max(0, ...limits.windows.map((window) => window.usedPercent));
}

export function usageTone(percent: number): "ok" | "warn" | "danger" {
  return percent >= dangerPercent ? "danger" : percent >= warnPercent ? "warn" : "ok";
}

export function percentText(percent: number): string {
  // 不足 1% 但有用量时显示 <1%，避免进度条已经有一点宽度却写着 0%。
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

export function windowLabel(minutes: number): string {
  if (minutes === 300) return tr("5 小时额度", "5-hour limit");
  if (minutes === 10080) return tr("每周额度", "Weekly limit");
  if (minutes % 1440 === 0) return trf("{0} 天额度", "{0}-day limit", minutes / 1440);
  if (minutes % 60 === 0) return trf("{0} 小时额度", "{0}-hour limit", minutes / 60);
  return trf("{0} 分钟额度", "{0}-minute limit", minutes);
}

/** 24 小时内重置只写时刻，更久以后带上星期，和额度窗口的节奏一致。 */
export function resetText(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt === null) return "";
  const locale = activeIntlLocale();
  const date = new Date(resetsAt);
  const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (resetsAt - now < 24 * 3600_000) return trf("{0} 重置", "Resets {0}", time);
  const day = date.toLocaleDateString(locale, { weekday: "short" });
  return trf("{0} 重置", "Resets {0}", `${day} ${time}`);
}

export function planName(plan: string | null): string {
  if (!plan) return "";
  return plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase();
}

/** 圆环和详情显示的是剩余额度，和 Codex 自己的界面一致。 */
export function remainingPercent(usedPercent: number): number {
  return Math.min(100, Math.max(0, 100 - usedPercent));
}

/** 5 小时额度占圆环顶部的角度，其余部分给每周额度。 */
export const shortArcDegrees = 100;
/** 两段弧之间留出的缝隙（度）。 */
export const arcGapDegrees = 12;

export type UsageRingLayout =
  | { kind: "split"; short: UsageLimitWindow; long: UsageLimitWindow }
  | { kind: "single"; window: UsageLimitWindow };

export function usageRingLayout(limits: UsageLimits, plusWindow: PlusUsageWindow = "lowest"): UsageRingLayout | null {
  const windows = [...limits.windows].sort((a, b) => a.windowMinutes - b.windowMinutes);
  if (windows.length === 0) return null;
  const plan = limits.plan?.trim().toLowerCase();
  const fiveHour = windows.find((window) => window.windowMinutes === 300);
  if (plan === "plus") {
    const weekly = windows.find((window) => window.windowMinutes === 10080);
    if (plusWindow === "5h" && fiveHour) return { kind: "single", window: fiveHour };
    if (plusWindow === "1w" && weekly) return { kind: "single", window: weekly };
    const candidates = [fiveHour, weekly].filter((window): window is UsageLimitWindow => window !== undefined);
    const available = candidates.length ? candidates : windows;
    const lowest = available.reduce((a, b) => a.usedPercent >= b.usedPercent ? a : b);
    return { kind: "single", window: lowest };
  }
  const long = windows[windows.length - 1];
  const short = fiveHour ?? windows[0];
  if (plan?.startsWith("pro") || short === long) return { kind: "single", window: long };
  return { kind: "split", short, long };
}

/** 圆环上某段弧的起止角度，自正上方顺时针计。 */
export function usageRingArcs(): { short: [number, number]; long: [number, number] } {
  const half = shortArcDegrees / 2;
  return { short: [-half, half], long: [half + arcGapDegrees, 360 - half - arcGapDegrees] };
}

/** 圆环和详情的颜色：剩余额度低于用户设定的提醒线时为 low（黄色），否则为 ok。 */
export function remainingTone(usedPercent: number, threshold: number): "ok" | "low" {
  return remainingPercent(usedPercent) < threshold ? "low" : "ok";
}
