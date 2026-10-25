import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import { recommendedActionsToolName } from "@vela/shared";
import {
  createModeExtension, createModeTools, defaultToolPolicy, modeSystemPrompt, modeToolNames, type ModeState, type ModeToolHost,
} from "../src/interaction.ts";
import { ToolLoadout } from "../src/runtime-tools.ts";
import { activityFromCall, activityFromExecution } from "../src/tool-activity.ts";

const args = {
  question: "要提交这些改动吗？",
  actions: [{ label: "提交", prompt: "请提交本次改动" }, { label: "先不提交", prompt: "先不要提交，等我确认" }],
};

function loadout(on: () => boolean) {
  return new ToolLoadout({ scheduledTasks: false, browser: false, memoryEnabled: () => false, recommendedActions: on });
}

describe("推荐操作工具", () => {
  it("已注册，但只在开关开启的 Agent / Goal 对话里激活", () => {
    let on = false;
    const tools = loadout(() => on);
    const chat = { snapshot: { mode: "agent" as const, executionPlan: null } };
    assert.ok(tools.registered().includes(recommendedActionsToolName));
    assert.ok(modeToolNames.includes(recommendedActionsToolName));
    assert.equal(tools.active(chat).includes(recommendedActionsToolName), false);
    on = true;
    assert.equal(tools.active(chat).includes(recommendedActionsToolName), true);
    assert.equal(tools.active({ snapshot: { mode: "goal" as const, executionPlan: null } }).includes(recommendedActionsToolName), true);
    assert.equal(tools.active({ snapshot: { mode: "plan" as const, executionPlan: null } }).includes(recommendedActionsToolName), false);
    assert.equal(tools.active({ ...chat, scheduledTaskConversation: true }).includes(recommendedActionsToolName), false);
    assert.equal(tools.active({ ...chat, recipeExecution: {} }).includes(recommendedActionsToolName), false);
  });

  it("关闭时执行前也会被拦下", () => {
    let on = false;
    const tools = loadout(() => on);
    const chat = { snapshot: { mode: "agent" as const, executionPlan: null } };
    const call = { mode: "agent" as const, toolName: recommendedActionsToolName, input: args };
    assert.equal(tools.authorize(call, chat).allowed, false);
    on = true;
    assert.equal(tools.authorize(call, chat).allowed, true);
    assert.equal(defaultToolPolicy.authorizeCall({ ...call, mode: "plan" }).allowed, false);
  });

  it("提示词只在开启且非 Plan 时加入", () => {
    assert.doesNotMatch(modeSystemPrompt("agent", false, false, false), new RegExp(recommendedActionsToolName));
    assert.match(modeSystemPrompt("agent", false, false, true), new RegExp(recommendedActionsToolName));
    assert.match(modeSystemPrompt("goal", false, false, true), new RegExp(recommendedActionsToolName));
    assert.doesNotMatch(modeSystemPrompt("plan", false, false, true), new RegExp(recommendedActionsToolName));
  });

  it("模式扩展按状态把提示词追加到系统提示", async () => {
    const run = async (state: ModeState) => {
      const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
      createModeExtension(() => state)({ on: (name: string, fn: (event: unknown) => Promise<unknown>) => handlers.set(name, fn) } as never);
      const event = { systemPromptOptions: { appendSystemPrompt: "" } };
      await handlers.get("before_agent_start")!(event);
      return event.systemPromptOptions.appendSystemPrompt;
    };
    assert.match(await run({ mode: "agent", hasExecutionPlan: false, recommendedActions: true }), new RegExp(recommendedActionsToolName));
    assert.doesNotMatch(await run({ mode: "agent", hasExecutionPlan: false }), new RegExp(recommendedActionsToolName));
  });

  it("参数限制 1-3 个操作，并把草稿交给宿主", async () => {
    const seen: unknown[] = [];
    const host = { recommendActions: (draft: unknown) => { seen.push(draft); return { ok: true, text: "ok" }; } } as unknown as ModeToolHost;
    const tool = createModeTools(host).find(item => item.name === recommendedActionsToolName)!;
    assert.ok(Value.Check(tool.parameters, args));
    assert.equal(Value.Check(tool.parameters, { ...args, actions: [] }), false);
    assert.equal(Value.Check(tool.parameters, { ...args, actions: Array.from({ length: 4 }, () => args.actions[0]) }), false);
    assert.equal(Value.Check(tool.parameters, { question: "x", actions: [{ label: "", prompt: "p" }] }), false);
    await tool.execute("call-1", args as never, undefined, undefined, undefined as never);
    assert.deepEqual(seen, [args]);
  });

  it("界面能从调用参数还原推荐，无效参数不产生卡片", () => {
    assert.deepEqual(activityFromCall(recommendedActionsToolName, args).recommendedActions, args);
    assert.equal(activityFromCall(recommendedActionsToolName, { question: "q", actions: [] }).recommendedActions, undefined);
    assert.equal(activityFromExecution(recommendedActionsToolName, args, { content: [{ type: "text", text: "ok" }] }, false).recommendedActions?.actions.length, 2);
    assert.equal(activityFromExecution(recommendedActionsToolName, args, { content: [{ type: "text", text: "bad" }] }, true).recommendedActions, undefined);
  });
});
