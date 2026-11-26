import { intlLocale, type AppLocale } from "@vela/shared";
import { addCost, addUsageByModel, hasCost, ledgerCost, pricingCurrencies, type CostByCurrency, type ModelPrice, type UsageByModel, type TraceRequest, type TraceUsage } from "@vela/shared";

/** Minimal shape shared by turn requests and standalone summary requests. */
export interface UsageRecord {
  id: string;
  model: string;
  startedAt: number | null;
  completedAt: number | null;
  usage: TraceUsage | null;
  /** Imported daily buckets represent multiple metered requests. */
  requestCount?: number;
  missingBreakdown?: boolean;
  /** Undefined uses the model's registered rate, null marks an unpriceable record. */
  priceKey?: string | null;
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

export function filterUsageRequests<T extends UsageRecord>(requests: T[], filter: { providers: readonly string[]; start: string; end: string }): T[] {
  const providers = new Set(filter.providers);
  return requests.filter(request => {
    if (providers.size) {
      const separator = request.model.indexOf("/");
      if (separator < 1 || !providers.has(request.model.slice(0, separator))) return false;
    }
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
  detailed: number;
  requests: number;
  metered: number;
}

export interface ModelUsage extends UsageTotals {
  usageByPrice: UsageByModel;
  key: string;
  model: string;
  provider: string;
}

export interface ProviderUsage extends UsageTotals {
  provider: string;
}

function emptyTotals(): UsageTotals {
  return { requests: 0, metered: 0, detailed: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function addRequest(totals: UsageTotals, request: UsageRecord) {
  totals.requests += request.requestCount ?? 1;
  if (!request.usage) return;
  totals.metered += request.requestCount ?? 1;
  totals.totalTokens += request.usage.totalTokens;
  if (request.missingBreakdown) return;
  totals.detailed += request.requestCount ?? 1;
  totals.input += request.usage.input;
  totals.output += request.usage.output;
  totals.cacheRead += request.usage.cacheRead;
  totals.cacheWrite += request.usage.cacheWrite;
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
  let reportedRequests = 0;
  // Snapshot updates replace requests with the same ID; never count one twice.
  for (const request of new Map(requests.map(request => [request.id, request])).values()) {
    const separator = request.model.indexOf("/");
    const provider = separator > 0 ? request.model.slice(0, separator) : "";
    const model = separator > 0 ? request.model.slice(separator + 1) : request.model;
    let modelUsage = models.get(request.model);
    if (!modelUsage) {
      modelUsage = { ...emptyTotals(), key: request.model, provider, model, usageByPrice: Object.create(null) };
      models.set(request.model, modelUsage);
    }
    let providerUsage = providers.get(provider);
    if (!providerUsage) {
      providerUsage = { ...emptyTotals(), provider };
      providers.set(provider, providerUsage);
    }
    addRequest(totals, request);
    addRequest(modelUsage, request);
    if (model && request.usage) {
      reportedRequests += request.requestCount ?? 1;
      if (!request.missingBreakdown && request.priceKey !== null) {
        addUsageByModel(modelUsage.usageByPrice, request.priceKey ?? request.model, request.usage);
      }
    }
    addRequest(providerUsage, request);
    const date = requestDate(request);
    if (date) {
      const day = days.get(date) ?? emptyTotals();
      addRequest(day, request);
      days.set(date, day);
    } else {
      undated += request.requestCount ?? 1;
    }
  }
  const byUsage = (a: UsageTotals, b: UsageTotals) => b.totalTokens - a.totalTokens || b.requests - a.requests;
  return {
    totals,
    reportedRequests,
    models: [...models.values()].sort(byUsage),
    providers: [...providers.values()].sort(byUsage),
    activeDays: days.size,
    days,
    undated,
  };
}

export interface CostSummary {
  total: CostByCurrency;
  byModel: Map<string, CostByCurrency>;
  unpriced: string[];
}

export function summarizeCost(models: readonly ModelUsage[], prices: readonly ModelPrice[]): CostSummary {
  let total: CostByCurrency = {};
  const byModel = new Map<string, CostByCurrency>();
  const unpriced: string[] = [];
  for (const model of models) {
    const result = ledgerCost(model.usageByPrice, prices);
    unpriced.push(...result.unpriced);
    if (!hasCost(result.cost)) continue;
    byModel.set(model.key, result.cost);
    for (const currency of pricingCurrencies) {
      const amount = result.cost[currency];
      if (amount !== undefined) total = addCost(total, currency, amount);
    }
  }
  return { total, byModel, unpriced };
}

/** 一次任务从用户发出消息开始，对应追踪里编号最大的那一轮。 */
/**
 * 最近一次任务里子代理的请求：子代理在主代理发出派生请求之后才开始，
 * 所以取完成时间不早于该任务最早一次主代理请求的那些。没有主代理请求或缺少时间时视为没有。
 */
export function latestTaskAgentRequests<T extends UsageRecord>(
  latest: readonly UsageRecord[],
  agentRequests: readonly T[],
): T[] {
  const times = latest.map(request => request.startedAt ?? request.completedAt).filter((time): time is number => time !== null && Number.isFinite(time));
  if (times.length === 0) return [];
  const since = Math.min(...times);
  return agentRequests.filter(request => request.completedAt !== null && request.completedAt >= since);
}

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

const ONE_MILLION = 1_000_000;
const ONE_BILLION = 1_000_000_000;
/** Values at or above 999.95M round to 1000.0M, so switch to B at this boundary. */
const BILLION_DISPLAY_THRESHOLD = 999_950_000;

/** Format token counts in M or B with one decimal place for heatmap tooltips. */
export function formatHeatmapTokens(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safe >= BILLION_DISPLAY_THRESHOLD) {
    return `${(safe / ONE_BILLION).toFixed(1)}B`;
  }
  return `${(safe / ONE_MILLION).toFixed(1)}M`;
}
