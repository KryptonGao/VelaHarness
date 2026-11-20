import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultUsageRingPrefs, normalizeUsageRingPrefs } from "../src/renderer/hooks/useUsageRingPrefs.ts";
import { peakUsedPercent, remainingPercent, remainingTone, resetText, usageRingArcs, usageRingLayout, windowLabel } from "../src/renderer/components/usage-limit-format.ts";

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

  describe("nav rail ring layout", () => {
    const window = (usedPercent: number, windowMinutes: number) => ({ usedPercent, windowMinutes, resetsAt: null });
    const limits = (plan: string | null, ...windows: ReturnType<typeof window>[]) => ({ provider: "p", plan, fetchedAt: 0, windows });

    it("splits the ring between the 5-hour and weekly windows on Plus", () => {
      const layout = usageRingLayout(limits("plus", window(25, 10080), window(4, 300)));
      assert.equal(layout?.kind, "split");
      if (layout?.kind === "split") {
        assert.equal(layout.short.windowMinutes, 300);
        assert.equal(layout.long.windowMinutes, 10080);
      }
    });

    it("draws one full ring for Pro, even when the API also returns a 5-hour window", () => {
      for (const windows of [[window(4, 10080)], [window(1, 300), window(4, 10080)]]) {
        const layout = usageRingLayout(limits("pro", ...windows));
        assert.equal(layout?.kind, "single");
        if (layout?.kind === "single") assert.equal(layout.window.windowMinutes, 10080);
      }
    });

    it("has no ring without windows, and a single window fills the ring on other plans", () => {
      assert.equal(usageRingLayout(limits("plus")), null);
      assert.equal(usageRingLayout(limits("free", window(10, 10080)))?.kind, "single");
    });

    it("gives the 5-hour window about 100 degrees at the top and leaves gaps between arcs", () => {
      const { short, long } = usageRingArcs();
      assert.equal(short[1] - short[0], 100);
      assert.equal(short[0], -50);
      assert.ok(long[0] > short[1] && long[1] < 360 + short[0]);
    });

    it("reports remaining percent clamped to 0–100", () => {
      assert.equal(remainingPercent(4), 96);
      assert.equal(remainingPercent(120), 0);
      assert.equal(remainingPercent(-5), 100);
    });
  });

  describe("usage ring preferences", () => {
    it("turns low only when the remaining quota is below the threshold", () => {
      assert.equal(remainingTone(70, 20), "ok");
      assert.equal(remainingTone(80, 20), "ok", "exactly at the threshold stays normal");
      assert.equal(remainingTone(92, 20), "low");
      assert.equal(remainingTone(100, 0), "ok", "a zero threshold never turns yellow");
    });

    it("falls back to defaults and clamps stored values", () => {
      assert.deepEqual(normalizeUsageRingPrefs({}), defaultUsageRingPrefs);
      assert.deepEqual(normalizeUsageRingPrefs({ enabled: false, threshold: 150 }), { enabled: false, threshold: 100 });
      assert.equal(normalizeUsageRingPrefs({ threshold: -3 }).threshold, 0);
      assert.equal(normalizeUsageRingPrefs({ threshold: Number.NaN }).threshold, defaultUsageRingPrefs.threshold);
      assert.equal(normalizeUsageRingPrefs({ enabled: "yes" as never }).enabled, true);
    });
  });
});
