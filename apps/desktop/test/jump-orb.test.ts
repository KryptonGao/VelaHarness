import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORB_LOOP_MS,
  ORB_MORPH_MS,
  blendOrbFrames,
  orbFrame,
  orbMorphEase,
  type OrbFrame,
  type OrbStyle,
  ORB_MIN_DWELL_MS,
  ORB_POOLS,
  createOrbRotation,
  drawOrbStyle,
  orbDwellMs,
  shuttleFrame,
  tiltedOrbit,
  type OrbActivity,
} from "../src/renderer/components/jump-orb.ts";
import { createOrbStyleStore } from "../src/renderer/components/orb-style-store.ts";

/** 确定性的伪随机数,保证洗牌结果可复现。 */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("drawOrbStyle", () => {
  for (const activity of ["thinking", "command"] as OrbActivity[]) {
    it(`shows every ${activity} style once per bag`, () => {
      const rotation = createOrbRotation();
      const pool = ORB_POOLS[activity];
      for (let round = 0; round < 5; round++) {
        const drawn = pool.map(() => drawOrbStyle(rotation, activity, seeded(round + 1)));
        assert.deepEqual([...drawn].sort(), [...pool].sort());
      }
    });

    it(`never repeats the same ${activity} style back to back`, () => {
      const rotation = createOrbRotation();
      const random = seeded(7);
      let previous = drawOrbStyle(rotation, activity, random);
      for (let index = 0; index < 200; index++) {
        const next = drawOrbStyle(rotation, activity, random);
        assert.notEqual(next, previous);
        previous = next;
      }
    });
  }

  it("keeps the two pools separate", () => {
    const rotation = createOrbRotation();
    for (let index = 0; index < 20; index++) {
      assert.ok(ORB_POOLS.thinking.includes(drawOrbStyle(rotation, "thinking")));
      assert.ok(ORB_POOLS.command.includes(drawOrbStyle(rotation, "command")));
    }
  });
});

describe("orbDwellMs", () => {
  it("plays every style for at least 3 seconds and one full loop", () => {
    for (const style of [...ORB_POOLS.thinking, ...ORB_POOLS.command]) {
      const dwell = orbDwellMs(style);
      assert.equal(ORB_MIN_DWELL_MS, 3000);
      assert.ok(dwell >= ORB_MIN_DWELL_MS, style);
      assert.ok(dwell >= ORB_LOOP_MS[style], style);
    }
  });

  it("derives the C5 loop from its beat table", () => {
    assert.ok(ORB_LOOP_MS.c5 > 3000 && ORB_LOOP_MS.c5 < 4500);
  });
});

describe("tiltedOrbit", () => {
  it("returns three dots that stay inside the button and change size with depth", () => {
    let smallest = Infinity;
    let largest = -Infinity;
    for (let step = 0; step < 400; step++) {
      const dots = tiltedOrbit(step * 0.05);
      assert.equal(dots.length, 3);
      for (const dot of dots) {
        assert.ok(Math.abs(dot.x) <= 8.01 && Math.abs(dot.y) <= 8.01);
        smallest = Math.min(smallest, dot.scale);
        largest = Math.max(largest, dot.scale);
      }
    }
    assert.ok(smallest < 0.8 && largest > 1.2);
  });
});

describe("shuttleFrame", () => {
  it("draws one connected path and four dots inside the 30px box", () => {
    for (let step = 0; step < 400; step++) {
      const frame = shuttleFrame(step * 0.03);
      assert.equal(frame.dots.length, 4);
      assert.match(frame.path, /^M-?\d+(\.\d+)? -?\d+(\.\d+)?(L-?\d+(\.\d+)? -?\d+(\.\d+)?)+$/);
      for (const dot of frame.dots) {
        assert.ok(dot.x > 0 && dot.x < 30 && dot.y > 0 && dot.y < 30);
        assert.ok(dot.r > 0.8 && dot.r < 2.6);
      }
    }
  });

  it("starts with a short head and no tail", () => {
    const frame = shuttleFrame(0);
    assert.equal(frame.path.split("L").length, 2);
  });
});

const ALL_STYLES: OrbStyle[] = [...ORB_POOLS.thinking, ...ORB_POOLS.command];

function farthest(a: OrbFrame, b: OrbFrame) {
  return Math.max(...a.dots.map((dot, index) => Math.hypot(dot.x - b.dots[index].x, dot.y - b.dots[index].y)));
}

