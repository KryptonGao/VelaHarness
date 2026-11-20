import type { ToolTrace } from "@vela/shared";
import type { UiMessage } from "../hooks/useSession";

export type ChatSearch = ToolTrace & { searches?: ToolTrace[] };
const cache = new WeakMap<UiMessage[], UiMessage[]>();

/** A presentation-only projection. The trace, timing and transcript keep individual calls. */
export function webChatMessages(messages: UiMessage[]): UiMessage[] {
  const cached = cache.get(messages);
  if (cached) return cached;
  const replacements = new Map<ToolTrace, ChatSearch | null>();
  let run: ToolTrace[] = [];
  const flush = () => {
    if (run.length > 1) {
      const first = run[0]!;
      replacements.set(first, { ...first, searches: run, status: run.some(t => t.status === "running") ? "running" : "done" });
      for (const tool of run.slice(1)) replacements.set(tool, null);
    }
    run = [];
  };
  for (const message of messages) {
    if (message.role !== "assistant") { flush(); continue; }
    if (message.thinking.trim()) flush();
    for (const tool of message.tools) {
      if (!tool.activity?.mcp && tool.name === "web_fetch") replacements.set(tool, null);
      else if (!tool.activity?.mcp && tool.name === "web_search") {
        if (tool.status === "error") replacements.set(tool, null);
        else run.push(tool);
      }
      else flush();
    }
    if (message.text.trim() || message.planIds?.length) flush();
  }
  flush();
  const result = replacements.size ? messages.flatMap(message => {
    if (!message.tools.some(tool => replacements.has(tool))) return [message];
    const tools = message.tools.flatMap(tool => replacements.has(tool) ? replacements.get(tool) ?? [] : tool);
    if (!tools.length && !message.text && !message.thinking && !message.planIds?.length && !message.images?.length) return [];
    return [{ ...message, tools }];
  }) : messages;
  cache.set(messages, result);
  return result;
}
