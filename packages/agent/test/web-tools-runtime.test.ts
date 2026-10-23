import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type ToolCall } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../src/runtime.ts";
import { MemoryCredentialStore } from "../src/mcp/credentials.ts";
import { selectForkMessages, type AgentSessionRequest } from "../src/agent-control.ts";
import { webFetchToolName, webSearchToolName, webToolsInstructions } from "../src/web-tools.ts";

interface ConversationInternals { session: AgentSession }
interface Internals {
  conversations: Map<string, ConversationInternals>;
  createChildSession(entry: ConversationInternals, input: AgentSessionRequest): Promise<AgentSession>;
}

interface Fixture {
  runtime: AgentRuntime;
  id: string;
  approvals: Array<{ kind: string; command: string }>;
  requests: Array<{ url: string; body: string; authorization: string | undefined }>;
  internals(): Internals;
  session(conversationId?: string): AgentSession;
}

async function fixture(t: TestContext, options: { allow?: boolean } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "vela-web-tools-runtime-"));
  const workspace = join(root, "workspace");
  const agentDir = join(root, "profile");
  await mkdir(workspace);
  await mkdir(agentDir);
  const approvals: Fixture["approvals"] = [];
  const requests: Fixture["requests"] = [];
  const webToolsFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? ""), authorization: (init?.headers as Record<string, string>)?.authorization });
    return new Response(JSON.stringify(url.endsWith("/search")
      ? { results: [{ title: "Vela release", url: "https://example.com/vela", summary: "Vela 1.2 is out" }] }
      : { title: "Vela release", content: "# Vela 1.2\n\nWeb tools are here." }), { status: 200 });
  };
  const runtime = new AgentRuntime({
    cwd: workspace,
    agentDir,
    webToolsCredentialStore: new MemoryCredentialStore(),
    webToolsFetch,
    webPermission: { request: async (input) => { approvals.push({ kind: input.kind, command: input.command }); return options.allow !== false; } },
  });
  t.after(async () => {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await runtime.createConversation(workspace, { hasWorkspace: true });
  const id = runtime.activeConversationId!;
  await runtime.addModel({
    providerId: "web-tools-fixture", providerName: "Web tools fixture", modelId: "fixture-model",
    modelName: "Web tools fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "synthetic-web-tools-key", reasoning: false, contextWindow: 32768, maxTokens: 4096,
  });
  await runtime.saveAgentSettings({
    ...await runtime.getAgentSettings(), provider: "web-tools-fixture", modelId: "fixture-model", thinkingLevel: "off",
  });
  const internals = () => runtime as unknown as Internals;
  return { runtime, id, approvals, requests, internals, session: (conversationId = id) => internals().conversations.get(conversationId)!.session };
}

function scripted(session: AgentSession, replies: Array<string | ToolCall[]>, observe?: (system: string) => void): () => void {
  let index = 0;
  session.agent.streamFunction = (model, context) => {
    observe?.(effectiveSystemText(context as unknown as Context));
    const reply = replies[index++];
    assert.notEqual(reply, undefined, "No real model request may escape the fixture");
    const message: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: typeof reply === "string" ? [{ type: "text", text: reply }] : reply,
      stopReason: typeof reply === "string" ? "stop" : "toolUse", timestamp: Date.now(),
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const output = createAssistantMessageEventStream();
    output.push({ type: "start", partial: message });
    if (typeof reply === "string") output.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: message });
    else reply.forEach((toolCall, contentIndex) => output.push({ type: "toolcall_end", contentIndex, toolCall, partial: message }));
    output.push({ type: "done", reason: typeof reply === "string" ? "stop" : "toolUse", message });
    return output;
  };
  return () => assert.equal(index, replies.length, "the scripted model must consume exactly its fixture replies");
}

function effectiveSystemText(context: Context): string {
  let content = "";
  const sections = new Map<string, string>();
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    if (typeof message.content === "string") content = content ? `${content}\n${message.content}` : message.content;
    else content = [content, ...message.content.map((part) => part.text)].filter((text) => text.length > 0).join("\n");
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  return [content, ...sections.values()].filter((text) => text.length > 0).join("\n");
}

function toolResult(session: AgentSession, toolCallId: string) {
  const message = session.messages.find((value) => value.role === "toolResult" && value.toolCallId === toolCallId);
  assert.ok(message?.role === "toolResult", `missing tool result ${toolCallId}`);
  return message;
}


const enable = (f: Fixture, patch: { search?: boolean; fetch?: boolean; key?: boolean } = {}) => {
  f.runtime.webTools.save({
    enabled: true,
    searchProviderId: patch.search === false ? null : "deepseek",
    fetchProviderId: patch.fetch === false ? null : "deepseek",
    providers: [],
  });
  if (patch.key !== false) f.runtime.webTools.setApiKey("deepseek", "sk-web-runtime-secret");
};
const webNames = (names: string[]) => names.filter((name) => name === webSearchToolName || name === webFetchToolName);

