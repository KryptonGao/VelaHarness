import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSecondClock } from "../src/renderer/second-clock.ts";

function setup() {
  let started = 0;
  let cleared = 0;
  let tick: (() => void) | null = null;
  let time = 1000;
  const clock = createSecondClock({
    now: () => time,
    setTimer: (fn) => { started += 1; tick = fn; return started as unknown as ReturnType<typeof setInterval>; },
    clearTimer: () => { cleared += 1; tick = null; },
  });
  return {
    clock,
    started: () => started,
    cleared: () => cleared,
    fire: (next: number) => { time = next; tick?.(); },
  };
}

describe("createSecondClock", () => {
  it("多个订阅者共用一个定时器，同一次 tick 收到同一个时间", () => {
    const { clock, started, fire } = setup();
    const a: number[] = [];
    const b: number[] = [];
    clock.subscribe((now) => a.push(now));
    clock.subscribe((now) => b.push(now));
    assert.equal(started(), 1);
    fire(2000);
    assert.deepEqual(a, [2000]);
    assert.deepEqual(b, [2000]);
  });

  it("最后一个订阅者退订才停定时器，之后再订阅会重新启动", () => {
    const { clock, started, cleared, fire } = setup();
    const seen: number[] = [];
    const offA = clock.subscribe(() => {});
    const offB = clock.subscribe((now) => seen.push(now));
    offA();
    assert.equal(cleared(), 0);
    fire(2000);
    assert.deepEqual(seen, [2000]);
    offB();
    assert.equal(cleared(), 1);
    assert.equal(clock.size(), 0);
    clock.subscribe(() => {});
    assert.equal(started(), 2);
  });

  it("tick 里退订自己不影响其他订阅者", () => {
    const { clock, fire } = setup();
    const seen: number[] = [];
    const off = clock.subscribe(() => off());
    clock.subscribe((now) => seen.push(now));
    fire(2000);
    assert.deepEqual(seen, [2000]);
    assert.equal(clock.size(), 1);
  });
});
