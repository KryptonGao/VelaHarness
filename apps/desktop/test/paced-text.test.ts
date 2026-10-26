import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PACE_DRAIN_SECONDS, PACE_MAX_CPS, PACE_MIN_CPS, pacedAdvance } from "../src/renderer/hooks/usePacedText.ts";

describe("paced text", () => {
  it("never passes the end of the text", () => {
    assert.equal(pacedAdvance(98, 100, 1000, true), 100);
    assert.equal(pacedAdvance(100, 100, 16, true), 100);
  });

  it("shows a small backlog at the minimum speed", () => {
    const next = pacedAdvance(0, 20, 100, true);
    assert.ok(Math.abs(next - PACE_MIN_CPS * 0.1) < 1e-9);
  });

  it("speeds up with the backlog but stays under the cap while streaming", () => {
    const next = pacedAdvance(0, 5000, 1000, true);
    assert.equal(next, PACE_MAX_CPS);
  });

  it("drains the remaining text quickly once streaming ends", () => {
    assert.ok(Math.abs(pacedAdvance(0, 5000, 1000, false) - 5000 / PACE_DRAIN_SECONDS) < 1e-6);
    assert.ok(pacedAdvance(0, 100, 1000, false) > PACE_MAX_CPS * 0.4 - 1);
  });
});
