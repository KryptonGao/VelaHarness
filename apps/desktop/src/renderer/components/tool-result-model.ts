import { boundToolJson, type JsonValue } from "@vela/shared";

export const resultPageSize = 20;

const structuredResultTools = new Set([
  "bash_output", "bash_kill",
  "create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task",
  "memory_read", "memory_update", "tool_search",
  "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource",
  "update_goal", "record_goal_validation",
]);

/** A known finished record must not silently look like a successfully parsed empty result. */
export function needsRawResultFallback(name: string | undefined, status: string, hasPresentation: boolean): boolean {
  return !hasPresentation && status !== "running" && name !== undefined && structuredResultTools.has(name);
}

/**
 * tool_search queries and results carry raw registered names (`+mcp__server__tool`).
 * Show `server · tool` instead; the query operators `+`/`-` are search syntax, not content.
 */
export function humanizeMcpNames(text: string): string {
  return text
    .replace(/[+-]?mcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_-]+)/g, "$1 · $2")
    .replace(/[+-]?mcp__([A-Za-z0-9_-]+)/g, "$1");
}

const mcpDiscoveryTools = new Set(["tool_search", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);

/** Searching or reading MCP resources is part of MCP, not a generic tool. */
export function isMcpDiscoveryTool(name: string): boolean { return mcpDiscoveryTools.has(name); }

/** Split a tool_search query into the MCP server it targets and the remaining search text. */
export function splitMcpQuery(query: string): { server?: string; text: string } {
  const match = /[+-]?mcp__([A-Za-z0-9_-]+?)(?:__([A-Za-z0-9_-]+))?(?=[\s,]|$)/.exec(query);
  if (!match) return { text: humanizeMcpNames(query).trim() };
  const rest = query.replace(match[0], match[2] ?? "").replace(/^select:/, "").replace(/\s+/g, " ").trim();
  return { server: match[1]!, text: humanizeMcpNames(rest) || match[1]! };
}

export function resultRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function scalarTableColumns(value: readonly JsonValue[]): string[] | null {
  if (value.length === 0 || !value.every(resultRecord)) return null;
  const keys = Object.keys(value[0]!);
  if (!keys.length || keys.length > 12) return null;
  return value.every(item => resultRecord(item) && Object.keys(item).length === keys.length && keys.every(key =>
    Object.hasOwn(item, key) && (item[key] === null || typeof item[key] !== "object"))) ? keys : null;
}

/** Only an entire valid response is promoted. Logs containing JSON fragments stay logs. */
export function completeResultJson(text: string): { value: JsonValue; truncated: boolean } | undefined {
  const source = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  if (!source || source.length > 80_000) return undefined;
  try { return boundToolJson(JSON.parse(source)); } catch { return undefined; }
}

export function resultText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function resultNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function resultHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch { return undefined; }
}

export function resultTimestamp(value: unknown, locale: string): string {
  const date = typeof value === "number" || typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString(locale) : "—";
}

export function processFailed(status: string | undefined, exitCode: number | null | undefined): boolean {
  return status === "timed_out" || status === "failed" || (status === "exited" && typeof exitCode === "number" && exitCode !== 0);
}
