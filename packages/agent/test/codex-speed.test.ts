import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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

test("main and side chats send the selected Codex tier through Pi's real Responses transport", async t => {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") { response.writeHead(400).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    bodies.push(JSON.parse((request.headers["content-encoding"] === "zstd" ? zstdDecompressSync(raw) : raw).toString()));
    const item = { id: "msg_speed", type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end([
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id: "resp_speed", status: "completed", output: [item] } },
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
  const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture" } })).toString("base64url");
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ [provider]: {
    type: "oauth", access: `e30.${claims}.fake`, refresh: "local", expires: Date.now() + 3600_000, accountId: "fixture",
  } }));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { [provider]: { baseUrl } } }));
  const runtime = new AgentRuntime({ cwd, agentDir, modelDirectory: { configDir: agentDir, refreshCatalogOnStart: false } });
  t.after(async () => {
    await runtime.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  });
  const fetchLocal = globalThis.fetch;
  let lookups = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === "chatgpt.com" && url.pathname === "/backend-api/codex/models") {
      assert.equal(new Headers(init?.headers).get("ChatGPT-Account-Id"), "fixture");
      lookups++;
      return Response.json({ models: [{ slug: model, service_tiers: [{ id: "priority" }, { id: "ultrafast" }] }] });
    }
    assert.equal(url.origin, baseUrl);
    return fetchLocal(input, init);
  });
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
  assert.equal(lookups, 1);
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
