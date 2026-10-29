import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { conflictLimits, conflictingConversations, overlapsForConversation } from "@vela/shared";
import { ConflictService, buildConflictsState, type ConflictRuntime } from "../src/main/conflict-service.ts";

const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 28, 12);
const rec = (editedAt: number, edits = 1) => ({ editedAt, edits });

describe("buildConflictsState", () => {
  it("flags a file only when two or more chats edited the same absolute path", () => {
    const state = buildConflictsState([
      { conversationId: "a", title: "Auth", cwd: "/repo", files: new Map([["/repo/src/x.ts", rec(now - 5 * 60_000)], ["/repo/only-a.ts", rec(now - hour)]]) },
      { conversationId: "b", title: "Login", cwd: "/repo", files: new Map([["/repo/src/x.ts", rec(now - 60_000)]]) },
      { conversationId: "c", title: "Worktree", cwd: "/wt", files: new Map([["/wt/src/x.ts", rec(now)]]) },
    ], now);
    assert.deepEqual(state.overlaps.map(item => [item.relativePath, item.conversations.map(entry => entry.conversationId)]), [["src/x.ts", ["b", "a"]]]);
    assert.deepEqual(state.conversations.map(item => item.conversationId), ["c", "b", "a"]);
    assert.deepEqual(state.conversations.find(item => item.conversationId === "a")!.files.map(file => file.relativePath), ["src/x.ts", "only-a.ts"]);
    assert.deepEqual(conflictingConversations(state, "a"), [{ conversationId: "b", title: "Login", files: ["src/x.ts"] }]);
    assert.equal(overlapsForConversation(state, "c").length, 0);
  });

  it("ignores edits older than the window", () => {
    const state = buildConflictsState([
      { conversationId: "a", title: "A", cwd: "/repo", files: new Map([["/repo/x.ts", rec(now - conflictLimits.windowMs - 1)]]) },
      { conversationId: "b", title: "B", cwd: "/repo", files: new Map([["/repo/x.ts", rec(now)]]) },
    ], now);
    assert.deepEqual(state.overlaps, []);
    assert.deepEqual(state.conversations.map(item => item.conversationId), ["b"]);
  });
});

async function setup(t: TestContext, repo = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vela-conflict-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "pkg"), { recursive: true });
  if (repo) {
    const git = (...args: string[]) => execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" }).trim();
    git("init", "-b", "main");
    git("config", "user.name", "Conflict");
    git("config", "user.email", "conflict@example.invalid");
    await writeFile(join(workspace, "pkg", "a.txt"), "one\n");
    git("add", "-A");
    git("commit", "-m", "init");
  }
  const conversations = new Map<string, { title: string; cwd: string; hasWorkspace: boolean }>([
    ["a", { title: "First", cwd: workspace, hasWorkspace: true }],
    ["b", { title: "Second", cwd: join(workspace, "pkg"), hasWorkspace: true }],
  ]);
  const created: string[] = [];
  const runtime: ConflictRuntime = {
    conversation: id => conversations.get(id) ?? null,
    createConversation: async cwd => { created.push(cwd); return `new-${created.length}`; },
    worktreeRoot: join(root, "worktrees"),
  };
  const file = join(root, "edits.json");
  return { root, workspace, conversations, created, runtime, file };
}

