import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitFileChange } from "@vela/shared";
import type { UiMessage } from "../src/renderer/hooks/useSession.ts";
import { historicalChanges, lastTurnChanges, loadWorkspaceChanges } from "../src/renderer/components/workspace-changes.ts";

const mixed: GitFileChange = { path: "mixed.ts", oldPath: null, status: "modified", indexStatus: "modified", worktreeStatus: "modified",
  addedLines: 5, deletedLines: 3, indexAddedLines: 2, indexDeletedLines: 1, worktreeAddedLines: 3, worktreeDeletedLines: 2 };
const untracked: GitFileChange = { ...mixed, path: "new.ts", status: "untracked", indexStatus: null, worktreeStatus: "untracked",
  indexAddedLines: 0, indexDeletedLines: 0, worktreeAddedLines: 1, worktreeDeletedLines: 0 };
const staged: GitFileChange = { ...mixed, path: "staged.ts", worktreeStatus: null, worktreeAddedLines: 0, worktreeDeletedLines: 0 };

describe("workspace change categories", () => {
  it("includes both parts of a partially staged file and counts each once", async () => {
    const calls: string[] = [];
    const result = await loadWorkspaceChanges([mixed, untracked, staged], "uncommitted", async (path, scope) => { calls.push(`${path}:${scope}`); return scope; });
    assert.equal(result.files.length, 3);
    assert.deepEqual(result.files[0].diffs, ["index", "worktree"]);
    assert.deepEqual(result.files[0].diffScopes, ["index", "worktree"]);
    assert.equal(result.added, 8);
    assert.equal(result.removed, 4);
    assert.equal(calls.length, 4);
  });
  it("isolates staged and unstaged content, including untracked files", async () => {
    const read = async (_path: string, scope: string) => scope;
    const index = await loadWorkspaceChanges([mixed, untracked, staged], "staged", read);
    const worktree = await loadWorkspaceChanges([mixed, untracked, staged], "unstaged", read);
    assert.deepEqual(index.files.map(file => file.path), ["mixed.ts", "staged.ts"]);
    assert.deepEqual(index.files.map(file => file.diffs), [["index"], ["index"]]);
    assert.equal(index.added, 4);
    assert.equal(index.removed, 2);
    assert.deepEqual(worktree.files.map(file => file.path), ["mixed.ts", "new.ts"]);
    assert.deepEqual(worktree.files.map(file => file.diffs), [["worktree"], ["worktree"]]);
    assert.equal(worktree.added, 4);
    assert.equal(worktree.removed, 2);
  });
  it("propagates read failures instead of displaying a successful empty result", async () => {
    await assert.rejects(loadWorkspaceChanges([mixed], "staged", async () => { throw new Error("read failed"); }), /read failed/);
  });
  it("bounds parallel file reads", async () => {
    let running = 0, peak = 0;
    await loadWorkspaceChanges(Array.from({ length: 12 }, (_, i) => ({ ...mixed, path: `${i}.ts` })), "uncommitted", async () => {
      peak = Math.max(peak, ++running);
      await new Promise(done => setTimeout(done, 1));
      running--;
      return "diff";
    });
    assert.equal(peak, 4);
  });
  it("reads the latest completed turn and excludes the active turn", () => {
    const user = (id: string) => ({ id, role: "user", tools: [] }) as unknown as UiMessage;
    const assistant = (id: string, path?: string) => ({ id, role: "assistant", tools: path ? [{ id, name: "edit", status: "done", activity: { path, diff: "+1 new" } }] : [] }) as unknown as UiMessage;
    const messages = [user("u1"), assistant("a1", "/repo/old.ts"), user("u2"), assistant("a2", "/repo/new.ts")];
    assert.equal(lastTurnChanges(messages, true, "/repo").files[0].path, "old.ts");
    assert.equal(lastTurnChanges(messages, false, "/repo").files[0].path, "new.ts");
    assert.equal(lastTurnChanges([...messages, user("u3"), assistant("a3")], false, "/repo").files.length, 0);
    assert.equal(lastTurnChanges([user("u1"), assistant("a1", "new.ts")], true, "/repo").files.length, 0);
  });
  it("matches historical patches for renames, deletions, spaces and quoted Unicode paths", () => {
    const paths = ["new name.ts", "removed.ts", "中文.ts"];
    const diff = 'diff --git a/old name.ts b/new name.ts\nsimilarity index 100%\nrename from old name.ts\nrename to new name.ts\n'
      + 'diff --git a/removed.ts b/removed.ts\n--- a/removed.ts\n+++ /dev/null\n'
      + 'diff --git "a/\\344\\270\\255\\346\\226\\207.ts" "b/\\344\\270\\255\\346\\226\\207.ts"\n@@ -1 +1 @@\n-old\n+new\n';
    const changes = historicalChanges(paths.map(path => ({ path, oldPath: null, status: "modified", addedLines: 1, deletedLines: 1 })), diff);
    assert.ok(changes.files.every(file => file.diffs[0].startsWith("diff --git ")));
    assert.match(changes.files[0].diffs[0], /rename to new name.ts/);
    assert.match(changes.files[1].diffs[0], /\/dev\/null/);
    assert.match(changes.files[2].diffs[0], /\+new/);
    assert.equal(changes.added, 3);
    assert.equal(historicalChanges([{ path: "truncated.ts", oldPath: null, status: "modified", addedLines: 1, deletedLines: 0 }], "").files[0].diffs[0], "");
  });
});
