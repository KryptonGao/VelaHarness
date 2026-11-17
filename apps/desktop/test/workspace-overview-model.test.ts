import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationSummary, ScheduledTask } from "@vela/shared";
import {
  attentionItems,
  changeBreakdown,
  dailyCreatedConversations,
  overviewCounts,
  scheduleSummary,
  workspaceConversations,
} from "../src/renderer/components/workspace-overview-model.ts";

const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime();
const now = at(17);
function chat(id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return { id, title: id, cwd: "/work/a", createdAt: at(10), updatedAt: at(10), archivedAt: null, status: "ready", messageCount: 2, ...overrides };
}

describe("workspace overview model", () => {
  it("only lists sent, unarchived chats of the workspace, folding worktree chats into their repository", () => {
    const list = workspaceConversations([
      chat("mine"),
      chat("other", { cwd: "/work/b" }),
      chat("draft", { messageCount: 0 }),
      chat("archived", { archivedAt: at(11) }),
      chat("wt", { cwd: "/home/.vela/worktrees/x", worktree: { repository: "/work/a" } as ConversationSummary["worktree"] }),
      chat("loose", { hasWorkspace: false }),
    ], "/work/a", "New chat");
    assert.deepEqual(list.map(item => item.id).sort(), ["mine", "wt"]);
  });

  it("counts running, waiting and failed chats", () => {
    const list = [chat("a", { status: "streaming" }), chat("b"), chat("c", { status: "error" }), chat("d", { status: "starting" })];
    assert.deepEqual(overviewCounts(list, { waitingConversationIds: ["b"] }), { total: 4, running: 2, waiting: 1, error: 1 });
  });

  it("puts waiting before failed chats and appends an in-progress git operation", () => {
    const list = [chat("err", { status: "error", updatedAt: at(16) }), chat("wait", { updatedAt: at(12) }), chat("fine")];
    const items = attentionItems(list, { waitingConversationIds: ["wait"] }, { operation: "rebase" });
    assert.deepEqual(items.map(item => [item.kind, item.conversationId]), [["waiting", "wait"], ["error", "err"], ["operation", null]]);
    assert.deepEqual(attentionItems(list, {}, null).map(item => item.kind), ["error"]);
  });

  it("buckets chats created in the last days by local calendar day, oldest first", () => {
    const list = [chat("today", { createdAt: at(17, 1) }), chat("today2", { createdAt: at(17, 23) }), chat("edge", { createdAt: at(4, 0) }), chat("tooOld", { createdAt: at(3, 23) })];
    const series = dailyCreatedConversations(list, now, 14);
    assert.equal(series.length, 14);
    assert.equal(new Date(series[0]!.day).getDate(), 4);
    assert.equal(new Date(series[13]!.day).getDate(), 17);
    assert.deepEqual([series[0]!.count, series[13]!.count], [1, 2]);
    assert.equal(series.reduce((sum, entry) => sum + entry.count, 0), 3);
  });

  it("groups git status counts for the change bar and drops empty parts", () => {
    assert.deepEqual(changeBreakdown({ modified: 8, added: 1, untracked: 2, deleted: 1, renamed: 1, conflicted: 0 }), [
      { status: "modified", count: 8 }, { status: "added", count: 3 }, { status: "deleted", count: 1 }, { status: "other", count: 1 },
    ]);
    assert.deepEqual(changeBreakdown({ modified: 0, added: 0, untracked: 0, deleted: 0, renamed: 0, conflicted: 0 }), []);
  });

  it("summarises only active scheduled tasks of the workspace", () => {
    const task = (id: string, workspace: string, status: ScheduledTask["status"], nextRunAt: number | null) => ({ id, workspace, status, nextRunAt }) as ScheduledTask;
    const summary = scheduleSummary([
      task("late", "/work/a", "active", at(20)), task("soon", "/work/a", "active", at(18)),
      task("paused", "/work/a", "paused", at(17)), task("other", "/work/b", "active", at(17)), task("done", "/work/a", "completed", null),
    ], "/work/a");
    assert.equal(summary.active, 2);
    assert.equal(summary.next?.id, "soon");
    assert.equal(summary.nextRunAt, at(18));
    assert.deepEqual(scheduleSummary([], "/work/a"), { active: 0, nextRunAt: null, next: null });
  });
});
