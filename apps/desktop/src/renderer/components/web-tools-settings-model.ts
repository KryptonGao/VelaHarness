/**
 * 设置页「网页工具」的表单模型：把可编辑的草稿转成 WebProvider，反之亦然。
 * 只做界面能即时发现的问题；完整校验仍以主进程为准。
 */
import {
  webProviderIdPattern,
  webToolsLimits,
  type WebAuthType,
  type WebFetchEndpoint,
  type WebProvider,
  type WebSearchEndpoint,
} from "@vela/shared";

export type WebMethod = "GET" | "POST";

export interface EndpointDraftBase {
  enabled: boolean;
  url: string;
  method: WebMethod;
  authType: WebAuthType;
  authName: string;
  /** JSON 文本：请求体模板。 */
  body: string;
  /** JSON 文本：额外请求头。 */
  headers: string;
  /** JSON 文本：查询参数模板。 */
  query: string;
}

export interface SearchDraft extends EndpointDraftBase {
  resultsPath: string;
  title: string;
  link: string;
  snippet: string;
  summary: string;
  content: string;
  date: string;
  source: string;
}

export interface FetchDraft extends EndpointDraftBase {
  titlePath: string;
  contentPath: string;
}

export interface ProviderDraft {
  /** 已存在的提供商 ID；新建为 null，保存时由名称生成。 */
  id: string | null;
  name: string;
  search: SearchDraft;
  fetch: FetchDraft;
}

export type DraftErrorKey =
  | "name"
  | "nothing"
  | "url"
  | "json"
  | "authName"
  | "searchFields"
  | "fetchFields"
  | "id";

export type DraftResult = { ok: true; provider: WebProvider } | { ok: false; error: DraftErrorKey; detail?: string };

const base = (enabled: boolean, body: string): EndpointDraftBase => ({
  enabled, url: "", method: "POST", authType: "bearer", authName: "", body, headers: "", query: "",
});

export function emptyDraft(): ProviderDraft {
  return {
    id: null,
    name: "",
    search: {
      ...base(true, '{\n  "query": "{{query}}",\n  "count": "{{count}}"\n}'),
      resultsPath: "results", title: "title", link: "url", snippet: "snippet", summary: "", content: "", date: "", source: "",
    },
    fetch: { ...base(false, '{\n  "url": "{{url}}"\n}'), titlePath: "title", contentPath: "content" },
  };
}

const pretty = (value: unknown): string => (value === undefined ? "" : JSON.stringify(value, null, 2));

function baseFrom(endpoint: WebSearchEndpoint | WebFetchEndpoint | undefined, fallbackBody: string): EndpointDraftBase {
  if (!endpoint) return base(false, fallbackBody);
  return {
    enabled: true, url: endpoint.url, method: endpoint.method, authType: endpoint.auth.type, authName: endpoint.auth.name ?? "",
    body: endpoint.body === undefined ? "" : pretty(endpoint.body), headers: endpoint.headers ? pretty(endpoint.headers) : "",
    query: endpoint.query ? pretty(endpoint.query) : "",
  };
}

export function draftFromProvider(provider: WebProvider): ProviderDraft {
  const empty = emptyDraft();
  const search = provider.search;
  const fetchEndpoint = provider.fetch;
  return {
    id: provider.id,
    name: provider.name,
    search: {
      ...baseFrom(search, empty.search.body),
      resultsPath: search?.resultsPath ?? empty.search.resultsPath,
      title: search?.fields.title ?? empty.search.title,
      link: search?.fields.url ?? empty.search.link,
      snippet: search?.fields.snippet ?? "", summary: search?.fields.summary ?? "", content: search?.fields.content ?? "",
      date: search?.fields.date ?? "", source: search?.fields.source ?? "",
    },
    fetch: {
      ...baseFrom(fetchEndpoint, empty.fetch.body),
      titlePath: fetchEndpoint?.titlePath ?? "", contentPath: fetchEndpoint?.contentPath ?? empty.fetch.contentPath,
    },
  };
}

