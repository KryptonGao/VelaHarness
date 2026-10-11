import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUiEnv,
  chartDomain,
  composeRefreshRequest,
  composeToolRequest,
  itineraryPlot,
  niceScale,
  parseCsv,
  parseUiMessage,
  parseUnifiedDiff,
  resolveChartData,
  resolvePieData,
  resolveTimeline,
  resolveUiSource,
  resolveUiValue,
  summarizeUiArtifact,
  toolCallsFromMessages,
  uiSourceStaleAfterMs,
  type UiArtifact,
  type UiSegment,
  type UiSourceDefinition,
  type UiSourceSnapshot,
  type UiToolCall,
} from "@vela/shared";
import { fenced } from "./fixtures/intelligent-ui.ts";

const now = () => 0;
const T = 1_700_000_000_000;

function artifactOf(lines: string[]): UiArtifact {
  const segment = parseUiMessage(fenced(lines), { now }).find((item): item is Extract<UiSegment, { type: "ui" }> => item.type === "ui");
  assert.ok(segment);
  return segment.artifact;
}

const def = (patch: Partial<UiSourceDefinition> = {}): UiSourceDefinition => ({ name: "data", tool: "bash", format: "json", path: [], ...patch });
const call = (patch: Partial<UiToolCall> = {}): UiToolCall => ({ id: "call_1", name: "bash", status: "done", body: "[]", completedAt: T, ...patch });
const resolve = (definition: UiSourceDefinition, calls: UiToolCall[], extra: { now?: number; receiving?: boolean } = {}) =>
  resolveUiSource(definition, calls, { now: extra.now ?? T + 1_000, receiving: extra.receiving });

const snapshotOf = (patch: Partial<UiSourceSnapshot>): UiSourceSnapshot => ({
  name: "total", sourceId: "call_1", tool: "bash", subject: "git ls-files | wc -l", status: "ok", fetchedAt: T, columns: [], rows: [],
  text: null, scalar: 10, truncated: false, message: null, detail: null, ...patch,
});

