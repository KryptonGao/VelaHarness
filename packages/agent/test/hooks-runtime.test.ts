import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type ToolCall } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { AgentRuntime } from "../src/runtime.ts";
import { SandboxPermissionManager } from "../../workspace/src/sandbox-permission-manager.ts";
import { createSandboxedToolDefinitions } from "../../workspace/src/sandbox-tools.ts";
import type { HookDefinition } from "../../shared/src/hooks.ts";
import type { AgentControl, AgentSessionRequest } from "../src/agent-control.ts";

async function fixture(t: TestContext, mode: "agent" | "plan" = "agent") {
  const root = await mkdtemp(join(tmpdir(), "vela-hooks-runtime-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const permission = new SandboxPermissionManager(join(root, "permissions.json"));
  const runtime = new AgentRuntime({ cwd, agentDir: join(root, "agent"), toolFactory: (cwd, context) => createSandboxedToolDefinitions({ cwd, workspace: cwd, permission, ...context }) });
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  await runtime.addModel({ providerId: "hook-local", providerName: "Hook fixture", modelId: "hook-model", modelName: "Hook fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "test", reasoning: false, contextWindow: 32768, maxTokens: 4096 });
  const { conversationId: id } = await runtime.createRunConversation({ cwd, mode, sandboxMode: "full", model: { provider: "hook-local", id: "hook-model" } });
  const entry = (runtime as unknown as { conversations: Map<string, { session: AgentSession }> }).conversations.get(id)!;
  const requests: Context[] = [];
  let replies: (string | ToolCall[])[] = [];
  const stream: StreamFn = (model, context, options) => {
    if (options?.signal?.aborted) {
      const output = createAssistantMessageEventStream();
      output.push({ type: "error", reason: "aborted", error: { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], stopReason: "aborted", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
      return output;
    }
    requests.push(structuredClone(context));
    const reply = replies.shift(); assert.notEqual(reply, undefined, "unexpected extra model request");
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: typeof reply === "string" ? [{ type: "text", text: reply }] : reply!, stopReason: typeof reply === "string" ? "stop" : "toolUse", timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const output = createAssistantMessageEventStream();
    output.push({ type: "start", partial: message });
    output.push({ type: "done", reason: message.stopReason === "stop" ? "stop" : "toolUse", message });
    return output;
  };
  entry.session.agent.streamFunction = stream;
  function configure(hooks: HookDefinition[]) {
    const document = runtime.getHooksCatalog({ cwd }).documents[1]!;
    const saved = runtime.saveHooksConfig({ cwd, scope: "project", expectedDigest: document.digest, config: { version: 1, hooks } });
    runtime.setHooksTrust({ cwd, scope: "project", digest: saved.documents[1]!.digest, trusted: true });
  }
  return { runtime, id, cwd, entry, requests, configure, script: (items: typeof replies) => { replies = items; } };
}
const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id, name, arguments: args });
const hook = (event: HookDefinition["event"], command: string): HookDefinition => ({ id: event, event, command });

describe("lifecycle hooks in the real runtime", () => {
  it("awaits SessionStart, PreToolUse and PostToolUse; injects data and persists metadata to traces", async t => {
    const f = await fixture(t);
    f.configure([hook("SessionStart", "printf '{\"additionalContext\":\"startup-context\"}'"), hook("PreToolUse", "printf '{\"additionalContext\":\"before-context\"}'"),
      hook("PostToolUse", "printf '{\"additionalContext\":\"after-context\"}'"), hook("Stop", "true")]);
    f.script([[call("write", "write", { path: "result.txt", content: "ok" })], "Done."]);
    await f.runtime.prompt(f.id, "write result");
    assert.equal(await readFile(join(f.cwd, "result.txt"), "utf8"), "ok");
    assert.match(JSON.stringify(f.requests[0]), /startup-context/);
    assert.match(JSON.stringify(f.requests[1]), /after-context/);
    assert.match(JSON.stringify(f.requests[1]), /before-context/);
    const records = f.runtime.getHooksCatalog({ cwd: f.cwd }).history;
    assert.deepEqual(records.map(r => r.event), ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]);
    assert.ok(records.every(r => r.status === "allowed"));
    const trace = f.runtime.getTrace(f.id);
    assert.ok(trace.nodes.some(n => n.kind === "state" && n.summary.includes("Hook")));
    f.script(["Again."]); await f.runtime.prompt(f.id, "again");
    assert.equal(f.runtime.getHooksCatalog({ cwd: f.cwd }).history.filter(r => r.event === "SessionStart").length, 1);
  });
  it("denies tools before effects and leaves the model an actionable tool result", async t => {
    const f = await fixture(t);
    f.configure([hook("PreToolUse", "printf '{\"decision\":\"deny\",\"reason\":\"write forbidden\"}'")]);
    f.script([[call("write", "write", { path: "blocked.txt", content: "no" })], "Blocked."]);
    await f.runtime.prompt(f.id, "write");
    await assert.rejects(readFile(join(f.cwd, "blocked.txt")));
    assert.match(JSON.stringify(f.requests[1]), /write forbidden/);
  });
  it("prevents model startup on SessionStart denial and can retry after configuration repair", async t => {
    const f = await fixture(t);
    f.configure([hook("SessionStart", "exit 1")]);
    f.script(["Should not run."]);
    await f.runtime.prompt(f.id, "hello");
    assert.equal(f.requests.length, 0);
    assert.match(f.runtime.getSnapshot(f.id).error ?? "", /SessionStart/);
    f.configure([hook("SessionStart", "true")]);
    f.script(["Ready."]); await f.runtime.prompt(f.id, "retry");
    assert.equal(f.requests.length, 1); assert.equal(f.runtime.getSnapshot(f.id).error, null);
  });
  it("allows at most two Stop continuations, then reports failure rather than looping forever", async t => {
    const f = await fixture(t);
    f.configure([hook("Stop", "printf '{\"decision\":\"deny\",\"reason\":\"test first\"}'")]);
    f.script(["First.", "Second.", "Third."]);
    await f.runtime.prompt(f.id, "finish");
    assert.equal(f.requests.length, 3);
    assert.match(JSON.stringify(f.requests[1]), /test first/);
    assert.match(f.runtime.getSnapshot(f.id).error ?? "", /two continuations/);
  });
  it("supplies final response text to Stop and accepts a successful repair", async t => {
    const f = await fixture(t);
    f.configure([hook("Stop", "node -e 'let s=\"\";process.stdin.on(\"data\",c=>s+=c);process.stdin.on(\"end\",()=>console.log(JSON.stringify({decision:JSON.parse(s).response===\"Fixed.\"?\"allow\":\"deny\",reason:\"repair needed\"})))'")]);
    f.script(["Not yet.", "Fixed."]); await f.runtime.prompt(f.id, "finish");
    assert.equal(f.requests.length, 2);
    assert.equal(f.runtime.getSnapshot(f.id).error, null);
    assert.deepEqual(f.runtime.getHooksCatalog({ cwd: f.cwd }).history.map(r => r.status), ["denied", "allowed"]);
  });
  it("reports a blocking hook execution error instead of a successful prompt end", async t => {
    const f = await fixture(t);
    f.configure([hook("PreToolUse", "exit 2")]);
    const endings: string[] = [];
    f.runtime.subscribe(event => { if (event.type === "prompt_end") endings.push(event.status); });
    f.script([[call("write", "write", { path: "blocked", content: "no" })]]);
    await f.runtime.prompt(f.id, "write");
    assert.deepEqual(endings, ["failed"]);
    await assert.rejects(readFile(join(f.cwd, "blocked")));
  });
  it("installs hooks for general subagents but never executes native commands for explore", async t => {
    for (const kind of ["general", "explore"] as const) {
      const f = await fixture(t);
      f.configure([hook("SessionStart", "touch child-hook"), hook("PreToolUse", "touch child-hook"), hook("Stop", "touch child-hook")]);
      const internals = f.runtime as unknown as { createChildSession(entry: unknown, input: AgentSessionRequest): Promise<AgentSession> };
      const child = await internals.createChildSession(f.entry, { agentId: `child-${kind}`, parentId: "root", parentPath: "/root", parentSession: f.entry.session,
        kind, name: "child", path: `/root/${kind}`, forkMessages: [], customTools: [] });
      child.agent.streamFunction = f.entry.session.agent.streamFunction;
      f.script([[call("read", "read", { path: "missing.txt" })], "Child finished."]);
      await child.prompt("inspect");
      if (kind === "general") {
        assert.equal(await readFile(join(f.cwd, "child-hook"), "utf8"), "");
        assert.ok(f.runtime.getHooksCatalog({ cwd: f.cwd }).history.every(r => r.agentId === "child-general" && r.status === "allowed"));
      } else {
        await assert.rejects(readFile(join(f.cwd, "child-hook")));
        assert.ok(f.runtime.getHooksCatalog({ cwd: f.cwd }).history.every(r => r.code === "restricted"));
      }
    }
  });
  it("PostToolUse failures are observational and cannot erase a successful tool effect", async t => {
    const f = await fixture(t);
    f.configure([hook("PostToolUse", "exit 1")]);
    f.script([[call("write", "write", { path: "kept.txt", content: "kept" })], "The hook failed after writing."]);
    await f.runtime.prompt(f.id, "write");
    assert.equal(await readFile(join(f.cwd, "kept.txt"), "utf8"), "kept");
    assert.match(JSON.stringify(f.requests[1]), /PostToolUse hook did not pass/);
  });
  it("does not execute trusted native hooks in Plan", async t => {
    const f = await fixture(t, "plan");
    f.configure([hook("SessionStart", "touch forbidden"), hook("PreToolUse", "touch forbidden"), hook("Stop", "touch forbidden")]);
    f.script([[call("read", "read", { path: "missing.txt" })], "Read only."]);
    await f.runtime.prompt(f.id, "inspect");
    await assert.rejects(readFile(join(f.cwd, "forbidden")));
    assert.ok(f.runtime.getHooksCatalog({ cwd: f.cwd }).history.every(r => r.code === "restricted"));
  });
  it("cancels an in-flight hook when the user stops the conversation", async t => {
    const f = await fixture(t);
    f.configure([hook("SessionStart", "sleep 20; touch forbidden")]);
    f.script(["Should not run."]);
    const pending = f.runtime.prompt(f.id, "hello");
    const deadline = Date.now() + 3000;
    while (!f.runtime.getHooksCatalog({ cwd: f.cwd }).history.some(r => r.status === "running")) {
      assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 10));
    }
    await f.runtime.abort(f.id); await pending;
    assert.equal(f.requests.length, 0);
    assert.equal(f.runtime.getHooksCatalog({ cwd: f.cwd }).history.at(-1)?.code, "cancelled");
    await assert.rejects(readFile(join(f.cwd, "forbidden")));
  });
  it("cancels child startup hooks even before the SDK has a streaming abort signal", async t => {
    const f = await fixture(t);
    f.configure([hook("SessionStart", "sleep 20; touch leaked-child")]);
    const control = (f.entry as unknown as { control: AgentControl }).control;
    const root = control.list().find(agent => agent.kind === "root")!;
    const child = control.spawn(root.id, { kind: "general", task: "inspect", name: "cancel-startup" });
    const deadline = Date.now() + 3000;
    while (!f.runtime.getHooksCatalog({ cwd: f.cwd }).history.some(run => run.agentId === child.id && run.status === "running")) {
      assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
    }
    control.cancel(child.id);
    while (control.list().find(agent => agent.id === child.id)?.status !== "aborted") {
      assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(f.runtime.getHooksCatalog({ cwd: f.cwd }).history.at(-1)?.code, "cancelled");
    await assert.rejects(readFile(join(f.cwd, "leaked-child")));
  });
  it("dispatches PreCommit before common agent git commit commands", async t => {
    const f = await fixture(t);
    f.configure([hook("PreCommit", "printf '{\"decision\":\"deny\",\"reason\":\"commit blocked\"}'")]);
    f.script([[call("commit", "bash", { command: "git commit -m test" })], "Blocked."]);
    await f.runtime.prompt(f.id, "commit");
    assert.match(JSON.stringify(f.requests[1]), /commit blocked/);
    assert.equal(f.runtime.getHooksCatalog({ cwd: f.cwd }).history.at(-1)?.event, "PreCommit");
  });
});