/** 从名称生成 ID：小写字母、数字和连字符。 */
export function providerIdFromName(name: string, taken: ReadonlySet<string>): string | null {
  const slug = name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  const root = slug || "provider";
  for (let index = 1; index < 100; index += 1) {
    const candidate = index === 1 ? root : `${root}-${index}`;
    if (!taken.has(candidate) && webProviderIdPattern.test(candidate)) return candidate;
  }
  return null;
}

type JsonResult = { ok: true; value: unknown } | { ok: false };

function parseJson(text: string): JsonResult {
  if (!text.trim()) return { ok: true, value: undefined };
  try { return { ok: true, value: JSON.parse(text) as unknown }; } catch { return { ok: false }; }
}

const optional = (value: string): string | undefined => value.trim() || undefined;

function endpointBase(draft: EndpointDraftBase): { ok: true; value: Record<string, unknown> } | { ok: false; error: DraftErrorKey } {
  if (!draft.url.trim()) return { ok: false, error: "url" };
  if ((draft.authType === "header" || draft.authType === "query") && !draft.authName.trim()) return { ok: false, error: "authName" };
  const body = parseJson(draft.body);
  const headers = parseJson(draft.headers);
  const query = parseJson(draft.query);
  if (!body.ok || !headers.ok || !query.ok) return { ok: false, error: "json" };
  return {
    ok: true,
    value: {
      url: draft.url.trim(), method: draft.method,
      auth: { type: draft.authType, ...(draft.authType === "header" || draft.authType === "query" ? { name: draft.authName.trim() } : {}) },
      ...(headers.value !== undefined ? { headers: headers.value } : {}),
      ...(query.value !== undefined ? { query: query.value } : {}),
      ...(body.value !== undefined && draft.method === "POST" ? { body: body.value } : {}),
    },
  };
}

export function providerFromDraft(draft: ProviderDraft, takenIds: ReadonlySet<string>): DraftResult {
  const name = draft.name.trim();
  if (!name || name.length > webToolsLimits.nameMax) return { ok: false, error: "name" };
  if (!draft.search.enabled && !draft.fetch.enabled) return { ok: false, error: "nothing" };
  const id = draft.id ?? providerIdFromName(name, takenIds);
  if (!id) return { ok: false, error: "id" };
  const provider: Record<string, unknown> = { id, name };
  if (draft.search.enabled) {
    const common = endpointBase(draft.search);
    if (!common.ok) return { ok: false, error: common.error };
    if (!draft.search.title.trim() || !draft.search.link.trim()) return { ok: false, error: "searchFields" };
    provider.search = {
      ...common.value, resultsPath: draft.search.resultsPath.trim(),
      fields: {
        title: draft.search.title.trim(), url: draft.search.link.trim(),
        ...(optional(draft.search.snippet) ? { snippet: optional(draft.search.snippet) } : {}),
        ...(optional(draft.search.summary) ? { summary: optional(draft.search.summary) } : {}),
        ...(optional(draft.search.content) ? { content: optional(draft.search.content) } : {}),
        ...(optional(draft.search.date) ? { date: optional(draft.search.date) } : {}),
        ...(optional(draft.search.source) ? { source: optional(draft.search.source) } : {}),
      },
    };
  }
  if (draft.fetch.enabled) {
    const common = endpointBase(draft.fetch);
    if (!common.ok) return { ok: false, error: common.error };
    if (!draft.fetch.contentPath.trim()) return { ok: false, error: "fetchFields" };
    provider.fetch = {
      ...common.value, contentPath: draft.fetch.contentPath.trim(),
      ...(optional(draft.fetch.titlePath) ? { titlePath: optional(draft.fetch.titlePath) } : {}),
    };
  }
  return { ok: true, provider: provider as unknown as WebProvider };
}