describe("Intelligent UI data sources", () => {
  it("takes the latest matching tool call and records where the data came from", () => {
    const calls = [
      call({ id: "a", command: "git log", body: '[{"n":1}]' }),
      call({ id: "b", command: "git status", body: '[{"n":2}]' }),
      call({ id: "c", name: "read", path: "x.json", body: '[{"n":3}]' }),
    ];
    const latest = resolve(def(), calls);
    assert.equal(latest.sourceId, "b");
    assert.equal(latest.status, "ok");
    assert.equal(latest.fetchedAt, T);
    assert.equal(latest.subject, "git status");
    assert.deepEqual(latest.rows, [{ n: 2 }]);
    assert.equal(resolve(def({ match: "GIT LOG" }), calls).sourceId, "a");
    assert.equal(resolve(def({ call: "a" }), calls).sourceId, "a");
    assert.equal(resolve(def({ tool: "read" }), calls).sourceId, "c");
  });

  it("never reports a missing, running or failed call as updated data", () => {
    assert.deepEqual([resolve(def(), []).status, resolve(def(), []).message], ["error", "not_found"]);
    assert.equal(resolve(def(), [], { receiving: true }).status, "loading");
    assert.equal(resolve(def(), [call({ status: "running" })]).status, "loading");
    const failed = resolve(def(), [call({ status: "error", body: "fatal: not a git repository\n(more)" })]);
    assert.equal(failed.status, "error");
    assert.equal(failed.message, "tool_error");
    assert.equal(failed.detail, "fatal: not a git repository (more)");
    assert.deepEqual(failed.rows, []);
    assert.equal(resolve(def(), [call({ body: "[]" })]).status, "empty");
  });

  it("marks old results stale instead of ok", () => {
    const fresh = resolve(def(), [call({ body: '[{"a":1}]' })], { now: T + uiSourceStaleAfterMs });
    assert.equal(fresh.status, "ok");
    const stale = resolve(def(), [call({ body: '[{"a":1}]' })], { now: T + uiSourceStaleAfterMs + 1 });
    assert.equal(stale.status, "stale");
    assert.deepEqual(stale.rows, [{ a: 1 }]);
    const unknownAge = resolve(def(), [call({ body: '[{"a":1}]', completedAt: null })]);
    assert.equal(unknownAge.status, "ok");
    assert.equal(unknownAge.fetchedAt, null);
  });

  it("parses json shapes, paths and scalars safely", () => {
    const rows = resolve(def(), [call({ body: '[{"name":"a","n":1,"tags":["x","y"],"deep":{"k":1}},{"name":"b","extra":true},7]' })]);
    assert.deepEqual(rows.columns, ["name", "n", "tags", "deep", "extra", "value"]);
    assert.deepEqual(rows.rows[0], { name: "a", n: 1, tags: "x, y", deep: null });
    assert.deepEqual(rows.rows[2], { value: 7 });
    const scalar = resolve(def({ path: ["stats", 1, "total"] }), [call({ body: '{"stats":[{"total":1},{"total":42}]}' })]);
    assert.equal(scalar.scalar, 42);
    assert.equal(resolve(def({ path: ["stats", 9] }), [call({ body: '{"stats":[1]}' })]).message, "bad_path");
    assert.equal(resolve(def({ path: ["toString"] }), [call({ body: "{}" })]).message, "bad_path");
    assert.equal(resolve(def(), [call({ body: "not json" })]).message, "not_json");
    const proto = resolve(def(), [call({ body: '[{"__proto__":{"x":1},"ok":1}]' })]);
    assert.deepEqual(proto.rows, [{ ok: 1 }]);
    assert.equal(Object.getPrototypeOf(proto.rows[0]), Object.prototype);
  });

  it("refuses data that was truncated or is too large", () => {
    const truncated = resolve(def(), [call({ body: '[{"a":1},{"a"\n… 内容过长，已截断' })]);
    assert.equal(truncated.status, "error");
    assert.equal(truncated.message, "truncated");
    assert.equal(resolve(def(), [call({ body: "x".repeat(200_001) })]).message, "too_large");
    const lines = resolve(def({ format: "lines" }), [call({ body: `${Array.from({ length: 600 }, (_, i) => `l${i}`).join("\n")}\n… 内容过长，已截断` })]);
    assert.equal(lines.rows.length, 500);
    assert.equal(lines.truncated, true);
  });

  it("parses csv, lines and text", () => {
    const csv = resolve(def({ format: "csv" }), [call({ body: 'name,qty,note\n"Smith, J",3,"say ""hi"""\nLee,4.5,\n' })]);
    assert.deepEqual(csv.rows, [{ name: "Smith, J", qty: 3, note: 'say "hi"' }, { name: "Lee", qty: 4.5, note: "" }]);
    assert.equal(parseCsv('a,b\n"open').ok, false);
    const lines = resolve(def({ format: "lines" }), [call({ body: "one\n\n two \nthree" })]);
    assert.deepEqual(lines.rows.map(row => row.text), ["one", "two", "three"]);
    assert.deepEqual(lines.columns, ["line", "text"]);
    const text = resolve(def({ format: "text" }), [call({ body: "diff --git a b\n+x" })]);
    assert.equal(text.text, "diff --git a b\n+x");
  });

  it("collects tool calls from messages in order with the message completion time", () => {
    const messages = [
      { tools: [{ id: "t1", name: "bash", status: "done", activity: { command: "ls", body: "a" } }], turnCompletedAt: 10 },
      { tools: [{ id: "t2", name: "read", status: "running", activity: { path: "x" } }], timestamp: 20 },
      { tools: [{ id: "t3", name: "bash", status: "error", activity: {} }] },
    ];
    const calls = toolCallsFromMessages(messages, 1);
    assert.deepEqual(calls.map(item => [item.id, item.status, item.completedAt]), [["t1", "done", 10], ["t2", "running", 20]]);
    assert.equal(toolCallsFromMessages(messages, 99).length, 3);
    assert.equal(toolCallsFromMessages([], 3).length, 0);
  });
});

