import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationSummary } from "@vela/shared";
import {
  defaultSearchScope, groupActiveConversations, scopeFilters, scopeRange, searchActiveConversations,
  searchConversationTitles, searchProjects, searchWorkspace, workspaceName,
} from "../src/renderer/components/conversation-search.ts";

const conversations: ConversationSummary[] = [
  { id: "old", title: "修复登录", cwd: "/projects/Vela", updatedAt: 1, archivedAt: null, status: "ready" },
  { id: "archived", title: "修复登录", cwd: "/projects/Vela", updatedAt: 9, archivedAt: 5, status: "ready" },
  { id: "other", title: "Release notes", cwd: "C:\\projects\\DESKTOP", updatedAt: 4, archivedAt: null, status: "streaming" },
  { id: "recent", title: "侧边栏搜索", cwd: "/projects/Vela", updatedAt: 5, archivedAt: null, status: "ready" },
  { id: "empty", title: "", cwd: "/other/Untitled", updatedAt: 2, archivedAt: null, status: "ready" },
];

describe("sidebar conversation search", () => {
  it("keeps chats without a workspace searchable by title and out of workspace groups", () => {
    const unassigned: ConversationSummary = { ...conversations[0]!, id: "unassigned", title: "Hello", cwd: "/Applications/Vela.app/Contents", hasWorkspace: false, updatedAt: 10, messageCount: 1 };
    const actualWorkspace = { ...unassigned, id: "actual-workspace", cwd: "/projects/Contents", hasWorkspace: true, updatedAt: 8 };
    const items = [...conversations, unassigned, actualWorkspace,
      { ...unassigned, id: "older-unassigned", updatedAt: 6 },
      { ...unassigned, id: "draft-unassigned", messageCount: 0 },
      { ...unassigned, id: "archived-unassigned", archivedAt: 11 }];
    const original = structuredClone(items);
    const recent = searchActiveConversations(items, "", "新对话").filter(item => item.hasWorkspace === false);
    assert.deepEqual(recent.map(item => item.id), ["unassigned", "older-unassigned"]);
    const groups = groupActiveConversations(items, "", "新对话");
    assert.equal(groups[0]!.cwd, actualWorkspace.cwd);
    assert.equal(groups[0]!.name, "Contents");
    assert.ok(groups.every(group => group.conversations.every(item => item.hasWorkspace !== false)));
    assert.deepEqual([...groups.flatMap(group => group.conversations), ...recent].map(item => item.id).sort(),
      searchActiveConversations(items, "", "新对话").map(item => item.id).sort());
    assert.deepEqual(searchActiveConversations(items, "Contents", "新对话").map(item => item.id), ["actual-workspace"]);
    assert.deepEqual(searchActiveConversations(items, "Hello", "新对话").map(item => item.id), ["unassigned", "actual-workspace", "older-unassigned"]);
    assert.deepEqual(groupActiveConversations([unassigned], "", "新对话"), []);
    assert.deepEqual(items, original);
  });

  it("lists a new chat only after its first message is sent, including image-only messages", () => {
    const draft: ConversationSummary = { id: "draft", title: "新对话", cwd: "/new/workspace", createdAt: 10,
      updatedAt: 10, archivedAt: null, status: "ready", messageCount: 0 };
    const pending = [...conversations, draft, { ...draft, id: "another-draft", status: "starting" as const }];
    assert.deepEqual(searchActiveConversations(pending, "", "新对话"), searchActiveConversations(conversations, "", "新对话"));
    assert.deepEqual(groupActiveConversations(pending, "", "新对话"), groupActiveConversations(conversations, "", "新对话"));
    assert.deepEqual(searchActiveConversations(pending, "/new/workspace", "新对话"), []);
    // The count, rather than the title or assistant's first reply, controls visibility.
    const sent = { ...draft, messageCount: 1, status: "streaming" as const };
    assert.equal(searchActiveConversations([...conversations, sent], "", "新对话")[0]?.id, "draft");
    assert.equal(groupActiveConversations([...conversations, sent], "", "新对话")[0]?.cwd, draft.cwd);
    assert.deepEqual(searchActiveConversations([{ ...sent, archivedAt: 11 }], "", "新对话"), []);
  });

  it("orders dialog results globally by recency and filters titles and workspace paths", () => {
    const original = structuredClone(conversations);
    assert.deepEqual(searchActiveConversations(conversations, "", "新对话").map(item => item.id), ["recent", "other", "empty", "old"]);
    assert.deepEqual(searchActiveConversations(conversations, "DESKTOP release", "新对话").map(item => item.id), ["other"]);
    assert.deepEqual(searchActiveConversations(conversations, "登录", "新对话").map(item => item.id), ["old"]);
    assert.deepEqual(conversations, original);
  });
  it("keeps workspace and conversation recency, excludes archived chats, and does not mutate input", () => {
    const original = structuredClone(conversations);
    const groups = groupActiveConversations(conversations, "   ", "新对话");
    assert.deepEqual(groups.map(group => group.name), ["Vela", "DESKTOP", "Untitled"]);
    assert.deepEqual(groups[0]!.conversations.map(item => item.id), ["recent", "old"]);
    assert.deepEqual(conversations, original);
  });
  it("finds Chinese titles and case-insensitive workspace names or full paths", () => {
    assert.deepEqual(groupActiveConversations(conversations, "  登录  ", "新对话")[0]!.conversations.map(item => item.id), ["old"]);
    assert.equal(groupActiveConversations(conversations, "desktop", "New chat")[0]!.conversations[0]!.id, "other");
    assert.equal(groupActiveConversations(conversations, "C:\\projects\\", "New chat")[0]!.conversations[0]!.id, "other");
  });
  it("matches multiple keywords across title and workspace and reports no matches", () => {
    assert.deepEqual(groupActiveConversations(conversations, "vela 登录", "新对话")[0]!.conversations.map(item => item.id), ["old"]);
    assert.deepEqual(groupActiveConversations(conversations, "missing", "新对话"), []);
    assert.equal(groupActiveConversations(conversations, "新对话", "新对话")[0]!.conversations[0]!.id, "empty");
  });
  it("reflects a rename or archive immediately", () => {
    const changed = conversations.map(item => item.id === "old" ? { ...item, title: "支付问题" } : item);
    assert.deepEqual(groupActiveConversations(changed, "登录", "新对话"), []);
    assert.equal(groupActiveConversations(changed, "支付", "新对话")[0]!.conversations[0]!.id, "old");
    assert.deepEqual(groupActiveConversations(changed.map(item => ({ ...item, archivedAt: 10 })), "支付", "新对话"), []);
  });
  it("extracts workspace labels on Windows and POSIX, including trailing separators", () => {
    assert.equal(workspaceName("/projects/Vela/"), "Vela");
    assert.equal(workspaceName("C:\\projects\\Vela\\"), "Vela");
    assert.equal(workspaceName("/"), "/");
  });
});

