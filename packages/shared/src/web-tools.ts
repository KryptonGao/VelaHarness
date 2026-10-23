/**
 * 网页工具（web_search / web_fetch）的提供商配置。
 * 与模型提供商完全分开：配置在 web-tools.json，密钥只在主进程的加密存储里。
 */

export type WebAuthType = "bearer" | "header" | "query" | "none";

export interface WebEndpointAuth {
  type: WebAuthType;
  /** header 为请求头名称，query 为查询参数名；bearer 与 none 不需要。 */
  name?: string;
}

interface WebEndpointBase {
  url: string;
  method: "GET" | "POST";
  auth: WebEndpointAuth;
  /** 额外请求头，值里可用模板变量；密钥请用 auth 或 {{apiKey}}。 */
  headers?: Record<string, string>;
  /** 追加到 URL 的查询参数模板。 */
  query?: Record<string, string>;
  /** POST 的 JSON 请求体模板；字符串值里的 {{变量}} 会被替换。 */
  body?: unknown;
  timeoutMs?: number;
}

export interface WebSearchFields {
  title: string;
  url: string;
  snippet?: string;
  summary?: string;
  content?: string;
  date?: string;
  source?: string;
}

/** 变量：{{query}}、{{count}}、{{apiKey}}。整串恰为 {{count}} 时按数字代入。 */
export interface WebSearchEndpoint extends WebEndpointBase {
  /** 响应里结果数组的路径；空字符串表示响应本身就是数组。 */
  resultsPath: string;
  fields: WebSearchFields;
}

/** 变量：{{url}}、{{apiKey}}。 */
export interface WebFetchEndpoint extends WebEndpointBase {
  titlePath?: string;
  /** 正文路径，内容应为文本或 Markdown。 */
  contentPath: string;
}

export interface WebProvider {
  id: string;
  name: string;
  builtin?: boolean;
  search?: WebSearchEndpoint;
  fetch?: WebFetchEndpoint;
}

export type WebCapability = "search" | "fetch";

export interface WebToolsConfig {
  enabled: boolean;
  searchProviderId: string | null;
  fetchProviderId: string | null;
  /** 只含用户自定义的提供商；内置预设始终存在。 */
  providers: WebProvider[];
}

export interface WebProviderView extends WebProvider {
  hasKey: boolean;
}

export interface WebToolsState {
  enabled: boolean;
  searchProviderId: string | null;
  fetchProviderId: string | null;
  providers: WebProviderView[];
  /** 加密存储可读写；false 时不能保存或使用密钥。 */
  keysAvailable: boolean;
}

export type WebToolsFailureCode =
  | "invalid"
  | "no-key"
  | "no-provider"
  | "unsupported"
  | "auth"
  | "balance"
  | "blocked"
  | "not-found"
  | "rate-limit"
  | "timeout"
  | "network"
  | "response"
  | "storage"
  | "disabled";

export type WebToolsResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: WebToolsFailureCode; message: string };

export interface WebToolsTestResult {
  durationMs: number;
  /** 搜索为命中条数，抓取为正文字符数。 */
  size: number;
  title: string | null;
}

export interface WebToolsApi {
  get(): Promise<WebToolsResult<WebToolsState>>;
  save(input: WebToolsConfig): Promise<WebToolsResult<WebToolsState>>;
  setApiKey(input: { providerId: string; apiKey: string | null }): Promise<WebToolsResult<WebToolsState>>;
  test(input: { providerId: string; capability: WebCapability }): Promise<WebToolsResult<WebToolsTestResult>>;
}

export const webToolsLimits = {
  idMax: 40,
  nameMax: 80,
  urlMax: 2048,
  keyMax: 4000,
  providersMax: 20,
  templateMax: 8192,
  searchCountMax: 20,
  searchCountDefault: 8,
  queryMax: 400,
  fetchUrlMax: 8192,
} as const;

export const webProviderIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const deepseekWebProvider: WebProvider = {
  id: "deepseek",
  name: "DeepSeek",
  builtin: true,
  search: {
    url: "https://api.deepseek.com/v1/tools/search",
    method: "POST",
    auth: { type: "bearer" },
    body: { query: "{{query}}", count: "{{count}}" },
    resultsPath: "results",
    fields: { title: "title", url: "url", snippet: "snippet", summary: "summary", date: "date", source: "site_name" },
  },
  fetch: {
    url: "https://api.deepseek.com/v1/tools/fetch",
    method: "POST",
    auth: { type: "bearer" },
    body: { url: "{{url}}" },
    titlePath: "title",
    contentPath: "content",
  },
};

export const builtinWebProviders: readonly WebProvider[] = [deepseekWebProvider];

export const defaultWebToolsConfig = (): WebToolsConfig => ({
  enabled: false,
  searchProviderId: null,
  fetchProviderId: null,
  providers: [],
});

/**
 * 有些抓取服务（DeepSeek 等）返回的是「转义过的 Markdown」：`\#\# 标题`、`\- 列表`、`2024\-07\-25`。
 * 原样渲染会把标记符当成普通文字。这里只在转义明显密集时还原，避免破坏正文里本来就有的反斜杠（如正则、路径）。
 */
export function unescapeMarkdown(text: string): string {
  const escape = /\\([!-/:-@[-`{-~])/g;
  const count = text.match(escape)?.length ?? 0;
  if (count < 5 || count * 100 < text.length) return text;
  return text.replace(escape, "$1");
}