describe("Intelligent UI source values in expressions and suggestions", () => {
  const artifact = artifactOf([
    '{"op":"begin","id":"s","title":"Repo health","version":1}',
    '{"op":"source","name":"total","tool":"bash","format":"json","path":["count"]}',
    '{"op":"derive","name":"half","expr":{"op":"divide","args":[{"ref":"total"},2]}}',
    '{"op":"node","id":"root","type":"column","props":{}}',
    '{"op":"node","id":"n","parent":"root","type":"stat","props":{"label":"Files","from":"total"}}',
    '{"op":"commit"}',
  ]);

  it("feeds scalar results into the environment and explains why it has none", () => {
    const value = (patch: Partial<UiSourceSnapshot>, name = "half") =>
      resolveUiValue({ ref: name }, buildUiEnv(artifact, {}, new Map([["total", snapshotOf(patch)]])));
    assert.deepEqual(value({}), { ok: true, value: 5 });
    assert.deepEqual(value({}, "total"), { ok: true, value: 10 });
    assert.deepEqual(value({ status: "loading", scalar: undefined }), { ok: false, error: "source_pending" });
    assert.deepEqual(value({ status: "error", scalar: undefined }), { ok: false, error: "source_failed" });
    assert.deepEqual(value({ status: "empty", scalar: undefined }), { ok: false, error: "source_empty" });
    assert.deepEqual(value({ scalar: undefined, rows: [{ a: 1 }] }, "total"), { ok: false, error: "type_mismatch" });
    assert.deepEqual(resolveUiValue({ ref: "half" }, buildUiEnv(artifact, {})), { ok: false, error: "source_pending" });
    assert.deepEqual(value({ status: "stale" }, "total"), { ok: true, value: 10 });
  });

  it("states the provenance and status of sourced data in the text copy", () => {
    const text = summarizeUiArtifact(artifact, {}, new Map([["total", snapshotOf({ status: "stale" })]]));
    assert.match(text, /Files: 10/);
    assert.match(text, /Data: bash \(call_1\) · 2023-11-14T22:13:20\.000Z · stale/);
    assert.match(summarizeUiArtifact(artifact, {}, new Map()), /Data: total \(not available\)/);
  });

  it("composes tool suggestions from filled parameters without granting anything", () => {
    const action = { type: "request_tool" as const, tool: "bash", summary: "Run the unit tests", args: { suite: "unit", retries: { ref: "retries" } } };
    const env = new Map([["retries", { ok: true as const, value: 2 }]]);
    const result = composeToolRequest({ title: "Test runner" }, action, env);
    assert.ok(result.ok);
    assert.match(result.text, /^\[Interface suggestion: Test runner\] Please consider running the `bash` tool: Run the unit tests/);
    assert.match(result.text, /- suite: unit\n- retries: 2/);
    assert.match(result.text, /not from an approval/);
    const blocked = composeToolRequest({ title: null }, action, new Map([["retries", { ok: false as const, error: "invalid_input" as const }]]));
    assert.deepEqual(blocked, { ok: false, error: "invalid_input" });
  });

  it("asks the agent to rerun the tool for a refresh", () => {
    const text = composeRefreshRequest({ title: "Repo health" }, artifact.sources[0], snapshotOf({}));
    assert.match(text, /refresh the data source "total" for the interface "Repo health": run the `bash` tool again \(git ls-files \| wc -l\)/);
    assert.match(text, /normal tool permissions/);
  });
});

