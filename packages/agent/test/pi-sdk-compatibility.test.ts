import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, getCurrentSystemMessage, getCurrentTools, getSystemMessageText, type AssistantMessage, type Context, type ToolCall } from "@earendil-works/pi-ai";
import type { SystemPromptProfile } from "@vela/shared";
import { AgentRuntime, type RuntimeEvent } from "../src/runtime.ts";
import { TraceRecorder } from "../src/trace.ts";
import { ModelDirectory } from "../src/model-directory.ts";
import type { AgentSessionRequest } from "../src/agent-control.ts";
import { SandboxPermissionManager } from "../../workspace/src/sandbox-permission-manager.ts";
import { createSandboxedToolDefinitions } from "../../workspace/src/sandbox-tools.ts";

async function fixture(t: TestContext, systemPromptProfile?: SystemPromptProfile) {
  const root = await mkdtemp(join(tmpdir(), "vela-pi-sdk-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(join(agentDir, "extensions", "input.js"), `export default pi => {
    pi.on("input", event => {
      if (event.text === "consume") return { action: "handled" };
      if (event.text === "transform") return { action: "transform", text: "transformed input" };
      return { action: "continue" };
    });
  };`);
  const permission = new SandboxPermissionManager(join(root, "permissions.json"));
  await permission.setMode("ask");
  const runtime = new AgentRuntime({ cwd, agentDir, systemPromptProfile,
    toolFactory: cwd => createSandboxedToolDefinitions({ cwd, workspace: cwd, permission }) });
  const approvalIds: string[] = [];
  permission.subscribe(event => { if (event.type === "request") approvalIds.push(event.request.id); });
  t.after(async () => { for (const id of approvalIds) permission.reply(id, false); runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  await runtime.createConversation(cwd);
  const id = runtime.activeConversationId!;
  // Prevent the independent title service from making a provider request.
  await runtime.renameConversation(id, "SDK compatibility");
  await runtime.addModel({ providerId: "compat-local", providerName: "Compatibility fixture", modelId: "compat-model",
    modelName: "Compatibility fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "synthetic-test-key", reasoning: false, contextWindow: 32768, maxTokens: 4096 });
  const internals = runtime as unknown as {
    conversations: Map<string, { session: AgentSession }>;
    trace(id: string): TraceRecorder;
    createChildSession(entry: unknown, input: AgentSessionRequest): Promise<AgentSession>;
  };
  const session = internals.conversations.get(id)!.session;
  assert.ok(session.extensionRunner.hasHandlers("input"), "fixture input extension must be loaded");
  const events: RuntimeEvent[] = [];
  // The runtime itself counts real tool executions; hosts no longer do.
  runtime.subscribe(event => { events.push(event); });
  const requests: Context[] = [];
  function script(replies: Array<string | ToolCall[]>, target = session) {
    let invocation = 0;
    const stream: StreamFn = (model, context) => {
      requests.push(structuredClone(context));
      const reply = replies[invocation++];
      assert.ok(reply !== undefined, "unexpected extra model request");
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: typeof reply === "string" ? [{ type: "text", text: reply }] : reply,
        stopReason: typeof reply === "string" ? "stop" : "toolUse", timestamp: Date.now(),
        usage: { input: 100, output: 10, cacheRead: 20, cacheWrite: 0, totalTokens: 130,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const output = createAssistantMessageEventStream();
      output.push({ type: "start", partial: message });
      if (typeof reply === "string") output.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: message });
      else reply.forEach((toolCall, contentIndex) => output.push({ type: "toolcall_end", contentIndex, toolCall, partial: message }));
      output.push({ type: "done", reason: message.stopReason === "stop" ? "stop" : "toolUse", message });
      return output;
    };
    target.agent.streamFunction = target === session ? internals.trace(id).wrapStream(stream) : stream;
  }
  const child = (input: AgentSessionRequest) => internals.createChildSession(internals.conversations.get(id), input);
  return { runtime, id, session, events, requests, permission, script, child, root, cwd, agentDir };
}

const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id, name, arguments: args });
const userTexts = (context: Context) => context.messages.filter(message => message.role === "user")
  .map(message => typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.text).join(""));

describe("released Pi SDK compatibility", () => {
  it("preserves real running queues, input dispositions, sandbox denial, Trace and usage", { timeout: 15_000 }, async t => {
    const f = await fixture(t);
    f.script([[call("denied-shell", "bash", { command: "printf should-not-run" })], "steered reply", "follow-up reply"]);
    let approval!: (id: string) => void;
    const requested = new Promise<string>(resolve => { approval = resolve; });
    f.permission.subscribe(event => { if (event.type === "request") approval(event.request.id); });
    const running = f.runtime.prompt(f.id, "start");
    const approvalId = await requested;
    await f.runtime.prompt(f.id, "consume", undefined, "steer");
    await f.runtime.prompt(f.id, "consume", undefined, "queue");
    assert.deepEqual(f.runtime.getSnapshot().pendingInstructions, []);
    await f.runtime.prompt(f.id, "transform", undefined, "steer");
    await f.runtime.prompt(f.id, "after task", undefined, "queue");
    assert.equal(f.runtime.getSnapshot().pendingInstructions.length, 2);
    f.permission.reply(approvalId, false);
    await running;
    assert.equal(f.requests.length, 3);
    assert.ok(userTexts(f.requests[1]!).includes("transformed input"));
    assert.equal(userTexts(f.requests[1]!).includes("after task"), false);
    assert.ok(userTexts(f.requests[2]!).includes("after task"));
    assert.equal(f.events.filter(event => event.type === "user_message").some(event => event.text === "consume"), false);
    assert.equal(f.runtime.getUsage(f.id).messageCount, 3);
    assert.equal(f.runtime.getUsage(f.id).toolCallCount, 1);
    assert.ok((f.runtime.getUsage(f.id).sessionTokens ?? 0) > 0);
    assert.ok(f.runtime.getUsage(f.id).tokens > 0);
    assert.ok(f.events.some(event => event.type === "tool_end" && event.isError));
    const result = f.session.messages.find(message => message.role === "toolResult");
    assert.ok(result?.role === "toolResult" && result.isError);
    assert.match(JSON.stringify(result.content), /用户拒绝/);
    assert.equal(f.runtime.getTrace(f.id).requests.length, 3);
    assert.deepEqual(f.runtime.getSnapshot().pendingInstructions, []);
  });

  it("keeps mode loadouts and blocks Plan mutations before sandbox approval", async t => {
    const f = await fixture(t);
    const forbidden = ["codemode", "generate_image"];
    const registry = f.session.getAllTools().map(tool => tool.name);
    assert.ok(forbidden.every(name => !registry.includes(name)));
    assert.ok(!f.session.getActiveToolNames().includes("tool_search"), "MCP discovery stays inactive without enabled servers");
    const work = ["read", "bash", "edit", "write", "spawn_agent", "send_message", "followup_task", "submit_outcome", "ask_user_question", "show_visual"];
    const memory = ["memory_read", "memory_update"];
    assert.deepEqual(f.session.getActiveToolNames(), [...work, ...memory]);
    await f.runtime.setMode(f.id, "goal");
    assert.deepEqual(f.session.getActiveToolNames(), [...work.filter(name => name !== "ask_user_question" && name !== "submit_outcome" && name !== "show_visual"), "record_goal_validation", "submit_outcome", "update_goal", "show_visual", ...memory]);
    await f.runtime.setMode(f.id, "plan");
    assert.deepEqual(f.session.getActiveToolNames(), ["read", "bash", "ask_user_question", "show_visual", "memory_read"]);
    // Even if a tool was activated externally, the final mode guard must reject it.
    f.session.setActiveToolsByName(["read", "bash", "write", "ask_user_question"]);
    let approvals = 0;
    f.permission.subscribe(event => { if (event.type === "request") { approvals++; f.permission.reply(event.request.id, true); } });
    f.script([[call("plan-write", "write", { path: "forbidden.txt", content: "must not exist" }),
      call("plan-shell", "bash", { command: "touch forbidden-shell.txt" })], "Plan complete"]);
    await f.runtime.prompt(f.id, "plan safely");
    assert.equal(approvals, 0);
    assert.ok(f.session.messages.filter(message => message.role === "toolResult").every(message => message.isError));
    await assert.rejects(readFile(join(f.cwd, "forbidden.txt")), { code: "ENOENT" });
    await assert.rejects(readFile(join(f.cwd, "forbidden-shell.txt")), { code: "ENOENT" });
    await f.runtime.setMode(f.id, "agent");
    assert.deepEqual(f.session.getActiveToolNames(), [...work, ...memory]);
  });

  it("keeps the Codex instructions and declared tools in sync from Run View through Plan approval and Goal completion", async t => {
    const f = await fixture(t, "codex");
    const step = "Review the requested behavior";
    function checkRequest(checklist: "update_plan" | "update_todos" | null) {
      const messages = f.requests.at(-1)!.messages;
      const prompt = getSystemMessageText(getCurrentSystemMessage(messages)!);
      const names = getCurrentTools(messages).map(tool => tool.name);
      assert.match(prompt, /As a coding agent in Vela/);
      for (const tool of ["update_plan", "update_todos"]) {
        assert.equal(names.includes(tool), tool === checklist, tool);
        assert.equal(prompt.includes(tool), tool === checklist, tool);
      }
      return prompt;
    }

    f.runtime.setRunView(true);
    f.script([[call("todo", "update_todos", { todos: [{ step, status: "completed" }] })], "Reviewed."]);
    await f.runtime.prompt(f.id, "Review the requested behavior.");
    assert.match(checkRequest("update_todos"), /2-7 concrete items/);

    await f.runtime.setMode(f.id, "plan");
    f.script(["<proposed_plan>\n# Review\n\nDocument the requested behavior.\n</proposed_plan>"]);
    await f.runtime.prompt(f.id, "Propose a plan.");
    assert.match(checkRequest(null), /<proposed_plan>/);
    assert.doesNotMatch(checkRequest(null), /High-quality plans|no more than 10 lines|Run View/);

    f.script([[call("execute", "update_plan", { plan: [{ step, status: "in_progress" }] })], "Review started."]);
    await f.runtime.executePlan(f.id);
    assert.match(checkRequest("update_plan"), /before your first change/);
    assert.equal(f.runtime.getSnapshot(f.id).executionPlan?.items[0]?.status, "in_progress");

    await f.runtime.setMode(f.id, "goal");
    f.script([
      [call("finish-step", "update_plan", { plan: [{ step, status: "completed" }] })],
      [call("validate", "record_goal_validation", { risk: "low", checks: [], knownIssues: [],
        skipped: ["diff", "test", "build", "typecheck", "regression"].map(category => ({ category, reason: "Text-only review with no file changes." })) })],
      [call("finish-goal", "update_goal", { status: "complete" })],
      "Reviewed.",
    ]);
    await f.runtime.prompt(f.id, "Finish the approved review.");
    assert.match(checkRequest("update_plan"), /must call record_goal_validation/);
    const snapshot = f.runtime.getSnapshot(f.id);
    assert.equal(snapshot.executionPlan?.items[0]?.status, "completed");
    assert.equal(snapshot.goal?.status, "complete");

    f.runtime.setRunView(false);
    await f.runtime.setMode(f.id, "agent");
    f.script(["Done."]);
    await f.runtime.prompt(f.id, "Summarize.");
    assert.doesNotMatch(checkRequest("update_plan"), /Run View/);
  });

  it("preserves approval and error results for a real bash command with a nonzero exit", async t => {
    const f = await fixture(t);
    let approvals = 0;
    f.permission.subscribe(event => { if (event.type === "request") { approvals++; f.permission.reply(event.request.id, true); } });
    f.script([[call("failed-shell", "bash", { command: "printf failure-output; exit 7" })], "failure reported"]);
    await f.runtime.prompt(f.id, "run failing command");
    assert.equal(approvals, 1);
    const ended = f.events.find(event => event.type === "tool_end");
    assert.ok(ended?.type === "tool_end" && ended.isError);
    assert.match(ended.activity.body ?? "", /failure-output/);
    const result = f.session.messages.find(message => message.role === "toolResult");
    assert.ok(result?.role === "toolResult" && result.isError);
    assert.match(JSON.stringify(result.content), /code 7/);
    assert.equal(f.runtime.getUsage(f.id).toolCallCount, 1);
  });

  it("keeps a real explore session read-only and restores its independent history", async t => {
    const f = await fixture(t);
    const input: AgentSessionRequest = { agentId: "explore-fixture", parentId: f.id, parentPath: "/root", parentSession: f.session,
      kind: "explore", name: "fixture", path: "/root/fixture", forkMessages: [], customTools: [] };
    const child = await f.child(input);
    t.after(() => child.dispose());
    assert.equal(child.model?.provider, f.session.model?.provider);
    assert.equal(child.model?.id, f.session.model?.id);
    assert.deepEqual(child.getActiveToolNames(), ["read", "bash", "memory_read"]);
    let approvals = 0;
    f.permission.subscribe(event => { if (event.type === "request") { approvals++; f.permission.reply(event.request.id, true); } });
    f.script([[call("explore-mutation", "bash", { command: "touch explore-forbidden.txt" })], "read-only report"], child);
    await child.prompt("inspect only");
    assert.equal(approvals, 0);
    await assert.rejects(readFile(join(f.cwd, "explore-forbidden.txt")), { code: "ENOENT" });
    assert.ok(child.messages.some(message => message.role === "toolResult" && message.isError));
    const sessionFile = child.sessionManager.getSessionFile();
    assert.ok(sessionFile);
    child.dispose();
    const restored = await f.child({ ...input, sessionFile });
    t.after(() => restored.dispose());
    assert.equal(restored.sessionId, child.sessionId);
    assert.match(JSON.stringify(restored.messages), /read-only report/);
    assert.deepEqual(restored.getActiveToolNames(), ["read", "bash", "memory_read"]);
  });

  it("reopens synthetic legacy API-key and Codex OAuth credentials without changing the selected provider", async t => {
    const root = await mkdtemp(join(tmpdir(), "vela-pi-auth-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const credentials = { anthropic: { type: "api_key", key: "synthetic-legacy-key" },
      "openai-codex": { type: "oauth", access: "synthetic-access", refresh: "synthetic-refresh", expires: Date.now() + 86400000, accountId: "synthetic-account" } };
    const auth = `${JSON.stringify(credentials)}\n`;
    await writeFile(join(root, "auth.json"), auth);
    await writeFile(join(root, "selection.json"), JSON.stringify({ provider: "openai-codex", modelId: "gpt-5.4", thinkingLevel: "medium" }));
    const directory = await ModelDirectory.open(root);
    assert.equal(directory.selection.provider, "openai-codex");
    assert.equal(directory.selection.modelId, "gpt-5.4");
    const stored = await directory.runtime.listCredentials();
    assert.ok(stored.some(item => item.providerId === "anthropic"));
    assert.ok(stored.some(item => item.providerId === "openai-codex"));
    assert.equal(await readFile(join(root, "auth.json"), "utf8"), auth);
    const catalog = await directory.catalog();
    assert.equal(catalog.providers.some(provider => provider.id === "typesafe"), false);
    assert.deepEqual(catalog.providers.find(provider => provider.id === "openai")?.methods.map(method => method.type), ["api_key", "oauth"]);
    assert.ok(catalog.providers.find(provider => provider.id === "openai-codex")?.methods.some(method => method.type === "oauth"));
    assert.equal(await readFile(join(root, "auth.json"), "utf8"), auth);
  });

  it("signs in through OpenAI with a stable Vela identity and keeps the credential after a cancelled reconnect", async t => {
    const root = await mkdtemp(join(tmpdir(), "vela-chatgpt-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    // Exercise Pi's manual redirect flow without reserving the user's OAuth callback port.
    const listen = Server.prototype.listen;
    t.mock.method(Server.prototype, "listen", function (this: Server, _port: number, host: string, ready: () => void) {
      return Reflect.apply(listen, this, [0, host, ready]);
    });
    const exchange = t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(String(url), "https://auth.openai.com/api/accounts/oauth/token");
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("client_id"), "test-client");
      assert.equal(body.get("code"), "test-code");
      return Response.json({ access_token: hostIds.length > 2 ? "second-access" : "test-access", refresh_token: "test-refresh", id_token: "test-id",
        scope: "chatgpt.tokens.use.direct", expires_in: 3600 });
    });
    const hostIds: string[] = [];
    for (const scenario of ["initial", "cancel", "additional"]) {
      const directory = await ModelDirectory.open(root);
      const providerId = scenario === "additional" ? await directory.addProviderAccount("openai") : "openai";
      let redirect: URL;
      directory.subscribeAuth(event => {
        if (event.type === "notice" && event.notice.type === "auth_url") {
          const params = new URL(event.notice.url).searchParams;
          assert.equal(params.get("agent_name_hint"), "Vela");
          const hostId = params.get("ext_agent_host_id") ?? "";
          assert.match(hostId, /^urn:uuid:[0-9a-f-]{36}$/);
          hostIds.push(hostId);
          redirect = new URL(params.get("redirect_uri")!);
          redirect.search = new URLSearchParams({ state: params.get("state")!, code: "test-code", client_id: "test-client" }).toString();
        } else if (event.type === "prompt") {
          directory.replyLogin(event.request.id, scenario === "cancel" ? null : redirect.href);
        }
      });
      assert.equal(await directory.login(providerId, "oauth"), scenario === "cancel" ? "cancelled" : "ok");
      if (scenario === "additional") assert.equal((await directory.runtime.getAuth(providerId))?.auth.apiKey, "second-access");
      assert.equal((await directory.runtime.getAuth("openai"))?.auth.apiKey, "test-access");
    }
    assert.equal(exchange.mock.callCount(), 2);
    assert.equal(hostIds.length, 3);
    assert.equal(new Set(hostIds).size, 1);
  });
});
