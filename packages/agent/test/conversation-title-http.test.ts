import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { describe, it, type TestContext } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { requestConversationTitle } from "../src/conversation-title.ts";

const title = "修复标题生成";

/** Run the installed SDK against a local endpoint that enforces the reported OpenCode contract. */
async function endpoint(t: TestContext, provider: string) {
  const requests: IncomingHttpHeaders[] = [];
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the request before responding. */ }
    requests.push(request.headers);
    if (!request.headers["x-opencode-session"]) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { type: "MissingSessionID", message: "MissingSessionID: Request is missing x-opencode-session" } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = { id: "title-response", object: "chat.completion.chunk", created: 1, model: "title-test" };
    response.end([
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: title }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""));
  });
  const dir = await mkdtemp(join(tmpdir(), "vela-title-http-"));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider(provider, {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-test-key",
    models: [{
      id: "title-test", name: "Local title test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 4096,
    }],
  });
  const model = runtime.getModel(provider, "title-test");
  assert.ok(model);
  return { runtime, model, requests };
}

describe("conversation title HTTP session routing", () => {
  it("omits the unsupported temperature parameter through the real Codex SDK path", async (t) => {
    const requests: Record<string, unknown>[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks);
      const body = JSON.parse((request.headers["content-encoding"] === "zstd" ? zstdDecompressSync(raw) : raw).toString());
      requests.push(body);
      if ("temperature" in body) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ detail: "Unsupported parameter: temperature" }));
        return;
      }
      const item = { id: "msg_title", type: "message", role: "assistant", content: [{ type: "output_text", text: title }] };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end([
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: "resp_title", status: "completed", output: [item] } },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
    });
    const dir = await mkdtemp(join(tmpdir(), "vela-title-codex-"));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(dir, { recursive: true, force: true });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url");
    runtime.registerProvider("openai-codex", {
      baseUrl: `http://127.0.0.1:${address.port}`, api: "openai-codex-responses", apiKey: `e30.${claims}.fake`,
      models: [{
        id: "gpt-6.1-sol", name: "Local Codex title test", reasoning: true, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 4096,
      }],
    });
    const model = runtime.getModel("openai-codex", "gpt-6.1-sol");
    assert.ok(model);
    const httpRuntime: Pick<ModelRuntime, "completeSimple"> = {
      completeSimple: (selected, context, options) => runtime.completeSimple(selected, context, {
        ...options, transport: "sse", maxRetries: 0, timeoutMs: 5000,
      }),
    };
    const rejected = await httpRuntime.completeSimple(model, { messages: [{ role: "user", content: "帮我修复标题生成", timestamp: 1 }] }, { temperature: 0.2 });
    assert.equal(rejected.stopReason, "error");
    assert.match(rejected.errorMessage ?? "", /Unsupported parameter: temperature/);
    assert.equal(await requestConversationTitle(httpRuntime, model, { conversationId: "chat-codex", text: "帮我修复标题生成" }), title);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.temperature, 0.2);
    assert.equal("temperature" in requests[1]!, false);
    assert.match(String(requests[1]!.instructions), /return only the title/);
    assert.equal(requests[1]!.prompt_cache_key, "chat-codex");
  });

  it("reproduces MissingSessionID and sends the conversation header through the real OpenCode SDK path", async (t) => {
    const { runtime, model, requests } = await endpoint(t, "opencode-go");
    const missing = await runtime.completeSimple(model, { messages: [{ role: "user", content: "帮我修复标题生成", timestamp: 1 }] }, { maxTokens: 32 });
    assert.equal(missing.stopReason, "error");
    assert.match(missing.errorMessage ?? "", /MissingSessionID/);
    assert.equal(await requestConversationTitle(runtime, model, { conversationId: "chat-a", text: "帮我修复标题生成" }), title);
    assert.deepEqual(requests.map((request) => request["x-opencode-session"]), [undefined, "chat-a"]);
  });

  it("also sends the header for a custom provider pointing at the OpenCode endpoint", async (t) => {
    const { runtime, model, requests } = await endpoint(t, "custom-openai-compatible");
    // Route the real HTTP dispatch locally, preserving the model metadata seen by the title request.
    const declaredModel = { ...model, baseUrl: "https://opencode.ai/zen/go/v1" };
    const localDispatch: Pick<ModelRuntime, "completeSimple"> = {
      completeSimple: (selected, context, options) => {
        assert.equal(selected, declaredModel);
        return runtime.completeSimple(model, context, options);
      },
    };
    assert.equal(await requestConversationTitle(localDispatch, declaredModel, { conversationId: "chat-a", text: "帮我修复标题生成" }), title);
    assert.equal(requests[0]!["x-opencode-session"], "chat-a");
  });
});
