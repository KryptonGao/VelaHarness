import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffWords, markWordChanges } from "../src/renderer/components/diff-words.ts";
import { parseDisplayDiff } from "../src/renderer/components/tool-compact.ts";

describe("diffWords", () => {
  it("marks only the words that changed on each side", () => {
    const result = diffWords("const live = Boolean(a)", "const tools = Boolean(a)");
    assert.deepEqual(result?.oldRanges, [[6, 10]]);
    assert.deepEqual(result?.newRanges, [[6, 11]]);
  });

  it("merges changed words separated only by whitespace", () => {
    const result = diffWords("call(a b c)", "call(x y c)");
    assert.deepEqual(result?.newRanges, [[5, 8]]);
  });

  it("returns null for identical lines", () => {
    assert.equal(diffWords("same", "same"), null);
  });
});

describe("markWordChanges", () => {
  it("pairs a removed line with its rewritten counterpart", () => {
    const { rows } = parseDisplayDiff("-1 const live = true;\n+1 const tools = true;");
    assert.deepEqual(rows[0]?.marks, [[6, 10]]);
    assert.deepEqual(rows[1]?.marks, [[6, 11]]);
  });

  it("leaves wholly rewritten lines and pure additions unmarked", () => {
    const { rows } = parseDisplayDiff("-1 alpha beta gamma\n+1 one two three\n+2 extra");
    assert.equal(rows.every((row) => row.marks === undefined), true);
    const additions = [{ kind: "add", text: "x" }, { kind: "add", text: "y" }];
    markWordChanges(additions);
    assert.equal(additions.every((row) => !("marks" in row)), true);
  });

  it("skips pairing for oversized blocks", () => {
    const removed = Array.from({ length: 80 }, (_, i) => ({ kind: "del", text: `value ${i}` }));
    const added = Array.from({ length: 80 }, (_, i) => ({ kind: "add", text: `value ${i + 1}` }));
    markWordChanges([...removed, ...added]);
    assert.equal(removed.every((row) => !("marks" in row)), true);
  });
});
