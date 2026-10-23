import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock, type TestContext } from "node:test";
import { MemoryCredentialStore, WebToolsService, type AgentRuntime } from "@vela/agent";
import type { WebProvider, WebToolsResult, WebToolsState, WebToolsTestResult } from "@vela/shared";

type Handler = (event: unknown, input?: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();
mock.module("electron", {
  namedExports: {
    ipcMain: {
      handle(channel: string, handler: Handler) {
        assert.ok(!handlers.has(channel), `duplicate handler: ${channel}`);
        handlers.set(channel, handler);
      },
      removeHandler(channel: string) { handlers.delete(channel); },
    },
    BrowserWindow: { fromWebContents: (sender: unknown) => (sender ? {} : null) },
  },
});
const { WebToolsHost, parseKeyRequest, parseTestRequest } = await import("../src/main/web-tools-host.ts");

const custom = (): WebProvider => ({
  id: "mine", name: "Mine",
  search: { url: "https://search.example.com/v1", method: "POST", auth: { type: "bearer" }, body: { q: "{{query}}" }, resultsPath: "hits", fields: { title: "t", url: "u" } },
});

function fixture(t: TestContext, fetchStub?: typeof fetch) {
  handlers.clear();
  const root = mkdtempSync(join(tmpdir(), "vela-web-host-"));
  const service = new WebToolsService({ agentDir: root, credentials: new MemoryCredentialStore(), sleep: async () => undefined, ...(fetchStub ? { fetch: fetchStub } : {}) });
  const host = new WebToolsHost({ webTools: service } as unknown as AgentRuntime);
  host.register();
  const frame = {};
  const event = { sender: { mainFrame: frame }, senderFrame: frame };
  t.after(() => { host.dispose(); rmSync(root, { recursive: true, force: true }); });
  return {
    service, frame, host,
    call: <T>(channel: string, input?: unknown) => handlers.get(channel)!(event, input) as Promise<WebToolsResult<T>>,
  };
}

describe("web tools IPC validation", () => {
  it("accepts well-formed key and test requests", () => {
    assert.deepEqual(parseKeyRequest({ providerId: "deepseek", apiKey: "k" }), { providerId: "deepseek", apiKey: "k" });
    assert.deepEqual(parseKeyRequest({ providerId: "deepseek", apiKey: null }), { providerId: "deepseek", apiKey: null });
    assert.deepEqual(parseTestRequest({ providerId: "deepseek", capability: "fetch" }), { providerId: "deepseek", capability: "fetch" });
  });

  it("rejects extra fields, missing ids and wrong types", () => {
    assert.throws(() => parseKeyRequest({ providerId: "x", apiKey: "k", extra: 1 }), /不支持的字段/);
    assert.throws(() => parseKeyRequest({ providerId: "", apiKey: "k" }), /缺少提供商/);
    assert.throws(() => parseKeyRequest({ providerId: "x", apiKey: 5 }), /文本或 null/);
    assert.throws(() => parseKeyRequest("x"), /格式不正确/);
    assert.throws(() => parseKeyRequest([]), /格式不正确/);
    assert.throws(() => parseTestRequest({ providerId: "x", capability: "run" }), /测试类型/);
    assert.throws(() => parseTestRequest({ providerId: "x" }), /测试类型/);
  });
});

describe("web tools host", () => {
  it("registers four channels and releases them on dispose", (t) => {
    const f = fixture(t);
    assert.deepEqual([...handlers.keys()].sort(), ["web-tools:get", "web-tools:save", "web-tools:set-key", "web-tools:test"]);
    f.host.dispose();
    assert.equal(handlers.size, 0);
  });

  it("rejects requests from a non-main frame or without a window", async (t) => {
    const f = fixture(t);
    await assert.rejects(handlers.get("web-tools:get")!({ sender: { mainFrame: f.frame }, senderFrame: {} }), /不可用/);
    await assert.rejects(handlers.get("web-tools:get")!({ sender: null, senderFrame: null }), /不可用/);
  });

  it("saves configuration and keys, and never returns the key", async (t) => {
    const f = fixture(t);
    const initial = await f.call<WebToolsState>("web-tools:get");
    assert.ok(initial.ok && initial.value.enabled === false);
    assert.deepEqual(initial.ok && initial.value.providers.map(provider => provider.id), ["deepseek"]);

    const saved = await f.call<WebToolsState>("web-tools:save", { enabled: true, searchProviderId: "mine", fetchProviderId: null, providers: [custom()] });
    assert.ok(saved.ok);
    assert.equal(saved.ok && saved.value.providers.length, 2);

    const withKey = await f.call<WebToolsState>("web-tools:set-key", { providerId: "mine", apiKey: "sk-secret-123" });
    assert.ok(withKey.ok);
    assert.equal(withKey.ok && withKey.value.providers.find(provider => provider.id === "mine")?.hasKey, true);
    assert.ok(!JSON.stringify(withKey).includes("sk-secret-123"));
    assert.ok(!JSON.stringify(await f.call("web-tools:get")).includes("sk-secret-123"));

    const removed = await f.call<WebToolsState>("web-tools:set-key", { providerId: "mine", apiKey: null });
    assert.equal(removed.ok && removed.value.providers.find(provider => provider.id === "mine")?.hasKey, false);
  });

  it("returns typed failures instead of throwing", async (t) => {
    const f = fixture(t);
    const bad = await f.call("web-tools:save", { enabled: true, searchProviderId: "ghost", fetchProviderId: null, providers: [] });
    assert.deepEqual(bad.ok === false && bad.code, "invalid");
    const unknown = await f.call("web-tools:set-key", { providerId: "ghost", apiKey: "k" });
    assert.equal(unknown.ok === false && unknown.code, "invalid");
    const malformed = await f.call("web-tools:set-key", { providerId: "deepseek", apiKey: "k", extra: true });
    assert.equal(malformed.ok === false && malformed.code, "invalid");
    const noKey = await f.call("web-tools:test", { providerId: "deepseek", capability: "search" });
    assert.equal(noKey.ok === false && noKey.code, "no-key");
  });

  it("tests a provider and reports the result", async (t) => {
    const fetchStub: typeof fetch = async () => new Response(JSON.stringify({ hits: [{ t: "Hit", u: "https://hit.example" }] }), { status: 200 });
    const f = fixture(t, fetchStub);
    await f.call("web-tools:save", { enabled: false, searchProviderId: null, fetchProviderId: null, providers: [custom()] });
    await f.call("web-tools:set-key", { providerId: "mine", apiKey: "k" });
    const result = await f.call<WebToolsTestResult>("web-tools:test", { providerId: "mine", capability: "search" });
    assert.ok(result.ok);
    assert.equal(result.ok && result.value.size, 1);
    assert.equal(result.ok && result.value.title, "Hit");
    const unsupported = await f.call("web-tools:test", { providerId: "mine", capability: "fetch" });
    assert.equal(unsupported.ok === false && unsupported.code, "unsupported");
  });
});
