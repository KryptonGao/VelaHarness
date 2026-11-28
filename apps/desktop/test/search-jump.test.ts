import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alignEntryIds, findJumpMessage, searchJumpStore } from "../src/renderer/components/search-jump.ts";

const message = (id: string, extra: { entryId?: string; tools?: string[]; role?: string; text?: string } = {}) =>
  ({ id, entryId: extra.entryId, role: extra.role ?? "assistant", text: extra.text ?? "", tools: (extra.tools ?? []).map(tool => ({ id: tool })) });

describe("findJumpMessage", () => {
  const messages = [
    message("m1", { entryId: "e1", role: "user" }),
    message("m2", { entryId: "e2", tools: ["call-a", "call-b"] }),
    message("m3", { entryId: "e3" }),
  ];

  it("finds the message that was stored in the entry", () => {
    assert.equal(findJumpMessage(messages, { entryId: "e3", toolCallId: null }), "m3");
    assert.equal(findJumpMessage(messages, { entryId: "gone", toolCallId: null }), null);
  });

  it("finds the message that made a tool call, even when the hit is the output's entry", () => {
    assert.equal(findJumpMessage(messages, { entryId: "result-entry", toolCallId: "call-b" }), "m2");
  });

  it("falls back to the entry when the call is not in the chat", () => {
    assert.equal(findJumpMessage(messages, { entryId: "e1", toolCallId: "unknown" }), "m1");
  });
});

describe("alignEntryIds", () => {
  const saved = [
    { role: "user", text: "run the tests", entryId: "e1" },
    { role: "assistant", text: "", entryId: "e2" },
    { role: "assistant", text: "all green", entryId: "e3" },
    { role: "user", text: "ship it", entryId: "e4" },
  ];

  it("gives live messages the entries they were saved as, matching in order", () => {
    const live = [
      message("a", { role: "user", text: "run the tests" }),
      message("b", { role: "assistant", text: "" }),
      message("c", { role: "assistant", text: " all green " }),
    ];
    const aligned = alignEntryIds(live, saved);
    assert.deepEqual(aligned.map(item => item.entryId), ["e1", "e2", "e3"]);
    assert.deepEqual(aligned.map(item => item.id), ["a", "b", "c"]);
    assert.equal(live[0]!.entryId, undefined, "the input is not changed");
  });

  it("skips messages that were never saved and does not match the same entry twice", () => {
    const live = [message("a", { role: "user", text: "ship it" }), message("b", { role: "user", text: "ship it" })];
    assert.deepEqual(alignEntryIds(live, saved).map(item => item.entryId), ["e4", undefined]);
    assert.deepEqual(alignEntryIds([message("x", { role: "user", text: "unsaved" })], saved).map(item => item.entryId), [undefined]);
  });

  it("returns the same list when nothing needed an entry", () => {
    const done = [message("a", { entryId: "e1", role: "user", text: "run the tests" })];
    assert.equal(alignEntryIds(done, saved), done);
    const nothing = [message("a", { role: "user", text: "unsaved" })];
    assert.equal(alignEntryIds(nothing, saved), nothing);
  });
});

describe("searchJumpStore", () => {
  it("keeps the newest request and only clears the one it was given", () => {
    const first = searchJumpStore.request({ conversationId: "c", entryId: "e", toolCallId: null, keywords: ["a"] }, 1);
    const second = searchJumpStore.request({ conversationId: "c", entryId: "f", toolCallId: null, keywords: ["b"] }, 2);
    assert.notEqual(first.nonce, second.nonce);
    searchJumpStore.clear(first.nonce);
    assert.equal(searchJumpStore.get()?.entryId, "f");
    let notified = 0;
    const stop = searchJumpStore.subscribe(() => { notified += 1; });
    searchJumpStore.clear(second.nonce);
    stop();
    assert.equal(searchJumpStore.get(), null);
    assert.equal(notified, 1);
  });
});