describe("Intelligent UI chart and view models", () => {
  it("resolves inline values, reports evaluation errors and sourced rows", () => {
    const artifact = artifactOf([
      '{"op":"begin","id":"c","version":1}',
      '{"op":"state","name":"jan","kind":"number","initial":4}',
      '{"op":"state","name":"zero","kind":"number","initial":0}',
      '{"op":"node","id":"root","type":"column","props":{}}',
      '{"op":"node","id":"chart","parent":"root","type":"bar_chart","props":{"data":[{"label":"Jan","value":{"ref":"jan"}},{"label":"Feb","value":{"op":"divide","args":[1,{"ref":"zero"}]}},{"label":"Mar","value":null}],"title":"Sales"}}',
      '{"op":"commit"}',
    ]);
    const chart = artifact.nodes.find(node => node.id === "chart")!;
    const data = resolveChartData(chart.props, buildUiEnv(artifact, { jan: 4, zero: 0 }), undefined);
    assert.deepEqual(data.labels, ["Jan", "Feb", "Mar"]);
    assert.deepEqual(data.series[0].values, [4, null, null]);
    assert.deepEqual(data.series[0].bound, ["jan", null, null]);
    assert.equal(data.series[0].label, "Sales");
    assert.equal(data.error, "division_by_zero");
    const sourced = resolveChartData({ from: "s", x: "name", y: ["n", "m"] }, new Map(), snapshotOf({
      rows: [{ name: "a", n: 1, m: "2.5" }, { name: "b", n: "x", m: null }], scalar: undefined,
    }));
    assert.deepEqual(sourced.series.map(entry => entry.values), [[1, null], [2.5, null]]);
  });

  it("keeps bar baselines honest and respects explicit bounds", () => {
    const series = [{ key: "s", label: "s", values: [120, 180, 150] as Array<number | null>, bound: [null, null, null] }];
    const bars = chartDomain(series, { includeZero: true });
    assert.equal(bars.min, 0);
    assert.ok(bars.max >= 180);
    const line = chartDomain(series, { includeZero: false });
    assert.ok(line.min > 0);
    const bounded = chartDomain(series, { includeZero: true, yMin: 100, yMax: 200 });
    assert.deepEqual([bounded.min, bounded.max], [100, 200]);
    assert.ok(chartDomain([], { includeZero: true }).ticks.length >= 2);
    const flat = niceScale(5, 5);
    assert.ok(flat.min < 5 && flat.max > 5);
    assert.deepEqual(niceScale(0, 100).ticks, [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(niceScale(Number.NaN, 1).ticks, [0, 0.5, 1]);
  });

  it("builds pie fractions and skips values that are not non-negative numbers", () => {
    const pie = resolvePieData({ slices: [{ label: "a", value: 1 }, { label: "b", value: 3 }, { label: "c", value: -2 }, { label: "d", value: null }] }, new Map(), undefined);
    assert.deepEqual(pie.slices.map(slice => [slice.label, slice.fraction]), [["a", 0.25], ["b", 0.75]]);
    assert.equal(pie.skipped, 2);
    assert.equal(pie.total, 4);
    assert.equal(resolvePieData({ slices: [{ label: "a", value: 0 }] }, new Map(), undefined).slices[0].fraction, 0);
  });

  it("maps timeline rows from a source and falls back for unknown statuses", () => {
    const entries = resolveTimeline({ from: "t", titleKey: "name", dateKey: "due", statusKey: "state" }, snapshotOf({
      rows: [{ name: "Ship", due: "May", state: "done" }, { name: "Test", due: null, state: "weird" }], scalar: undefined,
    }));
    assert.deepEqual(entries.map(entry => [entry.title, entry.date, entry.status]), [["Ship", "May", "done"], ["Test", null, "upcoming"]]);
  });

  it("parses unified diffs by hunk counts so removed '--- ' lines are not mistaken for headers", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt", "index 1..2 100644", "--- a/a.txt", "+++ b/a.txt",
      "@@ -1,3 +1,3 @@", " keep", "--- removed dashes", "+++ added pluses", " tail", "\\ No newline at end of file",
    ].join("\n");
    const model = parseUnifiedDiff(diff);
    assert.equal(model.files, 1);
    assert.deepEqual([model.added, model.removed], [1, 1]);
    const body = model.lines.filter(line => line.kind === "add" || line.kind === "del");
    assert.deepEqual(body.map(line => [line.kind, line.text, line.oldNo, line.newNo]), [["del", "-- removed dashes", 2, null], ["add", "++ added pluses", null, 2]]);
    assert.equal(model.lines.at(-1)!.kind, "meta");
    const simple = parseUnifiedDiff("-a\n+b\n c");
    assert.deepEqual([simple.added, simple.removed], [1, 1]);
    assert.equal(parseUnifiedDiff("+x\n".repeat(50), 10).truncated, true);
    assert.equal(parseUnifiedDiff("").lines.length, 0);
  });

  it("plots only explicit coordinates and never guesses places from names", () => {
    assert.equal(itineraryPlot([{ label: "d", stops: [{ name: "Paris" }, { name: "Rome" }] }]), null);
    assert.equal(itineraryPlot([{ label: "d", stops: [{ name: "A", lat: 1, lng: 1 }, { name: "B" }] }]), null);
    const plot = itineraryPlot([{ label: "d1", stops: [{ name: "A", lat: 0, lng: 0 }, { name: "B", lat: 10, lng: 20 }] }, { label: "d2", stops: [{ name: "C", lat: 5, lng: 10 }] }])!;
    assert.equal(plot.points.length, 3);
    for (const point of plot.points) assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
    assert.ok(plot.points[1].y < plot.points[0].y, "north is up");
    assert.ok(plot.points[1].x > plot.points[0].x, "east is right");
  });
});
