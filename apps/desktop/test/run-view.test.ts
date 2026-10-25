import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolTrace } from "@vela/shared";
import type { UiMessage } from "../src/renderer/hooks/useSession.ts";
import {
  advanceRunStep,
  currentTurnStartedAt,
  formatRunElapsed,
  initialRunStepDisplay,
  latestTodos,
  orbActivityOf,
  runStepCooldownMs,
  runStepSignal,
  sameRunStepDisplay,
  type RunStepDisplay,
  type RunStepSignal,
} from "../src/renderer/run-view.ts";

const user = (id: string): UiMessage => ({ id, role: "user", text: "请修复", thinking: "", tools: [] });
const assistant = (id: string, patch: Partial<UiMessage> = {}): UiMessage => ({ id, role: "assistant", text: "", thinking: "", tools: [], ...patch });
const tool = (name: string, status: ToolTrace["status"], activity: ToolTrace["activity"] = {}): ToolTrace => ({ id: `${name}-${status}`, name, status, activity });
const kindOf = (message: UiMessage | undefined) => runStepSignal(message).kind;

describe("运行视图的数据", () => {
  it("取本轮最近一次提交的清单,上一轮的不算", () => {
    const old = [{ text: "旧任务", status: "completed" as const }];
    const first = [{ text: "查原因", status: "in_progress" as const }, { text: "改代码", status: "pending" as const }];
    const next = [{ text: "查原因", status: "completed" as const }, { text: "改代码", status: "in_progress" as const }];
    const messages = [
      user("u1"), assistant("a1", { tools: [tool("update_todos", "done", { plan: old })] }),
      user("u2"), assistant("a2", { tools: [tool("update_todos", "done", { plan: first })] }),
      assistant("a3", { tools: [tool("bash", "done"), tool("update_todos", "done", { plan: next })] }),
    ];
    assert.deepEqual(latestTodos(messages), next);
    assert.equal(latestTodos([...messages, user("u3"), assistant("a4")]), null);
  });

  it("已批准方案的 update_plan 同样作为清单来源", () => {
    const plan = [{ text: "按方案改", status: "in_progress" as const }];
    assert.deepEqual(latestTodos([user("u"), assistant("a", { tools: [tool("update_plan", "done", { plan })] })]), plan);
  });

  it("按运行中的工具分类步骤,没有工具时看思考和正文", () => {
    assert.equal(kindOf(undefined), "thinking");
    assert.equal(kindOf(assistant("a", { thinking: "先看一下\n再查日志\n" })), "thinking");
    assert.equal(kindOf(assistant("a", { text: "好的,我来" })), "writing");
    const bash = tool("bash", "running", { command: "pnpm test" });
    assert.equal(kindOf(assistant("a", { tools: [tool("read", "done"), bash] })), "command");
    assert.equal(kindOf(assistant("a", { tools: [tool("read", "running", { path: "a.ts" })] })), "reading");
    assert.equal(kindOf(assistant("a", { tools: [tool("write", "running")] })), "editing");
    assert.equal(kindOf(assistant("a", { tools: [tool("web_search", "running")] })), "searching");
    assert.equal(kindOf(assistant("a", { tools: [tool("spawn_agent", "running")] })), "subagent");
    assert.equal(kindOf(assistant("a", { tools: [tool("update_todos", "running")] })), "todos");
    assert.equal(kindOf(assistant("a", { tools: [tool("mcp__x__y", "running")] })), "working");
    // 全部结束后又开始下一步前,回到思考。
    assert.equal(kindOf(assistant("a", { tools: [tool("bash", "done")] })), "thinking");
  });

  it("圆球样式池:思考与撰写用三点,工具用四点", () => {
    assert.equal(orbActivityOf("thinking"), "thinking");
    assert.equal(orbActivityOf("writing"), "thinking");
    for (const kind of ["command", "reading", "editing", "searching", "subagent", "todos", "working"] as const) assert.equal(orbActivityOf(kind), "command");
  });

  it("步骤标识:运行中的命令按工具 id 稳定,结束后回到思考", () => {
    const running = assistant("a", { tools: [tool("bash", "running", { command: "pnpm test" })] });
    assert.deepEqual(runStepSignal(running), { kind: "command", key: "tool:bash-running" });
    assert.deepEqual(runStepSignal(running), runStepSignal(running));
    assert.deepEqual(runStepSignal(assistant("a", { tools: [tool("bash", "done")] })), { kind: "thinking", key: "step:thinking" });
  });

  it("本轮开始时间与用时格式", () => {
    assert.equal(currentTurnStartedAt([user("u"), assistant("a", { turnStartedAt: 1000 }), assistant("b", { turnStartedAt: 2000 })]), 1000);
    assert.equal(currentTurnStartedAt([user("u")]), undefined);
    assert.equal(formatRunElapsed(18_400), "18s");
    assert.equal(formatRunElapsed(72_000), "1m 12s");
    assert.equal(formatRunElapsed(3_900_000), "1h 5m");
    assert.equal(formatRunElapsed(-5), "0s");
  });
});

