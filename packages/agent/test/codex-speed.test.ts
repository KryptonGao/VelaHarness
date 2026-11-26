import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { parseCodexSpeedCatalog } from "../src/codex-speed.ts";
import { AgentRuntime } from "../src/runtime.ts";

test("Codex speed discovery honors explicit tiers, older catalogs and account-specific omissions", () => {
  const catalog = parseCodexSpeedCatalog({ models: [
    { slug: "a", service_tiers: [{ id: "unknown" }, { id: "priority" }] },
    { slug: "b", additional_speed_tiers: ["fast", "ultrafast"] },
    { slug: "c", service_tiers: [], additional_speed_tiers: ["fast"] },
  ] });
  assert.deepEqual([...catalog], [["a", ["priority"]], ["b", ["priority", "ultrafast"]], ["c", []]]);
});

async function setupCodex(t: TestContext, options: {
  catalog?: (account: string) => Response | Promise<Response>;
  secondaryAccount?: boolean;
} = {}) {
  const bodies: Record<string, unknown>[] = [];
  const accounts: (string | string[] | undefined)[] = [];
  let spawns: { agent: "explore" | "general"; task: string; model?: string }[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") { response.writeHead(400).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const body = JSON.parse((request.headers["content-encoding"] === "zstd" ? zstdDecompressSync(raw) : raw).toString());
    bodies.push(body);
    accounts.push(request.headers["chatgpt-account-id"]);
    const requestId = bodies.length;
    const output = spawns.length && hasPrompt(body, "Start speed fixtures")
      ? spawns.splice(0).map((args, index) => ({ id: `fc_${requestId}_${index}`, call_id: `call_${requestId}_${index}`,
        type: "function_call", name: "spawn_agent", arguments: JSON.stringify(args) }))
      : [{ id: `msg_${requestId}`, type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }];
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end([
      ...output.map((item, output_index) => ({ type: "response.output_item.done", output_index, item })),
      { type: "response.completed", response: { id: `resp_${requestId}`, status: "completed", output } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const cwd = await mkdtemp(join(tmpdir(), "vela-codex-speed-"));
  const agentDir = join(cwd, "agent");
  await mkdir(agentDir);
  const provider = "openai-codex";
  const model = "gpt-6.1-sol";
  const secondary = "openai-codex@d60e6178-c49a-4828-826f-e8ab4d177b11";
  const credential = (accountId: string) => {
    const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url");
    return { type: "oauth", access: `e30.${claims}.fake`, refresh: "local", expires: Date.now() + 3600_000, accountId };
  };
  const auth = { [provider]: credential("fixture") };
  const providers = { [provider]: { baseUrl } };
  if (options.secondaryAccount) {
    auth[secondary] = credential("secondary");
    await writeFile(join(agentDir, "provider-profiles.json"), JSON.stringify({ [secondary]: { account: { builtinId: provider, number: 2 } } }));
  }
  await writeFile(join(agentDir, "auth.json"), JSON.stringify(auth));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers }));
  const runtimes: AgentRuntime[] = [];
  const openRuntime = () => {
    const runtime = new AgentRuntime({ cwd, agentDir, modelDirectory: { configDir: agentDir, refreshCatalogOnStart: false } });
    runtimes.push(runtime);
    return runtime;
  };
  const runtime = openRuntime();
  t.after(async () => {
    for (const runtime of runtimes) await runtime.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  });
  const fetchLocal = globalThis.fetch;
  let lookups = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === "chatgpt.com" && url.pathname === "/backend-api/codex/models") {
      const account = new Headers(init?.headers).get("ChatGPT-Account-Id");
      assert.ok(account);
      lookups++;
      if (options.catalog) return options.catalog(account);
      assert.equal(account, "fixture");
      return speedCatalog(model, "priority", "ultrafast");
    }
    if (options.secondaryAccount && url.hostname === "pi.dev") return new Response(null, { status: 503 });
    assert.equal(url.origin, baseUrl);
    return fetchLocal(input, init);
  });
  if (options.secondaryAccount) {
    // Register the native account before overriding its endpoint; pre-existing entries can shadow it.
    await runtime.getAgentSettings();
    providers[secondary] = { baseUrl };
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers }));
    await runtime.refreshCatalog();
  }
  return { runtime, cwd, provider, secondary, model, bodies, accounts, openRuntime, lookups: () => lookups,
    spawnOnNextPrompt: (args: typeof spawns) => { spawns = args; } };
}

function hasPrompt(body: Record<string, unknown>, text: string): boolean {
  if (!Array.isArray(body.input)) return false;
  const latest = body.input.findLast(item => item.role === "user");
  return latest !== undefined && JSON.stringify(latest.content).includes(text);
}

