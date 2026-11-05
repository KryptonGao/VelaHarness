import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationSummary } from "@vela/shared";
import { adjacentConversation, nextAttentionConversation, sidebarConversationOrder } from "../src/renderer/conversation-nav.ts";

function chat(id: string, patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return { id, title: id, cwd: "/work/a", updatedAt: 1000, archivedAt: null, messageCount: 2, status: "idle", hasWorkspace: true, ...patch } as ConversationSummary;
}

describe("keyboard chat navigation", () => {
  const order = [chat("a"), chat("b"), chat("c")];

  it("moves to the neighbour and wraps around", () => {
    assert.equal(adjacentConversation(order, "a", 1)?.id, "b");
    assert.equal(adjacentConversation(order, "c", 1)?.id, "a");
    assert.equal(adjacentConversation(order, "a", -1)?.id, "c");
  });

  it("starts from an end when the active chat is not listed", () => {
    assert.equal(adjacentConversation(order, "new", 1)?.id, "a");
    assert.equal(adjacentConversation(order, null, -1)?.id, "c");
  });

  it("has nowhere to go with zero or one chat", () => {
    assert.equal(adjacentConversation([], "a", 1), null);
    assert.equal(adjacentConversation([chat("a")], "a", 1), null);
  });

  it("finds the next chat that waits for an answer or failed", () => {
    const list = [chat("a"), chat("b", { status: "error" }), chat("c"), chat("d")];
    assert.equal(nextAttentionConversation(list, "a", {})?.id, "b");
    assert.equal(nextAttentionConversation(list, "b", { waitingConversationIds: ["d"] })?.id, "d");
    assert.equal(nextAttentionConversation(list, "d", { waitingConversationIds: ["d"] })?.id, "b");
    assert.equal(nextAttentionConversation(list, "b", {}), null);
    assert.equal(nextAttentionConversation([chat("a"), chat("c")], "a", {}), null);
  });

  it("orders like the sidebar: activity view by attention, workspace view by project", () => {
    const list = [
      chat("old", { cwd: "/work/a", updatedAt: 10 }),
      chat("fresh", { cwd: "/work/b", updatedAt: 5000 }),
      chat("alone", { hasWorkspace: false, updatedAt: 7000 }),
      chat("archived", { archivedAt: 1 }),
      chat("empty", { messageCount: 0 }),
    ];
    const now = 6000;
    const activity = sidebarConversationOrder(list, "activity", { waitingConversationIds: ["old"] }, "New chat", now).map(item => item.id);
    assert.deepEqual(activity, ["old", "alone", "fresh"]);
    const workspaces = sidebarConversationOrder(list, "workspaces", {}, "New chat", now).map(item => item.id);
    assert.deepEqual(workspaces, ["fresh", "old", "alone"]);
  });
});
