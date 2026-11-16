import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import { visualToolName } from "@vela/shared";
import {
  createModeExtension,
  createModeTools,
  defaultToolPolicy,
  modeSystemPrompt,
  modeToolNames,
  type ModeState,
  type ModeToolHost,
} from "../src/interaction.ts";
import { ToolLoadout } from "../src/runtime-tools.ts";
import { activityFromCall, activityFromExecution } from "../src/tool-activity.ts";
import { isStreamedFileTool, streamedFileActivity } from "../src/tool-stream.ts";
import { transcriptFromMessages } from "../src/transcript.ts";

const sampleArgs = {
  title: "ApprovalBanner",
  html: "<style>.card{padding:12px}</style><div class=\"card\">Approve?</div>",
  height: 180,
};

function loadout(on: () => boolean) {
  return new ToolLoadout({
    scheduledTasks: false,
    browser: false,
    memoryEnabled: () => false,
    visualDemo: on,
  });
}

describe("show_visual 工具", () => {
  it("已注册并在 agent / plan / goal 对话里按开关激活", () => {
    let on = false;
    const tools = loadout(() => on);
    const chat = { snapshot: { mode: "agent" as const, executionPlan: null } };
    assert.ok(tools.registered().includes(visualToolName));
    assert.ok(modeToolNames.includes(visualToolName));
    assert.equal(tools.active(chat).includes(visualToolName), false);

    on = true;
    assert.equal(tools.active(chat).includes(visualToolName), true);
    assert.equal(tools.active({ snapshot: { mode: "plan" as const, executionPlan: null } }).includes(visualToolName), true);
    assert.equal(tools.active({ snapshot: { mode: "goal" as const, executionPlan: null } }).includes(visualToolName), true);
    assert.equal(tools.active({ ...chat, scheduledTaskConversation: true }).includes(visualToolName), false);
    assert.equal(tools.active({ ...chat, backgroundExecution: true }).includes(visualToolName), false);
    assert.equal(tools.active({ ...chat, recipeExecution: {} }).includes(visualToolName), false);
  });

  it("关闭时拦截执行，开启时连同 Plan 模式一并放行", () => {
    let on = false;
    const tools = loadout(() => on);
    const planEntry = { snapshot: { mode: "plan" as const, executionPlan: null } };
    const call = { mode: "plan" as const, toolName: visualToolName, input: sampleArgs };
    assert.equal(tools.authorize(call, planEntry).allowed, false);
    on = true;
    assert.equal(tools.authorize(call, planEntry).allowed, true);
    assert.equal(defaultToolPolicy.authorizeCall(call).allowed, true);
  });

  it("在开启时向 agent / plan / goal 模式注入提示词", async () => {
    assert.doesNotMatch(modeSystemPrompt("agent", false, false, false, false), new RegExp(visualToolName));
    assert.match(modeSystemPrompt("agent", false, false, false, true), new RegExp(visualToolName));
    assert.match(modeSystemPrompt("plan", false, false, false, true), new RegExp(visualToolName));
    assert.match(modeSystemPrompt("goal", false, false, false, true), new RegExp(visualToolName));

    const run = async (state: ModeState) => {
      const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
      createModeExtension(() => state)({
        on: (name: string, fn: (event: unknown) => Promise<unknown>) => handlers.set(name, fn),
      } as never);
      const event = { systemPromptOptions: { appendSystemPrompt: "" } };
      await handlers.get("before_agent_start")!(event);
      return event.systemPromptOptions.appendSystemPrompt;
    };
    assert.match(await run({ mode: "plan", hasExecutionPlan: false, visualDemo: true }), new RegExp(visualToolName));
    assert.doesNotMatch(await run({ mode: "plan", hasExecutionPlan: false, visualDemo: false }), new RegExp(visualToolName));
  });

  it("校验参数并支持默认成功返回", async () => {
    const tool = createModeTools({} as unknown as ModeToolHost).find((item) => item.name === visualToolName)!;
    assert.ok(Value.Check(tool.parameters, sampleArgs));
    assert.equal(Value.Check(tool.parameters, { html: "" }), false);
    const result = await tool.execute("v1", sampleArgs as never, undefined, undefined, undefined as never);
    assert.match((result.content[0] as { text: string }).text, /ApprovalBanner/);
  });

  it("支持流式进度统计、ToolActivity 提取与 Transcript 恢复", () => {
    assert.equal(isStreamedFileTool(visualToolName), true);
    assert.deepEqual(
      streamedFileActivity(visualToolName, '{"title":"Banner","html":"<div>1</div>\\n<div>2'),
      { body: "Banner", streaming: { added: 2, removed: 0 } },
    );

    const callActivity = activityFromCall(visualToolName, sampleArgs);
    assert.deepEqual(callActivity.visual, sampleArgs);
    assert.equal(callActivity.body, "ApprovalBanner");

    const doneActivity = activityFromExecution(visualToolName, sampleArgs, { content: [{ type: "text", text: "ok" }] }, false);
    assert.deepEqual(doneActivity.visual, sampleArgs);

    const errActivity = activityFromExecution(visualToolName, sampleArgs, { content: [{ type: "text", text: "too big" }] }, true);
    assert.equal(errActivity.visual, undefined);
    assert.equal(errActivity.body, "too big");

    const transcript = transcriptFromMessages([
      {
        role: "assistant",
        api: "openai-completions",
        provider: "test",
        model: "test",
        stopReason: "toolUse",
        timestamp: 1,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [
          { type: "text", text: "示意图如下：" },
          { type: "toolCall", id: "call-v1", name: visualToolName, arguments: sampleArgs },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call-v1",
        toolName: visualToolName,
        isError: false,
        timestamp: 2,
        content: [{ type: "text", text: "ok" }],
      },
    ]);
    assert.equal(transcript.length, 1);
    assert.equal(transcript[0]?.tools[0]?.name, visualToolName);
    assert.deepEqual(transcript[0]?.tools[0]?.activity.visual, sampleArgs);
  });
});
