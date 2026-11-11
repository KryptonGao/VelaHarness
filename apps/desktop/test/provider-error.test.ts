import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProviderError } from "../src/renderer/components/provider-error.ts";

const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const parse = (message: string) => parseProviderError(message, NOW);

describe("parseProviderError plain text", () => {
  it("parses the Codex usage limit error", () => {
    assert.deepEqual(parse("Codex error: The usage limit has been reached"), {
      kind: "usage-limit", source: "Codex", plan: null, retryMinutes: null, message: null,
    });
  });

  it("reads the plan and wait time from the friendly ChatGPT message", () => {
    const parsed = parse("You have hit your ChatGPT usage limit (plus plan). Try again in ~125 min.");
    assert.equal(parsed?.kind, "usage-limit");
    assert.equal(parsed?.plan, "Plus");
    assert.equal(parsed?.retryMinutes, 125);
  });

  it("treats Codex capacity errors as a busy model", () => {
    const parsed = parse("Codex error: Selected model is at capacity. Please try a different model.");
    assert.equal(parsed?.kind, "overloaded");
    assert.equal(parsed?.source, "Codex");
  });

  it("reads OpenAI style durations", () => {
    assert.equal(parse("429 Rate limit reached for gpt-5. Please try again in 1m30s.")?.retryMinutes, 2);
    assert.equal(parse("429 Rate limit reached. Please try again in 7.5s.")?.retryMinutes, 1);
  });

  it("unwraps the IPC prefix", () => {
    assert.equal(parse("Error invoking remote method 'x': Error: insufficient_quota")?.kind, "usage-limit");
  });

  it("leaves unrelated errors alone", () => {
    assert.equal(parse("无法读取文件"), null);
    assert.equal(parse("Codex error: invalid request"), null);
    assert.equal(parseProviderError(null), null);
  });
});

describe("parseProviderError JSON bodies", () => {
  it("reads OpenAI usage limit JSON with a reset timestamp", () => {
    const resetsAt = Math.floor(NOW / 1000) + 3 * 3600;
    const parsed = parse(JSON.stringify({ error: { type: "usage_limit_reached", message: "The usage limit has been reached", plan_type: "pro", resets_at: resetsAt } }));
    assert.deepEqual(parsed, { kind: "usage-limit", source: null, plan: "Pro", retryMinutes: 180, message: "The usage limit has been reached" });
  });

  it("reads resets_in_seconds and a status prefix", () => {
    const parsed = parse(`429 ${JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Slow down", resets_in_seconds: 90 } })}`);
    assert.equal(parsed?.kind, "rate-limit");
    assert.equal(parsed?.retryMinutes, 2);
  });

  it("reads Anthropic overloaded and rate limit envelopes", () => {
    assert.equal(parse('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')?.kind, "overloaded");
    assert.equal(parse('429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit."}}')?.kind, "rate-limit");
  });

  it("reads Google RESOURCE_EXHAUSTED with a retry delay, including array bodies", () => {
    const body = [{ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric", details: [{ retryDelay: "34s" }] } }];
    const parsed = parse(JSON.stringify(body));
    assert.equal(parsed?.kind, "usage-limit");
    assert.equal(parsed?.retryMinutes, 1);
    assert.equal(parse(JSON.stringify([{ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Try later" } }]))?.kind, "rate-limit");
  });

  it("unwraps JSON nested inside a message field", () => {
    const inner = JSON.stringify({ error: { type: "insufficient_quota", message: "You exceeded your current quota" } });
    assert.equal(parse(JSON.stringify({ error: { message: inner, code: 429 } }))?.kind, "usage-limit");
  });

  it("recognises auth and context length errors", () => {
    assert.equal(parse('401 {"error":{"code":"invalid_api_key","message":"Incorrect API key provided"}}')?.kind, "auth");
    assert.equal(parse('{"error":{"code":"context_length_exceeded","message":"maximum context length is 128000 tokens"}}')?.kind, "context");
  });

  it("turns any other JSON error into a readable message", () => {
    const parsed = parse('Foo error: {"error":{"message":"Model not found: foo-1"}}');
    assert.equal(parsed?.kind, "other");
    assert.equal(parsed?.source, "Foo");
    assert.equal(parsed?.message, "Model not found: foo-1");
  });

  it("ignores JSON without an error message", () => {
    assert.equal(parse('{"ok":false}'), null);
    assert.equal(parse("{ not json"), null);
  });
});
