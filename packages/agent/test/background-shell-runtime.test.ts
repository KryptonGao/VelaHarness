import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type ToolCall } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { AgentRuntime } from "../src/runtime.ts";
import { ToolLoadout } from "../src/runtime-tools.ts";
import type { TraceRecorder } from "../src/trace.ts";
import { BackgroundShellManager } from "../../workspace/src/background-shells.ts";
import { SandboxPermissionManager } from "../../workspace/src/sandbox-permission-manager.ts";
import { createSandboxedToolDefinitions } from "../../workspace/src/sandbox-tools.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-bg-runtime-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir, { recursive: true });
  const permission = new SandboxPermissionManager(join(root, "permissions.json"));
  await permission.setMode("full");
  const shells = new BackgroundShellManager();
  const runtime = new AgentRuntime({
    cwd,
    agentDir,
    backgroundShells: shells,
    toolFactory: (workdir, { background, ...context } = {}) =>
      createSandboxedToolDefinitions({ cwd: workdir, workspace: workdir, permission, ...context, ...(background ? { background: shells } : {}) }),
  });
  t.after(async () => { shells.dispose(); await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  await runtime.createConversation(cwd);
  const id = runtime.activeConversationId!;
  await runtime.renameConversation(id, "Background shells");
  await runtime.addModel({ providerId: "bg-local", providerName: "Background fixture", modelId: "bg-model", modelName: "Background fixture",
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-test-key", reasoning: false, contextWindow: 32768, maxTokens: 4096 });
  const internals = runtime as unknown as {
    conversations: Map<string, { session: AgentSession }>;
    trace(conversationId: string): TraceRecorder;
  };
  const session = internals.conversations.get(id)!.session;
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
    session.agent.streamFunction = internals.trace(id).wrapStream(stream);
  }
  return { runtime, id, session, requests, script, shells };
}

const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id, name, arguments: args });
const until = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const text = (context: Context): string => JSON.stringify(context.messages);

describe("background shells in the agent runtime", () => {
  it("lets the turn finish while the command runs, then wakes the agent with its result", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    assert.ok(f.session.getActiveToolNames().includes("bash_output"));
    assert.ok(f.session.getActiveToolNames().includes("bash_kill"));
    f.script([[call("start", "bash", { command: "sleep 0.5; echo build-ok", run_in_background: true })], "Started it; carrying on.", "The build finished."]);
    const started = Date.now();
    await f.runtime.prompt(f.id, "run the build in the background");
    // 回合在命令结束前就结束了：主代理没有被命令阻塞。
    assert.ok(Date.now() - started < 450, "turn must not wait for the command");
    assert.equal(f.requests.length, 2);
    assert.match(text(f.requests[1]!), /Started background shell bg-\d+/);
    await until(() => f.requests.length === 3, "wake-up turn");
    assert.match(text(f.requests[2]!), /Background shell bg-\d+ exited with code 0/);
    assert.match(text(f.requests[2]!), /build-ok/);
    // 等唤醒的这一轮写完会话文件再收尾，否则清理临时目录会和它抢。
    await until(() => f.runtime.getSnapshot().status === "ready", "wake-up turn to settle");
  });

  it("records a clean exit with no unread output without waking the agent", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    f.script([[call("start", "bash", { command: "sleep 0.3", run_in_background: true })], "Started it."]);
    await f.runtime.prompt(f.id, "run a quiet command in the background");
    assert.equal(f.requests.length, 2);
    await until(() => f.shells.list(f.id)[0]?.status === "exited", "command exit");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(f.requests.length, 2);
  });

  it("wakes the agent once for commands that finish close together", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    f.script([
      [call("a", "bash", { command: "sleep 0.3; echo first-done", run_in_background: true }),
        call("b", "bash", { command: "sleep 0.4; echo second-done", run_in_background: true })],
      "Started both.",
      "Both finished.",
    ]);
    await f.runtime.prompt(f.id, "run two commands in the background");
    await until(() => f.requests.length === 3, "single wake-up turn");
    const woken = text(f.requests[2]!);
    assert.match(woken, /first-done/);
    assert.match(woken, /second-done/);
    await until(() => f.runtime.getSnapshot().status === "ready", "wake-up turn to settle");
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(f.requests.length, 3);
  });

  it("does not wake the agent for a command it stopped itself",{ timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    f.script([
      [call("start", "bash", { command: "sleep 30", run_in_background: true })],
      [call("stop", "bash_kill", { shell_id: "bg-1" })],
      "Stopped it.",
    ]);
    await f.runtime.prompt(f.id, "start and stop a server");
    assert.equal(f.requests.length, 3);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(f.requests.length, 3);
    assert.equal(f.shells.list(f.id)[0]!.status, "killed");
  });
});

describe("background shell tool policy", () => {
  const loadout = (background: boolean) => new ToolLoadout({ scheduledTasks: false, browser: false, background, memoryEnabled: () => false });

  it("activates bash_output and bash_kill outside Plan mode only when background shells exist", () => {
    assert.ok(loadout(true).native("agent", false).includes("bash_output"));
    assert.ok(loadout(true).native("goal", false).includes("bash_kill"));
    assert.equal(loadout(true).native("plan", false).includes("bash_output"), false);
    assert.equal(loadout(false).native("agent", false).includes("bash_output"), false);
    assert.ok(loadout(true).registered().includes("bash_output"));
    assert.equal(loadout(false).registered().includes("bash_kill"), false);
  });

  it("keeps background commands out of Plan mode and subagents", () => {
    const tools = loadout(true);
    const entry = { snapshot: { mode: "plan" as const, executionPlan: null } };
    assert.equal(tools.authorize({ mode: "plan", toolName: "bash", input: { command: "ls", run_in_background: true } }, entry).allowed, false);
    assert.equal(tools.authorize({ mode: "plan", toolName: "bash", input: { command: "ls" } }, entry).allowed, true);
    assert.equal(tools.child("general").includes("bash_output"), false);
  });
});
