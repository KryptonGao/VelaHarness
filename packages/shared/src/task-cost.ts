/**
 * 任务费用的账本与预估。纯函数，运行时和界面共用。
 * 账本只记每个模型的 Token 用量，费用在需要时按当时登记的价格换算：
 * 价格改动立即作用于进行中的任务，也作用于历史任务的预估。
 */
import { costOfUsage, findModelPrice, type CostByCurrency, type ModelPrice, type PricingCurrency } from "./model-pricing";
import type { TraceUsage } from "./trace";

/** 以 `provider/model` 为键的用量，与价格登记的模型标识一致。 */
export type UsageByModel = Record<string, TraceUsage>;

export function emptyUsage(): TraceUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

/** 把一次请求的用量累加进账本；负数和非数字按 0 处理，账本只增不减。 */
export function addUsageByModel(ledger: UsageByModel, model: string, usage: Partial<TraceUsage>): void {
  const count = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  const total = ledger[model] ?? (ledger[model] = emptyUsage());
  total.input += count(usage.input);
  total.output += count(usage.output);
  total.cacheRead += count(usage.cacheRead);
  total.cacheWrite += count(usage.cacheWrite);
  total.totalTokens += count(usage.totalTokens);
}

export interface LedgerCost {
  /** 各币种已计入的费用。 */
  cost: CostByCurrency;
  /** 没登记价格的模型。 */
  unpriced: string[];
}

export function ledgerCost(ledger: UsageByModel, prices: readonly ModelPrice[]): LedgerCost {
  const cost: CostByCurrency = {};
  const unpriced: string[] = [];
  for (const [model, usage] of Object.entries(ledger)) {
    const price = findModelPrice(prices, model);
    if (!price) {
      unpriced.push(model);
      continue;
    }
    cost[price.currency] = (cost[price.currency] ?? 0) + costOfUsage(usage, price);
  }
  return { cost, unpriced };
}

export interface CappedCost {
  /** 上限币种的已计入费用。 */
  used: number;
  /** 没能计入的模型数：没登记价格，或登记为另一种币种（不换算汇率）。 */
  uncounted: number;
}

/** 只计上限币种：没登记价格和登记为另一币种的模型都不计入，沿用「没登记价格不计入」的规则。 */
export function cappedCost(ledger: UsageByModel, prices: readonly ModelPrice[], currency: PricingCurrency): CappedCost {
  let used = 0;
  let uncounted = 0;
  for (const [model, usage] of Object.entries(ledger)) {
    const price = findModelPrice(prices, model);
    if (!price || price.currency !== currency) {
      uncounted += 1;
      continue;
    }
    used += costOfUsage(usage, price);
  }
  return { used, uncounted };
}

/** 一次已结束任务留下的记录，用来给同类任务做预估。 */
export interface TaskCostRecord {
  /** 结束时间。 */
  at: number;
  /** 任务类别，取值见 taskCostKinds。 */
  kind: string;
  /** 用量最多的模型，预估时优先找同一个模型的记录。 */
  model: string;
  durationMs: number;
  requests: number;
  usageByModel: UsageByModel;
}

export const taskCostHistoryLimits = {
  /** 本地最多保留的记录数。 */
  maxRecords: 200,
  /** 预估时每个类别最多参考最近多少条。 */
  window: 30,
  /** 至少要有这么多条同类记录才给预估；太少的样本说明不了什么。 */
  minSamples: 3,
} as const;

/** 同类任务的划分：普通对话和任务配方的开销差别大，不混在一起估。 */
export const taskCostKinds = { chat: "chat", recipe: "recipe" } as const;

/** 记录里用量最多的模型；账本为空时返回 null。 */
export function primaryModel(ledger: UsageByModel): string | null {
  let best: string | null = null;
  let bestTokens = -1;
  for (const [model, usage] of Object.entries(ledger)) {
    const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    if (tokens > bestTokens) {
      best = model;
      bestTokens = tokens;
    }
  }
  return best;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export interface TaskCostEstimate {
  currency: PricingCurrency;
  /** 同类任务费用的中间一半区间（第 25 到第 75 百分位）和中位数。 */
  low: number;
  median: number;
  high: number;
  samples: number;
  /** 参考的记录都来自同一个模型；否则是同类任务按各自当时的模型、现在的价格换算。 */
  sameModel: boolean;
}

/** 界面显示的预估：带上本对话生效的费用上限（同币种），用来提示「预估已经超过上限」。 */
export interface TaskCostForecast extends TaskCostEstimate {
  limit: number | null;
}

export interface TaskCostEstimateQuery {
  kind: string;
  model: string | null;
  /** 优先使用的币种（费用上限的币种）；省略时取所选模型登记的币种。 */
  currency?: PricingCurrency | null;
}

/**
 * 按同类历史任务估算一次任务的费用，用现在登记的价格重新换算。
 * 样本不足、或没有可用的币种时返回 null，调用方什么都不显示，而不是给一个没有依据的数。
 */
export function estimateTaskCost(
  history: readonly TaskCostRecord[],
  prices: readonly ModelPrice[],
  query: TaskCostEstimateQuery,
): TaskCostEstimate | null {
  const currency = query.currency ?? (query.model ? findModelPrice(prices, query.model)?.currency ?? null : null);
  if (!currency) return null;
  const sameKind = history.filter(record => record.kind === query.kind).slice(-taskCostHistoryLimits.window);
  const sameModel = query.model ? sameKind.filter(record => record.model === query.model) : [];
  const useSameModel = sameModel.length >= taskCostHistoryLimits.minSamples;
  const pool = useSameModel ? sameModel : sameKind;
  const costs = pool
    .map(record => cappedCost(record.usageByModel, prices, currency).used)
    .filter(cost => cost > 0)
    .sort((a, b) => a - b);
  if (costs.length < taskCostHistoryLimits.minSamples) return null;
  return {
    currency,
    low: percentile(costs, 0.25),
    median: percentile(costs, 0.5),
    high: percentile(costs, 0.75),
    samples: costs.length,
    sameModel: useSameModel,
  };
}

/** 解析磁盘上的历史记录；损坏的条目被丢弃，只保留最近的 maxRecords 条。 */
export function parseTaskCostHistory(raw: unknown): TaskCostRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: TaskCostRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const input = item as Record<string, unknown>;
    if (typeof input.at !== "number" || !Number.isFinite(input.at)) continue;
    if (typeof input.kind !== "string" || !input.kind || input.kind.length > 200) continue;
    if (typeof input.model !== "string" || !input.model || input.model.length > 300) continue;
    if (!input.usageByModel || typeof input.usageByModel !== "object" || Array.isArray(input.usageByModel)) continue;
    const ledger: UsageByModel = {};
    for (const [model, usage] of Object.entries(input.usageByModel as Record<string, unknown>)) {
      if (!usage || typeof usage !== "object") continue;
      addUsageByModel(ledger, model, usage as Partial<TraceUsage>);
    }
    if (Object.keys(ledger).length === 0) continue;
    records.push({
      at: input.at,
      kind: input.kind,
      model: input.model,
      durationMs: typeof input.durationMs === "number" && Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0,
      requests: typeof input.requests === "number" && Number.isFinite(input.requests) ? Math.max(0, Math.round(input.requests)) : 0,
      usageByModel: ledger,
    });
  }
  return records.slice(-taskCostHistoryLimits.maxRecords);
}
