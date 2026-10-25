/**
 * 任务用量上限的共享契约。
 * 一次「任务」从用户发出消息开始，到根代理与所有子代理都空闲为止；
 * Token 与耗时都按整棵 agent 树统计。纯函数，主进程和界面共用。
 */

export const taskBudgetLimits = {
  minMinutes: 1,
  maxMinutes: 24 * 60,
  minTokens: 10_000,
  maxTokens: 10_000_000_000,
  minSubagents: 0,
  maxSubagents: 64,
} as const;

/** 用量达到上限的这个比例时先提示用户。 */
export const taskBudgetWarnRatio = 0.8;

export interface TaskBudgetSettings {
  enabled: boolean;
  /** 单次任务耗时上限（分钟）；null 表示不限。 */
  maxMinutes: number | null;
  /** 单次任务 Token 上限（输入 + 输出，含子代理，不含缓存读取）；null 表示不限。 */
  maxTokens: number | null;
  /** 一个对话里所有层级子代理的总数上限；0 表示不允许创建子代理。与 enabled 无关，始终生效。 */
  maxSubagents: number;
  /** 子代理是否可以继续创建子代理；关闭后只有主代理能派生。 */
  allowNestedSubagents: boolean;
}

export const defaultTaskBudgetSettings: Readonly<TaskBudgetSettings> = Object.freeze({
  enabled: false,
  maxMinutes: 30,
  maxTokens: 20_000_000,
  maxSubagents: 16,
  allowNestedSubagents: true,
});

/** agent 树控制面每次派生子代理前读取的限制。 */
export interface SubagentLimits {
  maxSubagents: number;
  allowNested: boolean;
}

/** 一个对话的用量上限：全局默认、本对话自定义（没有则沿用全局）和实际生效的设置。 */
export interface ConversationTaskBudget {
  global: TaskBudgetSettings;
  override: TaskBudgetSettings | null;
  effective: TaskBudgetSettings;
}

export type TaskBudgetPhase = "ok" | "warning" | "exhausted";
export type TaskBudgetReason = "time" | "tokens";

/** 挂在会话快照上的当前任务用量；没有任务或未启用时为 null。 */
export interface TaskBudgetState {
  phase: TaskBudgetPhase;
  /** 触发 warning / exhausted 的维度；两者同时触发时 exhausted 以先到上限的为准。 */
  reason: TaskBudgetReason | null;
  startedAt: number;
  tokensUsed: number;
  /** 任务开始时的上限快照，设置改动后以下一次评估为准。 */
  maxTokens: number | null;
  maxMs: number | null;
  /** 到达上限的时间；仅 exhausted 时有值。 */
  exhaustedAt: number | null;
}

function validLimit(value: unknown, min: number, max: number): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : undefined;
}

/** 解析并校验设置；非法输入抛错，不静默改写成别的值。 */
export function parseTaskBudgetSettings(raw: unknown): TaskBudgetSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("任务用量上限设置不正确");
  const input = raw as Record<string, unknown>;
  if (typeof input.enabled !== "boolean") throw new Error("任务用量上限开关必须是布尔值");
  const maxMinutes = validLimit(input.maxMinutes, taskBudgetLimits.minMinutes, taskBudgetLimits.maxMinutes);
  const maxTokens = validLimit(input.maxTokens, taskBudgetLimits.minTokens, taskBudgetLimits.maxTokens);
  if (maxMinutes === undefined) {
    throw new Error("时间上限超出范围");
  }
  if (maxTokens === undefined) {
    throw new Error("Token 上限超出范围");
  }
  if (input.enabled && maxMinutes === null && maxTokens === null) throw new Error("启用任务用量上限时至少要设置时间或 Token 其中一项");
  // 子代理限制是后加的字段：缺省时取默认值，让旧的设置文件和旧调用方继续可用。
  const maxSubagents = input.maxSubagents === undefined
    ? defaultTaskBudgetSettings.maxSubagents
    : validLimit(input.maxSubagents, taskBudgetLimits.minSubagents, taskBudgetLimits.maxSubagents);
  if (maxSubagents === undefined || maxSubagents === null) throw new Error("子代理数量上限超出范围");
  if (input.allowNestedSubagents !== undefined && typeof input.allowNestedSubagents !== "boolean") {
    throw new Error("子代理嵌套开关必须是布尔值");
  }
  const allowNestedSubagents = input.allowNestedSubagents ?? defaultTaskBudgetSettings.allowNestedSubagents;
  return { enabled: input.enabled, maxMinutes, maxTokens, maxSubagents, allowNestedSubagents };
}

/** 读取磁盘上的设置：损坏或越界时回到默认（关闭），不会意外启用。 */
export function readTaskBudgetSettings(raw: unknown): TaskBudgetSettings {
  try {
    return parseTaskBudgetSettings(raw);
  } catch {
    return { ...defaultTaskBudgetSettings };
  }
}

export interface TaskBudgetUsage {
  tokensUsed: number;
  elapsedMs: number;
}

export interface TaskBudgetEvaluation {
  phase: TaskBudgetPhase;
  reason: TaskBudgetReason | null;
  tokenRatio: number | null;
  timeRatio: number | null;
}

/** 按当前设置评估用量。未启用或没有任何上限时恒为 ok。 */
export function evaluateTaskBudget(settings: TaskBudgetSettings, usage: TaskBudgetUsage): TaskBudgetEvaluation {
  const tokenRatio = settings.enabled && settings.maxTokens !== null ? usage.tokensUsed / settings.maxTokens : null;
  const timeRatio = settings.enabled && settings.maxMinutes !== null ? usage.elapsedMs / (settings.maxMinutes * 60_000) : null;
  const ratios: Array<[TaskBudgetReason, number]> = [];
  if (tokenRatio !== null) ratios.push(["tokens", tokenRatio]);
  if (timeRatio !== null) ratios.push(["time", timeRatio]);
  let phase: TaskBudgetPhase = "ok";
  let reason: TaskBudgetReason | null = null;
  let top = 0;
  for (const [name, ratio] of ratios) {
    const next: TaskBudgetPhase = ratio >= 1 ? "exhausted" : ratio >= taskBudgetWarnRatio ? "warning" : "ok";
    if (next === "ok") continue;
    const rank = (value: TaskBudgetPhase) => (value === "exhausted" ? 2 : 1);
    if (rank(next) > rank(phase) || (rank(next) === rank(phase) && ratio > top)) {
      phase = next;
      reason = name;
      top = ratio;
    }
  }
  return { phase, reason, tokenRatio, timeRatio };
}

/** 面向界面和提示的用量文本：12.3K / 1.20M。 */
export function formatTaskBudgetTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(tokens >= 10_000_000_000 ? 0 : 2)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}K`;
  return String(Math.max(0, Math.round(tokens)));
}

export function formatTaskBudgetDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
