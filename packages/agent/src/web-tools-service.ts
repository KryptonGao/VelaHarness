import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  builtinWebProviders,
  defaultWebToolsConfig,
  redactSensitive,
  unescapeMarkdown,
  webProviderIdPattern,
  webToolsLimits,
  type WebCapability,
  type WebFetchEndpoint,
  type WebProvider,
  type WebSearchEndpoint,
  type WebToolsConfig,
  type WebToolsFailureCode,
  type WebToolsState,
  type WebToolsTestResult,
} from "@vela/shared";
import { MemoryCredentialStore, type CredentialStore } from "./mcp/credentials";

/** 工具与设置页共用的失败类型；code 决定界面文案，message 面向模型和日志。 */
export class WebToolsError extends Error {
  constructor(readonly code: WebToolsFailureCode, message: string, readonly status?: number) {
    super(message);
    this.name = "WebToolsError";
  }
}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet?: string;
  summary?: string;
  content?: string;
  date?: string;
  source?: string;
}

export interface WebSearchResponse {
  provider: string;
  results: WebSearchHit[];
}

export interface WebFetchResponse {
  provider: string;
  url: string;
  title: string | null;
  content: string;
  truncated: boolean;
}

export interface WebToolsServiceOptions {
  agentDir: string;
  /** 桌面端注入系统加密存储；缺省时只在内存里保存，进程退出即丢失。 */
  credentials?: CredentialStore;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const maxResponseBytes = 2 * 1024 * 1024;
const defaultTimeoutMs: Record<WebCapability, number> = { search: 20_000, fetch: 30_000 };
const maxRetryDelayMs = 5_000;
const fetchContentMax = 50_000;
const snippetMax = 1_000;
const contentSnippetMax = 2_000;
const forbiddenHeaders = new Set([
  "host", "content-length", "connection", "transfer-encoding", "upgrade", "te", "trailer", "keep-alive",
  "proxy-authorization", "proxy-connection", "expect", "cookie", "set-cookie",
]);
const searchVariables = new Set(["query", "count", "apiKey"]);
const fetchVariables = new Set(["url", "apiKey"]);
const pathPattern = /^[A-Za-z0-9_$-]+(\[\d+\])*(\.[A-Za-z0-9_$-]+(\[\d+\])*)*$/;
const placeholderPattern = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

type Endpoint = WebSearchEndpoint | WebFetchEndpoint;
type Variables = Record<string, string | number>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function invalid(message: string): never {
  throw new WebToolsError("invalid", message);
}

function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== "string") return required ? invalid(`${label}必须是文本`) : "";
  const trimmed = value.trim();
  if (required && !trimmed) invalid(`${label}不能为空`);
  if (trimmed.length > max) invalid(`${label}最长 ${max} 个字符`);
  return trimmed;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

/** 目标 URL 是否指向本机或内网；抓取不碰这些地址。 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (isLoopbackHost(host) || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true;
  if (!host.includes(".") && !host.includes(":")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (host.includes(":")) {
    if (host === "::" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host)) return true;
    const mapped = /^::ffff:(.+)$/.exec(host);
    if (mapped) {
      const tail = mapped[1]!;
      if (tail.includes(".")) return isPrivateHost(tail);
      const [hi, lo] = tail.split(":").map(part => Number.parseInt(part, 16));
      if (hi !== undefined && lo !== undefined && Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
    }
  }
  return false;
}

/** 校验并规范化要抓取的 URL。 */
export function parseFetchUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) throw new WebToolsError("invalid", "URL is required");
  const value = raw.trim();
  if (value.length > webToolsLimits.fetchUrlMax) throw new WebToolsError("invalid", `URL is longer than ${webToolsLimits.fetchUrlMax} characters`);
  let url: URL;
  try { url = new URL(value); } catch { throw new WebToolsError("invalid", "URL is not valid"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebToolsError("invalid", "Only http and https URLs can be fetched");
  if (url.username || url.password) throw new WebToolsError("invalid", "URLs with a username or password are not fetched");
  if (isPrivateHost(url.hostname)) throw new WebToolsError("invalid", "Local and private network addresses are not fetched");
  return url;
}

function placeholdersOf(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(placeholderPattern)) into.add(match[1]!);
  } else if (Array.isArray(value)) {
    for (const item of value) placeholdersOf(item, into);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) placeholdersOf(item, into);
  }
}

