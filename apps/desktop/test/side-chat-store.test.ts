import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SideChatThread } from "@vela/shared";
import { SideChatStore, parseSideChatThread, parseSideChatWorkspace } from "../src/main/side-chat-store.ts";

const thread = (id: string, updatedAt: number, texts: string[] = ["hi"], number = 1): SideChatThread => ({
  id, number, updatedAt,
  entries: texts.map((text, index) => ({ id: `${id}-${index}`, role: index % 2 === 0 ? "user" : "assistant", text })),
});

describe("side chat store", () => {
  let directory: string;
  let store: SideChatStore;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "vela-side-chat-store-")); store = new SideChatStore(join(directory, "side-chats")); });
  afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

  it("shares threads within a project and keeps projects apart", () => {
    store.save("/a", thread("one", 1));
    store.save("/a", thread("two", 2, ["q", "a"], 2));
    store.save("/b", thread("other", 3));
    assert.deepEqual(store.list("/a").map((item) => item.id), ["two", "one"]);
    assert.deepEqual(store.list("/b").map((item) => item.id), ["other"]);
    assert.deepEqual(store.list(""), []);
  });

  it("survives a new store instance", () => {
    store.save("/a", thread("one", 1));
    assert.equal(new SideChatStore(join(directory, "side-chats")).list("/a")[0]?.entries[0]?.text, "hi");
  });

  it("replaces a thread on save and deletes it when emptied", () => {
    store.save("/a", thread("one", 1));
    store.save("/a", thread("one", 5, ["hi", "hello", "more"]));
    assert.equal(store.list("/a").length, 1);
    assert.equal(store.list("/a")[0]!.entries.length, 3);
    store.save("/a", { ...thread("one", 6), entries: [] });
    assert.deepEqual(store.list("/a"), []);
    assert.deepEqual(readdirSync(join(directory, "side-chats")), []);
  });

  it("removes one thread without touching the others", () => {
    store.save("/a", thread("one", 1));
    store.save("/a", thread("two", 2));
    store.remove("/a", "one");
    assert.deepEqual(store.list("/a").map((item) => item.id), ["two"]);
  });

  it("treats a corrupted file as empty and recovers on the next save", () => {
    store.save("/a", thread("one", 1));
    const file = join(directory, "side-chats", readdirSync(join(directory, "side-chats"))[0]!);
    writeFileSync(file, "{not json");
    assert.deepEqual(store.list("/a"), []);
    store.save("/a", thread("two", 2));
    assert.deepEqual(store.list("/a").map((item) => item.id), ["two"]);
  });

  it("normalises incoming threads", () => {
    const parsed = parseSideChatThread({
      id: "t", number: 2, updatedAt: 9,
      entries: [
        { id: "1", role: "user", text: "keep", quotes: ["q", 3], stopped: true },
        { id: "2", role: "assistant", text: "   " },
        { id: "3", role: "system", text: "bad" },
        { id: "4", role: "assistant", text: "ok" },
      ],
    });
    assert.deepEqual(parsed.entries, [
      { id: "1", role: "user", text: "keep", quotes: ["q"], stopped: true },
      { id: "4", role: "assistant", text: "ok" },
    ]);
    assert.throws(() => parseSideChatThread({ id: "", number: 1, entries: [] }));
    assert.throws(() => parseSideChatThread({ id: "t", number: 0, entries: [] }));
    assert.throws(() => parseSideChatThread({ id: "t", number: 1, entries: "x" }));
    assert.throws(() => parseSideChatWorkspace(5));
    assert.equal(parseSideChatWorkspace(""), "");
  });
});
