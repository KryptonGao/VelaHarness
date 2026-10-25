import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { TraceRecorder } from "../src/trace.ts";
import { readTraceUsage } from "../src/trace-usage.ts";

const dir = mkdtempSync(join(tmpdir(), "vela-trace-usage-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const usage = (total: number) => ({ input: total, output: 1, cacheRead: 2, cacheWrite: 3, totalTokens: total + 6 });
const request = (number: number, tokens: number | null, extra = {}) => ({
  id: `request-${number}`, number, turn: 1, model: "opencode-go/deepseek", status: "Completed", contextId: "c1",
  startedAt: 1000 + number, completedAt: 2000 + number, durationMs: 1, firstTokenMs: 1, generationMs: 1,
  usage: tokens === null ? null : usage(tokens), ...extra,
});
const node = (id: string, content: string) => ({ type: "node", value: { node: { id, sequence: 1, kind: "assistant", turn: 1, step: 0, requestId: null,
  toolCallId: null, toolName: null, status: "Completed", summary: "", startedAt: 1, completedAt: 2, executionStartedAt: null, durationMs: null, version: 1, historical: false },
  content, raw: null, source: null, arguments: null, result: null, contextId: null } });
const line = (record: unknown) => JSON.stringify(record);

describe("readTraceUsage", () => {
  it("reads requests and summaries without decoding the large node records", async () => {
    const file = join(dir, "a.jsonl");
    const huge = "x".repeat(3 * (1 << 20));
    writeFileSync(file, [
      line(node("n1", huge)),
      line({ type: "request", value: { request: request(2, 20), blocks: [{ type: "text", text: 'with ,"blocks": inside' }] } }),
      line({ type: "request", value: { request: request(1, null), blocks: [] } }),
      line({ type: "request", value: { request: request(1, 10), blocks: [{ type: "text", text: huge }] } }),
      line(node("n2", "tail")),
      line({ type: "summary", value: { id: "summary-1", model: "opencode-go/deepseek", status: "Completed", startedAt: 1, completedAt: 2, durationMs: 1, usage: usage(5) } }),
    ].join("\n"));
    const result = await readTraceUsage(file);
    assert.deepEqual(result.requests.map(item => [item.id, item.usage?.input]), [["request-1", 10], ["request-2", 20]]);
    assert.equal(result.summaries.length, 1);
    assert.equal(result.damaged, false);
  });

  it("matches what a TraceRecorder restores from the same file, including a torn last line", async () => {
    const file = join(dir, "b.jsonl");
    writeFileSync(file, [
      line({ type: "request", value: { request: request(1, 10), blocks: [] } }),
      "{not json",
      line({ type: "summary", value: { id: "summary-1", model: "m/n", status: "Failed", startedAt: null, completedAt: null, durationMs: null, usage: null } }),
      line({ type: "request", value: { request: request(2, 7), blocks: [] } }).slice(0, 60),
    ].join("\n"));
    const result = await readTraceUsage(file);
    const recorder = new TraceRecorder("b", file, () => {});
    const snapshot = recorder.snapshot();
    assert.deepEqual(result.requests, snapshot.requests);
    assert.deepEqual(result.summaries, snapshot.summaries);
    assert.equal(result.damaged, true);
    recorder.dispose();
  });

  it("copes with lines shorter than the type prefix and a missing trailing newline", async () => {
    const file = join(dir, "c.jsonl");
    writeFileSync(file, `{}\n\n{"type":"x"}\n${line({ type: "request", value: { request: request(1, 1), blocks: [] } })}`);
    const result = await readTraceUsage(file);
    assert.equal(result.requests.length, 1);
    assert.equal(result.damaged, false);
  });
});
