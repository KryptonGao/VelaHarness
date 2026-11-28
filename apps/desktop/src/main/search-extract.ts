/**
 * Turns one line of a session file into the rows the search index stores.
 * Pure, so the indexer can run it in a worker and tests can feed it plain strings.
 */

export const searchKinds = { user: 0, assistant: 1, tool: 2 } as const;
export type SearchKindCode = (typeof searchKinds)[keyof typeof searchKinds];

export interface SearchRow {
  /** Session entry that holds the text. */
  entryId: string;
  /** For tool calls and tool output, the call they belong to. */
  toolCallId: string | null;
  kind: SearchKindCode;
  /** ms since epoch; NaN when the entry has no usable timestamp. */
  timestamp: number;
  text: string;
}

/** Tool output is clipped to its start and end: errors and exit lines sit at the edges. */
const outputHead = 6000;
const outputTail = 2000;
const readHead = 2000;
const callLimit = 2000;
const messageLimit = 60_000;

/** MCP calls and results are redacted for display; their raw text never goes into the index. */
const resourceTools = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource", "tool_search"]);
export function isUnindexedTool(name: unknown): boolean {
  return typeof name === "string" && (name.startsWith("mcp__") || resourceTools.has(name));
}

const messageLine = /^\{\s*"type"\s*:\s*"message"/;

export function extractRows(line: string): SearchRow[] {
  if (!messageLine.test(line)) return [];
  let entry: unknown;
  try { entry = JSON.parse(line); } catch { return []; }
  if (!isRecord(entry) || typeof entry.id !== "string" || !isRecord(entry.message)) return [];
  const message = entry.message;
  const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
  const rows: SearchRow[] = [];
  const add = (kind: SearchKindCode, toolCallId: string | null, text: string, limit: { head: number; tail: number }) => {
    const clean = sanitize(clip(text, limit.head, limit.tail));
    if (clean.trim()) rows.push({ entryId: entry.id as string, toolCallId, kind, timestamp, text: clean });
  };

  if (message.role === "user") {
    add(searchKinds.user, null, textOf(message.content), { head: messageLimit, tail: 0 });
  } else if (message.role === "assistant") {
    const parts = Array.isArray(message.content) ? message.content : [];
    add(searchKinds.assistant, null, textOf(parts), { head: messageLimit, tail: 0 });
    for (const part of parts) {
      if (!isRecord(part) || part.type !== "toolCall" || typeof part.id !== "string" || isUnindexedTool(part.name)) continue;
      add(searchKinds.tool, part.id, callText(part.name, part.arguments), { head: callLimit, tail: 0 });
    }
  } else if (message.role === "toolResult") {
    if (typeof message.toolCallId !== "string" || isUnindexedTool(message.toolName)) return rows;
    // A read returns a file the user can open; keep only its start instead of filling the index with source code.
    const limit = message.toolName === "read" ? { head: readHead, tail: 0 } : { head: outputHead, tail: outputTail };
    add(searchKinds.tool, message.toolCallId, textOf(message.content), limit);
  }
  return rows;
}

function callText(name: unknown, args: unknown): string {
  const label = typeof name === "string" ? name : "";
  if (isRecord(args) && typeof args.command === "string") return `${label} ${args.command}`;
  let body = "";
  try { body = JSON.stringify(args) ?? ""; } catch { /* unserializable arguments are not searchable */ }
  return `${label} ${body}`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") texts.push(part.text);
  }
  return texts.join("\n");
}

function clip(text: string, head: number, tail: number): string {
  if (text.length <= head + tail) return text;
  return tail > 0 ? `${text.slice(0, head)}\n…\n${text.slice(-tail)}` : text.slice(0, head);
}

/** Control characters delimit highlights in snippets and NUL ends C strings; lone surrogates are not valid UTF-8. */
function sanitize(text: string): string {
  return text.replace(/[\u0000-\u0002]/g, " ").replace(loneSurrogate, "\uFFFD");
}

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
