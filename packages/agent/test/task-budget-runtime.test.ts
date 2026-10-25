import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it, type TestContext } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../src/runtime.ts";

interface Internals {
  conversations: Map<string, { session: AgentSession; budget?: { exhausted: boolean; ended: boolean } }>;
}

/** 每次模型请求固定消耗 10,000 token（输入 8,000 + 输出 2,000）。 */
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-task-budget-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "alpha");
  await mkdir(agentDir);
  await mkdir(workspace);
  const runtime = new AgentRuntime({ cwd: workspace, agentDir });
  t.after(async () => {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await runtime.createConversation(workspace);
  const id = runtime.activeConversationId!;
  await runtime.addModel({
    providerId: "budget-fixture", providerName: "Budget fixture", modelId: "fixture-model",
    modelName: "Budget fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "synthetic-budget-fixture-key", reasoning: false, contextWindow: 32768, maxTokens: 4096,
  });
  await runtime.saveAgentSettings({ ...await runtime.getAgentSettings(), provider: "budget-fixture", modelId: "fixture-model", thinkingLevel: "off" });
  const session = () => (runtime as unknown as Internals).conversations.get(id)!.session;
  let requests = 0;
  const script = () => {
    const stream: StreamFn = (model) => {
      requests += 1;
      const message: AssistantMessage = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "好的" }], stopReason: "stop", timestamp: Date.now(),
        usage: { input: 8000, output: 2000, cacheRead: 0, cacheWrite: 0, totalTokens: 10_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const output = createAssistantMessageEventStream();
      output.push({ type: "start", partial: message });
      output.push({ type: "text_delta", contentIndex: 0, delta: "好的", partial: message });
      output.push({ type: "done", reason: "stop", message });
      return output;
    };
    session().agent.streamFunction = stream as unknown as AgentSession["agent"]["streamFunction"];
  };
  return { runtime, id, session, script, requests: () => requests, agentDir, workspace };
}

describe("AgentRuntime 任务用量上限", { timeout: 30_000 }, () => {
  it("未启用时不产生用量状态", async (t) => {
    const f = await fixture(t);
    f.script();
    await f.runtime.prompt(f.id, "任务");
    assert.equal(f.runtime.getSnapshot().taskBudget ?? null, null);
  });

  it("Token 到达上限后标记为 exhausted，之后的新消息开始新的任务", async (t) => {
    const f = await fixture(t);
    f.runtime.setTaskBudgetSettings({ enabled: true, maxMinutes: null, maxTokens: 10_000 });
    f.script();
    await f.runtime.prompt(f.id, "任务");
    const first = f.runtime.getSnapshot().taskBudget;
    assert.equal(first?.phase, "exhausted");
    assert.equal(first?.reason, "tokens");
    assert.equal(first?.tokensUsed, 10_000);
    assert.equal(first?.maxTokens, 10_000);
    assert.equal(f.requests(), 1);
    // 关闭上限后，新的消息不受旧任务影响，也不会带着 exhausted 状态。
    f.runtime.setTaskBudgetSettings({ enabled: false, maxMinutes: null, maxTokens: 10_000 });
    assert.equal(f.runtime.getSnapshot().taskBudget ?? null, null);
    await f.runtime.prompt(f.id, "第二个任务");
    assert.equal(f.requests(), 2);
    assert.equal(f.runtime.getSnapshot().taskBudget ?? null, null);
  });

  it("接近上限时进入 warning，任务结束后收起", async (t) => {
    const f = await fixture(t);
    f.runtime.setTaskBudgetSettings({ enabled: true, maxMinutes: null, maxTokens: 12_000 });
    f.script();
    await f.runtime.prompt(f.id, "任务");
    const state = f.runtime.getSnapshot().taskBudget;
    assert.equal(state?.phase, "warning");
    assert.equal(state?.tokensUsed, 10_000);
    const until = Date.now() + 5000;
    while (f.runtime.getSnapshot().taskBudget && Date.now() < until) await delay(50);
    assert.equal(f.runtime.getSnapshot().taskBudget ?? null, null);
  });

  it("交接草稿可以只用事实整理，不向模型发请求", async (t) => {
    const f = await fixture(t);
    f.script();
    await f.runtime.prompt(f.id, "任务");
    const before = f.requests();
    const pack = await f.runtime.generateHandoffPack({ conversationId: f.id, locale: "zh-CN", requestId: "r1", factsOnly: true });
    assert.equal(pack.source, "facts-only");
    assert.equal(f.requests(), before);
  });

  it("对话自己的上限只对该对话生效，可恢复沿用全局，并随对话保存", async (t) => {
    const f = await fixture(t);
    f.runtime.setTaskBudgetSettings({ enabled: false, maxMinutes: 30, maxTokens: 2_000_000 });
    const other = await f.runtime.createConversation(f.workspace).then(() => f.runtime.activeConversationId!);
    assert.notEqual(other, f.id);
    const custom = { enabled: true, maxMinutes: null, maxTokens: 10_000, maxSubagents: 16, allowNestedSubagents: true };
    const saved = f.runtime.setConversationTaskBudget(f.id, custom);
    assert.deepEqual(saved.override, custom);
    assert.deepEqual(saved.effective, custom);
    assert.equal(f.runtime.getConversationTaskBudget(other).override, null);
    assert.equal(f.runtime.getConversationTaskBudget(other).effective.enabled, false);
    assert.throws(() => f.runtime.setConversationTaskBudget(f.id, { enabled: true, maxMinutes: null, maxTokens: null }), /至少/);
    assert.throws(() => f.runtime.setConversationTaskBudget("missing", null), /对话不存在/);

    // 只有设置了自定义上限的对话会到达上限；全局关闭时另一个对话不受影响。
    await f.runtime.switchConversation(f.id);
    f.script();
    await f.runtime.prompt(f.id, "任务");
    assert.equal(f.runtime.getSnapshot().taskBudget?.phase, "exhausted");

    await f.runtime.dispose();
    const restored = new AgentRuntime({ cwd: f.workspace, agentDir: f.agentDir });
    t.after(() => restored.dispose());
    await restored.switchConversation(f.id);
    assert.deepEqual(restored.getConversationTaskBudget(f.id).override, custom);
    assert.equal(restored.setConversationTaskBudget(f.id, null).override, null);
    assert.equal(restored.getConversationTaskBudget(f.id).effective.enabled, false);
    assert.equal(restored.getSnapshot().taskBudget ?? null, null);
  });
});
