import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStreamEvent } from "../src/preload/stream-event.ts";

describe("preload 事件白名单", () => {
  it("放行 proposed_plan 三类事件，聊天里的计划卡片才能实时出现", () => {
    assert.equal(isStreamEvent({ type: "proposed_plan_start", conversationId: "c1", planId: "p1", revision: 1 }), true);
    assert.equal(isStreamEvent({ type: "proposed_plan_delta", conversationId: "c1", planId: "p1", delta: "# 方案" }), true);
    assert.equal(isStreamEvent({ type: "proposed_plan_end", conversationId: "c1", plan: { id: "p1", markdown: "# 方案" } }), true);
  });

  it("丢弃字段不完整的 proposed_plan 事件", () => {
    assert.equal(isStreamEvent({ type: "proposed_plan_start", conversationId: "c1", planId: "p1" }), false);
    assert.equal(isStreamEvent({ type: "proposed_plan_delta", conversationId: "c1", delta: "x" }), false);
    assert.equal(isStreamEvent({ type: "proposed_plan_end", conversationId: "c1", plan: null }), false);
  });

  it("放行 assistant_update / assistant_end，模型来源才能随消息更新", () => {
    assert.equal(isStreamEvent({ type: "assistant_update", conversationId: "c1", model: "m", provider: "p" }), true);
    assert.equal(isStreamEvent({ type: "assistant_end", conversationId: "c1", model: "m", provider: "p" }), true);
  });

  it("仍然拒绝未知事件", () => {
    assert.equal(isStreamEvent({ type: "nope", conversationId: "c1" }), false);
    assert.equal(isStreamEvent(null), false);
  });
});
