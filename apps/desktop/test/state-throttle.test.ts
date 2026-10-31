import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StateThrottle } from "../src/main/state-throttle.ts";

function setup() {
  let sent = 0;
  let tick: (() => void) | null = null;
  let timers = 0;
  const throttle = new StateThrottle(() => { sent += 1; }, {
    setTimer: (fn) => { tick = fn; timers += 1; return timers as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => { tick = null; },
  });
  return { throttle, sent: () => sent, timers: () => timers, fire: () => { const fn = tick; tick = null; fn?.(); } };
}

describe("StateThrottle", () => {
  it("窗口内的多次请求只广播一次", () => {
    const { throttle, sent, timers, fire } = setup();
    throttle.request();
    throttle.request();
    throttle.request();
    assert.equal(sent(), 0);
    assert.equal(timers(), 1);
    fire();
    assert.equal(sent(), 1);
    throttle.request();
    assert.equal(timers(), 2);
  });

  it("now() 立即广播并取消排队的那次", () => {
    const { throttle, sent, fire } = setup();
    throttle.request();
    throttle.now();
    assert.equal(sent(), 1);
    fire();
    assert.equal(sent(), 1);
  });

  it("cancel() 丢弃排队的广播", () => {
    const { throttle, sent, fire } = setup();
    throttle.request();
    throttle.cancel();
    fire();
    assert.equal(sent(), 0);
  });
});
