import assert from "node:assert/strict";
import { it } from "node:test";
import { emptyAgentUsage, type AgentInfo, type TraceAgentRequest, type TranscriptMessage } from "@vela/shared";
import { ownedTraceMessages, projectSubagentTrace } from "../src/renderer/components/trace/subagent-trace.ts";
import { applyAgentStreamEvent, sanitizeAgentEvent, type UiMessage } from "../src/renderer/hooks/useSession.ts";

const child: AgentInfo = { id: "child", parentId: "chat", path: "/root/scan", name: "scan", kind: "explore", status: "completed", depth: 1,
  task: "", steps: [], mutated: false, finalText: null, error: null, usage: { ...emptyAgentUsage }, activeMs: 0, runningSince: null,
  pauseRequested: false, createdAt: 10, updatedAt: 100 };
const record: TraceAgentRequest = { id: "r1", agentPath: child.path, model: "p/m", status: "Completed", startedAt: 50, completedAt: 60,
  durationMs: null, usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 6 } };
const msg: TranscriptMessage = { id: "entry-1", role: "assistant", text: "owned reply", thinking: "owned thought", tools: [], sourceTimestamp: 50,
  timestamp: 61, model: "m", provider: "p" };

it("projects only exact owner requests, never root, siblings, descendants or a previous occupant of the same path", () => {
  const records = [record, { ...record, id: "sibling", agentPath: "/root/scan-2" }, { ...record, id: "nested", agentPath: "/root/scan/nested" },
    { ...record, id: "root", agentPath: "/root" }, { ...record, id: "conflict", agentId: "someone-else" }, { ...record, id: "rewound", startedAt: 1 }];
  const projected = projectSubagentTrace("chat", child, ownedTraceMessages([msg], []), records);
  assert.equal(projected.trace.requests.length, 1);
  assert.deepEqual(projected.trace.nodes.map(n => n.kind), ["thinking", "assistant"]);
  const [r] = projected.trace.requests;
  for (const n of projected.trace.nodes) {
    const d = projected.getDetails(n.id)!;
    assert.equal(d.request, r); assert.equal(d.context, null); assert.equal(n.durationMs, null);
  }
  assert.equal(r!.generationMs, null); assert.equal(r!.usage?.totalTokens, 6);
  assert.equal(projected.trace.agentRequests.length, 0, "request has already been promoted, not counted twice");
  assert.equal(projected.getDetails("main-1"), null);
  const other = projectSubagentTrace("different-chat", child, ownedTraceMessages([msg], []), []);
  assert.equal(other.getDetails(projected.trace.nodes[0]!.id), null);
  for (const invalid of [null, { ...child, kind: "root" as const }, { ...child, id: "chat" }, { ...child, path: "/root" }]) {
    assert.deepEqual(projectSubagentTrace("chat", invalid, ownedTraceMessages([msg], []), records).trace.nodes, []);
  }
});

it("does not match by response ordinal, non-unique request timestamps, model or roster totals", () => {
  const project = (records: TraceAgentRequest[]) => projectSubagentTrace("chat", child, ownedTraceMessages([msg], []), records).trace;
  for (const records of [[{ ...record, startedAt: 51 }], [{ ...record, model: "different-model" }], [record, { ...record, id: "same-time" }]]) {
    const trace = project(records);
    assert.equal(trace.nodes.find(n => n.kind === "assistant")!.requestId, null);
    assert.equal(trace.nodes.filter(n => n.kind === "state").length, records.length);
  }
  assert.equal(projectSubagentTrace("chat", child, [], [record]).trace.nodes[0]?.startedAt, 50, "usage-only record is visible");
});

it("excludes forked hydrated chat history, reconciles live/disk overlap, and distinguishes a call from a recorded result", () => {
  const call = { id: "call-1", name: "read", status: "done" as const, activity: { path: "a.ts" } };
  const saved = { ...msg, tools: [{ ...call, resultRecorded: false }] };
  const forked: UiMessage = { id: "forked", role: "assistant", historical: true, text: "parent-only content", thinking: "", tools: [] };
  const live: UiMessage = { id: "live", role: "assistant", text: "reply", sourceTimestamp: 50, thinking: "", tools: [{ ...call, activity: { path: "a.ts", body: "child output" } }] };
  const project = (stream: UiMessage[]) => projectSubagentTrace("chat", child, ownedTraceMessages([saved], stream), [record]);
  const initial = project([forked]);
  assert.deepEqual(initial.trace.nodes.map(n => n.kind), ["thinking", "assistant", "tool-call"]);
  assert.equal(initial.getDetails(initial.trace.nodes.at(-1)!.id)?.result, null);
  const merged = project([forked, live]);
  assert.deepEqual(merged.trace.nodes.map(n => n.kind), ["thinking", "assistant", "tool-call", "tool-result"]);
  assert.equal(merged.trace.nodes[1]!.summary, "owned reply");
  const result = merged.getDetails(merged.trace.nodes.at(-1)!.id)!;
  assert.equal(result.content, "child output"); assert.deepEqual(result.arguments, { path: "a.ts" });
  assert.ok(!JSON.stringify(merged.trace).includes("parent-only"));
});

it("handles live model boundaries and sender attribution without inventing latency or using the active root model", () => {
  const events = [{ type: "user_message", text: "task", inputSender: "/root", sourceTimestamp: 41 },
    { type: "assistant_start", model: "m", provider: "p", sourceTimestamp: 50 }, { type: "text_delta", delta: "answer" }];
  const stream = events.reduce((bucket, e) => applyAgentStreamEvent(bucket, "chat", "child", sanitizeAgentEvent(e)!), {} as Parameters<typeof applyAgentStreamEvent>[0]);
  const project = (stream: UiMessage[]) => projectSubagentTrace("chat", { ...child, status: "running" }, ownedTraceMessages([], stream), []);
  const live = project(stream.chat!.child!);
  assert.equal(live.trace.nodes[1]!.status, "Running");
  assert.equal(live.trace.requests.length, 0);
  const input = live.trace.nodes[0]!;
  assert.equal(input.startedAt, 41); assert.equal(live.getDetails(input.id)?.source, "/root");
  const ended = applyAgentStreamEvent(stream, "chat", "child", { type: "assistant_end", sourceTimestamp: 50 });
  assert.equal(project(ended.chat!.child!).trace.nodes[1]!.status, "Completed");
});

it("retains only known legacy task, step, conclusion and error (no schema, fake request, tool output or duration)", () => {
  const projection = projectSubagentTrace("chat", { ...child, historyIncomplete: true, task: "inspect", finalText: "done", error: "warning",
    steps: [{ id: "s", name: "read", summary: "a.ts", status: "done" }], usage: { ...emptyAgentUsage, total: 900 } }, [], []);
  assert.deepEqual(projection.trace.nodes.map(n => n.kind), ["user", "tool-call", "assistant", "error"]);
  assert.equal(projection.trace.requests.length, 0);
  for (const n of projection.trace.nodes) {
    assert.equal(n.startedAt, null); assert.equal(n.durationMs, null);
    const details = projection.getDetails(n.id)!;
    assert.equal(details.arguments, null); assert.equal(details.result, null); assert.equal(details.context, null);
  }
});
