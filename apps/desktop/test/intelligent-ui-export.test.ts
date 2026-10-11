import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUiMessage, serializeUiStateSnapshot, uiSourceFingerprint, uiStateStorageKey, type TranscriptMessage } from "@vela/shared";
import { buildConversationExport, type ConversationExportInput } from "../src/main/conversation-export.ts";
import { UiExportNumbering } from "../src/main/intelligent-ui-export.ts";
import { billSplit, fenced } from "../../../packages/agent/test/fixtures/intelligent-ui.ts";

const message = (id: string, role: "user" | "assistant", text: string): TranscriptMessage =>
  ({ id, role, text, thinking: "", tools: [], timestamp: null });

const uiText = `先算一下：\n\n${fenced(billSplit)}\n\n以上。`;

function input(messages: TranscriptMessage[], readUiState?: ConversationExportInput["readUiState"]): ConversationExportInput {
  return {
    conversation: { id: "conv-1", title: "Split", cwd: "/work", createdAt: 0, updatedAt: 0 },
    messages, trace: null, checkpoints: null, locale: "en", appVersion: "1.0.9", readUiState,
    exportedAt: new Date(Date.UTC(2026, 9, 10)), homeDir: "/home/x",
  };
}

const markdown = { format: "markdown", includeTrace: false, includeThinking: false, includeDiffs: false } as const;
const html = { ...markdown, format: "html" } as const;

