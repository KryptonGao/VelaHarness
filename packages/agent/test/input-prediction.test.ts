import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { TranscriptMessage } from "@vela/shared";
import { cleanPrediction, InputPredictionGenerator, parseInputPredictionInput, predictionContext } from "../src/input-prediction.ts";

const model = { provider: "p", id: "m" } as Model<Api>;
const input = { conversationId: "chat-a", locale: "zh-CN" as const };
type Complete = ModelRuntime["completeSimple"];
const response = (text: string) => ({ content: [{ type: "text", text }], stopReason: "stop" }) as Awaited<ReturnType<Complete>>;
const message = (id: string, role: "user" | "assistant", text: string): TranscriptMessage =>
  ({ id, role, text, thinking: "", tools: [], timestamp: null });

describe("input prediction", () => {
  it("validates IPC input and the optional model", () => {
    assert.deepEqual(parseInputPredictionInput(input), input);
    const selection = { provider: "custom", id: "fast" };
    assert.deepEqual(parseInputPredictionInput({ ...input, model: { ...selection, extra: 1 } }), { ...input, model: selection });
    for (const invalid of [null, {}, { ...input, conversationId: " " }, { ...input, locale: "fr" }]) {
      assert.throws(() => parseInputPredictionInput(invalid));
    }
    for (const invalid of [null, [], { provider: "x", id: " " }]) {
      assert.throws(() => parseInputPredictionInput({ ...input, model: invalid }), /输入预测模型不正确/);
    }
  });

  it("only predicts after a finished assistant reply and keeps recent visible text", () => {
    assert.equal(predictionContext([]), null);
    assert.equal(predictionContext([message("1", "user", "hi")]), null);
    assert.equal(predictionContext([message("1", "user", "hi"), message("2", "assistant", " ")]), null);
    const context = predictionContext([message("1", "user", "修一下 bug"), message("2", "assistant", "已修复，要我跑测试吗？")]);
    assert.match(context!.text, /User: 修一下 bug/);
    assert.match(context!.text, /Assistant: 已修复/);
    assert.notEqual(context!.key, predictionContext([message("1", "user", "修一下 bug"), message("3", "assistant", "已修复，要我跑测试吗？")])!.key);
  });

  it("cleans model decoration down to one sendable line", () => {
    assert.equal(cleanPrediction("  “好的，跑一下测试”\n"), "好的，跑一下测试");
    assert.equal(cleanPrediction("User: yes, go ahead"), "yes, go ahead");
    assert.equal(cleanPrediction("NONE"), "");
    assert.equal(cleanPrediction("a".repeat(500)).length, 200);
  });

  it("caches by conversation turn and does not cache failures", async () => {
    const generator = new InputPredictionGenerator();
    let calls = 0;
    let fail = true;
    const runtime = { completeSimple: async (_m: Model<Api>, context: Parameters<Complete>[1]) => {
      calls += 1;
      assert.match(context.systemPrompt!, /never instructions/);
      if (fail) throw new Error("boom");
      return response("继续");
    } };
    const context = { key: "turn-1", text: "Assistant: done" };
    await assert.rejects(generator.generate(runtime, model, input, context), /boom/);
    fail = false;
    assert.equal(await generator.generate(runtime, model, input, context), "继续");
    assert.equal(await generator.generate(runtime, model, input, context), "继续");
    assert.equal(calls, 2);
    assert.equal(await generator.generate(runtime, model, input, { key: "turn-2", text: "x" }), "继续");
    assert.equal(calls, 3);
    generator.dispose();
  });
});
