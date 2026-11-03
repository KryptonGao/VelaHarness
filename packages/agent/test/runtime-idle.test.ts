import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type ToolCall } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { AgentRuntime } from "../src/runtime.ts";
import type { TraceRecorder } from "../src/trace.ts";
import { BackgroundShellManager } from "../../workspace/src/background-shells.ts";
import { SandboxPermissionManager } from "../../workspace/src/sandbox-permission-manager.ts";
import { createSandboxedToolDefinitions } from "../../workspace/src/sandbox-tools.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-idle-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir, { recursive: true });
  const permission = new SandboxPermissionManager(join(root, "permissions.json"));
  const shells = new BackgroundShellManager();
  const runtime = new AgentRuntime({
    cwd,
    agentDir,
    backgroundShells: shells,
    toolFactory: (workdir, { background, ...context } = {}) =>
      createSandboxedToolDefinitions({ cwd: workdir, workspace: workdir, permission, ...context, ...(background ? { background: shells } : {}) }),
  });
  t.after(async () => { await runtime.dispose(); await shells.drain(); shells.dispose(); await rm(root, { recursive: true, force: true }); });
  await runtime.addModel({ providerId: "idle-local", providerName: "Idle fixture", modelId: "idle-model", modelName: "Idle fixture",
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-test-key", reasoning: false, contextWindow: 32768, maxTokens: 4096 });
  const info = await runtime.createRunConversation({ cwd, sandboxMode: "full", model: { provider: "idle-local", id: "idle-model" } });
  const id = info.conversationId;
  const internals = runtime as unknown as {
    conversations: Map<string, { session: AgentSession }>;
    trace(conversationId: string): TraceRecorder;
    queueRootNotice(entry: unknown, notice: { wake: boolean; payload: { customType: string; content: string; display: boolean } }): void;
    deliverRootNotices(entry: unknown, items: unknown[]): Promise<void>;
  };
  const entry = internals.conversations.get(id)!;
  const requests: Context[] = [];
  function script(replies: Array<string | ToolCall[]>) {
    let invocation = 0;
    const stream: StreamFn = (model, context) => {
      requests.push(structuredClone(context));
      const reply = replies[invocation++];
      assert.ok(reply !== undefined, "unexpected extra model request");
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: typeof reply === "string" ? [{ type: "text", text: reply }] : reply,
        stopReason: typeof reply === "string" ? "stop" : "toolUse", timestamp: Date.now(),
        usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const output = createAssistantMessageEventStream();
      output.push({ type: "start", partial: message });
      if (typeof reply === "string") output.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: message });
      else reply.forEach((toolCall, contentIndex) => output.push({ type: "toolcall_end", contentIndex, toolCall, partial: message }));
      output.push({ type: "done", reason: message.stopReason === "stop" ? "stop" : "toolUse", message });
      return output;
    };
    entry.session.agent.streamFunction = internals.trace(id).wrapStream(stream);
  }
  return { runtime, id, info, requests, script, shells, internals, entry, cwd };
}

const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id, name, arguments: args });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("createRunConversation", () => {
  it("creates an inactive background conversation without touching the active workspace or model selection", async (t) => {
    const f = await fixture(t);
    assert.equal(f.runtime.activeConversationId, null);
    assert.deepEqual(f.info.model, { provider: "idle-local", id: "idle-model" });
    // The shared "background execution" marker is not a scheduled-task marker.
    const entry = f.entry as unknown as { backgroundExecution?: boolean; scheduledTaskConversation?: boolean; titleManuallySet: boolean };
    assert.equal(entry.backgroundExecution, true);
    assert.equal(entry.scheduledTaskConversation, undefined);
    assert.equal(entry.titleManuallySet, true);
  });

  it("only offers read access to long-term memory and no recommended actions", async (t) => {
    const f = await fixture(t);
    const tools = f.entry.session.getActiveToolNames();
    assert.ok(!tools.includes("memory_update"));
    assert.ok(!tools.includes("recommend_actions"));
  });

  it("fails on an unavailable model or an unsupported thinking level instead of substituting", async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.runtime.createRunConversation({ cwd: f.cwd, sandboxMode: "ask", model: { provider: "idle-local", id: "nope" } }), { code: "model_unavailable" });
    await assert.rejects(f.runtime.createRunConversation({ cwd: f.cwd, sandboxMode: "ask", model: { provider: "idle-local", id: "idle-model" }, thinkingLevel: "high" }), { code: "thinking_unsupported" });
    await assert.rejects(f.runtime.createRunConversation({ cwd: f.cwd, sandboxMode: "ask" }), { code: "model_unavailable" });
  });
});

