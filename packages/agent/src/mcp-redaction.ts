import { redactSensitive } from "@vela/shared";

/** Scrub credential-bearing parameters and diagnostics before IPC, approvals and Trace display. */
export const redactMcpDisplay = redactSensitive;

interface ModelRecords { requests?: { model: string }[]; summaries?: { model: string }[] }

/**
 * 追踪里的模型标识（provider/model）不是密钥，必须原样保留：MCP 密钥恰好是它的子串时
 * 脱敏会把标识改写，用量统计就按改写后的名字分组，登记的模型价格也匹配不上。
 */
export function preserveTraceModels<T extends ModelRecords>(redacted: T, original: T): T {
  const keep = <R extends { model: string }>(masked: R[] | undefined, source: R[] | undefined) =>
    masked && source?.length === masked.length ? masked.map((item, index) => ({ ...item, model: source[index]!.model })) : masked;
  const requests = keep(redacted.requests, original.requests);
  const summaries = keep(redacted.summaries, original.summaries);
  return { ...redacted, ...(requests ? { requests } : {}), ...(summaries ? { summaries } : {}) };
}
const sensitive = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|credential)/i;
export function mcpConfiguredSecrets(configs: readonly unknown[]): string[] {
  const values = new Set<string>();
  const visit = (value: unknown, secret = false): void => {
    if (typeof value === "string" && secret && !value.startsWith("!")) {
      const resolved = value.replace(/\$\$|\$!|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced: string, plain: string) => match === "$$" ? "$" : match === "$!" ? "!" : process.env[braced ?? plain] ?? "");
      if (resolved) values.add(resolved);
      if (/^Bearer /i.test(resolved)) values.add(resolved.slice(7));
    } else if (Array.isArray(value)) value.forEach(item => visit(item, secret));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) visit(item, secret || key === "env" || key === "headers" || sensitive.test(key));
  };
  configs.forEach(value => visit(value));
  return [...values];
}
