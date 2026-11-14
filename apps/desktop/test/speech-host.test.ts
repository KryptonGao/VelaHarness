import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock, type TestContext } from "node:test";
import { MemoryCredentialStore } from "@vela/agent";
import type { SpeechResult, SpeechState, SpeechTranscript } from "@vela/shared";

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
const { SpeechHost, parseSetKeyRequest, parseSynthesizeRequest, parseTranscribeRequest, readDictationConfig, defaultDictationConfig } = await import("../src/main/speech-host.ts");

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
    assert.deepEqual(parseSynthesizeRequest({ text: "你好" }), { text: "你好", voice: "stella" });
    assert.deepEqual(parseSynthesizeRequest({ text: "你好", voice: "tide" }), { text: "你好", voice: "tide" });
    assert.throws(() => parseSynthesizeRequest({ text: "你好", voice: "other" }), /不支持这个音色/);
    assert.throws(() => parseSynthesizeRequest({ text: "  " }), /没有可朗读/);
    assert.throws(() => parseSynthesizeRequest({ text: "x".repeat(70_000) }), /过长/);
    assert.throws(() => parseSynthesizeRequest({ text: "x", speed: 2 }), /格式不正确/);
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
    assert.deepEqual(JSON.parse(String(seen?.init.body)), { text: "你好", voice_id: "stella", format: "wav", filter_markdown: true });
    await call<Uint8Array>("speech:synthesize", { text: "你好", voice: "tide" });
    assert.equal(JSON.parse(String(seen?.init.body)).voice_id, "tide");
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

const wav = () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2]);
const ogg = () => new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("dictation request validation", () => {
  it("accepts WAV and Ogg audio of bounded size only", () => {
    assert.equal(parseTranscribeRequest({ audio: wav() }).audio.byteLength, 14);
    assert.equal(parseTranscribeRequest({ audio: ogg() }).audio.byteLength, 6);
    assert.throws(() => parseTranscribeRequest({ audio: new Uint8Array([1, 2, 3, 4]) }), /录音格式/);
    assert.throws(() => parseTranscribeRequest({ audio: "text" }), /录音格式/);
    assert.throws(() => parseTranscribeRequest({ audio: wav(), extra: 1 }), /格式不正确/);
    const tooLong = new Uint8Array(8 * 1024 * 1024 + 1);
    tooLong.set(wav());
    assert.throws(() => parseTranscribeRequest({ audio: tooLong }), /过长/);
  });
});