function templateMap(value: unknown, label: string, headers: boolean): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalid(`${label}必须是键值对象`);
  const entries = Object.entries(value);
  if (entries.length > 20) invalid(`${label}最多 20 项`);
  const out: Record<string, string> = {};
  for (const [name, item] of entries) {
    if (typeof item !== "string") invalid(`${label}「${name}」的值必须是文本`);
    if (item.length > 2000 || /[\r\n]/.test(item)) invalid(`${label}「${name}」的值不合法`);
    if (headers) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) invalid(`请求头名称「${name}」不合法`);
      if (forbiddenHeaders.has(name.toLowerCase())) invalid(`不能自定义请求头 ${name}`);
    } else if (!/^[A-Za-z0-9_.\-[\]]{1,64}$/.test(name)) {
      invalid(`查询参数名称「${name}」不合法`);
    }
    out[name] = item;
  }
  return out;
}

function parseEndpoint(raw: unknown, capability: WebCapability): Endpoint {
  if (!isRecord(raw)) return invalid(capability === "search" ? "搜索接口配置不正确" : "抓取接口配置不正确");
  const urlText = text(raw.url, "接口地址", webToolsLimits.urlMax);
  let url: URL;
  try { url = new URL(urlText); } catch { return invalid("接口地址不是有效的 URL"); }
  if (url.username || url.password) invalid("接口地址不能包含账号或密码");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    invalid("接口地址必须使用 https（仅本机地址可以用 http）");
  }
  const method = raw.method === "GET" || raw.method === "POST" ? raw.method : invalid("请求方法只能是 GET 或 POST");
  const authRaw = isRecord(raw.auth) ? raw.auth : invalid("缺少验证方式");
  const type = authRaw.type;
  if (type !== "bearer" && type !== "header" && type !== "query" && type !== "none") invalid("验证方式不正确");
  let authName: string | undefined;
  if (type === "header") {
    authName = text(authRaw.name, "请求头名称", 64);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(authName) || forbiddenHeaders.has(authName.toLowerCase())) invalid("验证请求头名称不合法");
  } else if (type === "query") {
    authName = text(authRaw.name, "查询参数名称", 64);
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(authName)) invalid("验证查询参数名称不合法");
  }
  const headers = templateMap(raw.headers, "请求头", true);
  const query = templateMap(raw.query, "查询参数", false);
  let body: unknown;
  if (raw.body !== undefined) {
    if (method !== "POST") invalid("只有 POST 可以带请求体");
    let serialized: string;
    try { serialized = JSON.stringify(raw.body) ?? ""; } catch { return invalid("请求体必须是 JSON"); }
    if (serialized.length > webToolsLimits.templateMax) invalid("请求体模板过长");
    body = JSON.parse(serialized) as unknown;
  }
  let timeoutMs: number | undefined;
  if (raw.timeoutMs !== undefined) {
    if (!Number.isInteger(raw.timeoutMs) || (raw.timeoutMs as number) < 1_000 || (raw.timeoutMs as number) > 60_000) invalid("超时必须在 1000 到 60000 毫秒之间");
    timeoutMs = raw.timeoutMs as number;
  }
  const used = new Set<string>();
  placeholdersOf(headers, used);
  placeholdersOf(query, used);
  placeholdersOf(body, used);
  const allowed = capability === "search" ? searchVariables : fetchVariables;
  for (const name of used) if (!allowed.has(name)) invalid(`模板变量 {{${name}}} 不支持，可用：${[...allowed].map(item => `{{${item}}}`).join("、")}`);
  const required = capability === "search" ? "query" : "url";
  if (!used.has(required)) invalid(`请求模板必须包含 {{${required}}}`);
  const common = {
    url: url.toString(), method, auth: { type, ...(authName ? { name: authName } : {}) },
    ...(headers ? { headers } : {}), ...(query ? { query } : {}), ...(body !== undefined ? { body } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  } as const;
  const path = (value: unknown, label: string, optional: boolean): string | undefined => {
    if (value === undefined || value === "") return optional ? undefined : invalid(`${label}不能为空`);
    const trimmed = text(value, label, 200);
    if (!pathPattern.test(trimmed)) invalid(`${label}「${trimmed}」不是有效路径，例如 data.items[0].title`);
    return trimmed;
  };
  if (capability === "search") {
    const fields = isRecord(raw.fields) ? raw.fields : invalid("缺少结果字段映射");
    let resultsPath = "";
    if (raw.resultsPath !== undefined && raw.resultsPath !== "") resultsPath = path(raw.resultsPath, "结果数组路径", false)!;
    const mapped = {
      title: path(fields.title, "标题字段", false)!,
      url: path(fields.url, "链接字段", false)!,
      snippet: path(fields.snippet, "摘要字段", true),
      summary: path(fields.summary, "概述字段", true),
      content: path(fields.content, "正文字段", true),
      date: path(fields.date, "日期字段", true),
      source: path(fields.source, "来源字段", true),
    };
    const cleaned = Object.fromEntries(Object.entries(mapped).filter(([, item]) => item !== undefined)) as unknown as WebSearchEndpoint["fields"];
    return { ...common, resultsPath, fields: cleaned };
  }
  const titlePath = path(raw.titlePath, "标题路径", true);
  return { ...common, ...(titlePath ? { titlePath } : {}), contentPath: path(raw.contentPath, "正文路径", false)! };
}

