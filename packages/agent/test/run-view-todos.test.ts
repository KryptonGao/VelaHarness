import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import {
  createModeExtension, createModeTools, modeSystemPrompt, modeToolNames, todoListOutcome, toolNamesFor, updateTodosToolName,
  type ModeToolHost, type ModeState,
} from "../src/interaction.ts";
import { ToolLoadout } from "../src/runtime-tools.ts";
import { activityFromCall } from "../src/tool-activity.ts";

const host: ModeToolHost = {
  updateExecutionPlan: () => ({ ok: true, text: "updated" }),
  updateGoal: () => ({ ok: true, text: "updated" }),
  recordGoalValidation: () => ({ ok: true, text: "recorded" }),
  askUser: async () => ({ ok: true, text: "answered", answer: null }),
  submitOutcome: () => ({ ok: true, text: "submitted" }),
  recommendActions: () => ({ ok: true, text: "recommended" }),
};

describe("运行视图的待办清单", () => {
  it("只在运行视图开启且没有已批准执行方案时提供 update_todos", () => {
    for (const mode of ["agent", "goal"] as const) {
      assert.ok(toolNamesFor(mode, false, true).includes(updateTodosToolName));
      assert.equal(toolNamesFor(mode, false, false).includes(updateTodosToolName), false);
      assert.equal(toolNamesFor(mode, false).includes(updateTodosToolName), false);
      // 有执行方案时由 update_plan 承担,不重复提供。
      assert.equal(toolNamesFor(mode, true, true).includes(updateTodosToolName), false);
    }
    assert.equal(toolNamesFor("plan", false, true).includes(updateTodosToolName), false);
    assert.ok(modeToolNames.includes(updateTodosToolName));
  });

  it("提示词鼓励多步骤任务提交 2-7 项清单、允许简单任务跳过,关闭时不出现", () => {
    for (const mode of ["agent", "goal"] as const) {
      assert.match(modeSystemPrompt(mode, false, true), /Run View/);
      assert.match(modeSystemPrompt(mode, false, true), /update_todos/);
      assert.match(modeSystemPrompt(mode, false, true), /2-7 concrete items/);
      assert.doesNotMatch(modeSystemPrompt(mode, false, true), /3-7/);
      assert.match(modeSystemPrompt(mode, false, true), /simple task[^.]*skip the list/);
      assert.doesNotMatch(modeSystemPrompt(mode, false, false), /Run View/);
    }
    assert.match(modeSystemPrompt("agent", true, true), /update_plan/);
    assert.doesNotMatch(modeSystemPrompt("plan", false, true), /Run View/);
  });

  it("工具参数、单项进行中的限制和结果文案", async () => {
    const tool = createModeTools(host).find(item => item.name === updateTodosToolName)!;
    assert.equal(tool.executionMode, "sequential");
    const todos = [{ step: "查原因", status: "completed" }, { step: "改代码", status: "in_progress" }, { step: "跑测试", status: "pending" }];
    assert.equal(Value.Check(tool.parameters, { todos }), true);
    assert.equal(Value.Check(tool.parameters, { todos: [] }), false);
    assert.equal(Value.Check(tool.parameters, { todos: [{ step: "x", status: "started" }] }), false);
    const result = await tool.execute("todo", { todos }, undefined, undefined, undefined as never);
    assert.deepEqual(result.content, [{ type: "text", text: "待办清单已更新：1/3 完成，进行中：改代码。" }]);
    await assert.rejects(
      tool.execute("todo", { todos: todos.map(item => ({ ...item, status: "in_progress" })) }, undefined, undefined, undefined as never),
      /最多只能有一项 in_progress/,
    );
    assert.equal(todoListOutcome([]).ok, true);
  });

  it("界面能从调用参数还原清单", () => {
    const activity = activityFromCall(updateTodosToolName, { todos: [{ step: "查原因", status: "in_progress" }, { step: "  跑\n测试 ", status: "oops" }] });
    assert.deepEqual(activity.plan, [{ text: "查原因", status: "in_progress" }, { text: "跑 测试", status: "pending" }]);
    assert.match(activity.body ?? "", /→ 查原因/);
  });

  it("ToolLoadout 按运行视图开关激活,定时任务和配方不要求", () => {
    let on = false;
    const loadout = new ToolLoadout({ scheduledTasks: false, browser: false, memoryEnabled: () => false, runView: () => on });
    const chat = { snapshot: { mode: "agent" as const, executionPlan: null } };
    assert.equal(loadout.active(chat).includes(updateTodosToolName), false);
    on = true;
    assert.equal(loadout.active(chat).includes(updateTodosToolName), true);
    assert.equal(loadout.active({ ...chat, scheduledTaskConversation: true }).includes(updateTodosToolName), false);
    assert.equal(loadout.active({ ...chat, recipeExecution: {} }).includes(updateTodosToolName), false);
    assert.ok(loadout.registered().includes(updateTodosToolName));
  });
});

type Handler = (event: any) => unknown;

function extensionHandlers(state: ModeState) {
  const handlers = new Map<string, Handler>();
  createModeExtension(() => state)({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as never);
  const startTurn = () => handlers.get("before_agent_start")!({ systemPromptOptions: { appendSystemPrompt: "" } });
  const call = (toolName: string, input: unknown = {}) => handlers.get("tool_call")!({ toolName, input }) as Promise<{ block: true; reason: string } | undefined>;
  return { startTurn, call };
}

describe("运行视图不设待办闸门", () => {
  it("没有提交清单时 bash/edit/write 也不会被拦下", async () => {
    for (const hasExecutionPlan of [false, true]) {
      const { startTurn, call } = extensionHandlers({ mode: "agent", hasExecutionPlan, runView: true });
      await startTurn();
      for (const tool of ["bash", "edit", "write", "read"]) assert.equal(await call(tool, { command: "ls", path: "a.ts" }), undefined);
    }
  });
});
