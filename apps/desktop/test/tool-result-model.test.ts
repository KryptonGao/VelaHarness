import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completeResultJson,
  processFailed,
  resultHttpUrl,
  resultNumber,
  resultPageSize,
  resultRecord,
  resultText,
  resultTimestamp,
  scalarTableColumns,
} from "../src/renderer/components/tool-result-model.ts";

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("tool result model: safe JSON views", () => {
  it("promotes only entire valid JSON, including fenced responses and scalar/empty values", () => {
    for (const [text, expected] of [
      ['{"a":[null,true,"",0]}', { a: [null, true, "", 0] }],
      ['```json\n{"x":1}\n```', { x: 1 }],
      ["null", null], ["false", false], ["[]", []], ["{}", {}], ['""', ""],
    ] as const) assert.deepEqual(plain(completeResultJson(text)?.value), expected);
    for (const text of ["", "   ", '{"x":', 'prefix {"x":1}', '{"x":1}\nordinary log', "```json\n{}\n```\nextra", "x".repeat(80_001)]) {
      assert.equal(completeResultJson(text), undefined, text.slice(0, 40));
    }
  });

  it("keeps strings inert, strips dangerous property names and signals bounds", () => {
    const parsed = completeResultJson('{"html":"<img onerror=alert(1)>","link":"javascript:alert(1)","__proto__":{"polluted":true},"safe":1}');
    assert.ok(parsed);
    assert.deepEqual(plain(parsed.value), { html: "<img onerror=alert(1)>", link: "javascript:alert(1)", safe: 1 });
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
    const deep = completeResultJson("[".repeat(20) + "0" + "]".repeat(20));
    assert.ok(deep);
    assert.equal(deep.truncated, true);
  });

  it("uses tables only for matching small scalar object schemas", () => {
    assert.deepEqual(scalarTableColumns([{ name: "A", count: 1, available: true, note: null }, { note: "", available: false, count: 0, name: "B" }]), ["name", "count", "available", "note"]);
    for (const value of [[], [{}], [1, 2], [null], [{ x: 1 }, { y: 2 }], [{ x: 1 }, { x: 2, y: 3 }], [{ x: { nested: true } }], [{ x: [1] }], [Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i]))]]) {
      assert.equal(scalarTableColumns(value), null);
    }
    assert.equal(resultPageSize, 20);
    assert.equal(resultRecord({ x: 1 }), true);
    assert.equal(resultRecord(null), false);
    assert.equal(resultRecord([]), false);
  });
});

describe("tool result model: display values and shell semantics", () => {
  it("only permits absolute HTTP/HTTPS result links", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "/relative", "docs://guide", "not a URL", null, 42]) assert.equal(resultHttpUrl(value), undefined);
    assert.equal(resultHttpUrl("https://example.com/docs?q=a"), "https://example.com/docs?q=a");
    assert.equal(resultHttpUrl("http://example.com"), "http://example.com/");
  });

  it("does not coerce booleans/numbers to strings or accept nonfinite timestamps/numbers", () => {
    assert.equal(resultText(""), "");
    assert.equal(resultText(0), undefined);
    assert.equal(resultNumber(0), 0);
    assert.equal(resultNumber(-1), -1);
    for (const value of [Number.NaN, Infinity, -Infinity, "12", null]) assert.equal(resultNumber(value), undefined);
    for (const value of [null, undefined, "not-a-date", Number.NaN, Infinity]) assert.equal(resultTimestamp(value, "en-US"), "—");
    assert.equal(resultTimestamp(0, "en-US"), new Date(0).toLocaleString("en-US"));
    assert.equal(resultTimestamp("2026-01-01T00:00:00Z", "ja-JP"), new Date("2026-01-01T00:00:00Z").toLocaleString("ja-JP"));
  });

  it("marks process failure separately from read completion", () => {
    assert.equal(processFailed("exited", 1), true);
    assert.equal(processFailed("exited", -9), true);
    assert.equal(processFailed("timed_out", null), true);
    assert.equal(processFailed("failed", undefined), true);
    for (const [status, code] of [["exited", 0], ["exited", null], ["running", null], ["killed", null], [undefined, undefined]] as const) assert.equal(processFailed(status, code), false);
  });
});