/** 严格校验一个提供商；内置与自定义共用。 */
export function parseWebProvider(raw: unknown, builtin = false): WebProvider {
  if (!isRecord(raw)) return invalid("提供商配置不正确");
  const id = text(raw.id, "提供商 ID", webToolsLimits.idMax);
  if (!webProviderIdPattern.test(id)) invalid("提供商 ID 只能用小写字母、数字、连字符和下划线");
  const name = text(raw.name, "提供商名称", webToolsLimits.nameMax);
  if (raw.search === undefined && raw.fetch === undefined) invalid("提供商至少要配置搜索或抓取之一");
  return {
    id, name, ...(builtin ? { builtin: true } : {}),
    ...(raw.search !== undefined ? { search: parseEndpoint(raw.search, "search") as WebSearchEndpoint } : {}),
    ...(raw.fetch !== undefined ? { fetch: parseEndpoint(raw.fetch, "fetch") as WebFetchEndpoint } : {}),
  };
}

const builtinIds = new Set(builtinWebProviders.map(provider => provider.id));

/** 严格校验整份配置；非法输入抛出 WebToolsError("invalid")。 */
export function parseWebToolsConfig(raw: unknown): WebToolsConfig {
  if (!isRecord(raw)) return invalid("网页工具配置不正确");
  if (typeof raw.enabled !== "boolean") invalid("开关必须是布尔值");
  if (!Array.isArray(raw.providers ?? [])) invalid("提供商列表不正确");
  const rawProviders = (raw.providers ?? []) as unknown[];
  if (rawProviders.length > webToolsLimits.providersMax) invalid(`最多 ${webToolsLimits.providersMax} 个自定义提供商`);
  const providers: WebProvider[] = [];
  const seen = new Set<string>(builtinIds);
  for (const item of rawProviders) {
    const provider = parseWebProvider(item);
    if (seen.has(provider.id)) invalid(`提供商 ID「${provider.id}」已被使用`);
    seen.add(provider.id);
    providers.push(provider);
  }
  const all = [...builtinWebProviders, ...providers];
  const select = (value: unknown, capability: WebCapability): string | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") return invalid("提供商选择不正确");
    const provider = all.find(item => item.id === value);
    if (!provider) return invalid("选择的提供商不存在");
    if (!provider[capability]) return invalid(capability === "search" ? "选择的提供商没有配置搜索" : "选择的提供商没有配置抓取");
    return value;
  };
  return {
    enabled: raw.enabled, providers,
    searchProviderId: select(raw.searchProviderId, "search"),
    fetchProviderId: select(raw.fetchProviderId, "fetch"),
  };
}

