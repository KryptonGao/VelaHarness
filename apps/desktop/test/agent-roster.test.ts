import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyAgentUsage, type AgentInfo, type ToolTrace } from "@vela/shared";
import { indexAgentHistory, mergeAgentRoster, reconcileAgents } from "../src/renderer/agent-roster.ts";

function agent(id: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    parentId: "root",
    path: `/root/${id}`,
    name: id,
    kind: "general",
    status: "running",
    depth: 1,
    task: "",
    steps: [],
    mutated: false,
    finalText: null,
    error: null,
    usage: { ...emptyAgentUsage },
    activeMs: 0,
    runningSince: 1,
    pauseRequested: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tool(id: string, agentId: string, status: ToolTrace["status"] = "done", body?: string): ToolTrace {
  return { id, name: "agent", status, activity: { agentId, agentPath: `/root/${agentId}`, body } };
}

describe("reconcileAgents", () => {
  it("returns the previous array when the snapshot is identical", () => {
    const previous = [agent("a"), agent("b")];
    assert.equal(reconcileAgents(previous, clone(previous)), previous);
  });

  it("keeps unchanged agent objects and replaces only the changed one", () => {
    const previous = [agent("a"), agent("b")];
    const next = clone(previous);
    next[1]!.status = "completed";
    const merged = reconcileAgents(previous, next);
    assert.notEqual(merged, previous);
    assert.equal(merged[0], previous[0]);
    assert.equal(merged[1], next[1]);
  });

  it("detects nested step changes", () => {
    const previous = [agent("a")];
    const next = clone(previous);
    next[0]!.steps = [{ id: "s1", name: "read", summary: "x" } as AgentInfo["steps"][number]];
    assert.notEqual(reconcileAgents(previous, next), previous);
  });

  it("treats added, removed and reordered agents as changes", () => {
    const previous = [agent("a"), agent("b")];
    assert.notEqual(reconcileAgents(previous, clone(previous).slice(0, 1)), previous);
    assert.notEqual(reconcileAgents(previous, [...clone(previous), agent("c")]), previous);
    const reordered = reconcileAgents(previous, clone(previous).reverse());
    assert.notEqual(reordered, previous);
    assert.equal(reordered[0], previous[1]);
  });

  it("accepts the first snapshot as is", () => {
    const next = [agent("a")];
    assert.equal(reconcileAgents(undefined, next), next);
  });
});

describe("indexAgentHistory", () => {
  it("prefers the latest message and the first tool inside it", () => {
    const restored = indexAgentHistory([
      { tools: [tool("t1", "a", "done", "old")] },
      { tools: [tool("t2", "a", "done", "first"), tool("t3", "a", "done", "second")] },
    ]);
    assert.equal(restored.size, 1);
    assert.equal(restored.get("a")?.finalText, "first");
  });

  it("maps tool status and ignores tools without an agent id", () => {
    const restored = indexAgentHistory([
      { tools: [tool("t1", "a", "running"), tool("t2", "b", "error"), { id: "t3", name: "bash", status: "done" }] },
    ]);
    assert.equal(restored.get("a")?.status, "running");
    assert.equal(restored.get("b")?.status, "failed");
    assert.equal(restored.size, 2);
  });

  it("scans long histories in one pass", () => {
    const messages = Array.from({ length: 20000 }, (_, i) => ({ tools: [tool(`t${i}`, `a${i % 50}`)] }));
    const started = performance.now();
    assert.equal(indexAgentHistory(messages).size, 50);
    assert.ok(performance.now() - started < 500);
  });
});

describe("mergeAgentRoster", () => {
  it("lets live agents win, skips root and appends restored ones", () => {
    const live = [agent("root", { kind: "root" }), agent("a", { task: "live" })];
    const restored = new Map([["a", agent("a", { task: "restored" })], ["b", agent("b")]]);
    const roster = mergeAgentRoster(live, restored);
    assert.deepEqual(roster.map((item) => item.id), ["a", "b"]);
    assert.equal(roster[0]?.task, "live");
  });
});
