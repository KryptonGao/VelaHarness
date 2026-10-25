import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryLoadReport, ModelCatalog, ModelSummary } from "@vela/shared";

// ui-storage 在模块加载时读取 window.vela.uiStorage；测试用内存实现替代。
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  vela: { uiStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key) : undefined),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } },
};
const { setActiveLocale } = await import("../src/renderer/locale.ts");
const { readSideChatChoice, searchSideChats, sideChatPreview, sideChatTimeLabel, sideChatTitle, forgetSideChatEntries, isSideChatDeleted, recallSideChatEntries, rememberSideChatEntries, sideChatEntriesFromStored, sideChatStoredEntries, sideChatMemoryLabel, sideChatModelInfo, sideChatRequestMessages, sideChatRetryHistory, writeSideChatChoice } =
  await import("../src/renderer/components/side-chat-model.ts");
type SideChatEntry = import("../src/renderer/components/side-chat-model.ts").SideChatEntry;

const report = (scope: "global" | "project", bytes: number, status: MemoryLoadReport["status"] = "loaded"): MemoryLoadReport =>
  ({ scope, workspace: null, path: null, status, bytes, error: null, message: null });

describe("side chat model", () => {
  it("sends only messages with text", () => {
    const entries: SideChatEntry[] = [
      { id: "1", role: "user", text: "hi" },
      { id: "2", role: "assistant", text: "", pending: true },
    ];
    assert.deepEqual(sideChatRequestMessages(entries), [{ role: "user", text: "hi" }]);
  });

  it("stores only entries with text and round-trips them", () => {
    const entries: SideChatEntry[] = [
      { id: "1", role: "user", text: "a", quotes: ["q"] },
      { id: "2", role: "assistant", text: "partial", pending: true },
      { id: "3", role: "user", text: "b" },
      { id: "4", role: "assistant", text: "", pending: true },
    ];
    const stored = sideChatStoredEntries(entries);
    assert.deepEqual(stored, [
      { id: "1", role: "user", text: "a", quotes: ["q"] },
      { id: "2", role: "assistant", text: "partial", stopped: true },
      { id: "3", role: "user", text: "b" },
    ]);
    assert.deepEqual(sideChatEntriesFromStored(stored), [
      { id: "1", role: "user", text: "a", quotes: ["q"] },
      { id: "2", role: "assistant", text: "partial", stopped: true },
      { id: "3", role: "user", text: "b" },
    ]);
  });

  it("remembers the latest entries per thread", () => {
    assert.equal(recallSideChatEntries("t"), undefined);
    rememberSideChatEntries("t", [{ id: "1", role: "user", text: "a" }]);
    assert.equal(recallSideChatEntries("t")?.length, 1);
  });

  it("names a chat after its first message and previews the last one", () => {
    const entries = [
      { id: "1", role: "user" as const, text: "  How does\n  satisfies work?  " },
      { id: "2", role: "assistant" as const, text: "It checks\nwithout widening." },
    ];
    assert.equal(sideChatTitle(entries), "How does satisfies work?");
    assert.equal(sideChatPreview(entries), "It checks without widening.");
    assert.equal(sideChatTitle([{ id: "1", role: "user", text: "x".repeat(60) }]), `${"x".repeat(40)}…`);
    setActiveLocale("en");
    assert.equal(sideChatTitle([]), "New chat");
    setActiveLocale("zh-CN");
    assert.equal(sideChatTitle([]), "新聊天");
    assert.equal(sideChatPreview([]), "");
  });

  it("searches names and every message without caring about case", () => {
    const thread = (id: string, texts: string[]) => ({
      id, number: 1, updatedAt: 1, entries: texts.map((text, index) => ({ id: `${id}${index}`, role: index % 2 ? "assistant" as const : "user" as const, text })),
    });
    const threads = [thread("a", ["About Rust lifetimes", "Borrowing rules apply"]), thread("b", ["Cooking pasta", "Boil water first"])];
    assert.equal(searchSideChats(threads, "  ").length, 2);
    assert.deepEqual(searchSideChats(threads, "BORROWING").map((hit) => hit.thread.id), ["a"]);
    assert.deepEqual(searchSideChats(threads, "borrowing")[0]!.snippet, { before: "", match: "Borrowing", after: " rules apply" });
    assert.deepEqual(searchSideChats(threads, "boil").map((hit) => hit.thread.id), ["b"]);
    assert.equal(searchSideChats(threads, "quantum").length, 0);
  });

  it("labels the time as clock, yesterday, weekday or date", () => {
    const now = new Date(2026, 9, 25, 18, 30).getTime();
    assert.match(sideChatTimeLabel(new Date(2026, 9, 25, 8, 5).getTime(), now, "en"), /8:05/);
    setActiveLocale("en");
    assert.equal(sideChatTimeLabel(new Date(2026, 9, 24, 23, 59).getTime(), now, "en"), "Yesterday");
    setActiveLocale("zh-CN");
    assert.match(sideChatTimeLabel(new Date(2026, 9, 21, 12).getTime(), now, "en"), /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    assert.match(sideChatTimeLabel(new Date(2026, 8, 1, 12).getTime(), now, "en"), /9\/1/);
    assert.match(sideChatTimeLabel(new Date(2025, 8, 1, 12).getTime(), now, "en"), /2025/);
  });

  it("remembers deleted chats so late saves can be skipped", () => {
    assert.equal(isSideChatDeleted("gone"), false);
    rememberSideChatEntries("gone", [{ id: "1", role: "user", text: "a" }]);
    forgetSideChatEntries("gone");
    assert.equal(recallSideChatEntries("gone"), undefined);
    assert.equal(isSideChatDeleted("gone"), true);
  });

  it("retries from the last user message", () => {
    const entries: SideChatEntry[] = [
      { id: "1", role: "user", text: "a" },
      { id: "2", role: "assistant", text: "b" },
      { id: "3", role: "user", text: "c" },
      { id: "4", role: "assistant", text: "partial", stopped: true },
    ];
    assert.deepEqual(sideChatRetryHistory(entries)?.map(entry => entry.id), ["1", "2", "3"]);
    assert.equal(sideChatRetryHistory([]), null);
  });

  it("remembers the last model choice and falls back to the main chat", () => {
    const main = { provider: "fixture", id: "one", thinkingLevel: "medium" as const };
    assert.deepEqual(readSideChatChoice(main), main);
    assert.equal(readSideChatChoice(null), null);
    writeSideChatChoice({ provider: "fixture", id: "two", thinkingLevel: "high" });
    assert.deepEqual(readSideChatChoice(main), { provider: "fixture", id: "two", thinkingLevel: "high" });
    store.set("vela.sideChat.model", JSON.stringify({ provider: "x", id: "y", thinkingLevel: "turbo" }));
    assert.deepEqual(readSideChatChoice(main), main);
    store.set("vela.sideChat.model", "{");
    assert.deepEqual(readSideChatChoice(main), main);
  });

  it("resolves the label and the reasoning levels the chosen model supports", () => {
    const summary = (id: string, levels: ModelSummary["thinkingLevels"]): ModelSummary => ({ provider: "fixture", providerName: "Fixture",
      id, name: `Model ${id}`, reasoning: levels.length > 1, contextWindow: 1000, available: true, custom: false, thinkingLevels: levels });
    const catalog = { providers: [], error: null, models: [summary("one", ["off", "low", "medium", "high"]), summary("plain", [])] } as unknown as ModelCatalog;
    assert.deepEqual(sideChatModelInfo(catalog, { provider: "fixture", id: "one", thinkingLevel: "medium" }),
      { label: "Model one", levels: ["off", "low", "medium", "high"], level: "medium" });
    // 不支持的强度取不超过它的最高一档。
    assert.equal(sideChatModelInfo(catalog, { provider: "fixture", id: "one", thinkingLevel: "max" }).level, "high");
    assert.deepEqual(sideChatModelInfo(catalog, { provider: "fixture", id: "plain", thinkingLevel: "high" }),
      { label: "Model plain", levels: ["off"], level: "off" });
    assert.deepEqual(sideChatModelInfo(catalog, { provider: "gone", id: "x", thinkingLevel: "high" }), { label: "gone/x", levels: ["off"], level: "off" });
    assert.deepEqual(sideChatModelInfo(null, null), { label: null, levels: ["off"], level: "off" });
  });

  it("describes which memory was included", () => {
    setActiveLocale("en");
    assert.equal(sideChatMemoryLabel(null), "Uses long-term memory");
    assert.equal(sideChatMemoryLabel({ memoryEnabled: false, memory: [] }), "Memory is off");
    assert.equal(sideChatMemoryLabel({ memoryEnabled: true, memory: [report("global", 0, "missing")] }), "No memory to include");
    assert.equal(sideChatMemoryLabel({ memoryEnabled: true, memory: [report("global", 10)] }), "Global memory included");
    assert.equal(sideChatMemoryLabel({ memoryEnabled: true, memory: [report("global", 10), report("project", 5)] }), "Global and project memory included");
    setActiveLocale("ja");
    assert.equal(sideChatMemoryLabel({ memoryEnabled: true, memory: [report("project", 5)] }), "プロジェクトのメモリーを利用");
    setActiveLocale("zh-CN");
  });
});
