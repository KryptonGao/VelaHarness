import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import type { AgentInfo, AgentStatus, SessionStatus } from "@vela/shared";
import { preventAgentIdleSleep } from "../src/main/agent-power-save.ts";

function fixture() {
  const events = new EventEmitter();
  const roots = new Map<string, SessionStatus>();
  const activeShells = new Set<string>();
  const started: string[] = [];
  const stopped: number[] = [];
  const dispose = preventAgentIdleSleep({
    subscribe: listener => { events.on("runtime", listener); return () => events.off("runtime", listener); },
    subscribeQuestions: listener => { events.on("question", listener); return () => events.off("question", listener); },
    getConversationInfo: id => ({ status: roots.get(id) ?? "ready", model: null }),
  }, {
    subscribeChanges: listener => { events.on("shells", listener); return () => events.off("shells", listener); },
    list: id => activeShells.has(id) ? [{
      id: "bg-1", conversationId: id, cwd: "/", command: "make", status: "running", exitCode: null, startedAt: 0, endedAt: null,
    }] : [],
  }, {
    start: type => started.push(type) - 1,
    stop: id => { stopped.push(id); return true; },
  });
  const root = (id: string, status: SessionStatus) => {
    roots.set(id, status);
    events.emit("runtime", { type: "status", conversationId: id });
  };
  const child = (id: string, status: AgentStatus) => events.emit("runtime", {
    type: "agents", conversationId: id, agents: [{ kind: "general", status } satisfies Pick<AgentInfo, "kind" | "status">],
  });
  const shell = (id: string, running: boolean) => {
    if (running) activeShells.add(id);
    else activeShells.delete(id);
    events.emit("shells", id);
  };
  return { events, started, stopped, root, child, shell, dispose };
}

it("shares one system idle blocker across overlapping turns and releases it after success, failure or cancellation", () => {
  const f = fixture();
  f.root("a", "ready");
  assert.deepEqual(f.started, []);
  f.root("a", "streaming");
  f.root("b", "streaming");
  f.root("a", "ready");
  assert.deepEqual(f.stopped, []);
  f.root("b", "error");
  f.root("b", "streaming");
  f.root("b", "ready");
  assert.deepEqual(f.started, ["prevent-app-suspension", "prevent-app-suspension"]);
  assert.deepEqual(f.stopped, [0, 1]);
});

it("keeps running children and background commands awake after the parent finishes", () => {
  const f = fixture();
  f.root("a", "streaming");
  f.child("a", "running");
  f.root("a", "ready");
  f.shell("a", true);
  f.child("a", "paused");
  assert.deepEqual(f.stopped, []);
  f.shell("a", false);
  assert.deepEqual(f.stopped, [0]);
  f.child("a", "running");
  f.child("a", "aborted");
  assert.deepEqual(f.stopped, [0, 1]);
});

it("allows sleep while waiting for an answer only once other parallel work finishes", () => {
  const f = fixture();
  f.root("a", "streaming");
  const tool = { conversationId: "a", toolName: "bash", toolCallId: "command", activity: {} };
  f.events.emit("runtime", { ...tool, type: "tool_start" });
  f.events.emit("question", { type: "request", request: { id: "q", conversationId: "a" } });
  assert.deepEqual(f.stopped, []);
  f.events.emit("runtime", { ...tool, type: "tool_end" });
  assert.deepEqual(f.stopped, [0]);
  f.root("b", "streaming");
  f.root("b", "ready");
  assert.deepEqual(f.stopped, [0, 1]);
  f.events.emit("question", { type: "resolved", id: "q", answer: "yes" });
  assert.equal(f.started.length, 3);
  f.dispose();
  f.dispose();
  f.root("a", "streaming");
  f.shell("b", true);
  assert.equal(f.started.length, 3);
  assert.deepEqual(f.stopped, [0, 1, 2]);
});