/** 读取路径 a.b[0].c；遇到缺失返回 undefined。 */
export function readPath(value: unknown, path: string): unknown {
  if (path === "") return value;
  let current: unknown = value;
  for (const part of path.split(".")) {
    const match = /^([A-Za-z0-9_$-]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) return undefined;
    if (!isRecord(current)) return undefined;
    current = current[match[1]!];
    for (const index of match[2]!.matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(index[1])];
    }
  }
  return current;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function render(template: unknown, variables: Variables): unknown {
  if (typeof template === "string") {
    const whole = /^\s*\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*$/.exec(template);
    if (whole && variables[whole[1]!] !== undefined) return variables[whole[1]!];
    return template.replace(placeholderPattern, (_all, name: string) => String(variables[name] ?? ""));
  }
  if (Array.isArray(template)) return template.map(item => render(item, variables));
  if (isRecord(template)) return Object.fromEntries(Object.entries(template).map(([key, item]) => [key, render(item, variables)]));
  return template;
}

function usesApiKey(endpoint: Endpoint): boolean {
  if (endpoint.auth.type !== "none") return true;
  const used = new Set<string>();
  placeholdersOf(endpoint.headers, used);
  placeholdersOf(endpoint.query, used);
  placeholdersOf(endpoint.body, used);
  return used.has("apiKey");
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function readBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxResponseBytes) throw new WebToolsError("response", "Provider response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new WebToolsError("response", "Provider response is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function statusError(status: number, detail: string): WebToolsError {
  const suffix = detail ? `: ${detail}` : "";
  if (status === 400) return new WebToolsError("invalid", `Provider rejected the request (400)${suffix}`, status);
  if (status === 401) return new WebToolsError("auth", `Provider rejected the API key (401)${suffix}`, status);
  if (status === 402) return new WebToolsError("balance", `Provider account balance is insufficient (402)${suffix}`, status);
  if (status === 403) return new WebToolsError("blocked", `Provider refused this request (403)${suffix}`, status);
  if (status === 404) return new WebToolsError("not-found", `Page or endpoint unavailable (404)${suffix}`, status);
  if (status === 408) return new WebToolsError("timeout", `Provider timed out (408)${suffix}`, status);
  if (status === 429) return new WebToolsError("rate-limit", `Provider rate limit reached (429)${suffix}`, status);
  if (status >= 500) return new WebToolsError("network", `Provider server error (${status})${suffix}`, status);
  return new WebToolsError("response", `Unexpected provider status ${status}${suffix}`, status);
}

const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

interface ServiceFile { version: 1; enabled: boolean; searchProviderId: string | null; fetchProviderId: string | null; providers: WebProvider[] }
type ChangeListener = () => void;

/**
 * 网页搜索与抓取的提供商配置、密钥和 HTTP 调用。与模型提供商无关：
 * 配置在 web-tools.json，密钥在注入的加密存储里，永远不回到界面。
 */
export class WebToolsService {
  private config: WebToolsConfig = defaultWebToolsConfig();
  private readonly path: string;
  private readonly credentials: CredentialStore;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly listeners = new Set<ChangeListener>();
  private keyCache: Record<string, string> | null = null;

  constructor(private readonly options: WebToolsServiceOptions) {
    this.path = join(options.agentDir, "web-tools.json");
    this.credentials = options.credentials ?? new MemoryCredentialStore();
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.config = this.load();
  }

  /** 缺失、损坏或不合法的文件一律按关闭处理，不会意外启用。 */
  private load(): WebToolsConfig {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (!isRecord(raw) || raw.version !== 1) return defaultWebToolsConfig();
      return parseWebToolsConfig(raw);
    } catch {
      return defaultWebToolsConfig();
    }
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* 监听者失败不影响保存 */ }
    }
  }

  private allProviders(): WebProvider[] {
    return [...builtinWebProviders, ...this.config.providers];
  }

  private provider(id: string | null): WebProvider | undefined {
    return id ? this.allProviders().find(item => item.id === id) : undefined;
  }

  /** 读取密钥表；加密存储不可用时返回 null，不缓存失败。 */
  private keys(): Record<string, string> | null {
    if (this.keyCache) return this.keyCache;
    try {
      const keys = this.credentials.withLock<Record<string, string>>(current => {
        if (!current) return { result: {} };
        const parsed = JSON.parse(current) as { version?: number; keys?: unknown };
        const out: Record<string, string> = {};
        if (parsed.version === 1 && isRecord(parsed.keys)) {
          for (const [id, value] of Object.entries(parsed.keys)) if (typeof value === "string" && value) out[id] = value;
        }
        return { result: out };
      });
      this.keyCache = keys;
      return keys;
    } catch {
      return null;
    }
  }

  private writeKeys(keys: Record<string, string>): void {
    try {
      this.credentials.withLock<null>(() => ({ result: null, next: JSON.stringify({ version: 1, keys }) }));
    } catch {
      throw new WebToolsError("storage", "Secure credential storage is unavailable");
    }
    this.keyCache = { ...keys };
  }

  getConfig(): WebToolsConfig {
    return structuredClone(this.config);
  }

  getState(): WebToolsState {
    const keys = this.keys();
    return {
      enabled: this.config.enabled,
      searchProviderId: this.config.searchProviderId,
      fetchProviderId: this.config.fetchProviderId,
      providers: this.allProviders().map(provider => ({ ...structuredClone(provider), hasKey: Boolean(keys?.[provider.id]) })),
      keysAvailable: keys !== null,
    };
  }

  save(raw: unknown): WebToolsState {
    const next = parseWebToolsConfig(raw);
    const file: ServiceFile = { version: 1, ...next };
    mkdirSync(this.options.agentDir, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    const removed = this.config.providers.filter(old => !next.providers.some(item => item.id === old.id));
    this.config = next;
    if (removed.length) {
      const keys = this.keys();
      if (keys && removed.some(provider => keys[provider.id])) {
        const rest = { ...keys };
        for (const provider of removed) delete rest[provider.id];
        try { this.writeKeys(rest); } catch { /* 密钥残留无害：ID 不存在时不会被使用 */ }
      }
    }
    this.emit();
    return this.getState();
  }

  setApiKey(providerId: string, apiKey: string | null): WebToolsState {
    if (!this.provider(providerId)) throw new WebToolsError("invalid", "提供商不存在");
    const keys = this.keys();
    if (!keys) throw new WebToolsError("storage", "Secure credential storage is unavailable");
    const next = { ...keys };
    if (apiKey === null) {
      delete next[providerId];
    } else {
      const value = apiKey.trim();
      if (!value) throw new WebToolsError("invalid", "密钥不能为空");
      if (value.length > webToolsLimits.keyMax) throw new WebToolsError("invalid", "密钥过长");
      if (/[\r\n\0]/.test(value)) throw new WebToolsError("invalid", "密钥含有不合法字符");
      next[providerId] = value;
    }
    this.writeKeys(next);
    this.emit();
    return this.getState();
  }

  /** 当前开关、已选提供商和密钥都就绪的能力。工具据此激活。 */
  ready(): { search: boolean; fetch: boolean } {
    if (!this.config.enabled) return { search: false, fetch: false };
    return { search: this.usable("search", this.config.searchProviderId), fetch: this.usable("fetch", this.config.fetchProviderId) };
  }

  private usable(capability: WebCapability, id: string | null): boolean {
    const endpoint = this.provider(id)?.[capability];
    if (!endpoint) return false;
    return !usesApiKey(endpoint) || Boolean(this.keys()?.[id!]);
  }

  async search(query: string, count: number | undefined, signal?: AbortSignal): Promise<WebSearchResponse> {
    if (!this.config.enabled) throw new WebToolsError("disabled", "Web tools are turned off in Settings");
    return this.runSearch(this.config.searchProviderId, query, count, signal);
  }

  async fetch(rawUrl: unknown, signal?: AbortSignal): Promise<WebFetchResponse> {
    if (!this.config.enabled) throw new WebToolsError("disabled", "Web tools are turned off in Settings");
    return this.runFetch(this.config.fetchProviderId, rawUrl, signal);
  }

  /** 设置页的测试：不要求总开关已打开。 */
  async test(providerId: string, capability: WebCapability, signal?: AbortSignal): Promise<WebToolsTestResult> {
    const started = Date.now();
    if (capability === "search") {
      const response = await this.runSearch(providerId, "Vela", 1, signal);
      return { durationMs: Date.now() - started, size: response.results.length, title: response.results[0]?.title ?? null };
    }
    const response = await this.runFetch(providerId, "https://example.com/", signal);
    return { durationMs: Date.now() - started, size: response.content.length, title: response.title };
  }

  private resolve(providerId: string | null, capability: WebCapability): { provider: WebProvider; endpoint: Endpoint; key: string | null } {
    const provider = this.provider(providerId);
    if (!provider) throw new WebToolsError("no-provider", capability === "search" ? "No search provider is selected in Settings" : "No fetch provider is selected in Settings");
    const endpoint = provider[capability];
    if (!endpoint) throw new WebToolsError("unsupported", `Provider ${provider.name} does not support ${capability}`);
    let key: string | null = null;
    if (usesApiKey(endpoint)) {
      const keys = this.keys();
      if (!keys) throw new WebToolsError("storage", "Secure credential storage is unavailable");
      key = keys[provider.id] ?? null;
      if (!key) throw new WebToolsError("no-key", `No API key saved for ${provider.name}`);
    }
    return { provider, endpoint, key };
  }

  private async runSearch(providerId: string | null, rawQuery: string, count: number | undefined, signal?: AbortSignal): Promise<WebSearchResponse> {
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!query) throw new WebToolsError("invalid", "Query is required");
    if (query.length > webToolsLimits.queryMax) throw new WebToolsError("invalid", `Query is longer than ${webToolsLimits.queryMax} characters`);
    const requested = typeof count === "number" && Number.isFinite(count) ? Math.trunc(count) : webToolsLimits.searchCountDefault;
    const limit = Math.min(Math.max(requested, 1), webToolsLimits.searchCountMax);
    const { provider, endpoint, key } = this.resolve(providerId, "search");
    const search = endpoint as WebSearchEndpoint;
    const json = await this.request(search, "search", { query, count: limit, apiKey: key ?? "" }, key, signal);
    const list = readPath(json, search.resultsPath);
    if (!Array.isArray(list)) throw new WebToolsError("response", `Provider ${provider.name} returned an unexpected search response`);
    const results: WebSearchHit[] = [];
    for (const item of list) {
      const link = scalarText(readPath(item, search.fields.url));
      if (!link || !/^https?:\/\//i.test(link)) continue;
      const pick = (path: string | undefined, max: number) => {
        const value = path ? scalarText(readPath(item, path)) : undefined;
        return value ? clip(value, max) : undefined;
      };
      results.push({
        title: clip(scalarText(readPath(item, search.fields.title)) ?? link, 300),
        url: link,
        ...(pick(search.fields.snippet, snippetMax) ? { snippet: pick(search.fields.snippet, snippetMax) } : {}),
        ...(pick(search.fields.summary, snippetMax) ? { summary: pick(search.fields.summary, snippetMax) } : {}),
        ...(pick(search.fields.content, contentSnippetMax) ? { content: pick(search.fields.content, contentSnippetMax) } : {}),
        ...(pick(search.fields.date, 64) ? { date: pick(search.fields.date, 64) } : {}),
        ...(pick(search.fields.source, 120) ? { source: pick(search.fields.source, 120) } : {}),
      });
      if (results.length >= limit) break;
    }
    return { provider: provider.name, results };
  }

  private async runFetch(providerId: string | null, rawUrl: unknown, signal?: AbortSignal): Promise<WebFetchResponse> {
    const target = parseFetchUrl(rawUrl);
    const { provider, endpoint, key } = this.resolve(providerId, "fetch");
    const fetchEndpoint = endpoint as WebFetchEndpoint;
    const json = await this.request(fetchEndpoint, "fetch", { url: target.toString(), apiKey: key ?? "" }, key, signal);
    const rawContent = scalarText(readPath(json, fetchEndpoint.contentPath));
    const content = rawContent === undefined ? undefined : unescapeMarkdown(rawContent);
    if (content === undefined) throw new WebToolsError("response", `Provider ${provider.name} returned no page content`);
    const title = fetchEndpoint.titlePath ? scalarText(readPath(json, fetchEndpoint.titlePath)) ?? null : null;
    const truncated = content.length > fetchContentMax;
    return { provider: provider.name, url: target.toString(), title: title ? clip(title, 300) : null, content: truncated ? content.slice(0, fetchContentMax) : content, truncated };
  }

  private async request(endpoint: Endpoint, capability: WebCapability, variables: Variables, key: string | null, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(endpoint.url);
    for (const [name, template] of Object.entries(endpoint.query ?? {})) url.searchParams.append(name, String(render(template, variables)));
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "Vela" };
    for (const [name, template] of Object.entries(endpoint.headers ?? {})) headers[name] = String(render(template, variables));
    if (key) {
      if (endpoint.auth.type === "bearer") headers.authorization = `Bearer ${key}`;
      else if (endpoint.auth.type === "header") headers[endpoint.auth.name!] = key;
      else if (endpoint.auth.type === "query") url.searchParams.set(endpoint.auth.name!, key);
    }
    let body: string | undefined;
    if (endpoint.method === "POST") {
      body = JSON.stringify(render(endpoint.body ?? {}, variables));
      if (!Object.keys(headers).some(name => name.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
    }
    const timeoutMs = endpoint.timeoutMs ?? defaultTimeoutMs[capability];
    const scrub = (value: string): string => {
      const redacted = String(redactSensitive(value, key ? [key] : []));
      return clip(redacted.replace(/\s+/g, " ").trim(), 200);
    };
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        let response: Response;
        try {
          response = await this.fetchImpl(url, { method: endpoint.method, headers, body, redirect: "manual", signal: controller.signal });
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error;
          if (timedOut) throw new WebToolsError("timeout", `Provider did not answer within ${Math.round(timeoutMs / 1000)} seconds`);
          throw new WebToolsError("network", `Could not reach the provider: ${scrub(error instanceof Error ? error.message : String(error))}`);
        }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => undefined);
          throw new WebToolsError("response", `Provider redirected the request (${response.status}); redirects are not followed`, response.status);
        }
        let raw: string;
        try {
          raw = await readBody(response);
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error;
          if (timedOut) throw new WebToolsError("timeout", `Provider did not answer within ${Math.round(timeoutMs / 1000)} seconds`);
          throw error instanceof WebToolsError ? error : new WebToolsError("network", "Reading the provider response failed");
        }
        if (response.status >= 200 && response.status < 300) {
          try { return JSON.parse(raw) as unknown; } catch { throw new WebToolsError("response", "Provider returned a response that is not JSON"); }
        }
        if (retryable(response.status) && attempt === 0) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, maxRetryDelayMs) : 800);
          continue;
        }
        let detail = "";
        try {
          const parsed = JSON.parse(raw) as unknown;
          const message = isRecord(parsed) ? (isRecord(parsed.error) ? parsed.error.message : parsed.message ?? parsed.error) : undefined;
          if (typeof message === "string") detail = scrub(message);
        } catch { /* 非 JSON 错误体不展示 */ }
        throw statusError(response.status, detail);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
  }
}
