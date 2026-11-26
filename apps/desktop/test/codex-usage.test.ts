import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";
import { zstdCompressSync } from "node:zlib";
import type { CodexUsageBucket } from "@vela/shared";
import { syncCodexUsage } from "../src/main/codex-usage-index.ts";
import { codexUsageRecord } from "../src/renderer/components/usage/codex-usage-model.ts";
import { filterUsageRequests, summarizeCost, summarizeUsage } from "../src/renderer/components/usage/usage-model.ts";

function row(type: string, payload: object, ordinal: number) {
  return JSON.stringify({ timestamp: new Date(Date.UTC(2026, 6, 1, 12, 0, ordinal)).toISOString(), ordinal, type, payload }) + "\n";
}
const meta = (id: string, extra = {}) => row("session_meta", { id, originator: "Codex Desktop", model_provider: "openai", ...extra }, 0);
const context = (turn_id: string, model = "gpt-test", service_tier = "default", ordinal = 1) =>
  row("turn_context", { model, turn_id, service_tier }, ordinal);
const counts = (n: number) => ({ input_tokens: 10*n, cached_input_tokens: 4*n, cache_write_input_tokens: n,
  output_tokens: 5*n, reasoning_output_tokens: 2*n, total_tokens: 15*n });
function metered(ordinal: number, total: number, last = 1) {
  return row("event_msg", { type: "token_count", info: { total_token_usage: counts(total), last_token_usage: counts(last) } }, ordinal);
}
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "vela-codex-usage-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const active = join(dir, "sessions", "2026", "07", "01"), archive = join(dir, "archived_sessions");
  await mkdir(active, { recursive: true });
  await mkdir(archive);
  const index = join(dir, "index.sqlite");
  return { active, archive, index, sync: () => syncCodexUsage(dir, index) };
}

test("refresh and append resume exactly once across partial lines, archive copies and compression", async t => {
  const f = await fixture(t), file = join(f.active, "a.jsonl");
  const privateText = "private-dialogue-marker";
  const start = meta("a") + context("turn1") + row("response_item", { type: "message", content: privateText }, 2)
    + metered(3, 1) + metered(4, 1);
  const next = metered(5, 2);
  await writeFile(file, start + next.slice(0, 65));
  await writeFile(join(f.active, "cli.jsonl"), meta("cli", { originator: "codex-tui" }) + context("cli") + metered(3, 1));
  const first = await f.sync();
  assert.equal(first.incompleteFiles, 0);
  assert.equal(first.buckets.length, 1);
  assert.equal(first.buckets[0].requests, 1);
  assert.deepEqual(first.buckets[0].usage, { input: 5, output: 5, cacheRead: 4, cacheWrite: 1, totalTokens: 15 });
  assert.deepEqual(await f.sync(), first);
  await appendFile(file, next.slice(65));
  const two = await f.sync();
  assert.equal(two.buckets[0].requests, 2);
  assert.equal(two.buckets[0].usage.totalTokens, 30);
  await writeFile(join(f.archive, "copy.jsonl.zst"), zstdCompressSync(await readFile(file)));
  assert.deepEqual(await f.sync(), two);
  await rename(file, join(f.archive, "a.jsonl"));
  assert.deepEqual(await f.sync(), two);
  assert.equal((await readFile(f.index)).includes(Buffer.from(privateText)), false);
  await rm(join(f.archive, "a.jsonl"));
  await rm(join(f.archive, "copy.jsonl.zst"));
  assert.deepEqual((await f.sync()).buckets, []);
});

test("subagent prefixes, nested parent headers and referenced forks count only new work", async t => {
  const f = await fixture(t);
  await writeFile(join(f.active, "p.jsonl"), meta("parent") + context("turn-parent") + metered(2, 1));
  await writeFile(join(f.active, "s.jsonl"), meta("sub", { parent_thread_id: "parent", subagent_history_start_ordinal: 5 })
    + meta("parent") + context("turn-parent") + metered(2, 1) + context("turn-sub", "small", "default", 6) + metered(7, 2));
  await writeFile(join(f.archive, "fork.jsonl"), meta("fork", { history_base: { thread_id: "parent", end_ordinal_exclusive: 4 } })
    + context("turn-fork", "other", "priority", 5) + metered(6, 1) + metered(7, 2));
  const report = await f.sync();
  assert.equal(report.incompleteFiles, 0);
  assert.deepEqual(report.buckets.map(b => [b.model, b.requests, b.usage.totalTokens]).sort(), [
    ["gpt-test", 1, 15], ["other", 1, 15], ["small", 1, 15],
  ]);
  // Older reference snapshots can start well above zero even with no parent file on disk.
  await writeFile(join(f.active, "ref.jsonl"), meta("ref", { history_base: { thread_id: "absent", end_ordinal_exclusive: 10 } })
    + context("turn-ref", "ref-model", "default", 12) + metered(13, 101));
  assert.equal((await f.sync()).buckets.find(b => b.model === "ref-model")?.usage.totalTokens, 15);
});

test("recovers complete final lines, skips initial context estimates and isolates gaps across model switches", async t => {
  const f = await fixture(t), file = join(f.active, "a.jsonl");
  const estimate = { total_tokens: 42, input_tokens: 0, output_tokens: 0 };
  const baseline = row("event_msg", { type: "token_count", info: { last_token_usage: estimate, total_token_usage: estimate } }, 1);
  await writeFile(file, meta("a") + baseline + context("new", "new-model", "default", 3) + metered(4, 6).trimEnd());
  const first = await f.sync();
  assert.equal(first.incompleteFiles, 1);
  assert.equal(first.buckets.length, 1);
  assert.equal(first.buckets[0].usage.totalTokens, 15);
  assert.equal(first.buckets[0].complete, true);
  await appendFile(file, "\n" + metered(5, 7));
  assert.equal((await f.sync()).buckets[0].usage.totalTokens, 30);
});

