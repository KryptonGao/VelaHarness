export const defaultThinkingActivityDelayMs = 500;
export const minThinkingActivityDelayMs = 100;
export const maxThinkingActivityDelayMs = 5000;

export function clampThinkingActivityDelayMs(value: number): number {
  if (!Number.isFinite(value)) return defaultThinkingActivityDelayMs;
  return Math.min(maxThinkingActivityDelayMs, Math.max(minThinkingActivityDelayMs, Math.round(value)));
}
