import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTurnQuota, consumedText, turnQuotaText } from "../src/renderer/components/turn-quota.ts";

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

  it("formats small and large amounts", () => {
    assert.equal(consumedText(0), "0%");
    assert.equal(consumedText(0.04), "<0.1%");
    assert.equal(consumedText(0.46), "0.5%");
    assert.equal(consumedText(12.4), "12%");
  });

  it("builds the label and hides it without windows", () => {
    assert.equal(turnQuotaText([]), null);
    assert.equal(
      turnQuotaText([{ windowMinutes: 300, consumedPercent: 2 }, { windowMinutes: 10080, consumedPercent: 0.3 }]),
      "消耗 5 小时额度 2% · 每周额度 0.3%",
    );
  });
});
