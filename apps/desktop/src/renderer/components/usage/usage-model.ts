import { intlLocale, type AppLocale } from "@vela/shared";
import { addCost, costOfUsage, findModelPrice, type CostByCurrency, type ModelPrice, type PricingCurrency, type TraceRequest, type TraceUsage } from "@vela/shared";

/** Minimal shape shared by turn requests and standalone summary requests. */
export interface UsageRecord {
  id: string;
  model: string;
  startedAt: number | null;
  completedAt: number | null;
  usage: TraceUsage | null;
}

export function usageDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function requestDate(request: UsageRecord): string | null {
  const timestamp = request.startedAt ?? request.completedAt;
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? usageDateKey(date) : null;
}

/** Request IDs are local counters. Forks copy dated requests, so count shared history once. */
export function collectUsageRequests(conversations: { id: string; requests: TraceRequest[] }[]): TraceRequest[] {
  const requests = new Map<string, TraceRequest>();
  for (const conversation of conversations) {
    for (const request of conversation.requests) {
      const key = JSON.stringify([requestDate(request) === null ? conversation.id : null,
        request.id, request.model, request.contextId, request.startedAt, request.completedAt]);
      const previous = requests.get(key);
      if (!previous || request.usage || !previous.usage) requests.set(key, { ...request, id: key });
    }
  }
  return [...requests.values()];
}

export function filterUsageRequests<T extends UsageRecord>(requests: T[], filter: { provider: string; start: string; end: string }): T[] {
  return requests.filter(request => {
    if (filter.provider && !request.model.startsWith(`${filter.provider}/`)) return false;
    if (!filter.start && !filter.end) return true;
    const day = requestDate(request);
    return day !== null && (!filter.start || day >= filter.start) && (!filter.end || day <= filter.end);
  });
}

/** Calendar arithmetic keeps local days intact across DST changes. */
export function usageCalendar(end: Date, dayCount = 365): string[] {
  const day = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  day.setDate(day.getDate() - dayCount + 1);
  return Array.from({ length: dayCount }, () => {
    const key = usageDateKey(day);
    day.setDate(day.getDate() + 1);
    return key;
  });
}

export interface UsageTotals extends TraceUsage {
  requests: number;
  metered: number;
}

export interface ModelUsage extends UsageTotals {
  key: string;
  model: string;
  provider: string;
}

export interface ProviderUsage extends UsageTotals {
  provider: string;
}

function emptyTotals(): UsageTotals {
  return { requests: 0, metered: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function addRequest(totals: UsageTotals, request: UsageRecord) {
  totals.requests++;
  if (!request.usage) return;
  totals.metered++;
  totals.input += request.usage.input;
  totals.output += request.usage.output;
  totals.cacheRead += request.usage.cacheRead;
  totals.cacheWrite += request.usage.cacheWrite;
  totals.totalTokens += request.usage.totalTokens;
}

export function usageCoverage(totals: UsageTotals): number | null {
  return totals.requests > 0 ? totals.metered / totals.requests : null;
}

/** Cache tokens are part of the prompt; input contains only uncached tokens. */
export function usageInputTokens(totals: TraceUsage): number {
  return totals.input + totals.cacheRead + totals.cacheWrite;
}

export function usageCacheHitRate(totals: UsageTotals): number | null {
  const input = usageInputTokens(totals);
  return totals.metered > 0 && input > 0 ? totals.cacheRead / input : null;
}

export function summarizeUsage(requests: UsageRecord[]) {
  const totals = emptyTotals();
  const models = new Map<string, ModelUsage>();
  const providers = new Map<string, ProviderUsage>();
  const days = new Map<string, UsageTotals>();
  let undated = 0;
  // Snapshot updates replace requests with the same ID; never count one twice.
  for (const request of new Map(requests.map(request => [request.id, request])).values()) {
    const separator = request.model.indexOf("/");
    const provider = separator > 0 ? request.model.slice(0, separator) : "";
    const model = separator > 0 ? request.model.slice(separator + 1) : request.model;
    let modelUsage = models.get(request.model);
    if (!modelUsage) {
      modelUsage = { ...emptyTotals(), key: request.model, provider, model };
      models.set(request.model, modelUsage);
    }
    let providerUsage = providers.get(provider);
    if (!providerUsage) {
      providerUsage = { ...emptyTotals(), provider };
      providers.set(provider, providerUsage);
    }
    addRequest(totals, request);
    addRequest(modelUsage, request);
    addRequest(providerUsage, request);
    const date = requestDate(request);
    if (date) {
      const day = days.get(date) ?? emptyTotals();
      addRequest(day, request);
      days.set(date, day);
    } else {
      undated++;
    }
  }
  const byUsage = (a: UsageTotals, b: UsageTotals) => b.totalTokens - a.totalTokens || b.requests - a.requests;
  return {
    totals,
    models: [...models.values()].sort(byUsage),
    providers: [...providers.values()].sort(byUsage),
    activeDays: days.size,
    days,
    undated,
  };
}

export interface ModelCost {
  currency: PricingCurrency;
  amount: number;
}

/** 已登记价格的模型按自己的单价算费用；没登记价格或没有计量用量时返回 null，而不是 0。 */
export function modelCost(model: UsageTotals & { key: string }, prices: readonly ModelPrice[]): ModelCost | null {
  const price = findModelPrice(prices, model.key);
  if (!price || model.metered === 0) return null;
  return { currency: price.currency, amount: costOfUsage(model, price) };
}

export interface CostSummary {
  /** 各币种的费用合计，不做汇率换算。 */
  total: CostByCurrency;
  byModel: Map<string, ModelCost>;
  /** 有计量用量但还没登记价格的模型，费用没有计入合计。 */
  unpriced: string[];
}

export function summarizeCost(models: readonly (UsageTotals & { key: string })[], prices: readonly ModelPrice[]): CostSummary {
  let total: CostByCurrency = {};
  const byModel = new Map<string, ModelCost>();
  const unpriced: string[] = [];
  for (const model of models) {
    const cost = modelCost(model, prices);
    if (cost) {
      byModel.set(model.key, cost);
      total = addCost(total, cost.currency, cost.amount);
    } else if (model.metered > 0) {
      unpriced.push(model.key);
    }
  }
  return { total, byModel, unpriced };
}

/** 一次任务从用户发出消息开始，对应追踪里编号最大的那一轮。 */
export function latestTaskRequests<T extends { turn: number }>(requests: readonly T[]): T[] {
  const turn = requests.reduce((max, request) => Math.max(max, request.turn), 0);
  return turn > 0 ? requests.filter(request => request.turn === turn) : [];
}

export function formatUsageNumber(value: number, locale: AppLocale = "zh-CN"): string {
  const units: [number, string][] = locale === "en"
    ? [[1e9, "B"], [1e6, "M"], [1e3, "K"]]
    : locale === "zh-TW" || locale === "ja" ? [[1e8, "億"], [1e4, "萬"]]
    : locale === "ko" ? [[1e8, "억"], [1e4, "만"]]
    : [[1e8, "亿"], [1e4, "万"]];
  const unit = units.find(([threshold]) => value >= threshold);
  if (!unit) return value.toLocaleString(intlLocale(locale));
  return `${Number((value / unit[0]).toFixed(1))}${unit[1]}`;
}

export function formatUsagePercent(value: number | null): string {
  return value === null ? "—" : `${Number((value * 100).toFixed(1))}%`;
}
