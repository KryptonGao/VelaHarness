import { boundToolJson, type JsonValue } from "@vela/shared";

export interface McpSearchResult {
  title: string;
  url?: string;
  id?: string;
  type?: string;
  highlight?: string;
  timestamp?: string;
}

export type McpResultView = (
  | { kind: "search"; results: McpSearchResult[] }
  | { kind: "json"; value: JsonValue }
  | { kind: "text"; text: string }
) & { truncated?: boolean };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Only promote a complete, recognizable search response; keep everything else readable. */
export function presentMcpResult(body: string, structured?: unknown): McpResultView {
  const source = body.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  let parsed: unknown = structured;
  if (parsed === undefined) {
    if (source.length > 80_000) return { kind: "text", text: body, truncated: true };
    try { parsed = JSON.parse(source); } catch { return { kind: "text", text: body }; }
  }
  const bounded = boundToolJson(parsed);
  if (!bounded) return { kind: "text", text: body };
  // Plain JSON output keeps the established model contract; bounding removes unsafe keys first.
  const value = JSON.parse(JSON.stringify(bounded.value)) as JsonValue;
  const truncation = bounded.truncated ? { truncated: true } : {};
  const results = record(value) ? value.results : Array.isArray(value) ? value : undefined;
  if (Array.isArray(results) && results.every(item => record(item) && typeof item.title === "string" && item.title.trim())) {
    return { kind: "search", ...truncation, results: results.map(item => {
      // every() above checks the complete list; repeat the record guard for type narrowing.
      if (!record(item)) return { title: "" };
      return {
        title: item.title as string,
        ...Object.fromEntries(["url", "id", "type", "highlight", "timestamp"]
          .filter(key => typeof item[key] === "string").map(key => [key, item[key]])),
      };
    }) };
  }
  return { kind: "json", value, ...truncation };
}

export function formatMcpResponse(body: string): string {
  const source = body.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  try { return JSON.stringify(JSON.parse(source), null, 2); } catch { return body; }
}

export function mcpResultUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch { return null; }
}
