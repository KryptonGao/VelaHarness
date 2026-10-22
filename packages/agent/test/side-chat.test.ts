import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, AssistantMessage, AssistantMessageEvent, Context, Model } from "@earendil-works/pi-ai";
import type { MemorySourceLoad } from "@vela/shared";
import { parseSideChatRequest, SideChatService, sideChatHistory, sideChatSystemPrompt } from "../src/side-chat.ts";

const model = { provider: "p", id: "m", api: "openai-completions", reasoning: false } as Model<Api>;
const reasoningModel = { provider: "p", id: "r", api: "openai-completions", reasoning: true } as Model<Api>;
const request = {
  requestId: "req-1",
  conversationId: "0123abcd-0000-0000-0000-000000000000",
  locale: "zh-CN" as const,
  messages: [{ role: "user" as const, text: "你好" }],
};
const memory = (scope: "global" | "project", content: string): MemorySourceLoad => ({
  scope, workspace: scope === "project" ? "/repo" : null, path: `/${scope}/MEMORY.md`, status: "loaded",
  content, revision: null, bytes: content.length, error: null, message: null,
});
const final = (text: string): AssistantMessage => ({
  role: "assistant", content: [{ type: "text", text }], api: model.api, provider: model.provider, model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop", timestamp: 0,
});

/** 按给定事件逐个产出；收到 abort 时改发 aborted 错误事件。 */
function fakeRuntime(events: AssistantMessageEvent[], seen: { context?: Context; signal?: AbortSignal; reasoning?: string } = {}, gate?: Promise<void>) {
  return {
    streamSimple: ((_model: Model<Api>, context: Context, options?: { signal?: AbortSignal; reasoning?: string }) => {
      seen.context = context;
      seen.signal = options?.signal;
      seen.reasoning = options?.reasoning;
      return (async function* () {
        for (const event of events) {
          if (gate && event.type === "done") await gate;
          if (options?.signal?.aborted) {
            yield { type: "error", reason: "aborted", error: { ...final(""), stopReason: "aborted" } } as AssistantMessageEvent;
            return;
          }
          yield event;
        }
      })();
    }) as never,
  };
}