function speedCatalog(model: string, ...tiers: string[]): Response {
  return Response.json({ models: [{ slug: model, service_tiers: tiers.map(id => ({ id })) }] });
}

function requestFor(bodies: Record<string, unknown>[], prompt: string): Record<string, unknown> {
  const body = bodies.findLast(body => hasPrompt(body, prompt));
  assert.ok(body, `Missing Responses request for ${prompt}`);
  return body;
}

async function waitForIdle(runtime: AgentRuntime, conversationId: string): Promise<void> {
  await runtime.waitForIdle(conversationId, { signal: AbortSignal.timeout(5_000) });
}

test("last-used chats inherit the Codex tier in both the snapshot and the outgoing request", async t => {
  const { runtime, cwd, provider, model, bodies } = await setupCodex(t);
  const settings = await runtime.getAgentSettings();
  await runtime.saveAgentSettings({ ...settings, provider, modelId: model, newConversationSelection: "lastUsed" });
  await runtime.createConversation(cwd);
  for (const speed of ["priority", "ultrafast", "standard"] as const) {
    await runtime.setCodexSpeed(provider, model, speed);
    const next = await runtime.createConversation(cwd);
    assert.ok(next.id);
    assert.equal(next.codexSpeed, speed);
    await runtime.renameConversation(next.id, "Speed test");
    await runtime.prompt(next.id, "Hello");
    assert.ok(bodies.at(-1));
    assert.equal(bodies.at(-1)!.service_tier, speed === "standard" ? undefined : speed);
  }
  await runtime.setCodexSpeed(provider, model, "ultrafast");
  await runtime.saveAgentSettings({ ...settings, provider, modelId: model, newConversationSelection: "default" });
  assert.equal((await runtime.createConversation(cwd)).codexSpeed, undefined);
});

test("re-entering a chat restores its last send, not an unsent picker change or another chat's model", async t => {
  const { runtime, cwd, provider, model, bodies, openRuntime } = await setupCodex(t);
  const other = (await runtime.getCatalog()).models.find(item => item.provider === provider && item.available && item.id !== model)!;
  await runtime.saveAgentSettings({ ...await runtime.getAgentSettings(), provider, modelId: other.id });
  const first = (await runtime.createConversation(cwd)).id!;
  await runtime.renameConversation(first, "First");
  await runtime.selectModel(provider, model, first);
  await runtime.prompt(first, "First send");
  await runtime.selectModel(provider, other.id, first); // Not sent.
  const second = (await runtime.createConversation(cwd)).id!;
  await runtime.renameConversation(second, "Second");
  await runtime.prompt(second, "Other chat");
  assert.equal((await runtime.switchConversation(first)).modelId, model);
  await runtime.dispose();

  const restored = openRuntime();
  assert.equal((await restored.switchConversation(second)).modelId, other.id);
  assert.equal((await restored.switchConversation(first)).modelId, model);
  await restored.prompt(first, "After restart");
  assert.equal(requestFor(bodies, "After restart").model, model);
  assert.equal((await restored.createConversation(cwd)).modelId, other.id);
});

test("main and side chats send the selected Codex tier through Pi's real Responses transport", async t => {
  const { runtime, cwd, provider, model, bodies, lookups } = await setupCodex(t);
  const { conversationId } = await runtime.createRunConversation({ cwd, sandboxMode: "full", model: { provider, id: model } });
  for (const speed of ["priority", "ultrafast", "standard"] as const) {
    await runtime.setCodexSpeed(provider, model, speed, conversationId);
    await runtime.prompt(conversationId, "Hello");
    const body = bodies.at(-1);
    assert.ok(body);
    assert.equal(body.service_tier, speed === "standard" ? undefined : speed);
  }
  const side = await runtime.sideChat({ requestId: "speed-side", conversationId, locale: "en", messages: [{ role: "user", text: "Hello" }],
    model: { provider, id: model }, codexSpeed: "ultrafast" }, () => {});
  assert.equal(side.text, "OK");
  assert.deepEqual(bodies.map(body => body.service_tier), ["priority", "ultrafast", undefined, "ultrafast"]);
  assert.equal(lookups(), 1);
  await runtime.setCodexSpeed(provider, model, "ultrafast", conversationId);
  const other = await runtime.createRunConversation({ cwd, sandboxMode: "full", model: { provider, id: model } });
  assert.equal(runtime.getSnapshot(other.conversationId).codexSpeed, undefined);
  assert.equal(runtime.getSnapshot(conversationId).codexSpeed, "ultrafast");
  const otherModel = (await runtime.getCatalog()).models.find(item => item.provider === provider && item.available && item.id !== model);
  assert.ok(otherModel);
  const switched = await runtime.selectModel(provider, otherModel.id, conversationId);
  assert.equal(switched.codexSpeed, undefined);
  assert.deepEqual(await runtime.getCodexSpeedTiers("openai", model), []);
  await assert.rejects(runtime.setCodexSpeed(provider, "unknown", "priority", conversationId));
});