const thinking: RunStepSignal = { kind: "thinking", key: "step:thinking" };
const writing: RunStepSignal = { kind: "writing", key: "step:writing" };
const command = (id: string): RunStepSignal => ({ kind: "command", key: `tool:${id}` });

describe("运行视图状态条的命令冷却", () => {
  it("极短的命令不显示「运行命令」", () => {
    let display = advanceRunStep(initialRunStepDisplay(thinking, 0), command("a"), 0);
    assert.equal(display.kind, "thinking");
    assert.equal(display.pending?.key, "tool:a");
    // 没撑过冷却就结束,回到思考,挂起的命令作废。
    display = advanceRunStep(display, command("a"), runStepCooldownMs - 1);
    assert.equal(display.kind, "thinking");
    display = advanceRunStep(display, thinking, 200);
    assert.equal(display.kind, "thinking");
    assert.equal(display.pending, undefined);
  });

  it("命令跑满冷却时间才切到「运行命令」", () => {
    const start = 1_000;
    let display = advanceRunStep(initialRunStepDisplay(thinking, start), command("a"), start);
    assert.equal(display.pending?.deadline, start + runStepCooldownMs);
    display = advanceRunStep(display, command("a"), start + runStepCooldownMs - 1);
    assert.equal(display.kind, "thinking");
    display = advanceRunStep(display, command("a"), start + runStepCooldownMs);
    assert.equal(display.kind, "command");
    assert.equal(display.key, "tool:a");
    assert.equal(display.pending, undefined);
  });

  it("同一条命令的流式更新不重置冷却", () => {
    let display = advanceRunStep(initialRunStepDisplay(thinking, 0), command("a"), 0);
    const deadline = display.pending?.deadline;
    for (const now of [100, 300, runStepCooldownMs - 1]) display = advanceRunStep(display, command("a"), now);
    assert.equal(display.pending?.deadline, deadline);
    assert.equal(display.kind, "thinking");
  });

  it("其他步骤不受冷却影响", () => {
    let display = initialRunStepDisplay(thinking, 0);
    display = advanceRunStep(display, { kind: "reading", key: "tool:read" }, 10);
    assert.equal(display.kind, "reading");
    assert.equal(display.pending, undefined);
    display = advanceRunStep(display, writing, 20);
    assert.equal(display.kind, "writing");
  });

  it("冷却到点时命令已经结束,不补显示", () => {
    let display = advanceRunStep(initialRunStepDisplay(thinking, 0), command("a"), 0);
    display = advanceRunStep(display, writing, runStepCooldownMs + 50);
    assert.equal(display.kind, "writing");
    assert.equal(display.pending, undefined);
  });

  it("连续两条短命令各自计冷却,都不会闪出「运行命令」", () => {
    let display = advanceRunStep(initialRunStepDisplay(thinking, 0), command("a"), 0);
    display = advanceRunStep(display, thinking, 100);
    display = advanceRunStep(display, command("b"), 120);
    assert.equal(display.kind, "thinking");
    assert.equal(display.pending?.key, "tool:b");
    display = advanceRunStep(display, command("b"), 120 + runStepCooldownMs);
    assert.equal(display.kind, "command");
    assert.equal(display.key, "tool:b");
  });

  it("中途打开运行视图时,正在跑的命令也从零开始等冷却", () => {
    const display = initialRunStepDisplay(command("a"), 5_000);
    assert.equal(display.kind, "thinking");
    assert.equal(display.pending?.deadline, 5_000 + runStepCooldownMs);
    assert.equal(initialRunStepDisplay(writing, 0).kind, "writing");
  });

  it("状态比较只看界面上的内容", () => {
    const base: RunStepDisplay = { kind: "thinking", key: "step:thinking" };
    const pending: RunStepDisplay = { ...base, pending: { kind: "command", key: "tool:a", deadline: 600 } };
    assert.equal(sameRunStepDisplay(base, { kind: "thinking", key: "step:thinking" }), true);
    assert.equal(sameRunStepDisplay(base, pending), false);
    assert.equal(sameRunStepDisplay(pending, { ...base, pending: { kind: "command", key: "tool:a", deadline: 600 } }), true);
    assert.equal(sameRunStepDisplay(pending, { ...base, pending: { kind: "command", key: "tool:a", deadline: 700 } }), false);
    assert.equal(sameRunStepDisplay(pending, { ...base, pending: { kind: "command", key: "tool:b", deadline: 600 } }), false);
  });
});
