import type { UsageLimits } from "@vela/shared";
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
