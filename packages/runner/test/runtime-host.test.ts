import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { SandboxPermissionManager } from "@vela/workspace";
import { createRuntimeHost } from "../src/index.ts";

interface Internals {
  conversations: Map<string, { session: AgentSession }>;
  trace(conversationId: string): { wrapStream(stream: StreamFn): StreamFn };
}

async function fixture(t: TestContext, sandboxMode: "ask" | "smart" | "full" = "full") {
  const root = await mkdtemp(join(tmpdir(), "vela-host-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const sandbox = new SandboxPermissionManager(join(root, "sandbox.json"));
  const issues: string[] = [];
  const host = createRuntimeHost({ cwd, agentDir: join(root, "agent"), sandbox, onCleanupIssue: message => issues.push(message) });
  t.after(async () => { await host.dispose(); await rm(root, { recursive: true, force: true }); });
  await host.runtime.addModel({ providerId: "host-local", providerName: "Host fixture", modelId: "host-model", modelName: "Host fixture",
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-test-key", reasoning: false, contextWindow: 32768, maxTokens: 4096 });
  const { conversationId: id } = await host.runtime.createRunConversation({ cwd, sandboxMode, model: { provider: "host-local", id: "host-model" } });
  const internals = host.runtime as unknown as Internals;
  const session = internals.conversations.get(id)!.session;
  function script(replies: Array<string | ToolCall[]>) {
    let invocation = 0;
    const stream: StreamFn = (model) => {
      const reply = replies[invocation++];
      assert.ok(reply !== undefined, "unexpected extra model request");
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: typeof reply === "string" ? [{ type: "text", text: reply }] : reply,
        stopReason: typeof reply === "string" ? "stop" : "toolUse", timestamp: Date.now(),
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const output = createAssistantMessageEventStream();
      output.push({ type: "start", partial: message });
      if (typeof reply === "string") output.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: message });
      else reply.forEach((toolCall, contentIndex) => output.push({ type: "toolcall_end", contentIndex, toolCall, partial: message }));
      output.push({ type: "done", reason: message.stopReason === "stop" ? "stop" : "toolUse", message });
      return output;
    };
    session.agent.streamFunction = internals.trace(id).wrapStream(stream);
  }
  return { host, root, cwd, id, session, script, sandbox, issues };
}

const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id, name, arguments: args });
const processAlive = (marker: string): Promise<boolean> => new Promise(resolve => execFile("pgrep", ["-f", marker], error => resolve(!error)));

describe("createRuntimeHost", () => {
  it("exposes one runtime, the background shells and the permission manager", async (t) => {
    const f = await fixture(t);
    assert.ok(f.host.runtime && f.host.backgroundShells && f.host.sandbox === f.sandbox);
    assert.ok(f.session.getActiveToolNames().includes("bash_output"), "background shell tools are wired");
  });

  it("routes bash through the sandbox: ask mode requests approval and a denial stops the command", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t, "ask");
    const requests: string[] = [];
    f.sandbox.subscribe(event => { if (event.type === "request") { requests.push(event.request.command ?? ""); f.sandbox.reply(event.request.id, false); } });
    f.script([[call("deny", "bash", { command: `touch ${join(f.cwd, "denied.txt")}` })], "stopped"]);
    await f.host.runtime.prompt(f.id, "try it");
    await f.host.runtime.waitForIdle(f.id);
    assert.equal(requests.length, 1);
    await assert.rejects(stat(join(f.cwd, "denied.txt")));
    assert.equal(f.host.runtime.getUsage(f.id).toolCallCount, 1);
  });

  it("runs edits inside the workspace without asking in ask mode but asks for paths outside it", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t, "ask");
    const requests: string[] = [];
    f.sandbox.subscribe(event => { if (event.type === "request") { requests.push(event.request.path ?? ""); f.sandbox.reply(event.request.id, false); } });
    const outside = join(f.root, "outside.txt");
    f.script([[call("in", "write", { path: "inside.txt", content: "hi" }), call("out", "write", { path: outside, content: "no" })], "done"]);
    await f.host.runtime.prompt(f.id, "write files");
    await f.host.runtime.waitForIdle(f.id);
    assert.equal(await readFile(join(f.cwd, "inside.txt"), "utf8"), "hi");
    await assert.rejects(stat(outside));
    assert.deepEqual(requests, [outside]);
  });

  it("wires the risk evaluator for smart mode to the runtime", async (t) => {
    const f = await fixture(t, "smart");
    const seen: string[] = [];
    (f.host.runtime as unknown as { evaluateSandboxRisk: (input: { command: string | null }) => Promise<"safe"> }).evaluateSandboxRisk = async (input) => { seen.push(input.command ?? ""); return "safe"; };
    const allowed = await f.sandbox.request({ kind: "bash", command: "echo hi", cwd: f.cwd, workspace: f.cwd, sandboxMode: "smart" });
    assert.equal(allowed, true);
    assert.deepEqual(seen, ["echo hi"]);
  });

  it("dispose is idempotent, ends background commands and waits for them", { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    const token = `25.${process.pid}${Date.now() % 100000}`;
    f.script([[call("bg", "bash", { command: `sleep ${token}`, run_in_background: true })], "started"]);
    await f.host.runtime.prompt(f.id, "start it");
    assert.equal(await processAlive(`sleep ${token}`), true);
    const first = f.host.dispose();
    const second = f.host.dispose();
    assert.equal(first, second);
    await first;
    assert.equal(await processAlive(`sleep ${token}`), false, "dispose must not return before the command is gone");
    assert.deepEqual(f.issues, []);
  });
});

describe("package boundary", () => {
  it("imports no Electron, desktop or renderer code", async () => {
    const dir = new URL("../src/", import.meta.url);
    const forbidden = /from\s+["'](?:electron|[^"']*apps\/desktop[^"']*|[^"']*renderer[^"']*)["']/;
    for (const name of await readdir(dir)) {
      const source = await readFile(new URL(name, dir), "utf8");
      assert.ok(!forbidden.test(source), `${name} must not import desktop code`);
    }
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.ok(!Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).some(name => name.includes("electron") || name === "@vela/desktop"));
  });
});