describe("side chat", () => {
  it("validates the IPC request", () => {
    assert.deepEqual(parseSideChatRequest(request), request);
    assert.deepEqual(parseSideChatRequest({ ...request, conversationId: null }), { ...request, conversationId: null });
    const withModel = { ...request, model: { provider: "x", id: "y", extra: 1 } };
    assert.deepEqual(parseSideChatRequest(withModel).model, { provider: "x", id: "y" });
    assert.equal(parseSideChatRequest({ ...request, thinkingLevel: "high" }).thinkingLevel, "high");
    for (const invalid of [
      null, {}, { ...request, requestId: "" }, { ...request, conversationId: "../etc" }, { ...request, locale: "fr" },
      { ...request, messages: [] }, { ...request, messages: [{ role: "assistant", text: "hi" }] },
      { ...request, messages: [{ role: "system", text: "hi" }] }, { ...request, messages: [{ role: "user", text: " " }] },
      { ...request, model: { provider: "x", id: " " } }, { ...request, thinkingLevel: "turbo" },
    ]) {
      assert.throws(() => parseSideChatRequest(invalid), /侧边聊天/);
    }
  });

  it("states the no-tool limits and includes loaded memory, project first", () => {
    const prompt = sideChatSystemPrompt("en", [memory("global", "Prefers pnpm."), memory("project", "Uses Electron.")]);
    assert.match(prompt, /no tools/);
    assert.match(prompt, /cannot save memories/);
    assert.ok(prompt.indexOf("Uses Electron.") < prompt.indexOf("Prefers pnpm."));
    assert.doesNotMatch(sideChatSystemPrompt("en", []), /<memory/);
    assert.doesNotMatch(sideChatSystemPrompt("en", [{ ...memory("global", "x"), status: "missing", content: "" }]), /<memory/);
  });

  it("keeps the newest history within budget and never starts with an assistant reply", () => {
    const long = "a".repeat(150_000);
    const history = sideChatHistory([
      { role: "user", text: long },
      { role: "assistant", text: long },
      { role: "user", text: "q2" },
      { role: "assistant", text: " " },
      { role: "user", text: "q3" },
    ]);
    assert.deepEqual(history, [{ role: "user", text: "q2" }, { role: "user", text: "q3" }]);
    // 超长的最后一条用户消息也保留。
    assert.equal(sideChatHistory([{ role: "user", text: "b".repeat(300_000) }]).length, 1);
  });

  it("streams deltas without tools and returns the final text", async () => {
    const seen: { context?: Context } = {};
    const deltas: string[] = [];
    const runtime = fakeRuntime([
      { type: "text_delta", contentIndex: 0, delta: "你", partial: final("") },
      { type: "text_delta", contentIndex: 0, delta: "好", partial: final("") },
      { type: "done", reason: "stop", message: final("你好") },
    ], seen);
    const result = await new SideChatService().run({
      runtime, model, request: { ...request, messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }, { role: "user", text: "再说" }] },
      memory: [memory("global", "Prefers pnpm.")], memoryEnabled: true, onDelta: (text) => deltas.push(text),
    });
    assert.deepEqual(deltas, ["你", "好"]);
    assert.equal(result.text, "你好");
    assert.equal(result.aborted, false);
    assert.equal(result.model, "p/m");
    assert.equal(result.memory[0]?.scope, "global");
    assert.equal("content" in result.memory[0]!, false);
    assert.equal(seen.context?.tools, undefined);
    assert.match(seen.context!.systemPrompt!, /Prefers pnpm\./);
    assert.deepEqual(seen.context!.messages.map((message) => message.role), ["user", "assistant", "user"]);
  });

  it("stops on cancel and keeps the partial reply", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = new SideChatService();
    const running = service.run({
      runtime: fakeRuntime([
        { type: "text_delta", contentIndex: 0, delta: "部分", partial: final("") },
        { type: "done", reason: "stop", message: final("部分完整") },
      ], {}, gate),
      model, request, memory: [], memoryEnabled: false, onDelta: () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));
    service.cancel(request.requestId);
    release();
    const result = await running;
    assert.equal(result.aborted, true);
    assert.equal(result.text, "部分");
    assert.equal(result.memoryEnabled, false);
  });

  it("passes the chosen reasoning effort, clamped to what the model supports", async () => {
    const done = { type: "done", reason: "stop", message: final("ok") } as AssistantMessageEvent;
    const seen: { reasoning?: string } = {};
    const service = new SideChatService();
    const high = await service.run({ runtime: fakeRuntime([done], seen), model: reasoningModel,
      request: { ...request, requestId: "r1", thinkingLevel: "high" }, memory: [], memoryEnabled: true, onDelta: () => undefined });
    assert.equal(seen.reasoning, "high");
    assert.equal(high.thinkingLevel, "high");
    const off = await service.run({ runtime: fakeRuntime([done], seen), model: reasoningModel,
      request: { ...request, requestId: "r2", thinkingLevel: "off" }, memory: [], memoryEnabled: true, onDelta: () => undefined });
    assert.equal(seen.reasoning, undefined);
    assert.equal(off.thinkingLevel, "off");
    // 不支持推理的模型一律关闭。
    const plain = await service.run({ runtime: fakeRuntime([done], seen), model,
      request: { ...request, requestId: "r3", thinkingLevel: "high" }, memory: [], memoryEnabled: true, onDelta: () => undefined });
    assert.equal(seen.reasoning, undefined);
    assert.equal(plain.thinkingLevel, "off");
  });

  it("surfaces provider errors", async () => {
    const runtime = fakeRuntime([{ type: "error", reason: "error", error: { ...final(""), stopReason: "error", errorMessage: "rate limited" } }]);
    await assert.rejects(new SideChatService().run({ runtime, model, request, memory: [], memoryEnabled: true, onDelta: () => undefined }), /rate limited/);
  });
});
