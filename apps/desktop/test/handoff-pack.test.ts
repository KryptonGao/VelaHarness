import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handoffLimits, handoffSectionTitles, parseHandoffDraftRequest, renderHandoffText, type HandoffPack } from "@vela/shared";

const pack = (overrides: Partial<HandoffPack> = {}): HandoffPack => ({
  conversationId: "c1",
  title: "Fix  the\nparser",
  cwd: "/w",
  generatedAt: 1,
  source: "model",
  goal: "Make the parser stream tokens",
  decisions: ["Keep the public API", "  Use\nincremental parsing "],
  files: [
    { path: "src/parser.ts", added: 12, removed: 3, edits: 2, origin: "agent" },
    { path: "scripts/gen.sh", added: 0, removed: 0, edits: 0, origin: "disk" },
  ],
  omittedFiles: 0,
  verifications: [
    { command: "pnpm test", category: "test", result: "passed", exitCode: 0, stale: false, outputTail: "" },
    { command: "pnpm build", category: "build", result: "failed", exitCode: 2, stale: true, outputTail: "" },
    { command: "pnpm lint", category: "lint", result: "unknown", stale: false, outputTail: "" },
  ],
  omittedVerifications: 0,
  unfinished: ["Update docs"],
  notes: "",
  ...overrides,
});

describe("handoff draft request", () => {
  const request = { conversationId: "c1", locale: "en", requestId: "r1" };

  it("accepts a valid request and drops unknown fields", () => {
    assert.deepEqual(parseHandoffDraftRequest({ ...request, extra: 1 }), request);
  });

  it("rejects malformed input", () => {
    for (const invalid of [null, [], "x", {}, { ...request, conversationId: " " }, { ...request, conversationId: "a".repeat(201) },
      { ...request, locale: "fr" }, { ...request, requestId: "" }, { ...request, requestId: "a".repeat(101) }]) {
      assert.throws(() => parseHandoffDraftRequest(invalid));
    }
  });
});

describe("handoff text", () => {
  it("renders every section in English with files and verification results", () => {
    const text = renderHandoffText(pack(), "en");
    const titles = handoffSectionTitles("en");
    assert.ok(text.startsWith("# Task handoff pack · Fix the parser"));
    for (const title of [titles.goal, titles.decisions, titles.files, titles.verifications, titles.unfinished]) assert.ok(text.includes(`## ${title}`), title);
    assert.ok(!text.includes(`## ${titles.notes}`));
    assert.ok(text.includes("- `src/parser.ts` (+12 −3)"));
    assert.ok(text.includes("- `scripts/gen.sh`\n") || text.includes("- `scripts/gen.sh`\n\n"));
    assert.ok(text.includes("- `pnpm test` — passed (exit code 0)"));
    assert.ok(text.includes("- `pnpm build` — failed (exit code 2) — files changed afterwards"));
    assert.ok(text.includes("- `pnpm lint` — result unknown"));
    assert.ok(text.includes("- Use incremental parsing"));
  });

  it("renders Chinese headings and says plainly that no verification was recorded", () => {
    const text = renderHandoffText(pack({ verifications: [] }), "zh-CN");
    assert.ok(text.startsWith("# 任务交接包"));
    assert.ok(text.includes("## 实际验证\n（上一个对话没有记录任何验证）"));
  });

  it("uses translated headings for other locales", () => {
    const text = renderHandoffText(pack(), "ja");
    assert.ok(text.startsWith("# タスク引き継ぎパック"));
    assert.ok(text.includes("## 目標"));
    assert.ok(text.includes("## 実際に実行した検証"));
    assert.ok(text.includes("## 未完了の項目"));
    assert.ok(!text.includes("## Goal"));
    assert.ok(renderHandoffText(pack(), "zh-TW").includes("## 已確認決策"));
    assert.ok(renderHandoffText(pack(), "ko").includes("## 파일 수정"));
  });

  it("marks empty sections, mentions omitted entries and includes edited notes", () => {
    const text = renderHandoffText(pack({ goal: " ", decisions: [], files: [], omittedFiles: 5, unfinished: [], notes: "Remember the flaky test" }), "en");
    assert.ok(text.includes("## Goal\n(not recorded)"));
    assert.ok(text.includes("## Confirmed decisions\n(none)"));
    assert.ok(text.includes("5 more files not listed"));
    assert.ok(text.includes("## Unfinished items\n(none)"));
    assert.ok(text.includes("## Notes\nRemember the flaky test"));
  });

  it("truncates oversized text and says so", () => {
    const text = renderHandoffText(pack({ notes: "x".repeat(handoffLimits.textLength * 2) }), "en");
    assert.ok(text.length < handoffLimits.textLength + 100);
    assert.ok(text.endsWith("(content too long, truncated)"));
  });
});
