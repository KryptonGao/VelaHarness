import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandedThinkingGroupHeight } from "../src/renderer/thinking-group-height.ts";

describe("thinking group growth with expanded details", () => {
  it("adds the difference between the group and detail limits to short details", () => {
    const height = expandedThinkingGroupHeight(100, [140], 280, 200);
    assert.equal(height, 220);
    assert.equal(height - 140, 280 - 200);
  });

  it("caps long details and the group at their configured limits", () => {
    assert.equal(expandedThinkingGroupHeight(100, [900], 280, 200), 280);
    assert.equal(expandedThinkingGroupHeight(500, [900], 280, 200), 280);
  });

  it("does not shrink an already taller group or add space when details are closed", () => {
    assert.equal(expandedThinkingGroupHeight(250, [80], 280, 200), 250);
    assert.equal(expandedThinkingGroupHeight(100, [], 280, 200), 100);
  });

  it("uses the tallest expanded detail rather than accumulating their heights", () => {
    assert.equal(expandedThinkingGroupHeight(100, [60, 140, 100], 280, 200), 220);
    assert.equal(expandedThinkingGroupHeight(100, [140, 60], 280, 200), 220);
  });

  it("never introduces a negative gap when the detail limit exceeds the group limit", () => {
    assert.equal(expandedThinkingGroupHeight(50, [100], 160, 400), 100);
    assert.equal(expandedThinkingGroupHeight(50, [300], 160, 400), 160);
    assert.equal(expandedThinkingGroupHeight(50, [100], 200, 200), 100);
  });

  it("responds to changed limits without accumulating prior expansion", () => {
    assert.equal(expandedThinkingGroupHeight(100, [140], 400, 200), 340);
    assert.equal(expandedThinkingGroupHeight(100, [140], 240, 200), 180);
    assert.equal(expandedThinkingGroupHeight(100, [140], 400, 320), 220);
  });
});