describe("ConflictService", () => {
  it("resolves relative paths against the chat cwd so different folders still collide on the same file", async t => {
    const env = await setup(t);
    const service = new ConflictService(env.file, env.runtime, () => now);
    service.record("a", env.workspace, "pkg/x.ts");
    service.record("b", join(env.workspace, "pkg"), "x.ts");
    service.record("b", join(env.workspace, "pkg"), "x.ts");
    const state = service.list(now);
    assert.equal(state.overlaps.length, 1);
    assert.equal(state.overlaps[0]!.path, join(env.workspace, "pkg", "x.ts"));
    assert.equal(state.conversations.find(item => item.conversationId === "b")!.files[0]!.edits, 2);
    service.dispose();
  });

  it("drops archived or missing chats, expired files and forgotten chats", async t => {
    const env = await setup(t);
    let clock = now;
    const service = new ConflictService(env.file, env.runtime, () => clock);
    service.record("a", env.workspace, "x.ts");
    service.record("b", env.workspace, "x.ts");
    service.record("gone", env.workspace, "x.ts");
    assert.equal(service.list(clock).overlaps[0]!.conversations.length, 2);
    env.conversations.delete("b");
    assert.equal(service.list(clock).overlaps.length, 0);
    clock += conflictLimits.windowMs + 1;
    assert.equal(service.list(clock).conversations.length, 0);
    service.record("a", env.workspace, "y.ts", clock);
    service.forget("a");
    assert.equal(service.list(clock).conversations.length, 0);
    service.dispose();
  });

  it("caps the files kept per chat, evicting the oldest", async t => {
    const env = await setup(t);
    const service = new ConflictService(env.file, env.runtime, () => now);
    for (let i = 0; i < conflictLimits.maxFilesPerConversation + 5; i += 1) service.record("a", env.workspace, `f${i}.ts`, now - 1_000 + i);
    const files = service.list(now).conversations[0]!.files;
    assert.equal(files.length, conflictLimits.maxFilesPerConversation);
    assert.ok(!files.some(file => file.relativePath === "f0.ts"));
    service.dispose();
  });

  it("persists records across restarts and ignores a corrupt store", async t => {
    const env = await setup(t);
    const first = new ConflictService(env.file, env.runtime, () => now);
    first.record("a", env.workspace, "x.ts");
    first.dispose();
    const stored = JSON.parse(await readFile(env.file, "utf8"));
    assert.equal(stored.schemaVersion, 1);
    const second = new ConflictService(env.file, env.runtime, () => now);
    second.init();
    assert.equal(second.list(now).conversations[0]!.files[0]!.relativePath, "x.ts");
    second.dispose();
    await writeFile(env.file, "{not json");
    const third = new ConflictService(env.file, env.runtime, () => now);
    third.init();
    assert.deepEqual(third.list(now).conversations, []);
    third.dispose();
  });

  it("ignores bad inputs", async t => {
    const env = await setup(t);
    const service = new ConflictService(env.file, env.runtime, () => now);
    service.record("a", env.workspace, "   ");
    service.record("a", env.workspace, "bad\0path");
    service.record("a", "relative/cwd", "x.ts");
    assert.deepEqual(service.list(now).conversations, []);
    await assert.rejects(service.moveToWorktree(42), /对话 ID/);
    await assert.rejects(service.moveToWorktree("missing"), /对话不存在/);
    service.dispose();
  });

  it("moves a chat to a new worktree at the same sub-folder and returns a seed", async t => {
    const env = await setup(t, true);
    const service = new ConflictService(env.file, env.runtime, () => now);
    service.record("b", join(env.workspace, "pkg"), "a.txt");
    service.record("b", join(env.workspace, "pkg"), "../top.ts");
    const moved = await service.moveToWorktree("b");
    assert.match(moved.branch, /^vela\/task-[0-9a-f]{8}$/);
    assert.ok(existsSync(join(moved.worktree, "pkg", "a.txt")));
    assert.deepEqual(env.created, [join(moved.worktree, "pkg")]);
    assert.equal(moved.conversationId, "new-1");
    assert.match(moved.seed, /"Second"/);
    assert.match(moved.seed, /^- pkg\/a\.txt$/m);
    assert.match(moved.seed, /^- top\.ts$/m);
    assert.ok(!moved.seed.includes(env.root.replace(/\/$/, "") + "/workspace/top.ts"));
    assert.match(moved.seed, new RegExp(moved.branch));
    // 原对话保持不动，仍然记录着它的改动。
    assert.equal(service.list(now).conversations.some(item => item.conversationId === "b"), true);
    service.dispose();
  });

  it("explains when the workspace is not a git repository", async t => {
    const env = await setup(t);
    const service = new ConflictService(env.file, env.runtime, () => now);
    await assert.rejects(service.moveToWorktree("a"), /不是 Git 仓库/);
    assert.deepEqual(env.created, []);
    service.dispose();
  });
});
