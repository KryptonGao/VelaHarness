import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextUsage } from "@vela/shared";
import { getActiveLocale, setActiveLocale } from "../src/renderer/locale.ts";
import { composerStats, formatRate, formatSpeed, formatTokens } from "../src/renderer/components/composer/composer-stats.ts";

function usage(patch: Partial<ContextUsage> = {}): ContextUsage {
  return {
    messageCount: 0,
    toolCallCount: 0,
    turnCount: 0,
    stepCount: 0,
    tokens: 0,
    contextWindow: null,
    percent: null,
    segments: { system: 0, tools: 0, rules: 0, skills: 0, conversation: 0 },
    sessionTokens: null,
    cacheHitRate: null,
    outputSpeed: null,
    ...patch,
  };
}

describe("composer stats", () => {
  it("renders the output speed on its own", () => {
    assert.equal(composerStats(usage({ turnCount: 2, stepCount: 11, outputSpeed: 241.4 })).speed, "241 tok/s");
  });

  it("omits the speed when it is not measurable yet", () => {
    assert.equal(composerStats(usage({ turnCount: 1, stepCount: 3 })).speed, null);
  });

  it("reports cache hit rate and the session token total together", () => {
    const stats = composerStats(usage({ sessionTokens: 257_000, cacheHitRate: 0.968 }));
    assert.equal(stats.cacheHit, "缓存命中 97%");
    assert.equal(stats.total, "累计 257K tok");
  });

  it("localizes the session token total in every interface language", (t) => {
    const previous = getActiveLocale();
    t.after(() => setActiveLocale(previous));
    for (const [locale, label] of [["zh-CN", "累计"], ["zh-TW", "累計"], ["ja", "累計"], ["ko", "누적"], ["en", "Total"]] as const) {
      setActiveLocale(locale);
      assert.equal(composerStats(usage({ sessionTokens: 810_800 })).total, `${label} 810.8K tok`, locale);
    }
  });

  it("can report either metric independently", () => {
    const cacheOnly = composerStats(usage({ cacheHitRate: 0 }));
    assert.equal(cacheOnly.cacheHit, "缓存命中 0%");
    assert.equal(cacheOnly.total, null);
    const totalOnly = composerStats(usage({ sessionTokens: 940 }));
    assert.equal(totalOnly.cacheHit, null);
    assert.equal(totalOnly.total, "累计 940 tok");
  });

  it("omits fields the provider has not reported", () => {
    const stats = composerStats(usage({ turnCount: 1, stepCount: 2 }));
    assert.equal(stats.cacheHit, null);
    assert.equal(stats.total, null);
    assert.equal(stats.percent, null);
    assert.equal(stats.percentLabel, null);
  });

  it("drops an all-zero session instead of printing placeholders", () => {
    const stats = composerStats(usage());
    assert.equal(stats.speed, null);
    assert.equal(stats.total, null);
  });

  it("can keep the speed visible before any usage exists", () => {
    assert.equal(composerStats(usage(), { alwaysShowSpeed: true }).speed, "— tok/s");
    assert.equal(composerStats(undefined, { alwaysShowSpeed: true }).speed, "— tok/s");
    assert.equal(composerStats(usage({ turnCount: 2, stepCount: 11, outputSpeed: 241.4 }), { alwaysShowSpeed: true }).speed, "241 tok/s");
  });

  it("tolerates a missing usage snapshot", () => {
    const stats = composerStats(undefined);
    assert.equal(stats.speed, null);
    assert.equal(stats.cacheHit, null);
    assert.equal(stats.total, null);
    assert.equal(stats.percentLabel, null);
  });

  it("rounds the context percentage and keeps it available above 100", () => {
    assert.equal(composerStats(usage({ percent: 4.4 })).percentLabel, "4%");
    assert.equal(composerStats(usage({ percent: 132.6 })).percentLabel, "133%");
  });

  it("clamps nonsense rates and formats sizes", () => {
    assert.equal(formatRate(1.2), "100%");
    assert.equal(formatRate(-0.2), "0%");
    assert.equal(formatSpeed(0.42), "0.4");
    assert.equal(formatSpeed(8.75), "8.8");
    assert.equal(formatSpeed(241.4), "241");
    assert.equal(formatTokens(940), "940");
    assert.equal(formatTokens(257_000), "257K");
    assert.equal(formatTokens(1_240_000), "1.2M");
  });
});
