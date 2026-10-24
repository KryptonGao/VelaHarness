import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolTrace } from "@vela/shared";
import type { UiMessage } from "../src/renderer/hooks/useSession.ts";
import { currentRunStep, currentTurnStartedAt, formatRunElapsed, latestTodos, orbActivityOf } from "../src/renderer/run-view.ts";

const user = (id: string): UiMessage => ({ id, role: "user", text: "请修复", thinking: "", tools: [] });
const assistant = (id: string, patch: Partial<UiMessage> = {}): UiMessage => ({ id, role: "assistant", text: "", thinking: "", tools: [], ...patch });
const tool = (name: string, status: ToolTrace["status"], activity: ToolTrace["activity"] = {}): ToolTrace => ({ id: `${name}-${status}`, name, status, activity });

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
    assert.equal(currentRunStep(undefined), "thinking");
    assert.equal(currentRunStep(assistant("a", { thinking: "先看一下\n再查日志\n" })), "thinking");
    assert.equal(currentRunStep(assistant("a", { text: "好的,我来" })), "writing");
    const bash = tool("bash", "running", { command: "pnpm test" });
    assert.equal(currentRunStep(assistant("a", { tools: [tool("read", "done"), bash] })), "command");
    assert.equal(currentRunStep(assistant("a", { tools: [tool("read", "running", { path: "a.ts" })] })), "reading");
    assert.equal(currentRunStep(assistant("a", { tools: [tool("write", "running")] })), "editing");
    assert.equal(currentRunStep(assistant("a", { tools: [tool("web_search", "running")] })), "searching");
    assert.equal(currentRunStep(assistant("a", { tools: [tool("spawn_agent", "running")] })), "subagent");
    assert.equal(currentRunStep(assistant("a", { tools: [tool("update_todos", "running")] })), "todos");
    assert.equal(currentRunStep(assistant("a", { tools: [tool("mcp__x__y", "running")] })), "working");
    // 全部结束后又开始下一步前,回到思考。
    assert.equal(currentRunStep(assistant("a", { tools: [tool("bash", "done")] })), "thinking");
  });

  it("圆球样式池:思考与撰写用三点,工具用四点", () => {
    assert.equal(orbActivityOf("thinking"), "thinking");
    assert.equal(orbActivityOf("writing"), "thinking");
    for (const kind of ["command", "reading", "editing", "searching", "subagent", "todos", "working"] as const) assert.equal(orbActivityOf(kind), "command");
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