describe("message search scope", () => {
  const now = new Date(2026, 4, 20, 12, 0, 0).getTime();
  const day = 86_400_000;

  it("turns a preset into a lower time bound and 'any time' into none", () => {
    assert.deepEqual(scopeRange(defaultSearchScope, now), {});
    assert.deepEqual(scopeRange({ ...defaultSearchScope, datePreset: "day" }, now), { from: now - day });
    assert.deepEqual(scopeRange({ ...defaultSearchScope, datePreset: "week" }, now), { from: now - 7 * day });
    assert.deepEqual(scopeRange({ ...defaultSearchScope, datePreset: "quarter" }, now), { from: now - 90 * day });
  });

  it("makes a custom end date include that whole day, and ignores dates that are not complete", () => {
    const range = scopeRange({ ...defaultSearchScope, datePreset: "custom", from: "2026-05-01", to: "2026-05-03" }, now);
    assert.equal(range.from, new Date(2026, 4, 1).getTime());
    assert.equal(range.to, new Date(2026, 4, 4).getTime());
    assert.deepEqual(scopeRange({ ...defaultSearchScope, datePreset: "custom", from: "2026-05-0", to: "" }, now), {});
    assert.deepEqual(Object.keys(scopeRange({ ...defaultSearchScope, datePreset: "custom", from: "2026-05-01", to: "" }, now)), ["from"]);
  });

  it("hands the main process only the fields it filters on", () => {
    assert.deepEqual(scopeFilters(defaultSearchScope, now), { includeArchived: true, includeTools: true });
    assert.deepEqual(
      scopeFilters({ ...defaultSearchScope, workspace: "", datePreset: "day", includeTools: false }, now),
      { workspace: "", from: now - day, includeArchived: true, includeTools: false },
    );
  });
});

describe("chat title search with scope", () => {
  const chat = (id: string, patch: Partial<ConversationSummary>): ConversationSummary => ({
    id, title: id, cwd: "/work/app", createdAt: 1, updatedAt: 100, archivedAt: null, status: "ready", messageCount: 1, ...patch,
  });
  const items = [
    chat("fix login", { updatedAt: 300 }),
    chat("fix archived", { updatedAt: 200, archivedAt: 250 }),
    chat("fix lib", { updatedAt: 100, cwd: "/work/lib" }),
    chat("fix loose", { updatedAt: 50, cwd: "/Applications/Vela.app", hasWorkspace: false }),
    chat("fix draft", { updatedAt: 400, messageCount: 0 }),
  ];
  const ids = (list: ConversationSummary[]) => list.map(item => item.id);

  it("lists only unarchived chats until something is typed, then includes archived ones", () => {
    assert.deepEqual(ids(searchConversationTitles(items, "", "New chat", defaultSearchScope)), ["fix login", "fix lib", "fix loose"]);
    assert.deepEqual(ids(searchConversationTitles(items, "fix", "New chat", defaultSearchScope)), ["fix login", "fix archived", "fix lib", "fix loose"]);
    assert.deepEqual(ids(searchConversationTitles(items, "fix", "New chat", { ...defaultSearchScope, includeArchived: false })), ["fix login", "fix lib", "fix loose"]);
  });

  it("filters by project, with '' for chats that have none", () => {
    assert.deepEqual(ids(searchConversationTitles(items, "fix", "New chat", { ...defaultSearchScope, workspace: "/work/lib" })), ["fix lib"]);
    assert.deepEqual(ids(searchConversationTitles(items, "fix", "New chat", { ...defaultSearchScope, workspace: "" })), ["fix loose"]);
  });

  it("filters by the day the chat was last updated", () => {
    const scope = { ...defaultSearchScope, datePreset: "day" as const };
    // "Past 24 hours" at 299 ms before the first chat's day ends keeps only the chat updated at 300.
    assert.deepEqual(ids(searchConversationTitles(items, "fix", "New chat", scope, 300 + 86_400_000 - 1)), ["fix login"]);
    assert.deepEqual(ids(searchConversationTitles(items, "fix", "New chat", scope, 200 + 86_400_000 - 1)), ["fix login", "fix archived"]);
  });

  it("lists projects by recent use, with chats that have none as ''", () => {
    assert.deepEqual(searchProjects(items), ["/work/app", "/work/lib", ""]);
    assert.equal(searchWorkspace(items[3]!), "");
    assert.equal(searchWorkspace({ cwd: "/wt", worktree: { repository: "/repo", baseSha: "a", branch: null } }), "/repo");
  });
});
