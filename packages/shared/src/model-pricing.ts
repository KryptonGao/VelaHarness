/**
 * 模型价格登记与费用计算的共享契约。
 * 价格由用户手动登记，单位是「每 100 万 Token」；Vela 不内置价目表，也不换算汇率，
 * 所以人民币与美元的费用始终分开汇总。纯函数，主进程和界面共用。
 */
import type { TraceUsage } from "./trace";

export const pricingCurrencies = ["CNY", "USD"] as const;
export type PricingCurrency = (typeof pricingCurrencies)[number];

export const pricingCurrencySymbols: Readonly<Record<PricingCurrency, string>> = { CNY: "¥", USD: "$" };

/** 单个价格字段的上限，挡住明显的输入错误（例如多打了几个 0）。 */
export const maxPricePerMillion = 1_000_000;

export interface ModelPrice {
  /** 与用量记录一致的完整模型标识：`provider/model`。 */
  model: string;
  currency: PricingCurrency;
  /** 以下四项均为每 100 万 Token 的价格。input 指未命中缓存的输入。 */
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export type PriceField = "input" | "output" | "cacheWrite" | "cacheRead";
export const priceFields: readonly PriceField[] = ["input", "output", "cacheWrite", "cacheRead"];

/** 各币种的费用合计；某个币种没有费用时不出现。 */
export type CostByCurrency = Partial<Record<PricingCurrency, number>>;

export function isPricingCurrency(value: unknown): value is PricingCurrency {
  return typeof value === "string" && (pricingCurrencies as readonly string[]).includes(value);
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maxPricePerMillion;
}

/** 校验一条价格；不合法返回 null，调用方决定是丢弃还是提示。 */
export function parseModelPrice(raw: unknown): ModelPrice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model || model.length > 300 || !isPricingCurrency(input.currency)) return null;
  if (!priceFields.every(field => validPrice(input[field]))) return null;
  return {
    model,
    currency: input.currency,
    input: input.input as number,
    output: input.output as number,
    cacheWrite: input.cacheWrite as number,
    cacheRead: input.cacheRead as number,
  };
}

/** 读取已保存的价格；损坏的条目被跳过，同一个模型只保留最后一条。 */
export function parseModelPrices(text: string | null): ModelPrice[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const prices = new Map<string, ModelPrice>();
  for (const item of raw) {
    const price = parseModelPrice(item);
    if (price) prices.set(price.model, price);
  }
  return [...prices.values()];
}

export function serializeModelPrices(prices: readonly ModelPrice[]): string {
  return JSON.stringify(prices);
}

/** 登记新价格或替换同一模型的旧价格，保持登记顺序。 */
export function upsertModelPrice(prices: readonly ModelPrice[], price: ModelPrice): ModelPrice[] {
  const index = prices.findIndex(item => item.model === price.model);
  if (index < 0) return [...prices, price];
  return prices.map((item, position) => position === index ? price : item);
}

export function removeModelPrice(prices: readonly ModelPrice[], model: string): ModelPrice[] {
  return prices.filter(item => item.model !== model);
}

export function findModelPrice(prices: readonly ModelPrice[], model: string): ModelPrice | null {
  return prices.find(item => item.model === model) ?? null;
}

/**
 * 一组 Token 用量的费用。input 是未命中缓存的部分，缓存读取和写入各按自己的单价算，
 * 所以四项相加即可，不会重复计入。
 */
export function costOfUsage(usage: Pick<TraceUsage, PriceField>, price: ModelPrice): number {
  return (usage.input * price.input + usage.output * price.output
    + usage.cacheWrite * price.cacheWrite + usage.cacheRead * price.cacheRead) / 1_000_000;
}

export function addCost(total: CostByCurrency, currency: PricingCurrency, amount: number): CostByCurrency {
  return { ...total, [currency]: (total[currency] ?? 0) + amount };
}

export function hasCost(total: CostByCurrency): boolean {
  return pricingCurrencies.some(currency => total[currency] !== undefined);
}

/**
 * 费用的显示文本。小额保留更多位数，避免一次短任务显示成 ¥0.00；
 * 币种之间用「 · 」分隔，没有任何费用时返回 null。
 */
export function formatCost(total: CostByCurrency, locale = "en"): string | null {
  const parts = pricingCurrencies.flatMap(currency => {
    const amount = total[currency];
    if (amount === undefined) return [];
    const digits = amount === 0 ? 2 : amount < 0.01 ? 6 : amount < 1 ? 4 : 2;
    return [`${pricingCurrencySymbols[currency]}${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: digits })}`];
  });
  return parts.length ? parts.join(" · ") : null;
}
