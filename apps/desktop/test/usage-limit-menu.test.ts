import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { peakUsedPercent, resetText, windowLabel } from "../src/renderer/components/usage-limit-format.ts";

describe("usage limit menu helpers", () => {
  it("shows the highest used percentage across windows", () => {
    const window = (usedPercent: number, windowMinutes: number) => ({ usedPercent, windowMinutes, resetsAt: null });
    assert.equal(peakUsedPercent({ provider: "p", plan: null, fetchedAt: 0, windows: [window(4, 300), window(25, 10080)] }), 25);
    assert.equal(peakUsedPercent({ provider: "p", plan: null, fetchedAt: 0, windows: [window(25, 10080)] }), 25);
  });

  it("names windows by their length", () => {
    assert.equal(windowLabel(300), "5 小时额度");
    assert.equal(windowLabel(10080), "每周额度");
    assert.equal(windowLabel(1440), "1 天额度");
    assert.equal(windowLabel(120), "2 小时额度");
  });

  it("omits the reset text when the time is unknown and adds a weekday for resets beyond a day", () => {
    const now = Date.UTC(2026, 9, 30, 12, 0, 0);
    assert.equal(resetText(null, now), "");
    assert.match(resetText(now + 3600_000, now), /重置$/);
    const later = resetText(now + 3 * 24 * 3600_000, now);
    assert.notEqual(later, resetText(now + 3600_000, now));
  });
});
