import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../src/runtime.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-race-lane-"));
  const cwd = join(root, "workspace");
  const laneA = join(root, "lane-a");
  const laneB = join(root, "lane-b");
  for (const dir of [cwd, laneA, laneB]) await mkdir(dir);
  const runtime = new AgentRuntime({ cwd, agentDir: root });
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  await runtime.createConversation(cwd);
  await runtime.addModel({ providerId: "lane-fixture", providerName: "Lane fixture", modelId: "fixture", modelName: "Fixture", api: "openai-completions",
    baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-test-key", reasoning: false, contextWindow: 32768, maxTokens: 4096 });
  await runtime.saveAgentSettings({ ...await runtime.getAgentSettings(), provider: "lane-fixture", modelId: "fixture", thinkingLevel: "off" });
  const chats = (runtime as unknown as { conversations: Map<string, { session: AgentSession }> }).conversations;
  const session = (id: string) => chats.get(id)!.session;
  return { runtime, root, cwd, laneA, laneB, session };
}

function reply(session: AgentSession, text: string, onStart?: () => void) {
  session.agent.streamFunction = (model) => {
    onStart?.();
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now(),
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const output = createAssistantMessageEventStream();
    output.push({ type: "start", partial: message });
    output.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
    output.push({ type: "done", reason: "stop", message });
    return output;
  };
}

/** 赛道对话由 runLane 内部创建，测试在第一次 prompt 时给它的会话装上脚本。 */
function script(f: Awaited<ReturnType<typeof fixture>>, behave: (id: string, session: AgentSession) => void) {
  const actual = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = async (id, text, ...rest) => { behave(id, f.session(id)); await actual(id, text, ...rest); };
}

const request = (cwd: string, extra: Partial<Parameters<AgentRuntime["runLane"]>[0]> = {}) => ({
  conversationId: randomUUID(), cwd, title: "赛马 · fast", prompt: "Make the change",
  execution: { model: { provider: "lane-fixture", id: "fixture" }, thinkingLevel: "off" as const, sandboxMode: "smart" as const }, ...extra,
});

it("runLane 在指定 cwd 开一个独立的后台对话，不切换当前对话与工作区", async t => {
  const f = await fixture(t);
  const active = f.runtime.activeConversationId!;
  script(f, (_id, session) => reply(session, "lane done"));
  const lane = request(f.laneA);
  const result = await f.runtime.runLane(lane);
  assert.deepEqual(result, { status: "responded" });
  assert.equal(f.runtime.activeConversationId, active);
  assert.equal(f.runtime.getSnapshot().cwd, f.cwd);
  const info = f.runtime.listConversations().find(chat => chat.id === lane.conversationId);
  assert.equal(info?.cwd, f.laneA);
  assert.equal(info?.title, "赛马 · fast");
  assert.ok(f.runtime.getMessages(lane.conversationId).some(message => message.role === "user" && message.text === "Make the change"));
  const stats = f.runtime.getLaneStats(lane.conversationId);
  assert.equal(stats?.total, 15);
  assert.equal(stats?.input, 10);
  assert.equal(stats?.output, 5);
});

it("两条赛道并行运行，各自独立统计", async t => {
  const f = await fixture(t);
  let concurrent = 0;
  let peak = 0;
  script(f, (_id, session) => reply(session, "ok", () => { concurrent++; peak = Math.max(peak, concurrent); setTimeout(() => { concurrent--; }, 150); }));
  const a = request(f.laneA, { title: "赛马 · a" });
  const b = request(f.laneB, { title: "赛马 · b" });
  const [first, second] = await Promise.all([f.runtime.runLane(a), f.runtime.runLane(b)]);
  assert.equal(first.status, "responded");
  assert.equal(second.status, "responded");
  assert.equal(f.runtime.listConversations().find(chat => chat.id === a.conversationId)?.cwd, f.laneA);
  assert.equal(f.runtime.listConversations().find(chat => chat.id === b.conversationId)?.cwd, f.laneB);
  assert.equal(f.runtime.getLaneStats(a.conversationId)?.total, 15);
  assert.equal(f.runtime.getLaneStats(b.conversationId)?.total, 15);
});

it("模型调用失败时返回 failed 与错误信息，而不是抛出", async t => {
  const f = await fixture(t);
  script(f, (_id, session) => { session.agent.streamFunction = () => { throw new Error("Scripted provider failure"); }; });
  const result = await f.runtime.runLane(request(f.laneA));
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /Scripted provider failure/);
});

it("abort 一条正在运行的赛道得到 stopped，且不影响当前对话", async t => {
  const f = await fixture(t);
  const active = f.runtime.activeConversationId!;
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  script(f, (_id, session) => {
    session.agent.streamFunction = (_model, _context, options) => {
      started();
      const output = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: "assistant", api: _model.api, provider: _model.provider, model: _model.id,
        content: [], stopReason: "aborted", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      output.push({ type: "start", partial: message });
      options?.signal?.addEventListener("abort", () => output.push({ type: "error", reason: "aborted", error: message }));
      return output;
    };
  });
  const lane = request(f.laneA);
  const pending = f.runtime.runLane(lane);
  await running;
  await f.runtime.abort(lane.conversationId);
  const result = await pending;
  assert.equal(result.status, "stopped");
  assert.equal(f.runtime.activeConversationId, active);
});

it("预留的对话 ID 已被占用时拒绝，不会覆盖已有对话", async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.runtime.runLane(request(f.laneA, { conversationId: f.runtime.activeConversationId! })), /已被占用/);
});

it("getLaneStats 对不存在的对话返回 null", async t => {
  const f = await fixture(t);
  assert.equal(f.runtime.getLaneStats("missing"), null);
});
