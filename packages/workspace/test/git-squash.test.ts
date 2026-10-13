import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

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

const { runGit } = await import("../src/git-run.ts");
const { commitWorktreeChanges, currentHead, deleteLocalBranch, hasTrackedChanges, parseNumstat, squashMergeBranch } = await import("../src/git-squash.ts");
const { createWorktree, removeWorktree } = await import("../src/git-worktree.ts");

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(cwd, args);
  assert.equal(result.code, 0, `git ${args.join(" ")} 失败: ${result.stderr}`);
  return result.stdout;
}

async function temp(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

async function write(root: string, path: string, content: string | Buffer): Promise<void> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

async function repo(): Promise<string> {
  const root = await temp("vela-squash-repo-");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Vela Test"]);
  await git(root, ["config", "user.email", "test@vela.local"]);
  await write(root, "a.txt", "one\ntwo\nthree\n");
  await write(root, "keep.txt", "keep\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", "init"]);
  return root;
}

async function lane(root: string, name: string) {
  const managed = await temp("vela-squash-wt-");
  const result = await createWorktree(root, { branch: `vela/race-test-${name}`, newBranch: true, startPoint: "HEAD" }, managed);
  assert.equal(result.ok, true, result.message);
  return { path: result.path!, branch: `vela/race-test-${name}` };
}

describe("race git helpers", () => {
  it("parseNumstat 解析文本与二进制文件", () => {
    assert.deepEqual(parseNumstat("3\t1\ta.txt\0-\t-\timg.png\0"), [
      { path: "a.txt", added: 3, removed: 1 },
      { path: "img.png", added: 0, removed: 0 },
    ]);
    assert.deepEqual(parseNumstat(""), []);
  });

  it("commitWorktreeChanges 统计新增、修改与删除，并在无变更时返回 null", async () => {
    const root = await repo();
    const base = (await currentHead(root)).sha;
    const idle = await lane(root, "idle");
    const none = await commitWorktreeChanges(idle.path, base, "race: idle");
    assert.equal(none.commitSha, null);
    assert.deepEqual(none.files, []);

    const busy = await lane(root, "busy");
    await write(busy.path, "a.txt", "one\nTWO\nthree\nfour\n");
    await write(busy.path, "new/b.txt", "b\n");
    await write(busy.path, "bin.dat", Buffer.from([0, 1, 2, 3, 0]));
    await rm(join(busy.path, "keep.txt"));
    const done = await commitWorktreeChanges(busy.path, base, "race: busy");
    assert.match(done.commitSha ?? "", /^[0-9a-f]{40}$/);
    assert.deepEqual([...done.files].sort(), ["a.txt", "bin.dat", "keep.txt", "new/b.txt"]);
    // a.txt: +TWO +four −two；new/b.txt: +1；keep.txt: −1；二进制文件不计行数。
    assert.equal(done.added, 3);
    assert.equal(done.removed, 2);
  });

  it("没有配置 git 身份时仍能提交", async () => {
    const root = await repo();
    await git(root, ["config", "--unset", "user.name"]);
    await git(root, ["config", "--unset", "user.email"]);
    const base = (await currentHead(root)).sha;
    const item = await lane(root, "anon");
    await write(item.path, "a.txt", "changed\n");
    const previous = { ...process.env };
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    try {
      const result = await commitWorktreeChanges(item.path, base, "race: anon");
      assert.ok(result.commitSha);
    } finally {
      process.env.GIT_CONFIG_GLOBAL = previous.GIT_CONFIG_GLOBAL;
      if (previous.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      if (previous.GIT_CONFIG_NOSYSTEM === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    }
  });

  it("squashMergeBranch 把变更留在暂存区而不提交，并带上删除与新增", async () => {
    const root = await repo();
    const base = (await currentHead(root)).sha;
    const item = await lane(root, "win");
    await write(item.path, "a.txt", "one\nTWO\nthree\n");
    await write(item.path, "added.txt", "x\n");
    await rm(join(item.path, "keep.txt"));
    await commitWorktreeChanges(item.path, base, "race: win");

    const merged = await squashMergeBranch(root, item.branch);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    assert.deepEqual([...merged.files].sort(), ["a.txt", "added.txt", "keep.txt"]);
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "one\nTWO\nthree\n");
    assert.equal((await currentHead(root)).sha, base, "squash 不应产生提交");
    const status = await git(root, ["status", "--porcelain"]);
    assert.match(status, /^M {2}a\.txt$/m);
    assert.match(status, /^A {2}added\.txt$/m);
    assert.match(status, /^D {2}keep\.txt$/m);
  });

  it("主工作区有已追踪变更时拒绝，且不改动任何东西", async () => {
    const root = await repo();
    const base = (await currentHead(root)).sha;
    const item = await lane(root, "dirty");
    await write(item.path, "a.txt", "from lane\n");
    await commitWorktreeChanges(item.path, base, "race: dirty");
    await write(root, "keep.txt", "local edit\n");
    assert.equal(await hasTrackedChanges(root), true);

    const result = await squashMergeBranch(root, item.branch);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "dirty");
    assert.equal(await readFile(join(root, "keep.txt"), "utf8"), "local edit\n");
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "one\ntwo\nthree\n");
  });

  it("未跟踪文件不会阻止采用", async () => {
    const root = await repo();
    const base = (await currentHead(root)).sha;
    const item = await lane(root, "untracked");
    await write(item.path, "a.txt", "lane\n");
    await commitWorktreeChanges(item.path, base, "race: untracked");
    await write(root, "scratch.log", "noise\n");
    assert.equal(await hasTrackedChanges(root), false);
    const result = await squashMergeBranch(root, item.branch);
    assert.equal(result.ok, true);
    assert.equal(await readFile(join(root, "scratch.log"), "utf8"), "noise\n");
  });

  it("冲突时还原工作区并列出冲突文件", async () => {
    const root = await repo();
    const base = (await currentHead(root)).sha;
    const item = await lane(root, "conflict");
    await write(item.path, "a.txt", "lane edit\ntwo\nthree\n");
    await commitWorktreeChanges(item.path, base, "race: conflict");
    // 主分支之后在同一行做了不同的提交，三方合并必然冲突。
    await write(root, "a.txt", "main edit\ntwo\nthree\n");
    await git(root, ["commit", "-am", "main moved"]);
    const head = (await currentHead(root)).sha;

    const result = await squashMergeBranch(root, item.branch);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "conflict");
    assert.deepEqual(result.conflicts, ["a.txt"]);
    assert.equal((await currentHead(root)).sha, head);
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "main edit\ntwo\nthree\n");
    assert.equal(await git(root, ["status", "--porcelain"]), "");
  });

  it("拒绝以 - 开头的分支名，防止参数注入", async () => {
    const root = await repo();
    await assert.rejects(() => squashMergeBranch(root, "--abort"), /分支名不正确/);
    await assert.rejects(() => deleteLocalBranch(root, "-D"), /分支名不正确/);
  });

  it("清理：worktree 已提交所以可不带 force 移除，分支可删除且重复删除无害", async () => {
    const root = await repo();
    const base = (await currentHead(root)).sha;
    const item = await lane(root, "clean");
    await write(item.path, "a.txt", "x\n");
    await commitWorktreeChanges(item.path, base, "race: clean");
    const removed = await removeWorktree(root, { path: item.path, force: false }, null);
    assert.equal(removed.ok, true, removed.message);
    await deleteLocalBranch(root, item.branch);
    await deleteLocalBranch(root, item.branch);
    assert.doesNotMatch(await git(root, ["branch", "--list"]), /vela\/race-test-clean/);
  });
});
