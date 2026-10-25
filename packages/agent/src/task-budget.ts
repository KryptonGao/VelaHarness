import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  addUsageByModel,
  cappedCost,
  evaluateTaskBudget,
  type ModelPrice,
  type TaskBudgetPhase,
  type TaskBudgetSettings,
  type TaskBudgetState,
  type TraceUsage,
  type UsageByModel,
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
  /** 整棵 agent 树各模型的用量；费用在评估时按当前登记的价格换算。 */
  readonly usageByModel: UsageByModel = {};
  requests = 0;
  /** 已写入同类任务历史，避免重复记录。 */
  recorded = false;
  /** 已经通知过收件箱的费用阶段，每个阶段只通知一次。 */
  readonly costAlerts = new Set<"warning" | "exhausted">();
  private tokensUsed = 0;
  private exhaustedAt: number | null = null;
  private lastPhase: TaskBudgetPhase = "ok";
  private lastCost = 0;
  private lastUncounted = 0;

  constructor(
    private readonly baselineTokens: number,
    private readonly clock: TaskBudgetClock = Date,
  ) {
    this.startedAt = clock.now();
  }

  /** 记录一次模型请求的用量（根代理和子代理都走这里）。 */
  recordUsage(model: string, usage: Partial<TraceUsage>): void {
    addUsageByModel(this.usageByModel, model, usage);
    this.requests += 1;
  }

  /** 用累计 token 刷新用量。agent 被释放可能让累计值回落，所以只增不减。 */
  update(cumulativeTokens: number, settings: TaskBudgetSettings, prices: readonly ModelPrice[] = []): { state: TaskBudgetState | null; phaseChanged: boolean; changed: boolean } {
    const used = Math.max(this.tokensUsed, cumulativeTokens - this.baselineTokens);
    const tokensChanged = used !== this.tokensUsed;
    this.tokensUsed = used;
    const cost = settings.maxCost ? cappedCost(this.usageByModel, prices, settings.maxCost.currency) : null;
    const evaluation = evaluateTaskBudget(settings, { tokensUsed: used, elapsedMs: this.clock.now() - this.startedAt, costUsed: cost?.used ?? 0 });
    // 一旦到达上限就保持 exhausted，即使用户随后放宽设置也不再恢复这个任务。
    const phase: TaskBudgetPhase = this.exhausted ? "exhausted" : evaluation.phase;
    if (phase === "exhausted" && this.exhaustedAt === null) this.exhaustedAt = this.clock.now();
    const phaseChanged = phase !== this.lastPhase;
    this.lastPhase = phase;
    if (!settings.enabled) return { state: null, phaseChanged, changed: tokensChanged || phaseChanged };
    // 费用上限里费用只在每次请求结束时才增加，所以变化与否按金额判断。
    // 未计入的模型数变化也算：没登记价格时费用一直是 0，但界面要提示「实际花费可能更高」。
    const costChanged = cost !== null && (cost.used !== this.lastCost || cost.uncounted !== this.lastUncounted);
    if (cost) {
      this.lastCost = cost.used;
      this.lastUncounted = cost.uncounted;
    }
    return {
      state: {
        phase,
        reason: this.exhausted ? this.reason : evaluation.reason,
        startedAt: this.startedAt,
        tokensUsed: used,
        maxTokens: settings.maxTokens,
        maxMs: settings.maxMinutes === null ? null : settings.maxMinutes * 60_000,
        costUsed: cost?.used ?? null,
        maxCost: settings.maxCost,
        uncountedModels: cost?.uncounted ?? 0,
        exhaustedAt: this.exhaustedAt,
      },
      phaseChanged,
      changed: tokensChanged || phaseChanged || costChanged,
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
