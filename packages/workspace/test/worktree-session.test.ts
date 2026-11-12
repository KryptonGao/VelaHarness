import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { runGit } from "../src/git-run.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js")) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // 回退到默认解析
      }
    }
    return nextResolve(specifier, context);
  },
});

const { WorktreeSessions } = await import("../src/worktree-session.ts");

const tempDirs: string[] = [];

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(cwd, args);
  assert.equal(result.code, 0, `git ${args.join(" ")} 失败: ${result.stderr}`);
  return result.stdout;
}

async function fixture(): Promise<{ repo: string; sessions: InstanceType<typeof WorktreeSessions> }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "vela-wt-")));
  tempDirs.push(base);
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await writeFile(join(repo, "a.txt"), "a\n");
  await writeFile(join(repo, "src", "b.txt"), "b\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "init"]);
  return { repo, sessions: new WorktreeSessions(join(base, "worktrees")) };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

describe("WorktreeSessions", () => {
  it("creates a detached worktree from the current HEAD and leaves the repo untouched", async () => {
    const { repo, sessions } = await fixture();
    const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const created = await sessions.create(repo);

    assert.equal(created.cwd, created.path);
    assert.deepEqual(created.worktree, { repository: repo, baseSha: head, branch: null });
    assert.ok(sessions.isManaged(created.path));
    assert.equal((await git(created.path, ["rev-parse", "HEAD"])).trim(), head);
    assert.equal((await git(created.path, ["branch", "--show-current"])).trim(), "");
    assert.equal((await git(repo, ["branch", "--list"])).trim(), "* main");
  });

  it("gives every session its own worktree and keeps edits isolated", async () => {
    const { repo, sessions } = await fixture();
    const first = await sessions.create(repo);
    const second = await sessions.create(repo);
    assert.notEqual(first.path, second.path);

    await writeFile(join(first.path, "a.txt"), "changed in first\n");
    assert.equal(await readFile(join(second.path, "a.txt"), "utf8"), "a\n");
    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "a\n");
  });

  it("keeps the repository subfolder when the session started inside one", async () => {
    const { repo, sessions } = await fixture();
    const created = await sessions.create(join(repo, "src"));
    assert.equal(created.cwd, join(created.path, "src"));
    assert.equal(created.worktree.repository, repo);
  });

  it("refuses to create outside a git repository", async () => {
    const { sessions } = await fixture();
    const plain = await realpath(await mkdtemp(join(tmpdir(), "vela-plain-")));
    tempDirs.push(plain);
    await assert.rejects(sessions.create(plain), /不是 Git 仓库/);
  });

  it("hands edits, new files, deletions and commits back to the local checkout", async () => {
    const { repo, sessions } = await fixture();
    const { path, worktree } = await sessions.create(repo);

    await writeFile(join(path, "a.txt"), "edited\n");
    await writeFile(join(path, "new.txt"), "new\n");
    await git(path, ["rm", "-q", "src/b.txt"]);
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "work in worktree"]);
    await writeFile(join(path, "a.txt"), "edited again\n");

    const result = await sessions.handoffToLocal(path, worktree);
    assert.equal(result.ok, true, result.message);
    assert.equal(result.files, 3);
    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "edited again\n");
    assert.equal(await readFile(join(repo, "new.txt"), "utf8"), "new\n");
    assert.equal(await exists(join(repo, "src", "b.txt")), false);
    // 只落到工作区,不提交也不动分支。
    assert.equal((await git(repo, ["log", "--oneline"])).trim().split("\n").length, 1);
  });

  it("reports a no-op handoff when nothing changed", async () => {
    const { repo, sessions } = await fixture();
    const { path, worktree } = await sessions.create(repo);
    const result = await sessions.handoffToLocal(path, worktree);
    assert.deepEqual({ ok: result.ok, files: result.files }, { ok: true, files: 0 });
  });

  it("does not touch the local checkout when the same file already has other edits", async () => {
    const { repo, sessions } = await fixture();
    const { path, worktree } = await sessions.create(repo);
    await writeFile(join(path, "a.txt"), "from worktree\n");
    await writeFile(join(path, "new.txt"), "new\n");
    await writeFile(join(repo, "a.txt"), "local edit\n");

    const result = await sessions.handoffToLocal(path, worktree);
    assert.equal(result.ok, false);
    assert.deepEqual(result.conflicts, ["a.txt"]);
    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "local edit\n");
    assert.equal(await exists(join(repo, "new.txt")), false);
  });

  it("refuses to remove a worktree that still has unsent changes, unless forced", async () => {
    const { repo, sessions } = await fixture();
    const { path, worktree } = await sessions.create(repo);
    await writeFile(join(path, "scratch.txt"), "x\n");

    const blocked = await sessions.remove(path, worktree);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.changeCount, 1);
    assert.equal(await exists(path), true);

    const forced = await sessions.remove(path, worktree, true);
    assert.equal(forced.ok, true);
    assert.equal(await exists(path), false);
  });

  it("treats commits that no branch contains as unsent work", async () => {
    const { repo, sessions } = await fixture();
    const { path, worktree } = await sessions.create(repo);
    await writeFile(join(path, "a.txt"), "committed\n");
    await git(path, ["commit", "-am", "orphan commit"]);

    const blocked = await sessions.remove(path, worktree);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.changeCount, 1);

    await git(path, ["branch", "keep-me"]);
    assert.equal((await sessions.remove(path, worktree)).ok, true);
  });

  it("removes a clean worktree and tolerates one that is already gone", async () => {
    const { repo, sessions } = await fixture();
    const { path, worktree } = await sessions.create(repo);
    assert.equal((await sessions.remove(path, worktree)).ok, true);
    assert.equal(await exists(path), false);
    assert.equal((await sessions.remove(path, worktree)).ok, true);
    assert.equal((await git(repo, ["worktree", "list"])).trim().split("\n").length, 1);
  });

  it("never removes a directory outside the managed root", async () => {
    const { repo, sessions } = await fixture();
    const result = await sessions.remove(repo, { repository: repo, baseSha: "0".repeat(40), branch: null }, true);
    assert.equal(result.ok, false);
    assert.equal(await exists(join(repo, "a.txt")), true);
  });
});
