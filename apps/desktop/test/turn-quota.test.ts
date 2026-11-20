import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTurnQuota, consumedText, quotaWindowName } from "../src/renderer/components/turn-quota.ts";

const limits = (...windows: [number, number][]) => ({
  provider: "openai-codex",
  plan: null,
  fetchedAt: 0,
  windows: windows.map(([windowMinutes, usedPercent]) => ({ windowMinutes, usedPercent, resetsAt: null })),
});

describe("turn quota consumption", () => {
  it("subtracts the usage at turn start per window", () => {
    assert.deepEqual(computeTurnQuota(limits([300, 10], [10080, 40]), limits([300, 12.5], [10080, 41])), [
      { windowMinutes: 300, consumedPercent: 2.5 },
      { windowMinutes: 10080, consumedPercent: 1 },
    ]);
  });

  it("only reports the weekly window for plans without a 5-hour window", () => {
    const result = computeTurnQuota(limits([10080, 40]), limits([10080, 40.5]));
    assert.deepEqual(result.map((item) => item.windowMinutes), [10080]);
  });

  it("uses the current value as a lower bound when a window reset mid-turn", () => {
    assert.deepEqual(computeTurnQuota(limits([300, 95]), limits([300, 3])), [{ windowMinutes: 300, consumedPercent: 3 }]);
  });

  it("ignores windows that were not present at the start", () => {
    assert.deepEqual(computeTurnQuota(limits([10080, 1]), limits([300, 5], [10080, 2])), [{ windowMinutes: 10080, consumedPercent: 1 }]);
  });

  it("rounds to whole percent and shows <1% below one percent", () => {
    assert.equal(consumedText(0), "<1%");
    assert.equal(consumedText(0.4), "<1%");
    assert.equal(consumedText(0.5), "1%");
    assert.equal(consumedText(2.4), "2%");
    assert.equal(consumedText(12.6), "13%");
  });

  it("names windows briefly", () => {
    assert.equal(quotaWindowName(300), "5h");
    assert.equal(quotaWindowName(10080), "1w");
    assert.equal(quotaWindowName(2880), "2d");
    assert.equal(quotaWindowName(90), "90m");
  });
});