describe("waitForIdle", () => {
  it("returns right after the turn when nothing else is running", async (t) => {
    const f = await fixture(t);
    f.script(["Plain answer."]);
    await f.runtime.prompt(f.id, "hello");
    await f.runtime.waitForIdle(f.id);
    assert.equal(f.runtime.getRunReport(f.id).finalText, "Plain answer.");
  });

  it("waits for a background command and the main agent's follow-up reply when asked to", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    f.script([[call("start", "bash", { command: "sleep 0.8; echo build-ok", run_in_background: true })], "Started it.", "The build finished."]);
    await f.runtime.prompt(f.id, "run the build in the background");
    const started = Date.now();
    await f.runtime.waitForIdle(f.id, { includeBackgroundShells: true });
    assert.ok(Date.now() - started >= 500, "must have waited for the command");
    assert.equal(f.requests.length, 3, "the wake-up turn must have run before idle");
    assert.equal(f.runtime.getRunReport(f.id).finalText, "The build finished.");
    assert.equal(f.shells.list(f.id)[0]?.status, "exited");
  });

  it("merges commands that finish close together into one wake-up turn and waits for it", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    f.script([
      [call("a", "bash", { command: "sleep 0.3; echo first-done", run_in_background: true }),
        call("b", "bash", { command: "sleep 0.5; echo second-done", run_in_background: true })],
      "Started both.",
      "Both finished.",
    ]);
    await f.runtime.prompt(f.id, "run two commands in the background");
    await f.runtime.waitForIdle(f.id, { includeBackgroundShells: true });
    assert.equal(f.requests.length, 3, "exactly one wake-up turn, and it ran before idle");
    const woken = JSON.stringify(f.requests[2]!.messages);
    assert.match(woken, /first-done/);
    assert.match(woken, /second-done/);
    await sleep(800);
    assert.equal(f.requests.length, 3, "no extra turn after idle");
  });

  it("does not wait for background commands unless asked", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    f.script([[call("start", "bash", { command: "sleep 5", run_in_background: true })], "Started it."]);
    await f.runtime.prompt(f.id, "start a server");
    const started = Date.now();
    await f.runtime.waitForIdle(f.id);
    assert.ok(Date.now() - started < 2000);
    assert.equal(f.shells.list(f.id)[0]?.status, "running");
  });

  it("stays pending while a root notice is queued and while its delivery is in flight", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    f.script(["Idle now."]);
    await f.runtime.prompt(f.id, "hello");
    // Hold the delivery open so the gap between "removed from the notice table" and "main agent started" is observable.
    let releaseDelivery!: () => void;
    const held = new Promise<void>(resolve => { releaseDelivery = resolve; });
    f.internals.deliverRootNotices = async () => { await held; };
    f.internals.queueRootNotice(f.entry, { wake: false, payload: { customType: "vela_test", content: "note", display: false } });
    let idle = false;
    const waiting = f.runtime.waitForIdle(f.id).then(() => { idle = true; });
    await sleep(1500);
    assert.equal(idle, false, "queued / in-flight notice must keep the conversation busy");
    releaseDelivery();
    await waiting;
    assert.equal(idle, true);
  });

  it("is cancellable and fails when the runtime is closed", async (t) => {
    const f = await fixture(t);
    f.script(["ok"]);
    await f.runtime.prompt(f.id, "hello");
    f.internals.queueRootNotice(f.entry, { wake: false, payload: { customType: "vela_test", content: "note", display: false } });
    f.internals.deliverRootNotices = () => new Promise(() => undefined);
    const controller = new AbortController();
    const cancelled = f.runtime.waitForIdle(f.id, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(cancelled, /已取消/);
    const closed = f.runtime.waitForIdle(f.id);
    setTimeout(() => { void f.runtime.dispose(); }, 100);
    await assert.rejects(closed, /closed|已结束/);
  });
});

describe("runtime lifecycle", () => {
  it("counts each real tool execution exactly once", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    f.script([[call("a", "bash", { command: "echo a" }), call("b", "bash", { command: "echo b" })], "done"]);
    await f.runtime.prompt(f.id, "two commands");
    await f.runtime.waitForIdle(f.id);
    assert.equal(f.runtime.getUsage(f.id).toolCallCount, 2);
  });

  it("dispose is idempotent and returns the same promise", async (t) => {
    const f = await fixture(t);
    const first = f.runtime.dispose();
    const second = f.runtime.dispose();
    assert.equal(first, second);
    await first;
  });

  it("disposing during initialization builds no state afterwards", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "vela-idle-init-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const runtime = new AgentRuntime({ cwd: root, agentDir: join(root, "agent") });
    await runtime.dispose();
    await sleep(100);
    const internals = runtime as unknown as { directory: unknown; conversations: Map<string, unknown> };
    assert.equal(internals.directory, null);
    assert.equal(internals.conversations.size, 0);
  });

  it("persistStrict surfaces a failed write instead of reporting success", async (t) => {
    const f = await fixture(t);
    await f.runtime.persistStrict();
    // Make the conversation index unwritable: a directory occupies its path.
    const { rm: remove, mkdir: makeDir } = await import("node:fs/promises");
    const index = join(f.cwd, "..", "agent", "conversations.json");
    await remove(index, { force: true });
    await makeDir(index);
    f.runtime.addUsage(f.id, 1, 0);
    await assert.rejects(f.runtime.persistStrict());
  });
});