test("both child kinds default to standard, use only their chat's setting, and retain it after restart", { timeout: 15_000 }, async t => {
  const { runtime, cwd, provider, model, bodies, spawnOnNextPrompt, openRuntime } = await setupCodex(t);
  const settings = await runtime.getAgentSettings();
  await runtime.saveAgentSettings({ ...settings, provider, modelId: model, newConversationSelection: "lastUsed" });
  const { conversationId } = await runtime.createRunConversation({ cwd, sandboxMode: "full", model: { provider, id: model } });
  await runtime.setCodexSpeed(provider, model, "priority", conversationId);
  spawnOnNextPrompt([{ agent: "explore", task: "Explore first reply" }, { agent: "general", task: "General first reply" }]);
  await runtime.prompt(conversationId, "Start speed fixtures");
  await waitForIdle(runtime, conversationId);
  const children = runtime.getAgents(conversationId).filter(agent => agent.kind !== "root");
  assert.deepEqual(children.map(agent => agent.kind).sort(), ["explore", "general"]);
  assert.equal(requestFor(bodies, "Start speed fixtures").service_tier, "priority");
  assert.equal(runtime.getSnapshot(conversationId).subagentCodexSpeed, "standard");
  for (const task of ["Explore first reply", "General first reply"]) {
    assert.equal(requestFor(bodies, task).service_tier, undefined);
  }

  const other = await runtime.createConversation(cwd);
  assert.equal((await runtime.setSubagentCodexSpeed("ultrafast", conversationId)).subagentCodexSpeed, "ultrafast");
  await assert.rejects(runtime.setSubagentCodexSpeed("fast", conversationId));
  await assert.rejects(runtime.setSubagentCodexSpeed("priority", "missing"));
  assert.equal(runtime.activeConversationId, other.id);
  assert.equal(runtime.getSnapshot(conversationId).subagentCodexSpeed, "ultrafast");
  assert.equal(runtime.getSnapshot(conversationId).codexSpeed, "priority");
  assert.equal(runtime.getSnapshot(other.id!).subagentCodexSpeed, "standard");
  const fresh = await runtime.createConversation(cwd);
  assert.equal(fresh.codexSpeed, "priority");
  assert.equal(fresh.subagentCodexSpeed, "standard");

  for (const child of children) runtime.sendAgentMessage(conversationId, child.id, `Live ${child.kind} reply`);
  await waitForIdle(runtime, conversationId);
  for (const child of children) assert.equal(requestFor(bodies, `Live ${child.kind} reply`).service_tier, "ultrafast");

  await runtime.dispose();
  const restored = openRuntime();
  await restored.switchConversation(conversationId);
  assert.equal(restored.getSnapshot(conversationId).subagentCodexSpeed, "ultrafast");
  assert.equal(restored.getSnapshot(other.id!).subagentCodexSpeed, "standard");
  for (const child of children) restored.sendAgentMessage(conversationId, child.id, `Restored ${child.kind} reply`);
  await waitForIdle(restored, conversationId);
  for (const child of children) assert.equal(requestFor(bodies, `Restored ${child.kind} reply`).service_tier, "ultrafast");
});

test("child speed checks the actual model, not the root's supported tier", { timeout: 15_000 }, async t => {
  const { runtime, cwd, provider, model, bodies, spawnOnNextPrompt } = await setupCodex(t);
  const unsupported = (await runtime.getCatalog()).models.find(item => item.provider === provider && item.available && item.id !== model);
  assert.ok(unsupported);
  const settings = await runtime.getAgentSettings();
  await runtime.saveAgentSettings({ ...settings, provider, modelId: model, subagentModels: [{ provider, modelId: unsupported.id }] });
  const { conversationId } = await runtime.createRunConversation({ cwd, sandboxMode: "full", model: { provider, id: model } });
  await runtime.setSubagentCodexSpeed("priority", conversationId);
  spawnOnNextPrompt([{ agent: "explore", task: "Different model", model: `${provider}/${unsupported.id}` }, { agent: "general", task: "Supported model" }]);
  await runtime.prompt(conversationId, "Start speed fixtures");
  await waitForIdle(runtime, conversationId);
  assert.equal(requestFor(bodies, "Different model").model, unsupported.id);
  assert.equal(requestFor(bodies, "Different model").service_tier, undefined);
  assert.equal(requestFor(bodies, "Supported model").service_tier, "priority");
  assert.equal(requestFor(bodies, "Start speed fixtures").service_tier, undefined);
});