describe("dictation service", () => {
  it("refuses to transcribe without a key", async (t) => {
    const { call } = fixture(t, (async () => { throw new Error("must not be called"); }) as typeof fetch);
    const result = await call<SpeechTranscript>("speech:transcribe", { audio: wav() });
    assert.equal(!result.ok && result.code, "no-key");
  });

  it("uploads the recording, then refines the transcript with DeepSeek-Flash without thinking", async (t) => {
    const seen: { url: string; init: RequestInit }[] = [];
    const stub = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return url.endsWith("/asr") ? json({ request_id: "r", text: "呃 就是 那个 帮我看看 get hub 的 issue", duration_ms: 3000 })
        : json({ choices: [{ message: { content: "帮我看看 GitHub 的 issue。" } }] });
    }) as unknown as typeof fetch;
    const { call } = fixture(t, stub);
    await call("speech:set-key", { apiKey: "sk-secret" });
    const result = await call<SpeechTranscript>("speech:transcribe", { audio: wav() });
    assert.deepEqual(result, { ok: true, value: { text: "帮我看看 GitHub 的 issue。", refined: true } });

    assert.equal(seen[0]?.url, "https://api.deepseek.com/v1/tools/asr");
    assert.equal((seen[0]?.init.headers as Record<string, string>).Authorization, "Bearer sk-secret");
    const form = seen[0]?.init.body as FormData;
    assert.ok(form instanceof FormData);
    assert.equal((form.get("file") as File).name, "speech.wav");

    assert.equal(seen[1]?.url, "https://api.deepseek.com/chat/completions");
    const chat = JSON.parse(String(seen[1]?.init.body));
    assert.equal(chat.model, "deepseek-flash");
    assert.deepEqual(chat.thinking, { type: "enabled" });
    assert.equal(chat.reasoning_effort, "low");
    assert.equal(chat.messages[1].role, "user");
    assert.ok(chat.messages[1].content.includes("get hub"));
  });

  it("falls back to the raw transcript when refining fails or answers instead of tidying", async (t) => {
    const refiners: (() => Response | Promise<Response>)[] = [
      () => json({ error: "boom" }, 500),
      () => { throw new TypeError("fetch failed"); },
      () => json({ choices: [{ message: { content: "" } }] }),
      () => json({ choices: [{ message: { content: "很长的回答".repeat(200) } }] }),
    ];
    for (const refine of refiners) {
      const stub = (async (url: string) => url.endsWith("/asr") ? json({ text: "你好世界" }) : refine()) as unknown as typeof fetch;
      const { call } = fixture(t, stub);
      await call("speech:set-key", { apiKey: "k" });
      const result = await call<SpeechTranscript>("speech:transcribe", { audio: wav() });
      assert.deepEqual(result, { ok: true, value: { text: "你好世界", refined: false } });
      handlers.clear();
    }
  });

  it("reports silence and maps ASR HTTP failures to codes", async (t) => {
    const silent = fixture(t, (async () => json({ text: "  " })) as unknown as typeof fetch);
    await silent.call("speech:set-key", { apiKey: "k" });
    const none = await silent.call<SpeechTranscript>("speech:transcribe", { audio: wav() });
    assert.equal(!none.ok && none.code, "no-speech");
    handlers.clear();

    const statuses: Record<number, string> = { 401: "auth", 400: "rejected", 413: "rejected", 408: "timeout", 429: "busy", 503: "busy", 504: "timeout", 500: "failed" };
    for (const [status, code] of Object.entries(statuses)) {
      const { call } = fixture(t, (async () => new Response("secret sk-secret", { status: Number(status) })) as unknown as typeof fetch);
      await call("speech:set-key", { apiKey: "sk-secret" });
      const result = await call<SpeechTranscript>("speech:transcribe", { audio: ogg() });
      assert.equal(!result.ok && result.code, code, status);
      assert.ok(!JSON.stringify(result).includes("sk-secret"));
      handlers.clear();
    }
  });
});

describe("dictation config", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "vela-dictation-"));

  it("writes the defaults when the file is missing so users can find and edit it", () => {
    const path = join(dir(), "dictation.json");
    assert.deepEqual(readDictationConfig(path), { model: "deepseek-flash", effort: "low" });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), defaultDictationConfig);
  });

  it("reads edits on every call and falls back per field when values are invalid", () => {
    const path = join(dir(), "dictation.json");
    writeFileSync(path, JSON.stringify({ model: " deepseek-v4-pro ", effort: "high" }));
    assert.deepEqual(readDictationConfig(path), { model: "deepseek-v4-pro", effort: "high" });
    writeFileSync(path, JSON.stringify({ model: 3, effort: "turbo" }));
    assert.deepEqual(readDictationConfig(path), defaultDictationConfig);
    writeFileSync(path, "{ not json");
    assert.deepEqual(readDictationConfig(path), defaultDictationConfig);
  });

  it("sends the configured model and disables thinking when effort is off", async (t) => {
    const path = join(dir(), "dictation.json");
    writeFileSync(path, JSON.stringify({ model: "my-model", effort: "off" }));
    let chat: Record<string, unknown> = {};
    const stub = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/asr")) return json({ text: "你好" });
      chat = JSON.parse(String(init.body));
      return json({ choices: [{ message: { content: "你好。" } }] });
    }) as unknown as typeof fetch;
    handlers.clear();
    const host = new SpeechHost(new MemoryCredentialStore(), { fetch: stub, dictationConfigPath: path });
    host.register();
    t.after(() => host.dispose());
    const frame = {};
    const event = { sender: { mainFrame: frame }, senderFrame: frame };
    await handlers.get("speech:set-key")!(event, { apiKey: "k" });
    await handlers.get("speech:transcribe")!(event, { audio: wav() });
    assert.equal(chat.model, "my-model");
    assert.deepEqual(chat.thinking, { type: "disabled" });
    assert.equal("reasoning_effort" in chat, false);
  });
});
