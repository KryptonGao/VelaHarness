import assert from "node:assert/strict";
import { describe, it, mock, type TestContext } from "node:test";
import { MemoryCredentialStore } from "@vela/agent";
import type { SpeechResult, SpeechState } from "@vela/shared";

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
const { SpeechHost, parseSetKeyRequest, parseSynthesizeRequest } = await import("../src/main/speech-host.ts");

function fixture(t: TestContext, fetchStub?: typeof fetch) {
  handlers.clear();
  const host = new SpeechHost(new MemoryCredentialStore(), fetchStub ? { fetch: fetchStub } : {});
  host.register();
  const frame = {};
  const event = { sender: { mainFrame: frame }, senderFrame: frame };
  t.after(() => host.dispose());
  return { call: <T>(channel: string, input?: unknown) => handlers.get(channel)!(event, input) as Promise<SpeechResult<T>> };
}

describe("speech IPC validation", () => {
  it("accepts a trimmed key or null and rejects anything else", () => {
    assert.deepEqual(parseSetKeyRequest({ apiKey: " sk-1 " }), { apiKey: "sk-1" });
    assert.deepEqual(parseSetKeyRequest({ apiKey: null }), { apiKey: null });
    assert.throws(() => parseSetKeyRequest({ apiKey: "" }), /密钥格式/);
    assert.throws(() => parseSetKeyRequest({ apiKey: "a b" }), /密钥格式/);
    assert.throws(() => parseSetKeyRequest({ apiKey: 3 }), /文本或 null/);
    assert.throws(() => parseSetKeyRequest({ apiKey: "k", extra: 1 }), /格式不正确/);
    assert.throws(() => parseSetKeyRequest(null), /格式不正确/);
  });

  it("requires non-empty text of bounded size", () => {
    assert.deepEqual(parseSynthesizeRequest({ text: "你好" }), { text: "你好" });
    assert.throws(() => parseSynthesizeRequest({ text: "  " }), /没有可朗读/);
    assert.throws(() => parseSynthesizeRequest({ text: "x".repeat(70_000) }), /过长/);
    assert.throws(() => parseSynthesizeRequest({ text: "x", voice: "tide" }), /格式不正确/);
  });
});

describe("speech service", () => {
  it("reports configured state without exposing the key", async (t) => {
    const { call } = fixture(t);
    assert.deepEqual((await call<SpeechState>("speech:get")), { ok: true, value: { configured: false, keysAvailable: true } });
    const saved = await call<SpeechState>("speech:set-key", { apiKey: "sk-secret" });
    assert.deepEqual(saved, { ok: true, value: { configured: true, keysAvailable: true } });
    assert.ok(!JSON.stringify(saved).includes("sk-secret"));
    const cleared = await call<SpeechState>("speech:set-key", { apiKey: null });
    assert.deepEqual(cleared, { ok: true, value: { configured: false, keysAvailable: true } });
  });

  it("refuses to synthesize without a key", async (t) => {
    const { call } = fixture(t, (async () => { throw new Error("must not be called"); }) as typeof fetch);
    const result = await call<Uint8Array>("speech:synthesize", { text: "你好" });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "no-key");
  });

  it("posts wav requests with the bearer key and returns audio bytes", async (t) => {
    let seen: { url: string; init: RequestInit } | undefined;
    const stub = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;
    const { call } = fixture(t, stub);
    await call("speech:set-key", { apiKey: "sk-secret" });
    const result = await call<Uint8Array>("speech:synthesize", { text: "你好" });
    assert.ok(result.ok);
    assert.deepEqual([...(result.ok ? result.value : [])], [1, 2, 3]);
    assert.equal(seen?.url, "https://api.deepseek.com/v1/tools/tts");
    assert.equal(seen?.init.method, "POST");
    assert.equal((seen?.init.headers as Record<string, string>).Authorization, "Bearer sk-secret");
    assert.deepEqual(JSON.parse(String(seen?.init.body)), { text: "你好", format: "wav", filter_markdown: true });
  });

  it("maps HTTP failures to codes and never leaks the key", async (t) => {
    const statuses: Record<number, string> = { 401: "auth", 400: "rejected", 429: "busy", 503: "busy", 504: "timeout", 500: "failed" };
    for (const [status, code] of Object.entries(statuses)) {
      const stub = (async () => new Response("secret sk-secret", { status: Number(status) })) as unknown as typeof fetch;
      const { call } = fixture(t, stub);
      await call("speech:set-key", { apiKey: "sk-secret" });
      const result = await call<Uint8Array>("speech:synthesize", { text: "你好" });
      assert.equal(result.ok, false, status);
      assert.equal(!result.ok && result.code, code, status);
      assert.ok(!JSON.stringify(result).includes("sk-secret"));
      handlers.clear();
    }
  });

  it("treats an empty audio body and a network error as failures", async (t) => {
    const empty = fixture(t, (async () => new Response(new Uint8Array(), { status: 200 })) as unknown as typeof fetch);
    await empty.call("speech:set-key", { apiKey: "k" });
    const first = await empty.call<Uint8Array>("speech:synthesize", { text: "x" });
    assert.equal(!first.ok && first.code, "failed");
    handlers.clear();
    const down = fixture(t, (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    await down.call("speech:set-key", { apiKey: "k" });
    const second = await down.call<Uint8Array>("speech:synthesize", { text: "x" });
    assert.equal(!second.ok && second.code, "network");
  });
});
