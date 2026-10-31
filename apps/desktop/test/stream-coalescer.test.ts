import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentStreamEvent } from "@vela/shared";
import { StreamCoalescer } from "../src/main/stream-coalescer.ts";

function setup() {
  const sent: AgentStreamEvent[] = [];
  let tick: (() => void) | null = null;
  let timers = 0;
  const coalescer = new StreamCoalescer((event) => sent.push(event), {
    setTimer: (fn) => { tick = fn; timers += 1; return timers as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => { tick = null; },
  });
  return { sent, coalescer, fire: () => { const fn = tick; tick = null; fn?.(); }, timers: () => timers };
}

const text = (agentId: string, delta: string, conversationId = "c1"): AgentStreamEvent =>
  ({ type: "agent_event", conversationId, agentId, event: { type: "text_delta", delta } });
const thinking = (agentId: string, delta: string): AgentStreamEvent =>
  ({ type: "agent_event", conversationId: "c1", agentId, event: { type: "thinking_delta", delta } });

describe("StreamCoalescer", () => {
  it("同一子代理连续的 delta 合成一条，窗口到点才发", () => {
    const { sent, coalescer, fire, timers } = setup();
    coalescer.push(text("a", "你"));
    coalescer.push(text("a", "好"));
    coalescer.push(text("a", "！"));
    assert.equal(sent.length, 0);
    assert.equal(timers(), 1);
    fire();
    assert.deepEqual(sent, [text("a", "你好！")]);
  });

  it("多个子代理各自合并，互不影响", () => {
    const { sent, coalescer, fire } = setup();
    coalescer.push(text("a", "1"));
    coalescer.push(text("b", "x"));
    coalescer.push(text("a", "2"));
    coalescer.push(text("b", "y"));
    fire();
    assert.deepEqual(sent, [text("a", "12"), text("b", "xy")]);
  });

  it("同一子代理 text 与 thinking 交替时保持原有顺序", () => {
    const { sent, coalescer, fire } = setup();
    coalescer.push(thinking("a", "想"));
    coalescer.push(text("a", "答"));
    coalescer.push(thinking("a", "再想"));
    fire();
    assert.deepEqual(sent, [thinking("a", "想"), text("a", "答"), thinking("a", "再想")]);
  });

  it("该子代理的工具事件先冲掉它缓冲的 delta，再按序发出", () => {
    const { sent, coalescer } = setup();
    const toolStart: AgentStreamEvent = {
      type: "agent_event", conversationId: "c1", agentId: "a",
      event: { type: "tool_start", toolCallId: "t1", toolName: "read", activity: {} },
    };
    coalescer.push(text("a", "先"));
    coalescer.push(text("b", "别人"));
    coalescer.push(toolStart);
    assert.deepEqual(sent, [text("a", "先"), toolStart]);
  });

  it("同一对话的其他事件（agents、error）先冲掉该对话的缓冲，别的对话不动", () => {
    const { sent, coalescer, fire } = setup();
    coalescer.push(text("a", "1"));
    coalescer.push(text("a", "2", "c2"));
    const error: AgentStreamEvent = { type: "error", conversationId: "c1", message: "boom" };
    coalescer.push(error);
    assert.deepEqual(sent, [text("a", "1"), error]);
    fire();
    assert.deepEqual(sent.slice(2), [text("a", "2", "c2")]);
  });

  it("主对话自己的 delta 直接发，不冲掉子代理缓冲", () => {
    const { sent, coalescer } = setup();
    const rootDelta: AgentStreamEvent = { type: "text_delta", conversationId: "c1", delta: "root" };
    coalescer.push(text("a", "sub"));
    coalescer.push(rootDelta);
    assert.deepEqual(sent, [rootDelta]);
  });

  it("state 事件冲掉全部缓冲；flush 在没有缓冲时是空操作", () => {
    const { sent, coalescer } = setup();
    coalescer.flush();
    assert.equal(sent.length, 0);
    coalescer.push(text("a", "1"));
    coalescer.push(text("b", "2", "c2"));
    coalescer.push({ type: "state" } as AgentStreamEvent);
    assert.equal(sent.length, 3);
    assert.equal(sent[2]?.type, "state");
  });
});
