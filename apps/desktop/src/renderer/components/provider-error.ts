/** 把模型服务返回的原始报错（纯文本或 JSON）解析成可展示的结构。 */
export type ProviderErrorKind = "usage-limit" | "rate-limit" | "overloaded" | "auth" | "context" | "other";

export interface ProviderError {
  kind: ProviderErrorKind;
  /** 报错前缀里的服务名，例如 Codex。 */
  source: string | null;
  /** 套餐名，例如 Plus。 */
  plan: string | null;
  /** 报错里给出的重试等待时间；没有则为 null。 */
  retryMinutes: number | null;
  /** 从 JSON 里取出的可读说明；纯文本报错为 null。 */
  message: string | null;
}

const CONTEXT = /context[_ ]length|maximum context|prompt is too long|too many tokens|input is too long|request_too_large|exceeds the context window/i;
const AUTH = /invalid[_ ]api[_ ]key|invalid x-api-key|incorrect api key|authentication[_ ]error|unauthori[sz]ed|permission[_ ]denied|api key (?:not valid|expired)|\b401\b|\b403\b/i;
const USAGE_LIMIT = /usage[ _]?limit|usage_not_included|insufficient_quota|exceeded your current quota|quota exceeded|out of budget|available balance|credit balance is too low|billing/i;
const RATE_LIMIT = /rate[ _-]?limit|too many requests|resource_exhausted|\b429\b/i;
const OVERLOADED = /overloaded|server_busy|server_is_overloaded|servers are currently busy|high demand|at capacity|capacity|slow_down/i;

function cleanMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

function capitalize(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从文本里找出第一段 JSON 对象（允许前面带 "429 " 之类的前缀，数组取第一项）。 */
function extractJson(text: string): Json | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const closer = text[start] === "{" ? "}" : "]";
  const ends = [text.length, text.lastIndexOf(closer) + 1].filter((end) => end > start);
  for (const end of new Set(ends)) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end));
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      if (isObject(first)) return first;
    } catch { /* 不是合法 JSON,换下一个截取位置 */ }
  }
  return null;
}

const asText = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value) : "");

/** "34s"、"1m30s"、"~125 min"、"2h" 一类的时长，换算成向上取整的分钟。 */
function durationMinutes(text: string): number | null {
  const units: Record<string, number> = { ms: 1 / 60000, s: 1 / 60, m: 1, h: 60 };
  let total = 0;
  let found = false;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|hours?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi)) {
    const unit = match[2]!.toLowerCase();
    const key = unit.startsWith("ms") ? "ms" : unit[0]!;
    total += Number(match[1]) * (units[key] ?? 0);
    found = true;
  }
  return found ? Math.ceil(total) : null;
}

function waitFromText(text: string): number | null {
  const match = /(?:try again|retry|resets?)(?: after| in)\s+(?:about\s+|~)?([\w. ~]{1,24})/i.exec(text);
  return match ? durationMinutes(match[1]!) : null;
}

/** 服务端在 JSON 里给的等待时间:resets_at(秒级时间戳)、resets_in_seconds、retry_after、Google 的 retryDelay。 */
function waitFromJson(error: Json, outer: Json, now: number): number | null {
  for (const source of [error, outer]) {
    const at = Number(source.resets_at);
    if (Number.isFinite(at) && at > 0) return Math.max(0, Math.ceil((at * 1000 - now) / 60000));
    for (const key of ["resets_in_seconds", "retry_after", "retry_after_seconds"]) {
      const seconds = Number(source[key]);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds / 60);
    }
  }
  const details = Array.isArray(error.details) ? error.details : [];
  for (const detail of details) {
    if (isObject(detail) && typeof detail.retryDelay === "string") return durationMinutes(detail.retryDelay);
  }
  return null;
}

/** 不是已知的服务报错时返回 null，调用方继续按普通报错显示。 */
export function parseProviderError(message: string | null | undefined, now: number = Date.now()): ProviderError | null {
  if (!message) return null;
  const cleaned = cleanMessage(message);
  const prefixed = /^([A-Za-z][\w.-]{0,24}(?: [\w.-]{1,24})?) error:\s*(.*)$/is.exec(cleaned);
  const source = prefixed?.[1] ?? null;
  const text = prefixed?.[2] ?? cleaned;

  let outer = extractJson(text);
  let error: Json | null = outer && isObject(outer.error) ? outer.error : outer;
  // 有的网关把真正的报错 JSON 再包进 message 字段里,多拆一层。
  const inner = error && typeof error.message === "string" ? extractJson(error.message) : null;
  if (inner) { outer = error; error = isObject(inner.error) ? inner.error : inner; }

  const readable = error ? asText(error.message) || asText(error.error_description) || asText(error.detail) : "";
  const fields = error ? [asText(error.type), asText(error.code), asText(error.status), asText(error.error)].filter(Boolean).join(" ") : "";
  const prefix = outer ? text.slice(0, Math.max(0, text.search(/[{[]/))) : "";
  const haystack = error ? `${prefix} ${fields} ${readable}` : text;

  const kind: ProviderErrorKind | null = CONTEXT.test(haystack) ? "context"
    : USAGE_LIMIT.test(haystack) ? "usage-limit"
    : AUTH.test(haystack) ? "auth"
    : RATE_LIMIT.test(haystack) ? "rate-limit"
    : OVERLOADED.test(haystack) ? "overloaded"
    // JSON 报错里有说明但不属于上面任何一类,仍然整理成卡片,不把 JSON 原样甩给用户。
    : readable ? "other"
    : null;
  if (!kind) return null;

  const planText = error ? asText(error.plan_type) || asText(outer?.plan_type) : "";
  const plan = planText || /\(([\w -]{1,24}?) plan\)/i.exec(haystack)?.[1] || null;
  const retryMinutes = (error && outer ? waitFromJson(error, outer, now) : null) ?? waitFromText(haystack);
  return { kind, source, plan: plan ? capitalize(plan) : null, retryMinutes, message: readable || null };
}
