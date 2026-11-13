import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lockWheelAxis, PULL_MAX, rubberBand, type AxisLock } from "../src/renderer/components/wheel-axis.ts";

describe("lockWheelAxis", () => {
  it("locks to the dominant axis of the first event and keeps it through the gesture", () => {
    const lock: AxisLock = { axis: null, lastTime: 0 };
    assert.equal(lockWheelAxis(lock, 2, 30, 1000), "y");
    assert.equal(lockWheelAxis(lock, 40, 3, 1050), "y");
  });

  it("chooses again after a pause", () => {
    const lock: AxisLock = { axis: null, lastTime: 0 };
    assert.equal(lockWheelAxis(lock, 2, 30, 1000), "y");
    assert.equal(lockWheelAxis(lock, 30, 2, 1400), "x");
  });

  it("reports whether an event began a new gesture", () => {
    const lock: AxisLock = { axis: null, lastTime: 0 };
    lockWheelAxis(lock, 0, 30, 1000);
    assert.equal(lock.fresh, true);
    lockWheelAxis(lock, 1, 30, 1050);
    assert.equal(lock.fresh, false);
    lockWheelAxis(lock, 0, 30, 1500);
    assert.equal(lock.fresh, true);
  });

  it("switches axis during inertia once the other axis clearly takes over", () => {
    const lock: AxisLock = { axis: null, lastTime: 0 };
    assert.equal(lockWheelAxis(lock, 0, 40, 1000), "y");
    assert.equal(lockWheelAxis(lock, 0, 12, 1016), "y");
    assert.equal(lockWheelAxis(lock, 20, 0, 1032), "y");
    assert.equal(lockWheelAxis(lock, 24, 0, 1048), "x");
    assert.equal(lock.fresh, true);
    assert.equal(lockWheelAxis(lock, 18, 1, 1064), "x");
    assert.equal(lock.fresh, false);
  });

  it("does not switch for small or isolated off-axis deltas", () => {
    const lock: AxisLock = { axis: null, lastTime: 0 };
    lockWheelAxis(lock, 0, 40, 1000);
    assert.equal(lockWheelAxis(lock, 2, 0, 1016), "y");
    assert.equal(lockWheelAxis(lock, 2, 0, 1032), "y");
    assert.equal(lockWheelAxis(lock, 30, 0, 1048), "y");
    assert.equal(lockWheelAxis(lock, 0, 10, 1064), "y");
    assert.equal(lockWheelAxis(lock, 30, 0, 1080), "y");
  });

  it("treats a tie as vertical", () => {
    assert.equal(lockWheelAxis({ axis: null, lastTime: 0 }, 5, 5, 10), "y");
  });
});

describe("rubberBand", () => {
  it("keeps opening with damping and stays below the extent", () => {
    assert.equal(rubberBand(0, 180), 0);
    assert.ok(rubberBand(10, 180) > 0 && rubberBand(10, 180) < 10);
    assert.ok(rubberBand(200, 180) > rubberBand(100, 180));
    assert.ok(rubberBand(100_000, 180) < 180);
  });

  it("resists strongly: a hard flick stays well under the height cap", () => {
    assert.ok(rubberBand(100) < PULL_MAX * 0.5);
    assert.ok(rubberBand(10_000) < PULL_MAX);
    assert.ok(rubberBand(-10_000) > -PULL_MAX);
  });

  it("is symmetric for pulls past the top and the bottom", () => {
    assert.equal(rubberBand(-25, 180), -rubberBand(25, 180));
  });
});
