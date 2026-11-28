import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractRows, isUnindexedTool, searchKinds } from "../src/main/search-extract.ts";

const stamp = "2026-05-01T08:00:00.000Z";
const entry = (id: string, message: unknown) => JSON.stringify({ type: "message", id, parentId: null, timestamp: stamp, message });

describe("extractRows", () => {
  it("reads user text from a string or from text parts, and skips images", () => {
    assert.deepEqual(extractRows(entry("u1", { role: "user", content: "hello" })).map(row => row.text), ["hello"]);
    const rows = extractRows(entry("u2", { role: "user", content: [{ type: "text", text: "see" }, { type: "image", data: "AAAA" }, { type: "text", text: "this" }] }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.text, "see\nthis");
    assert.equal(rows[0]!.kind, searchKinds.user);
    assert.equal(rows[0]!.entryId, "u2");
    assert.equal(rows[0]!.timestamp, Date.parse(stamp));
  });

  it("indexes assistant text and each tool call, but not thinking", () => {
    const rows = extractRows(entry("a1", { role: "assistant", content: [
      { type: "thinking", thinking: "secret reasoning" },
      { type: "text", text: "Running it" },
      { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npm test -- --watch" } },
      { type: "toolCall", id: "call-2", name: "edit", arguments: { path: "a.ts", newText: "x" } },
    ] }));
    assert.deepEqual(rows.map(row => [row.kind, row.toolCallId]), [
      [searchKinds.assistant, null], [searchKinds.tool, "call-1"], [searchKinds.tool, "call-2"],
    ]);
    assert.equal(rows[0]!.text, "Running it");
    assert.equal(rows[1]!.text, "bash npm test -- --watch");
    assert.match(rows[2]!.text, /^edit \{"path":"a\.ts"/);
    assert.ok(!rows.some(row => row.text.includes("secret reasoning")));
  });

  it("indexes tool output under the call it answers", () => {
    const [row] = extractRows(entry("r1", { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "npm ERR! code ENOENT" }] }));
    assert.equal(row!.kind, searchKinds.tool);
    assert.equal(row!.toolCallId, "call-1");
    assert.equal(row!.entryId, "r1");
    assert.equal(row!.text, "npm ERR! code ENOENT");
  });

  it("keeps the start and end of long output and only the start of a file read", () => {
    const long = `${"a".repeat(6000)}${"m".repeat(5000)}${"z".repeat(2000)}`;
    const [bash] = extractRows(entry("r1", { role: "toolResult", toolCallId: "c", toolName: "bash", content: long }));
    assert.ok(bash!.text.startsWith("a".repeat(6000)));
    assert.ok(bash!.text.endsWith("z".repeat(2000)));
    assert.ok(!bash!.text.includes("m"));
    const [read] = extractRows(entry("r2", { role: "toolResult", toolCallId: "c2", toolName: "read", content: long }));
    assert.equal(read!.text.length, 2000);
  });

  it("leaves MCP calls and results out of the index", () => {
    assert.ok(isUnindexedTool("mcp__notion__search"));
    assert.ok(isUnindexedTool("read_mcp_resource"));
    assert.ok(!isUnindexedTool("bash"));
    assert.deepEqual(extractRows(entry("a", { role: "assistant", content: [{ type: "toolCall", id: "c", name: "mcp__x__y", arguments: { token: "t" } }] })), []);
    assert.deepEqual(extractRows(entry("r", { role: "toolResult", toolCallId: "c", toolName: "mcp__x__y", content: "secret" })), []);
  });

  it("removes control characters that delimit highlights and lone surrogates", () => {
    const [row] = extractRows(entry("u", { role: "user", content: "a\u0001b\u0002c\u0000d \ud800 e" }));
    assert.equal(row!.text, "a b c d � e");
  });

  it("ignores lines that are not messages, are damaged, or have no text", () => {
    assert.deepEqual(extractRows(JSON.stringify({ type: "model_change", id: "m", provider: "x" })), []);
    assert.deepEqual(extractRows('{"type":"message","id":"x","message":{"role":"user","content":'), []);
    assert.deepEqual(extractRows(entry("u", { role: "user", content: "   " })), []);
    assert.deepEqual(extractRows(entry("s", { role: "system", content: "rules" })), []);
  });

  it("reports a missing timestamp as NaN so the indexer can substitute one", () => {
    const [row] = extractRows(JSON.stringify({ type: "message", id: "u", message: { role: "user", content: "hi" } }));
    assert.ok(Number.isNaN(row!.timestamp));
  });
});
