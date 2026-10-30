import type { TaskSchedule } from "@vela/shared";
import { activeIntlLocale, tr } from "../locale";

const statusLabels = {
  active: ["启用", "Active"], paused: ["已暂停", "Paused"], completed: ["已完成", "Completed"],
  running: ["执行中", "Running"], success: ["成功", "Success"], failed: ["失败", "Failed"],
  skipped: ["已跳过", "Skipped"], interrupted: ["已中断", "Interrupted"],
} as const;
export type ScheduledStatus = keyof typeof statusLabels;
export const scheduledStatusText = (status: ScheduledStatus): string => tr(statusLabels[status][0], statusLabels[status][1]);
export const scheduledStatusTone = (status: ScheduledStatus): string => status === "success" || status === "active" ? "ok" : status === "failed" || status === "interrupted" ? "bad" : status === "running" ? "run" : "idle";
export function scheduledDateText(date: number | null): string {
  return date === null || !Number.isFinite(date) ? "—" : new Date(date).toLocaleString(activeIntlLocale());
}
export const scheduledDays = (): string[] => [tr("日", "Sun"), tr("一", "Mon"), tr("二", "Tue"), tr("三", "Wed"), tr("四", "Thu"), tr("五", "Fri"), tr("六", "Sat")];
export function scheduledScheduleText(schedule: TaskSchedule): string {
  if (schedule.kind === "once") return `${tr("一次性", "Once")} · ${scheduledDateText(Date.parse(schedule.at))} · ${schedule.at}`;
  if (schedule.kind === "cron") return `Cron · ${schedule.expression} · ${schedule.timezone}`;
  return `${schedule.kind === "daily" ? tr("每日", "Daily") : `${tr("每周", "Weekly")} ${schedule.weekdays.map(day => scheduledDays()[day]).join("、")}`} · ${schedule.time} · ${schedule.timezone}`;
}

/** Validate legacy schedule data before selecting a formatter. Unknown data stays in the generic view. */
export function isTaskSchedule(value: unknown): value is TaskSchedule {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "once") return typeof record.at === "string" && Number.isFinite(Date.parse(record.at));
  if (typeof record.timezone !== "string") return false;
  if (record.kind === "cron") return typeof record.expression === "string";
  if (typeof record.time !== "string") return false;
  if (record.kind === "daily") return true;
  return record.kind === "weekly" && Array.isArray(record.weekdays) && record.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6);
}
export function isScheduledStatus(value: unknown): value is ScheduledStatus {
  return typeof value === "string" && Object.hasOwn(statusLabels, value);
}
