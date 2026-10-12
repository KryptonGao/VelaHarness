import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { AgentRuntime } from "../src/runtime.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-resident-runtime-"));
  const cwd = join(root, "workspace"), residentDir = join(root, "resident");
  await mkdir(cwd); await mkdir(residentDir);
  const runtime = new AgentRuntime({
    cwd, agentDir: root,
    resident: { conversationId: () => null, host: { workspaces: () => [], tasks: () => [], inbox: () => [], delegate: async () => ({ ok: false as const, reason: "unused" }) } },
  });
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  await runtime.createConversation(cwd);
  for (const [modelId, reasoning] of [["plain", false], ["reasoner", true]] as const) {
    await runtime.addModel({ providerId: "resident-fixture", providerName: "Fixture", modelId, modelName: modelId, api: "openai-completions",
      baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-test-key", reasoning, contextWindow: 32768, maxTokens: 4096 });
  }
  await runtime.saveAgentSettings({ ...await runtime.getAgentSettings(), provider: "resident-fixture", modelId: "plain", thinkingLevel: "off" });
  const chats = (runtime as unknown as { conversations: Map<string, { session: AgentSession }> }).conversations;
  return { runtime, residentDir, session: (id: string) => chats.get(id)!.session };
}

it("starts the resident chat on the chosen model and effort, leaving the app defaults alone", async t => {
  const f = await fixture(t);
  const defaults = await f.runtime.getAgentSettings();
  const id = await f.runtime.ensureResidentConversation(f.residentDir, null, { model: { provider: "resident-fixture", id: "reasoner" }, thinkingLevel: "high" });
  assert.equal(f.session(id).model?.id, "reasoner");
  assert.equal(f.session(id).thinkingLevel, "high");
  assert.deepEqual(await f.runtime.getAgentSettings(), defaults);
  assert.equal(f.runtime.getConversationInfo(id)?.model?.includes("reasoner"), true);
});

it("follows the app defaults when nothing is chosen, and clamps an effort the model cannot do", async t => {
  const f = await fixture(t);
  const id = await f.runtime.ensureResidentConversation(f.residentDir, null);
  assert.equal(f.session(id).model?.id, "plain");
  await f.runtime.configureBackground(id, { model: { provider: "resident-fixture", id: "plain" }, thinkingLevel: "xhigh" });
  assert.equal(f.session(id).thinkingLevel, "off", "a model without reasoning stays off");
});

it("switches an idle resident chat immediately and defers the change while it is replying", async t => {
  const f = await fixture(t);
  const id = await f.runtime.ensureResidentConversation(f.residentDir, null, { model: { provider: "resident-fixture", id: "plain" }, thinkingLevel: null });
  await f.runtime.configureBackground(id, { model: { provider: "resident-fixture", id: "reasoner" }, thinkingLevel: "medium" });
  assert.deepEqual([f.session(id).model?.id, f.session(id).thinkingLevel], ["reasoner", "medium"]);
  Object.defineProperty(f.session(id), "isStreaming", { value: true, configurable: true });
  await f.runtime.configureBackground(id, { model: { provider: "resident-fixture", id: "plain" }, thinkingLevel: null });
  assert.equal(f.session(id).model?.id, "reasoner", "a reply in progress is never switched mid-stream");
  Object.defineProperty(f.session(id), "isStreaming", { value: false, configurable: true });
  await f.runtime.ensureResidentConversation(f.residentDir, id, { model: { provider: "resident-fixture", id: "plain" }, thinkingLevel: null });
  assert.equal(f.session(id).model?.id, "plain", "the next start picks the saved choice up");
});

it("reports an unavailable chosen model instead of silently using another", async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.ensureResidentConversation(f.residentDir, null, { model: { provider: "missing", id: "gone" } }));
});