describe("orbFrame", () => {
  it("draws four finite dots inside the 30px canvas for every style", () => {
    for (const style of ALL_STYLES) {
      for (let step = 0; step < 600; step++) {
        const frame = orbFrame(style, step * 0.025);
        assert.equal(frame.dots.length, 4, style);
        for (const dot of frame.dots) {
          assert.ok(Number.isFinite(dot.x) && Number.isFinite(dot.y) && Number.isFinite(dot.r) && Number.isFinite(dot.o), style);
          assert.ok(dot.x >= 0 && dot.x <= 30 && dot.y >= 0 && dot.y <= 30, `${style} ${dot.x},${dot.y}`);
          assert.ok(dot.r >= 0 && dot.r < 2.6 && dot.o >= 0 && dot.o <= 1, style);
        }
      }
    }
  });

  it("hides the fourth dot in the three-dot styles and only C5 has a line", () => {
    for (const style of ORB_POOLS.thinking) assert.equal(orbFrame(style, 1.3).dots[3].o, 0, style);
    for (const style of ORB_POOLS.command) assert.equal(orbFrame(style, 1.3).dots[3].o, 1, style);
    for (const style of ALL_STYLES) assert.equal(Boolean(orbFrame(style, 1.3).path), style === "c5", style);
  });

  it("moves smoothly: no dot moves more than 2px between 60fps frames", () => {
    for (const style of ALL_STYLES) {
      let previous = orbFrame(style, 0);
      for (let step = 1; step <= 60 * 12; step++) {
        const frame = orbFrame(style, step / 60);
        assert.ok(farthest(previous, frame) < 2, `${style} at ${(step / 60).toFixed(2)}s`);
        previous = frame;
      }
    }
  });
});

describe("blendOrbFrames", () => {
  it("starts exactly at the previous frame and ends exactly at the new one", () => {
    const from = orbFrame("t2", 1.1);
    const to = orbFrame("c5", 0);
    assert.equal(farthest(blendOrbFrames(from, to, 0), from), 0);
    assert.equal(farthest(blendOrbFrames(from, to, 1), to), 0);
  });

  it("switches between any two styles without a visible jump", () => {
    const frames = Math.round((ORB_MORPH_MS / 1000) * 60);
    for (const fromStyle of ALL_STYLES) {
      for (const toStyle of ALL_STYLES) {
        if (fromStyle === toStyle) continue;
        const departure = orbFrame(fromStyle, 2.7);
        let previous = departure;
        for (let step = 1; step <= frames; step++) {
          const frame = blendOrbFrames(departure, orbFrame(toStyle, step / 60), orbMorphEase(step / frames));
          assert.ok(farthest(previous, frame) < 2.2, `${fromStyle} -> ${toStyle} at frame ${step}`);
          previous = frame;
        }
      }
    }
  });
});

describe("createOrbStyleStore", () => {
  function fakeTimers() {
    const pending = new Map<number, { callback: () => void; ms: number }>();
    let next = 1;
    return {
      pending,
      timers: {
        set: (callback: () => void, ms: number) => { pending.set(next, { callback, ms }); return next++; },
        clear: (handle: unknown) => { pending.delete(handle as number); },
      },
      fire() {
        const [id, entry] = [...pending.entries()][0];
        pending.delete(id);
        entry.callback();
      },
    };
  }

  it("shares one style between subscribers and advances it after the dwell time", () => {
    const clock = fakeTimers();
    const store = createOrbStyleStore(seeded(3), clock.timers);
    const seen: string[] = [];
    const stopA = store.subscribe("thinking", () => seen.push("a"));
    const stopB = store.subscribe("thinking", () => seen.push("b"));
    const first = store.get("thinking");
    assert.equal(clock.pending.size, 1);
    assert.equal([...clock.pending.values()][0].ms, orbDwellMs(first));
    clock.fire();
    assert.notEqual(store.get("thinking"), first);
    assert.deepEqual(seen, ["a", "b"]);
    stopA();
    stopB();
  });

  it("stops the timer when the last subscriber leaves", () => {
    const clock = fakeTimers();
    const store = createOrbStyleStore(seeded(5), clock.timers);
    const stop = store.subscribe("command", () => {});
    assert.equal(clock.pending.size, 1);
    stop();
    assert.equal(clock.pending.size, 0);
  });

  it("keeps thinking and command styles in their own pools", () => {
    const store = createOrbStyleStore(seeded(9), fakeTimers().timers);
    assert.ok(ORB_POOLS.thinking.includes(store.get("thinking")));
    assert.ok(ORB_POOLS.command.includes(store.get("command")));
  });
});