describe("Intelligent UI export", () => {
  const messages = [message("m1", "user", "split 240 by 5"), message("m2", "assistant", uiText)];

  it("writes the vela-ui block as static text with initial values", () => {
    const md = buildConversationExport(input(messages), markdown);
    assert.doesNotMatch(md, /vela-ui/);
    assert.doesNotMatch(md, /"op"/);
    assert.match(md, /先算一下/);
    assert.match(md, /以上。/);
    assert.match(md, /Interactive UI \(static text\)/);
    assert.match(md, /总额: 240 元/);
    assert.match(md, /每人金额: 48.00 元/);
  });

  it("uses the user's saved inputs when the fingerprint matches", () => {
    const [, ui] = parseUiMessage(uiText);
    assert.equal(ui.type, "ui");
    if (ui.type !== "ui") return;
    const fingerprint = uiSourceFingerprint(ui.artifact.artifactId, ui.raw);
    const key = uiStateStorageKey({ conversationId: "conv-1", messageId: "u0", artifactId: ui.artifact.artifactId });
    const stored = new Map([[key, serializeUiStateSnapshot(fingerprint, { amount: 300, people: 4 })]]);
    const md = buildConversationExport(input(messages, k => stored.get(k) ?? null), markdown);
    assert.match(md, /总额: 300 元/);
    assert.match(md, /每人金额: 75.00 元/);
  });

  it("ignores saved state whose fingerprint no longer matches", () => {
    const [, ui] = parseUiMessage(uiText);
    if (ui.type !== "ui") throw new Error("expected ui");
    const key = uiStateStorageKey({ conversationId: "conv-1", messageId: "u0", artifactId: ui.artifact.artifactId });
    const stale = serializeUiStateSnapshot("00000000", { amount: 999 });
    const md = buildConversationExport(input(messages, k => (k === key ? stale : null)), markdown);
    assert.match(md, /总额: 240 元/);
    assert.doesNotMatch(md, /999/);
  });

  it("survives a throwing state reader", () => {
    const md = buildConversationExport(input(messages, () => { throw new Error("disk"); }), markdown);
    assert.match(md, /总额: 240 元/);
  });

  it("numbers only messages that may contain UI, like the renderer", () => {
    const numbering = new UiExportNumbering();
    assert.equal(numbering.next("plain"), null);
    assert.equal(numbering.next(uiText), "u0");
    assert.equal(numbering.next("no ui here"), null);
    assert.equal(numbering.next(uiText), "u1");
  });

  it("leaves messages without UI untouched", () => {
    const md = buildConversationExport(input([message("a", "assistant", "Hello **world**")]), markdown);
    assert.match(md, /Hello \*\*world\*\*/);
    assert.doesNotMatch(md, /Interactive UI/);
  });

  it("replaces an invalid block with a placeholder instead of leaking its source", () => {
    const bad = "```vela-ui\n{\"op\":\"begin\",\"id\":\"x\",\"version\":1}\n{\"op\":\"node\",\"id\":\"r\",\"type\":\"script\",\"props\":{\"html\":\"<script>alert(1)</script>\"}}\n{\"op\":\"commit\"}\n```";
    const md = buildConversationExport(input([message("a", "assistant", bad)]), markdown);
    assert.doesNotMatch(md, /<script>/);
    assert.doesNotMatch(md, /"op"/);
  });

  it("renders in HTML export without raw JSON or active content", () => {
    const out = buildConversationExport(input(messages), html);
    assert.doesNotMatch(out, /vela-ui/);
    assert.match(out, /每人金额/);
    assert.doesNotMatch(out, /"op"/);
  });

  describe("P1/P2 blocks", () => {
    const sourceUi = fenced([
      '{"op":"begin","id":"src","version":1,"title":"Files"}',
      '{"op":"source","name":"files","tool":"bash","match":"git ls-files","format":"json","path":["items"]}',
      '{"op":"node","id":"root","type":"column","props":{}}',
      '{"op":"node","id":"tbl","parent":"root","type":"table","props":{"from":"files","columns":[{"key":"name","label":"Name"},{"key":"size","label":"Size"}]}}',
      '{"op":"node","id":"bar","parent":"root","type":"bar_chart","props":{"title":"Sizes","from":"files","x":"name","y":["size"]}}',
      '{"op":"commit"}',
    ]);
    const tool = (body: string, status: "done" | "error" = "done") => ({ id: "call_1234567890", name: "bash", status, activity: { command: "git ls-files --json", body } });
    const withTool = (body: string, completedAt: number, status: "done" | "error" = "done"): TranscriptMessage[] => [
      message("u", "user", "list files"),
      { ...message("a", "assistant", sourceUi), tools: [tool(body, status)], turnCompletedAt: completedAt },
    ];
    const exportedAt = Date.UTC(2026, 9, 10);

    it("fills a data-source table and chart from the real tool call in the transcript, with provenance", () => {
      const md = buildConversationExport(input(withTool('{"items":[{"name":"a.ts","size":120},{"name":"b.ts","size":80}]}', exportedAt - 60_000)), markdown);
      assert.match(md, /\| a\.ts \| 120 \|/);
      assert.match(md, /\| b\.ts \| 80 \|/);
      assert.match(md, /Data: bash \(call_1234567\) · 2026-10-09T23:59:00\.000Z · ok/);
    });

    it("never invents rows: a missing or failed tool call exports as no data with the status", () => {
      const missing = buildConversationExport(input([message("u", "user", "x"), message("a", "assistant", sourceUi)]), markdown);
      assert.doesNotMatch(missing, /a\.ts/);
      assert.match(missing, /Data: files \(not available\)|Data: bash/);
      const failed = buildConversationExport(input(withTool("fatal: not a git repository", exportedAt, "error")), markdown);
      assert.doesNotMatch(failed, /\| a\.ts/);
      assert.match(failed, /error/);
    });

    it("marks old results stale in the export", () => {
      const md = buildConversationExport(input(withTool('{"items":[{"name":"a.ts","size":1}]}', exportedAt - 3 * 3600_000)), markdown);
      assert.match(md, /· stale/);
    });

    it("keeps micro-apps out of the export: the code never appears", () => {
      const app = '```vela-app\n{"op":"app","id":"g","version":1,"title":"Game"}\n<script>steal()</script><p id="x">hello</p>\n```';
      for (const options of [markdown, html]) {
        const out = buildConversationExport(input([message("a", "assistant", `Try it:\n\n${app}\n\nDone.`)]), options);
        assert.doesNotMatch(out, /steal\(\)/);
        assert.doesNotMatch(out, /vela-app/);
        assert.match(out, /Sandboxed micro-app is not exported/);
        assert.match(out, /Try it:/);
        assert.match(out, /Done\./);
      }
    });

    it("exports rich views as text a reader can follow", () => {
      const rich = fenced([
        '{"op":"begin","id":"rich","version":1}',
        '{"op":"node","id":"root","type":"column","props":{}}',
        '{"op":"node","id":"tl","parent":"root","type":"timeline","props":{"items":[{"title":"Freeze","status":"done"},{"title":"Ship","status":"upcoming"}]}}',
        '{"op":"node","id":"df","parent":"root","type":"diff_view","props":{"diff":"@@ -1 +1 @@\\n-a\\n+b"}}',
        '{"op":"node","id":"it","parent":"root","type":"itinerary","props":{"days":[{"label":"Day 1","stops":[{"name":"Cafe","lat":1.5,"lng":2.5},{"name":"Museum"}]}]}}',
        '{"op":"commit"}',
      ]);
      const md = buildConversationExport(input([message("a", "assistant", rich)]), markdown);
      assert.match(md, /- Freeze \[done\]/);
      assert.match(md, /\+1 −1/);
      assert.match(md, /Cafe \(1\.5, 2\.5, coordinates given by the model\)/);
      assert.match(md, /- Museum\n/);
    });
  });
});
