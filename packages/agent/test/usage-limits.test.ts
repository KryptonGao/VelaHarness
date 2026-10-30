import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelDirectory, parseCodexUsage } from "../src/model-directory.ts";

const now = Date.UTC(2026, 9, 30, 12, 0, 0);

describe("parseCodexUsage", () => {
  it("keeps the 5-hour and weekly windows, ordered by length", () => {
    const limits = parseCodexUsage("openai-codex", {
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 21, limit_window_seconds: 18000, reset_after_seconds: 14128, reset_at: 1793373916 },
        secondary_window: { used_percent: 14.5, limit_window_seconds: 604800, reset_at: 1793791356 },
      },
    }, now);
    assert.deepEqual(limits, {
      provider: "openai-codex",
      plan: "plus",
      windows: [
        { windowMinutes: 300, usedPercent: 21, resetsAt: 1793373916_000 },
        { windowMinutes: 10080, usedPercent: 14.5, resetsAt: 1793791356_000 },
      ],
      fetchedAt: now,
    });
  });

  it("classifies by duration, so a weekly-only plan yields just the weekly window", () => {
    const limits = parseCodexUsage("openai-codex", {
      plan_type: "pro",
      rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 604800, reset_after_seconds: 3600 }, secondary_window: null },
    }, now);
    assert.equal(limits?.windows.length, 1);
    assert.equal(limits?.windows[0]?.windowMinutes, 10080);
    assert.equal(limits?.windows[0]?.resetsAt, now + 3600_000);
  });

  it("clamps percentages and drops malformed windows", () => {
    const limits = parseCodexUsage("openai-codex", {
      rate_limit: {
        primary_window: { used_percent: 140, limit_window_seconds: 18000 },
        secondary_window: { used_percent: "x", limit_window_seconds: 604800 },
      },
    }, now);
    assert.deepEqual(limits?.windows, [{ windowMinutes: 300, usedPercent: 100, resetsAt: null }]);
    assert.equal(limits?.plan, null);
  });

  it("returns an empty window list when the account has no rate limit and null for junk", () => {
    assert.deepEqual(parseCodexUsage("openai-codex", { rate_limit: null }, now)?.windows, []);
    assert.equal(parseCodexUsage("openai-codex", null, now), null);
    assert.equal(parseCodexUsage("openai-codex", "nope", now), null);
  });
});

describe("ModelDirectory.usageLimits", () => {
  it("returns null for providers without subscription limits or without a sign-in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vela-usage-"));
    try {
      const directory = await ModelDirectory.open(dir);
      assert.equal(await directory.usageLimits("anthropic"), null);
      assert.equal(await directory.usageLimits("openai-codex"), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws on a transient failure instead of reporting no limits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vela-usage-"));
    const realFetch = globalThis.fetch;
    let calls = 0;
    try {
      const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url");
      await writeFile(join(dir, "auth.json"), JSON.stringify({
        "openai-codex": { type: "oauth", access: `h.${claims}.s`, refresh: "r", expires: Date.now() + 3600_000, accountId: "acct" },
      }));
      const directory = await ModelDirectory.open(dir);
      globalThis.fetch = (async () => { calls += 1; throw new TypeError("fetch failed"); }) as typeof fetch;
      await assert.rejects(directory.usageLimits("openai-codex"));
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = realFetch;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