test("replaces rewritten files and keeps a previously indexed archive if decompression fails", async t => {
  const f = await fixture(t), file = join(f.active, "r.jsonl"), archive = join(f.archive, "c.jsonl.zst");
  await writeFile(file, meta("r") + context("old") + metered(3, 1));
  await writeFile(archive, zstdCompressSync(meta("c") + context("c", "archive") + metered(3, 1)));
  await f.sync();
  await writeFile(file, meta("r") + context("rewritten", "different-and-longer") + metered(4, 2, 2));
  await writeFile(archive, "broken");
  const result = await f.sync();
  assert.equal(result.incompleteFiles, 1);
  assert.deepEqual(result.buckets.map(b => [b.model, b.usage.totalTokens]).sort(), [["archive", 15], ["different-and-longer", 30]]);
});

test("prices local daily buckets by provider, model and tier and leaves incomplete data unpriced", async t => {
  const f = await fixture(t);
  const tier = row("event_msg", { type: "thread_settings_applied", thread_settings: { service_tier: "priority" } }, 4);
  const ambiguous = row("event_msg", { type: "token_count", info: { total_token_usage: { total_tokens: 62 },
    last_token_usage: { total_tokens: 2 } } }, 9);
  await writeFile(join(f.active, "u.jsonl"), meta("u") + context("first") + metered(2, 1) + metered(3, 2)
    + tier + metered(5, 3) + row("event_msg", { type: "model_rerouted", to_model: "rerouted" }, 6)
    + metered(7, 4) + ambiguous);
  const read = await f.sync();
  assert.equal(read.incompleteFiles, 1);
  const all = read.buckets.map(codexUsageRecord);
  const stats = summarizeUsage(filterUsageRequests(all, { start: "2026-07-01", end: "2026-07-01", providers: ["openai"] }));
  assert.equal(stats.totals.requests, 5);
  assert.equal(stats.totals.totalTokens, 62);
  assert.deepEqual(stats.models.map(m => [m.model, m.requests, m.detailed, m.totalTokens]), [
    ["gpt-test", 3, 3, 45], ["rerouted", 2, 1, 17],
  ]);
  const registered = (model: string, input: number) => ({ model, currency: "USD" as const, input, output: 0, cacheRead: 0, cacheWrite: 0 });
  const prices = [registered("openai/gpt-test", 1), registered("openai/gpt-test [priority]", 4),
    registered("openai/rerouted [priority] [incomplete]", 10)];
  const cost = summarizeCost(stats.models, prices);
  assert.ok(Math.abs(cost.total.USD! - 30 / 1_000_000) < 1e-15);
  assert.deepEqual(cost.unpriced, ["openai/rerouted [priority]"]);
  assert.deepEqual([...cost.byModel], [["openai/gpt-test", cost.total]]);
});

test("combines every speed for the same provider/model while preserving each rate and currency", () => {
  const base: CodexUsageBucket = {
    provider: "openai", model: "org/model", tier: "default", complete: true, requests: 1, timestamp: 1000,
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1_000_000 },
  };
  const tiers = ["default", "priority", "ultrafast", null].map(tier => codexUsageRecord({ ...base, tier }));
  const stats = summarizeUsage([...tiers, tiers[1], codexUsageRecord({ ...base, provider: "other" })]);
  assert.deepEqual(stats.models.map(m => [m.provider, m.model, m.requests, m.totalTokens]), [
    ["openai", "org/model", 4, 4_000_000], ["other", "org/model", 1, 1_000_000],
  ]);
  const price = { currency: "USD" as const, input: 2, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cost = summarizeCost(stats.models, [
    { ...price, model: "openai/org/model" },
    { ...price, model: "openai/org/model [priority]", input: 5, currency: "CNY" },
    { ...price, model: "other/org/model", input: 3 },
  ]);
  assert.deepEqual(cost.byModel.get("openai/org/model"), { USD: 2, CNY: 5 });
  assert.deepEqual(cost.byModel.get("other/org/model"), { USD: 3 });
  assert.deepEqual(cost.total, { USD: 5, CNY: 5 });
  assert.deepEqual(cost.unpriced.sort(), ["openai/org/model [?]", "openai/org/model [ultrafast]"]);
});

test("groups missing model names as not reported and keeps their metered tokens", () => {
  const bucket: CodexUsageBucket = {
    provider: "openai", model: null, tier: "default", complete: true, requests: 3, timestamp: 1000,
    usage: { input: 60, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 90 },
  };
  const missing = codexUsageRecord(bucket);
  const known = codexUsageRecord({ ...bucket, model: "known" });
  const stats = summarizeUsage([missing, missing, known,
    { ...missing, id: "native-no-model-or-usage", requestCount: 1, usage: null },
    { ...known, id: "native-no-usage", requestCount: 1, usage: null },
  ]);
  const group = stats.models.find(m => m.model === "");
  assert.equal(group?.requests, 4);
  assert.equal(group?.totalTokens, 90);
  assert.deepEqual(Object.keys(group!.usageByPrice), []);
  assert.equal(stats.reportedRequests, 3);
  assert.equal(stats.totals.requests - stats.reportedRequests, 5);
  assert.equal(stats.totals.metered, 6);
  assert.equal(stats.totals.totalTokens, 180);
});