test("the same child model uses the catalog of the account that sends its request", { timeout: 15_000 }, async t => {
  const catalogs: string[] = [];
  const { runtime, cwd, provider, secondary, model, bodies, accounts, spawnOnNextPrompt } = await setupCodex(t, {
    secondaryAccount: true,
    catalog: account => {
      catalogs.push(account);
      return account === "secondary" ? speedCatalog(model, "ultrafast") : speedCatalog(model, "priority");
    },
  });
  const settings = await runtime.getAgentSettings();
  await runtime.saveAgentSettings({ ...settings, provider, modelId: model, subagentModels: [{ provider: secondary, modelId: model }] });
  const { conversationId } = await runtime.createRunConversation({ cwd, sandboxMode: "full", model: { provider, id: model } });
  await runtime.setSubagentCodexSpeed("ultrafast", conversationId);
  spawnOnNextPrompt([{ agent: "explore", task: "Child on secondary account", model: `${secondary}/${model}` }, { agent: "general", task: "Child on primary account" }]);
  await runtime.prompt(conversationId, "Start speed fixtures");
  await waitForIdle(runtime, conversationId);
  assert.deepEqual(runtime.getRunReport(conversationId).subagentFailures, []);
  assert.equal(runtime.getAgents(conversationId).find(agent => agent.kind === "explore")?.model?.provider, secondary,
    JSON.stringify(runtime.getMessages(conversationId).flatMap(message => message.tools)));
  const primary = requestFor(bodies, "Child on primary account");
  const alternate = requestFor(bodies, "Child on secondary account");
  assert.equal(primary.model, model);
  assert.equal(alternate.model, model);
  assert.equal(accounts[bodies.indexOf(primary)], "fixture");
  assert.equal(accounts[bodies.indexOf(alternate)], "secondary");
  assert.deepEqual(catalogs.sort(), ["fixture", "secondary"]);
  assert.equal(primary.service_tier, undefined);
  assert.equal(alternate.service_tier, "ultrafast");
});

for (const next of ["standard", "ultrafast"] as const) {
  test(`changing child speed to ${next} during a pending lookup discards the old tier`, { timeout: 15_000 }, async t => {
    const lookup = Promise.withResolvers<void>();
    const catalog = Promise.withResolvers<Response>();
    const { runtime, cwd, provider, model, bodies, spawnOnNextPrompt } = await setupCodex(t, {
      catalog: () => { lookup.resolve(); return catalog.promise; },
    });
    t.after(() => catalog.resolve(new Response(null, { status: 503 })));
    const { conversationId } = await runtime.createRunConversation({ cwd, sandboxMode: "full", model: { provider, id: model } });
    spawnOnNextPrompt([{ agent: "general", task: "Idle child setup" }]);
    await runtime.prompt(conversationId, "Start speed fixtures");
    await waitForIdle(runtime, conversationId);
    const child = runtime.getAgents(conversationId).find(agent => agent.kind === "general");
    assert.ok(child);
    await runtime.setSubagentCodexSpeed("priority", conversationId);
    runtime.sendAgentMessage(conversationId, child.id, "Lookup still pending");
    try {
      await lookup.promise;
      assert.equal(runtime.getAgents(conversationId).find(agent => agent.id === child.id)?.status, "running");
      assert.equal((await runtime.setSubagentCodexSpeed(next, conversationId)).subagentCodexSpeed, next);
    } finally {
      catalog.resolve(speedCatalog(model, "priority", "ultrafast"));
    }
    await waitForIdle(runtime, conversationId);
    assert.equal(requestFor(bodies, "Lookup still pending").service_tier, undefined);
    runtime.sendAgentMessage(conversationId, child.id, "After speed changed");
    await waitForIdle(runtime, conversationId);
    assert.equal(requestFor(bodies, "After speed changed").service_tier, next === "standard" ? undefined : next);
  });
}

test("an unavailable catalog falls back to standard without failing the child", { timeout: 15_000 }, async t => {
  const { runtime, cwd, provider, model, bodies, spawnOnNextPrompt, lookups } = await setupCodex(t, {
    catalog: () => new Response(null, { status: 503 }),
  });
  const { conversationId } = await runtime.createRunConversation({ cwd, sandboxMode: "full", model: { provider, id: model } });
  await runtime.setSubagentCodexSpeed("ultrafast", conversationId);
  spawnOnNextPrompt([{ agent: "explore", task: "Catalog failure reply" }]);
  await runtime.prompt(conversationId, "Start speed fixtures");
  await waitForIdle(runtime, conversationId);
  assert.equal(lookups(), 1);
  assert.equal(requestFor(bodies, "Catalog failure reply").service_tier, undefined);
  assert.equal(runtime.getAgents(conversationId).find(agent => agent.kind === "explore")?.status, "completed");
  assert.equal(runtime.getSnapshot(conversationId).subagentCodexSpeed, "ultrafast");
});
