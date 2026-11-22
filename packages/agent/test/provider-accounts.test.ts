import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { ModelConfigReadOnlyError, ModelDirectory } from "../src/model-directory.ts";

async function config(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "vela-provider-accounts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("duplicate built-ins route the same model through independent credentials and retain their identity after restart", async t => {
  const dir = await config(t);
  // The first account can be supplied entirely by the environment.
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "first-account";
  t.after(() => { if (saved === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = saved; });

  const directory = await ModelDirectory.open(dir);
  const second = await directory.addProviderAccount("deepseek");
  assert.notEqual(second, "deepseek");
  const modelId = directory.runtime.getModels("deepseek")[0]!.id;
  assert.equal(await directory.runtime.getAuth(second), undefined);
  assert.equal(directory.isAvailable({ provider: second, id: modelId }), false);
  const answer = (value: string | null) => directory.subscribeAuth(event => {
    if (event.type === "prompt") directory.replyLogin(event.request.id, value);
  });
  const entered = answer("second-account");
  assert.equal(await directory.login(second, "api_key"), "ok");
  entered();
  const cancelled = answer(null);
  assert.equal(await directory.login(second, "api_key"), "cancelled");
  cancelled();
  await directory.setProviderNote("deepseek", "Personal");
  await directory.setProviderNote(second, " Work ");
  await directory.select(second, modelId);

  const reopened = await ModelDirectory.open(dir);
  const model = reopened.availableSelection();
  assert.equal(model?.provider, second);
  assert.equal(model?.id, modelId);
  const catalog = await reopened.catalog();
  const profile = catalog.providers.find(p => p.id === second)!;
  assert.equal(profile.builtinId, "deepseek");
  assert.equal(profile.note, "Work");
  assert.equal(profile.custom, false);
  assert.equal(catalog.models.find(m => m.provider === second && m.id === modelId)?.providerName, "DeepSeek #2 · Work");
  assert.match(reopened.displayName(model!), /DeepSeek #2 · Work/);

  const headers: (string | undefined)[] = [];
  const server = createServer(async (req, res) => {
    for await (const _part of req) { /* drain */ }
    headers.push(req.headers.authorization);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = { id: "local", object: "chat.completion.chunk", model: modelId, created: 1,
      choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }] };
    res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  for (const provider of ["deepseek", second]) {
    const model = reopened.requireAvailable(provider, modelId);
    const reply = await reopened.runtime.completeSimple({ ...model, baseUrl: `http://127.0.0.1:${address.port}` },
      { messages: [{ role: "user", content: "local test", timestamp: 1 }] });
    assert.equal(reply.stopReason, "stop", reply.errorMessage);
    assert.equal(reply.provider, provider);
  }
  assert.deepEqual(headers, ["Bearer first-account", "Bearer second-account"]);

  const reader = await ModelDirectory.open(dir, { configDir: dir, readOnlyConfig: true });
  assert.equal(reader.availableSelection()?.provider, second);
  await assert.rejects(reader.addProviderAccount("deepseek"), ModelConfigReadOnlyError);
  await assert.rejects(reader.setProviderNote(second, ""), ModelConfigReadOnlyError);
  await assert.rejects(reader.removeProviderAccount(second), ModelConfigReadOnlyError);
  await reopened.logout(second);
  assert.equal(await reopened.runtime.getAuth(second), undefined);
  assert.equal((await reopened.catalog()).providers.find(p => p.id === second)?.note, "Work");
  await reopened.removeProviderAccount(second);
  await reopened.setProviderNote("deepseek", "");
  const final = await ModelDirectory.open(dir);
  assert.equal(final.runtime.getProvider(second), undefined);
  assert.equal((await final.runtime.getAuth("deepseek"))?.auth.apiKey, "first-account");
  assert.equal((await final.catalog()).providers.find(p => p.id === "deepseek")?.note, undefined);
  assert.equal(final.modelForSelection(), undefined);
});

test("OAuth accounts resolve and refresh their own stored tokens", async t => {
  const dir = await config(t);
  const token = (account: string) => {
    const claim = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url");
    return `e30.${claim}.test`;
  };
  const primary = { type: "oauth", access: token("one"), refresh: "primary", expires: Date.now() + 86400000, accountId: "one" };
  const path = join(dir, "auth.json");
  await writeFile(path, JSON.stringify({ "openai-codex": primary }));
  const directory = await ModelDirectory.open(dir);
  const second = await directory.addProviderAccount("openai-codex");
  const secondary = { ...primary, access: token("two"), refresh: "secondary", accountId: "two", expires: 0 };
  await writeFile(path, JSON.stringify({ "openai-codex": primary, [second]: secondary }));
  const reopened = await ModelDirectory.open(dir);
  const fetch = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(new URLSearchParams(String(init.body)).get("refresh_token"), "secondary");
    return Response.json({ access_token: token("two"), refresh_token: "rotated", expires_in: 3600 });
  });
  assert.equal((await reopened.runtime.getAuth(second))?.auth.apiKey, token("two"));
  assert.equal(fetch.mock.callCount(), 1);
  const credentials = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(credentials["openai-codex"], primary);
  assert.equal(credentials[second].refresh, "rotated");
});

test("custom provider notes can be edited and cleared independently of the connection", async t => {
  const dir = await config(t);
  const directory = await ModelDirectory.open(dir);
  const input = { providerId: "lab", providerName: "Lab", baseUrl: "https://example.test/v1", api: "openai-completions" as const,
    apiKey: "local", modelId: "m", modelName: "M", reasoning: false, contextWindow: null, maxTokens: null };
  await directory.addCustom(input);
  await directory.setProviderNote("lab", "Lab key");
  const reopened = await ModelDirectory.open(dir);
  assert.equal((await reopened.catalog()).models.find(m => m.provider === "lab")?.providerName, "Lab · Lab key");
  await assert.rejects(reopened.addProviderAccount("lab"));
  await assert.rejects(reopened.setProviderNote("lab", "x".repeat(121)));
  await reopened.removeCustom("lab", "m");
  await reopened.addCustom(input);
  assert.equal((await reopened.catalog()).providers.find(p => p.id === "lab")?.note, undefined);
});

test("an account-specific cached catalog never replaces another account's models", async t => {
  const dir = await config(t);
  await writeFile(join(dir, "auth.json"), JSON.stringify({ openrouter: { type: "api_key", key: "first" } }));
  const directory = await ModelDirectory.open(dir);
  const second = await directory.addProviderAccount("openrouter");
  const model = directory.runtime.getModels("openrouter")[0]!;
  const cache = {
    openrouter: { models: [{ ...model, id: "primary-only" }] },
    [second]: { models: [{ ...model, id: "secondary-only" }] },
  };
  await writeFile(join(dir, "models-store.json"), JSON.stringify(cache));
  const reopened = await ModelDirectory.open(dir);
  assert.deepEqual(reopened.runtime.getModels("openrouter").map(m => m.id), ["primary-only"]);
  assert.deepEqual(reopened.runtime.getModels(second).map(m => m.id), ["secondary-only"]);
});
