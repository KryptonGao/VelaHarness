import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampThinkingActivityDelayMs,
  defaultThinkingActivityDelayMs,
  maxThinkingActivityDelayMs,
  minThinkingActivityDelayMs,
} from "../src/renderer/thinking-activity-delay.ts";

describe("thinking activity delay preferences", () => {
  it("keeps the existing 500 ms default and accepts custom integer thresholds", () => {
    assert.equal(defaultThinkingActivityDelayMs, 500);
    for (const value of [100, 250, 500, 1200, 5000]) assert.equal(clampThinkingActivityDelayMs(value), value);
    assert.equal(clampThinkingActivityDelayMs(1234.6), 1235);
  });

  it("clamps thresholds while keeping disabling separate from the saved duration", () => {
    for (const value of [-100, 0, 1, 99]) assert.equal(clampThinkingActivityDelayMs(value), minThinkingActivityDelayMs);
    for (const value of [5001, 1e9]) assert.equal(clampThinkingActivityDelayMs(value), maxThinkingActivityDelayMs);
  });

  it("uses the default for non-finite values", () => {
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(clampThinkingActivityDelayMs(value), defaultThinkingActivityDelayMs);
  });
});
