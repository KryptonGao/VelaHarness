import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  evaluateTaskBudget,
  type TaskBudgetPhase,
  type TaskBudgetSettings,
  type TaskBudgetState,
} from "@vela/shared";

export interface TaskBudgetClock {
  now(): number;
}

/**
 * 一次任务的用量账本：从开始时刻起累计整棵 agent 树的 token 和耗时。
 * 上限在每次评估时读取，设置里的改动立即对进行中的任务生效。
 */
export class TaskBudgetTask {
  readonly startedAt: number;
  exhausted = false;
  ended = false;
  /** 已提示过「接近上限」，避免重复打扰。 */
  warned = false;
  /** 空闲 tick 的次数；子代理结论回投期间会有一瞬间全部空闲，要连续两次才算结束。 */
  idleTicks = 0;
  timer: ReturnType<typeof setInterval> | null = null;
  private tokensUsed = 0;
  private exhaustedAt: number | null = null;
  private lastPhase: TaskBudgetPhase = "ok";

  constructor(
    private readonly baselineTokens: number,
    private readonly clock: TaskBudgetClock = Date,
  ) {
    this.startedAt = clock.now();
  }

  /** 用累计 token 刷新用量。agent 被释放可能让累计值回落，所以只增不减。 */
  update(cumulativeTokens: number, settings: TaskBudgetSettings): { state: TaskBudgetState | null; phaseChanged: boolean; changed: boolean } {
    const used = Math.max(this.tokensUsed, cumulativeTokens - this.baselineTokens);
    const tokensChanged = used !== this.tokensUsed;
    this.tokensUsed = used;
    const evaluation = evaluateTaskBudget(settings, { tokensUsed: used, elapsedMs: this.clock.now() - this.startedAt });
    // 一旦到达上限就保持 exhausted，即使用户随后放宽设置也不再恢复这个任务。
    const phase: TaskBudgetPhase = this.exhausted ? "exhausted" : evaluation.phase;
    if (phase === "exhausted" && this.exhaustedAt === null) this.exhaustedAt = this.clock.now();
    const phaseChanged = phase !== this.lastPhase;
    this.lastPhase = phase;
    if (!settings.enabled) return { state: null, phaseChanged, changed: tokensChanged || phaseChanged };
    return {
      state: {
        phase,
        reason: this.exhausted ? this.reason : evaluation.reason,
        startedAt: this.startedAt,
        tokensUsed: used,
        maxTokens: settings.maxTokens,
        maxMs: settings.maxMinutes === null ? null : settings.maxMinutes * 60_000,
        exhaustedAt: this.exhaustedAt,
      },
      phaseChanged,
      changed: tokensChanged || phaseChanged,
    };
  }

  /** 记录触发上限的维度，之后的状态一直沿用它。 */
  private reason: TaskBudgetState["reason"] = null;

  markExhausted(reason: TaskBudgetState["reason"]): void {
    this.exhausted = true;
    this.reason = reason;
  }
}

export const taskBudgetBlockReason = "任务用量已到上限，不再继续调用工具或模型。请根据已有结果整理交接。";

/** 任务到达上限后拦下所有工具调用，让已触发的 abort 尽快收尾，不再产生新的模型请求。 */
export function createTaskBudgetExtension(isExhausted: () => boolean): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async () => (isExhausted() ? { block: true, reason: taskBudgetBlockReason } : undefined));
  };
}
