/**
 * Full-text search across every chat's messages and tool output.
 *
 * Results are pushed to the renderer in small batches while the index is still being
 * scanned, newest message first, so the list starts filling before the search finishes.
 */

export const ConversationSearchIpc = {
  /** Refresh the chat list the index follows and make sure the index is up to date. */
  sync: "conversation-search:sync",
  start: "conversation-search:start",
  cancel: "conversation-search:cancel",
  event: "conversation-search:event",
} as const;

/** What a hit was found in: the user's message, an assistant reply, or a tool call or its output. */
export type ConversationSearchKind = "user" | "assistant" | "tool";

export interface ConversationSearchFilters {
  /** `undefined`: every project. `""`: chats that have no project. Otherwise the project path. */
  workspace?: string;
  /** Inclusive lower bound, ms since epoch. */
  from?: number;
  /** Exclusive upper bound, ms since epoch. */
  to?: number;
  includeArchived: boolean;
  includeTools: boolean;
}

export interface ConversationSearchRequest {
  query: string;
  filters: ConversationSearchFilters;
  /** Continue after the last hit of an earlier page (its `cursor`). */
  after?: number;
}

export interface ConversationSearchHit {
  /** Position in the newest-first order; pass the last one as `after` to read further. */
  cursor: number;
  conversationId: string;
  title: string;
  /** Project path, or "" for a chat without one. */
  workspace: string;
  archived: boolean;
  /** Session entry that holds the text. */
  entryId: string;
  /** Set for tool calls and tool output: the call the text belongs to. */
  toolCallId: string | null;
  kind: ConversationSearchKind;
  timestamp: number;
  /** One line of text around the match; matches are wrapped in {@link snippetOpen} and {@link snippetClose}. */
  snippet: string;
}

export type ConversationSearchEvent =
  | { type: "hits"; requestId: string; hits: ConversationSearchHit[] }
  | { type: "done"; requestId: string; /** Cursor for the next page, `null` when nothing older matches. */ next: number | null }
  | { type: "error"; requestId: string; message: string }
  | { type: "index"; indexing: boolean; indexed: number; total: number };

export interface ConversationSearchApi {
  /** Resolves once the chat list is handed to the index; the index may still be catching up. */
  sync(): Promise<ConversationSearchIndexStatus>;
  start(requestId: string, request: ConversationSearchRequest): Promise<void>;
  cancel(requestId: string): Promise<void>;
  subscribe(listener: (event: ConversationSearchEvent) => void): () => void;
}

export interface ConversationSearchIndexStatus {
  indexing: boolean;
  indexed: number;
  total: number;
}

/** Control characters around a match in a snippet. Indexed text never contains them. */
export const snippetOpen = "\u0001";
export const snippetClose = "\u0002";

const maxKeywords = 8;
const maxKeywordLength = 200;

/**
 * Keywords of a search box entry. Words are separated by spaces and must all appear;
 * text in double quotes is one keyword, so an exact command can be searched as typed.
 */
export function parseSearchQuery(query: string): string[] {
  const keywords: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    const word = (match[1] ?? match[2] ?? "").trim().replace(/"/g, "");
    if (!word) continue;
    const keyword = word.slice(0, maxKeywordLength);
    if (!keywords.includes(keyword)) keywords.push(keyword);
    if (keywords.length === maxKeywords) break;
  }
  return keywords;
}

export interface SnippetSegment {
  text: string;
  match: boolean;
}

/** Split a snippet at its match markers so the renderer can highlight without parsing HTML. */
export function snippetSegments(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let match = false;
  for (const text of snippet.split(/[\u0001\u0002]/)) {
    if (text) segments.push({ text, match });
    match = !match;
  }
  return segments;
}