it("web tools stay inactive until a provider and key are configured, and follow settings changes live", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(webNames(f.session().getActiveToolNames()), []);

  f.runtime.webTools.save({ enabled: true, searchProviderId: "deepseek", fetchProviderId: "deepseek", providers: [] });
  assert.deepEqual(webNames(f.session().getActiveToolNames()), [], "no key yet");

  f.runtime.webTools.setApiKey("deepseek", "sk-web-runtime-secret");
  assert.deepEqual(webNames(f.session().getActiveToolNames()).sort(), [webFetchToolName, webSearchToolName]);

  f.runtime.webTools.save({ enabled: true, searchProviderId: "deepseek", fetchProviderId: null, providers: [] });
  assert.deepEqual(webNames(f.session().getActiveToolNames()), [webSearchToolName]);

  f.runtime.webTools.save({ enabled: false, searchProviderId: "deepseek", fetchProviderId: "deepseek", providers: [] });
  assert.deepEqual(webNames(f.session().getActiveToolNames()), []);
});

it("the model can search and fetch through a real session; the key stays out of the transcript", async (t) => {
  const f = await fixture(t);
  enable(f);
  let system = "";
  const check = scripted(f.session(), [
    [{ type: "toolCall", id: "search", name: webSearchToolName, arguments: { query: "Vela release notes", count: 2 } }],
    [{ type: "toolCall", id: "fetch", name: webFetchToolName, arguments: { url: "https://example.com/vela" } }],
    "Vela 1.2 adds web tools.",
  ], (value) => { system = value; });
  await f.runtime.prompt(f.id, "What's new in Vela?");
  check();

  assert.ok(system.includes(webToolsInstructions.split("\n")[0]!), "the system prompt explains the web tools");
  assert.match(system, /untrusted/i);
  const search = toolResult(f.session(), "search");
  assert.equal(search.isError, false);
  assert.match(JSON.stringify(search.content), /Vela 1\.2 is out/);
  const fetched = toolResult(f.session(), "fetch");
  assert.equal(fetched.isError, false);
  assert.match(JSON.stringify(fetched.content), /Web tools are here/);

  assert.deepEqual(f.approvals, [{ kind: "web", command: "https://example.com/vela" }], "only the fetch asks for approval");
  assert.deepEqual(f.requests.map((request) => request.url), ["https://api.deepseek.com/v1/tools/search", "https://api.deepseek.com/v1/tools/fetch"]);
  assert.equal(f.requests[0]!.authorization, "Bearer sk-web-runtime-secret");
  assert.deepEqual(JSON.parse(f.requests[0]!.body), { query: "Vela release notes", count: 2 });
  assert.ok(!JSON.stringify(f.session().messages).includes("sk-web-runtime-secret"), "the key never enters the conversation");
  assert.ok(!system.includes("sk-web-runtime-secret"));
});

it("a denied fetch is reported to the model and sends nothing to the provider", async (t) => {
  const f = await fixture(t, { allow: false });
  enable(f);
  const check = scripted(f.session(), [
    [{ type: "toolCall", id: "denied", name: webFetchToolName, arguments: { url: "https://example.com/private" } }],
    "The fetch was declined.",
  ]);
  await f.runtime.prompt(f.id, "Read that page");
  check();
  assert.equal(toolResult(f.session(), "denied").isError, true);
  assert.deepEqual(f.requests, []);
  assert.equal(f.approvals.length, 1);
});

it("Plan mode keeps web tools because they are read-only", async (t) => {
  const f = await fixture(t);
  enable(f);
  await f.runtime.setMode(f.id, "plan");
  assert.deepEqual(webNames(f.session().getActiveToolNames()).sort(), [webFetchToolName, webSearchToolName]);
  const check = scripted(f.session(), [
    [{ type: "toolCall", id: "plan-search", name: webSearchToolName, arguments: { query: "pnpm workspaces" } }],
    "Plan informed by the search.",
  ]);
  await f.runtime.prompt(f.id, "Plan a migration");
  check();
  assert.equal(toolResult(f.session(), "plan-search").isError, false);
});

it("a tool call made after the feature is switched off is blocked even if the model still emits it", async (t) => {
  const f = await fixture(t);
  enable(f);
  f.runtime.webTools.save({ enabled: false, searchProviderId: "deepseek", fetchProviderId: "deepseek", providers: [] });
  const check = scripted(f.session(), [
    [{ type: "toolCall", id: "off", name: webSearchToolName, arguments: { query: "anything" } }],
    "Search is off.",
  ]);
  await f.runtime.prompt(f.id, "Search something");
  check();
  assert.equal(toolResult(f.session(), "off").isError, true);
  assert.deepEqual(f.requests, []);
});

it("explore and general subagents can search and fetch too", async (t) => {
  const f = await fixture(t);
  enable(f);
  const entry = f.internals().conversations.get(f.id)!;
  const root = f.session();
  for (const kind of ["explore", "general"] as const) {
    const child = await f.internals().createChildSession(entry, {
      agentId: `${kind}-1`, parentId: f.id, parentPath: "/root", parentSession: root, kind,
      name: kind, path: `/root/${kind}`, forkMessages: selectForkMessages(root.messages, "all"),
      customTools: [], sessionFile: null,
    });
    assert.deepEqual(webNames(child.getActiveToolNames()).sort(), [webFetchToolName, webSearchToolName], kind);
  }
});
