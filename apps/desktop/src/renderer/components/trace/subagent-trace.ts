import type { AgentInfo, ToolTrace, TraceAgentRequest, TraceDetails, TraceNode, TraceRequest, TraceStatus, TranscriptMessage } from "@vela/shared";
import type { UiMessage } from "../../hooks/useSession";
import { emptyTrace, type TraceState } from "./trace-model";

type Message = Omit<UiMessage, "timestamp" | "tools"> & {
  timestamp?: number | null;
  tools: (ToolTrace & { resultRecorded?: boolean })[];
};
export const isTraceChild = (id: string | null, agent: AgentInfo | null): agent is AgentInfo =>
  Boolean(id && agent && agent.id && agent.id !== id && agent.kind !== "root" && agent.path !== "/root");
const time = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n : null;
const indexKey = (m: Message) => m.sourceTimestamp === undefined ? null : `${m.role}:${m.sourceTimestamp}`;

/** Chat's hydrated bucket includes fork context. Only consume live deltas from it;
 * strict IPC history owns the persisted portion. SDK timestamps (and call IDs for
 * a partial stream) reconcile overlapping reads without guessing by text/order. */
export function ownedTraceMessages(history: readonly TranscriptMessage[], stream: readonly UiMessage[]): Message[] {
  const result: Message[] = history.map(m => ({ ...m, historical: true }));
  const bySource = new Map<string, number>();
  const byTool = new Map<string, number>();
  result.forEach((m, i) => {
    const key = indexKey(m);
    if (key !== null) bySource.set(key, bySource.has(key) ? -1 : i);
    for (const t of m.tools) byTool.set(t.id, byTool.has(t.id) ? -1 : i);
  });
  for (const live of stream) {
    if (live.historical) continue;
    const key = indexKey(live);
    const i = (key !== null ? bySource.get(key) : undefined) ?? (live.tools[0] && byTool.get(live.tools[0].id));
    const saved = i === undefined ? undefined : history[i];
    if (!saved || i === undefined) { result.push(live); continue; }
    // A persisted assistant message can precede its tool results. Keep saved
    // full text (live may start mid-reply), but let later tool events finish it.
    const tools = saved.tools.map(tool => {
      const update = tool.resultRecorded === false && live.tools.find(t => t.id === tool.id);
      return update ? { ...update, resultRecorded: update.status !== "running" } : tool;
    });
    result[i] = { ...saved, id: live.id, historical: true, tools };
  }
  return result;
}

const noDetails = (_id: string): TraceDetails | null => null;
export const noSubagentTrace = { trace: emptyTrace, getDetails: noDetails };

