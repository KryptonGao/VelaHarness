import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { AgentRuntime } from "../src/runtime.ts";

interface Internals {
  conversations: Map<string, { session: AgentSession }>;
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-context-limit-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "alpha");
  await mkdir(agentDir);
  await mkdir(workspace);
  const runtime = new AgentRuntime({ cwd: workspace, agentDir });
  t.after(async () => {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await runtime.addModel({
    providerId: "limit-fixture", providerName: "Limit fixture", modelId: "fixture-model",
    modelName: "Limit fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "synthetic-limit-fixture-key", reasoning: false, contextWindow: 200_000, maxTokens: 4096,
  });
  await runtime.saveAgentSettings({ ...await runtime.getAgentSettings(), provider: "limit-fixture", modelId: "fixture-model", thinkingLevel: "off" });
  await runtime.createConversation(workspace);
  const id = runtime.activeConversationId!;
  const window = (conversationId = id) => (runtime as unknown as Internals).conversations.get(conversationId)!.session.model!.contextWindow;
  return { runtime, id, window, agentDir, workspace };
}

describe("AgentRuntime 对话上下文上限", { timeout: 30_000 }, () => {
  it("对话自己的上限只收窄该对话的窗口，可恢复沿用全局，并随对话保存", async (t) => {
    const f = await fixture(t);
    const other = await f.runtime.createConversation(f.workspace).then(() => f.runtime.activeConversationId!);
    assert.notEqual(other, f.id);
    assert.equal(f.window(), 200_000);

    const saved = f.runtime.setConversationContextLimit(f.id, { limitTokens: 64_000 });
    assert.deepEqual(saved.override, { limitTokens: 64_000 });
    assert.deepEqual(saved.effective, { limitTokens: 64_000 });
    assert.equal(f.window(), 64_000);
    assert.equal(f.window(other), 200_000);
    assert.equal(f.runtime.getConversationContextLimit(other).override, null);

    const usage = f.runtime.getUsage(f.id);
    assert.equal(usage.contextWindow, 64_000);
    assert.equal(usage.modelContextWindow, 200_000);
    assert.equal(usage.contextLimit, 64_000);
    // 预留空间随上限缩小：64,000 的 25% 为 16,000，小于默认的 16,384。
    assert.equal(usage.compactAt, 64_000 - 16_000);
    assert.equal(f.runtime.getUsage(other).compactAt, 200_000 - 16_384);

    assert.throws(() => f.runtime.setConversationContextLimit(f.id, { limitTokens: 1000 }), /超出范围/);
    assert.throws(() => f.runtime.setConversationContextLimit("missing", null), /对话不存在/);
    assert.equal(f.window(), 64_000);

    await f.runtime.dispose();
    const restored = new AgentRuntime({ cwd: f.workspace, agentDir: f.agentDir });
    t.after(() => restored.dispose());
    await restored.switchConversation(f.id);
    assert.deepEqual(restored.getConversationContextLimit(f.id).override, { limitTokens: 64_000 });
    assert.equal(restored.getUsage(f.id).contextWindow, 64_000);

    assert.equal(restored.setConversationContextLimit(f.id, null).override, null);
    assert.equal(restored.getUsage(f.id).contextWindow, 200_000);
  });

  it("全局上限作为默认值，对话自定义优先，改动立即作用于已打开的对话", async (t) => {
    const f = await fixture(t);
    f.runtime.setContextLimit({ limitTokens: 128_000 });
    assert.equal(f.window(), 128_000);
    assert.equal(f.runtime.getConversationContextLimit(f.id).effective.limitTokens, 128_000);

    f.runtime.setConversationContextLimit(f.id, { limitTokens: null });
    assert.equal(f.window(), 200_000);

    f.runtime.setConversationContextLimit(f.id, null);
    f.runtime.setContextLimit({ limitTokens: null });
    assert.equal(f.window(), 200_000);
    assert.equal(f.runtime.getUsage(f.id).contextLimit, null);
  });
});
