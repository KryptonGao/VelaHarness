import type { AuthSource, ModelSummary, ProviderSummary } from "@vela/shared";

export type ProviderStatus = "connected" | "attention" | "disconnected";

/** 已连接 = 登录过或有可用密钥;只存了凭据却不可用(过期、失效)算需要处理。 */
export function providerStatus(provider: ProviderSummary): ProviderStatus {
  if (provider.authenticated) return "connected";
  if (provider.stored) return "attention";
  return "disconnected";
}

/**
 * 左侧列表只放用户已经接入的:已连接或需要处理的内置提供方、全部自定义供应商,
 * 以及这次在「添加供应商」里刚挑出来、还没来得及登录的。其余内置提供方只出现在添加页。
 */
export function listedProviders(providers: ProviderSummary[], picked: ReadonlySet<string>): ProviderSummary[] {
  return providers.filter((provider) => provider.custom || providerStatus(provider) !== "disconnected" || picked.has(provider.id));
}

export function unlistedBuiltins(providers: ProviderSummary[], picked: ReadonlySet<string>): ProviderSummary[] {
  const listed = new Set(listedProviders(providers, picked).map((provider) => provider.id));
  return providers.filter((provider) => !listed.has(provider.id) && !provider.custom);
}

/** 内置提供方在前,自定义在后;组内保持目录给出的顺序。 */
export function groupListed(listed: ProviderSummary[]): { builtin: ProviderSummary[]; custom: ProviderSummary[] } {
  return { builtin: listed.filter((provider) => !provider.custom), custom: listed.filter((provider) => provider.custom) };
}

/** 262144 → "262.1K",1000000 → "1M";没有上下文长度返回空串。 */
export function formatContext(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "";
  if (tokens >= 1_000_000) return `${trimZero(tokens / 1_000_000)}M`;
  return `${trimZero(tokens / 1000)}K`;
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export type AuthSourceKind = "stored" | "environment" | "config" | "runtime";

export function authSourceKind(source: AuthSource | null): AuthSourceKind | null {
  switch (source) {
    case "stored": return "stored";
    case "environment": return "environment";
    case "models_json_key":
    case "models_json_command": return "config";
    case "runtime":
    case "fallback": return "runtime";
    default: return null;
  }
}

/** 供应商没有品牌图标时用名称首字母做头像,颜色由名称决定,同一个供应商始终同色。 */
export function providerMonogram(name: string): { letter: string; hue: number } {
  const trimmed = name.trim();
  const letter = (trimmed.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  let hash = 0;
  for (const char of trimmed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return { letter, hue: hash % 360 };
}

/** 供应商下可以在输入框里选的模型。没登录时一个都不可用,列表为空。 */
export function providerModels(models: ModelSummary[], providerId: string): ModelSummary[] {
  return models.filter((model) => model.provider === providerId && model.available);
}

/** 列表选中项:当前选择还在列表里就保留,否则落到第一项。 */
export function resolveSelection(listed: ProviderSummary[], selected: string | null): string | null {
  if (selected && listed.some((provider) => provider.id === selected)) return selected;
  return listed[0]?.id ?? null;
}