export function projectSubagentTrace(conversationId: string | null, agent: AgentInfo | null, messages: readonly Message[],
  records: readonly TraceAgentRequest[], includeSummary = true): { trace: TraceState; getDetails(id: string): TraceDetails | null } {
  if (!isTraceChild(conversationId, agent)) return noSubagentTrace;
  const prefix = (...keys: (string | number)[]) => JSON.stringify([conversationId, agent.id, ...keys]);
  const nodes: TraceNode[] = [], details = new Map<string, TraceDetails>();
  const requests: TraceRequest[] = [];
  const bySource = new Map<string, TraceRequest | null>();
  const matched = new Set<TraceRequest>();
  for (const record of records) {
    if (!agent.path.startsWith("/root/") || record.agentPath !== agent.path) continue;
    if (record.agentId !== undefined && record.agentId !== agent.id) continue;
    // Before stable owner IDs, a rewind could leave an older usage record at
    // the same path. A request predating the selected child cannot belong to it.
    if (!record.agentId && agent.createdAt > 0 && (record.startedAt ?? record.completedAt ?? -Infinity) < agent.createdAt) continue;
    const request: TraceRequest = { id: prefix("request", record.id), number: requests.length + 1, turn: 0, contextId: "",
      model: record.model, usage: record.usage, status: record.status, startedAt: record.startedAt, completedAt: record.completedAt,
      durationMs: record.durationMs, generationMs: null, firstTokenMs: null };
    requests.push(request);
    if (request.startedAt !== null) {
      const key = JSON.stringify([request.startedAt, request.model]);
      bySource.set(key, bySource.has(key) ? null : request);
    }
  }
  let turn = 0, step = 0;
  function add(id: string, kind: TraceNode["kind"], content: string, fields: Partial<TraceNode>, data: Partial<TraceDetails> = {}) {
    const node: TraceNode = { id, kind, sequence: nodes.length + 1, turn, step, status: "Completed", requestId: null,
      toolCallId: null, toolName: null, startedAt: null, executionStartedAt: null, completedAt: null, durationMs: null,
      historical: true, version: 0, summary: content.slice(0, 240), ...fields };
    nodes.push(node);
    details.set(id, { node, content, raw: null, arguments: null, result: null, source: null, context: null, request: null, responseBlocks: [], ...data });
  }
  for (const [index, m] of messages.entries()) {
    if (m.role === "user") { turn++; step = 0; } else step++;
    const id = (...parts: string[]) => prefix("message", m.id, ...parts);
    const historical = m.historical === true;
    const base = { historical };
    if (m.role === "user") {
      if (m.text || m.images?.length) add(id("user"), "user", m.text, { ...base, startedAt: time(m.sourceTimestamp) ?? time(m.timestamp) },
        { raw: { content: m.images?.length ? [{ type: "text", text: m.text }, ...m.images] : m.text }, source: m.inputSender ?? null });
      continue;
    }
    const request = bySource.get(JSON.stringify([m.sourceTimestamp, `${m.provider}/${m.model}`])) ?? null;
    if (request) { request.turn = turn; matched.add(request); }
    const running = !historical && !m.assistantEnded && index === messages.length - 1 && (agent.status === "running" || agent.status === "paused");
    const status: TraceStatus = m.turnStopped ? "Interrupted" : request?.status ?? (running ? "Running" : "Completed");
    const fields = { ...base, requestId: request?.id ?? null, status };
    // The timeline knows to draw request wait from its actual start for the
    // first model block; no synthetic per-block token timing is stored.
    if (m.thinking) add(`${id("thinking")}-block-0`, "thinking", m.thinking, fields, { request, raw: m.thinking });
    if (m.text) add(id("text") + (m.thinking ? "" : "-block-0"), "assistant", m.text, { ...fields, completedAt: time(m.timestamp) }, { request, raw: m.text });
    for (const tool of m.tools) {
      const a = tool.activity;
      const args = a.command !== undefined ? { command: a.command } : a.path !== undefined ? { path: a.path } : null;
      const hasResult = "resultRecorded" in tool ? tool.resultRecorded === true : !historical && tool.status !== "running";
      const toolStatus = tool.status === "error" ? "Failed" : tool.status === "running" ? "Running" : "Completed";
      const toolFields = { ...base, toolCallId: tool.id, toolName: tool.name, mcp: a.mcp, requestId: request?.id ?? null };
      // A transcript is a renderer-safe summary, not the SDK's raw arguments,
      // context or complete result. Don't invent payloads or tool timings.
      const result = hasResult ? a.body ?? a.diff ?? null : null;
      const data = { request, arguments: args, raw: a, result };
      add(id(tool.id, "call"), "tool-call", args ? JSON.stringify(args) : a.agentPrompt ?? tool.name,
        { ...toolFields, status: toolStatus }, data);
      if (hasResult) add(id(tool.id, "result"), "tool-result", result ?? tool.name, { ...toolFields, status: toolStatus }, data);
    }
  }
  // Old records may contain only the child's roster summary. Never turn a step
  // summary into a tool result or copy the root's system prompt/model/timings.
  if (!messages.length && includeSummary) {
    if (agent.task) { turn = 1; add(prefix("task"), "user", agent.task, {}); }
    for (const item of agent.steps) add(prefix("step", item.id), "tool-call", item.summary,
      { step: ++step, toolName: item.name, toolCallId: item.id, status: item.status === "running" ? "Running" : item.status === "error" ? "Failed" : "Completed" }, { raw: item });
    if (agent.finalText) add(prefix("conclusion"), "assistant", agent.finalText, { step: ++step });
  }
  if (agent.error && !messages.some(m => m.role === "assistant" && m.text.includes(agent.error!))) {
    add(prefix("error"), "error", agent.error, { status: "Failed" });
  }
  for (const r of requests) {
    // Usage-only records have no trustworthy response/turn association. Keep a
    // separate recorded event rather than attaching them to the nth assistant.
    if (!matched.has(r)) add(prefix("record", r.id), "state", r.model, { turn: 0, step: r.number, requestId: r.id,
      status: r.status, startedAt: r.startedAt, completedAt: r.completedAt, durationMs: r.durationMs }, { request: r, raw: r });
  }
  return { trace: { ...emptyTrace, nodes, requests }, getDetails: id => details.get(id) ?? null };
}
