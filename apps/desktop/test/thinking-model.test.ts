import assert from "node:assert/strict";
import { test } from "node:test";
import { partitionThinkingGroups, supportsThinkingGroups, thinkingModelName } from "../src/renderer/thinking-model.ts";
import { attachFollowerTools, buildTurnItems, groupProcessItems } from "../src/renderer/components/tool-sequence.ts";
import type { UiMessage } from "../src/renderer/hooks/useSession.ts";

const message = (id: string, model?: string, thinking = ""): UiMessage => ({
  id, model, role: "assistant", thinking, text: "", tools: [],
});

test("ID 或名称任意位置含 GPT 就匹配，忽略大小写，不额外识别 o 系列", () => {
  for (const model of ["gpt-6.1", "GPT-6.1 Sol", "openai/gpt-5", "customgpt", "not-gpt-5", "myGpTalias"]) {
    assert.equal(supportsThinkingGroups({ model }), true, model);
  }
  for (const modelName of ["GPT Custom", "My GPT Model", "customgpt", "My GpT alias"]) {
    assert.equal(supportsThinkingGroups({ model: "custom-model", modelName }), true, modelName);
  }
  assert.equal(supportsThinkingGroups({ model: "my-gpt", modelName: "Other" }), true);
  for (const model of [undefined, "deepseek-reasoner", "deepseek-v4-pro", "claude-opus-4-6", "o3", "o4-mini"]) {
    assert.equal(supportsThinkingGroups({ model }), false, model);
  }
  assert.equal(supportsThinkingGroups({ provider: "gpt-service", model: "custom", modelName: "Other" }), false);
});

test("按原消息 provider/id 解析名称，不能借用别的提供商或当前模型的名称", () => {
  const models = [
    { provider: "a", id: "custom", name: "GPT Custom" },
    { provider: "b", id: "custom", name: "DeepSeek" },
  ];
  assert.equal(thinkingModelName({ provider: "a", model: "custom" }, models), "GPT Custom");
  assert.equal(thinkingModelName({ provider: "b", model: "custom" }, models), "DeepSeek");
  assert.equal(thinkingModelName({ model: "custom" }, models), undefined);
  assert.equal(thinkingModelName({ model: "missing" }, models), undefined);
  const named = { ...message("name-only", "custom"), modelName: "GPT Custom" };
  assert.equal(partitionThinkingGroups([named], true)[0]?.coherent, true);
  const lead = { ...named, thinking: "**Planning**\n\nBody.", text: "Visible reply." };
  const follower = { ...named, id: "next", tools: [{ id: "read", name: "read", status: "done" as const, activity: {} }] };
  assert.equal(attachFollowerTools([lead, follower]).length, 1);
  assert.deepEqual(groupProcessItems(buildTurnItems([lead, follower]), "compact").map(node => node.type), ["thinking", "tool", "text"]);
});

test("混合模型的历史按原消息分段，不随当前选中的 GPT 改写", () => {
  const messages = [message("a", "gpt-6.1"), message("b", "gpt-6.1"), message("c", "deepseek-reasoner"), message("d"), message("e", "gpt-6.1")];
  assert.deepEqual(partitionThinkingGroups(messages, true).map(section => [section.coherent, section.messages.map(item => item.id)]), [
    [true, ["a", "b"]], [false, ["c"]], [false, ["d"]], [true, ["e"]],
  ]);
  assert.ok(partitionThinkingGroups(messages, false).every(section => !section.coherent));
});

test("非 GPT 即使原始思考第一行加粗也不把后续工具吞进标题分组", () => {
  const lead = { ...message("a", "deepseek-reasoner", "**Planning**\n\nRaw reasoning."), text: "Visible reply." };
  const follower = { ...message("b", "deepseek-reasoner"), tools: [{ id: "read", name: "read", status: "done" as const, activity: {} }] };
  assert.deepEqual(attachFollowerTools([lead, follower]).map(unit => unit.memberIds), [["a"], ["b"]]);
  assert.deepEqual(groupProcessItems(buildTurnItems([lead, follower]), "compact").map(node => node.type), ["thinking", "text", "tool"]);
});

test("GPT 标题分组不能跨模型吸收无思考的后续工具", () => {
  const lead = message("a", "gpt-6.1", "**Planning**\n\nSummary.");
  const follower = { ...message("b", "deepseek-reasoner"), tools: [{ id: "read", name: "read", status: "done" as const, activity: {} }] };
  assert.deepEqual(attachFollowerTools([lead, follower]).map(unit => unit.memberIds), [["a"], ["b"]]);
});
