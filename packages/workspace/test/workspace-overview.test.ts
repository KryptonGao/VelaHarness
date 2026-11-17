import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const { collectWorkspaceOverview, parseCommitLog, pickTopFiles } = await import("../src/workspace-overview.ts");

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runGit(cwd, ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);
  assert.equal(result.code, 0, `git ${args.join(" ")} 失败: ${result.stderr}`);
}

async function temp(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

describe("workspace overview", () => {
  it("parses commit log lines and drops malformed ones", () => {
    const commits = parseCommitLog(["aaa\x1fa1\x1f1700000000\x1ffeat: one", "bad line", "bbb\x1fb2\x1f1700000100\x1fsubject\x1fwith separator", ""].join("\n"));
    assert.deepEqual(commits.map(c => [c.sha, c.shortSha, c.at, c.subject]), [
      ["aaa", "a1", 1_700_000_000_000, "feat: one"],
      ["bbb", "b2", 1_700_000_100_000, "subject\x1fwith separator"],
    ]);
  });

  it("ranks the largest changes first with a stable tie-break", () => {
    const file = (path: string, added: number, deleted: number) => ({
      path, oldPath: null, status: "modified" as const, indexStatus: null, worktreeStatus: "modified" as const,
      addedLines: added, deletedLines: deleted, indexAddedLines: 0, indexDeletedLines: 0, worktreeAddedLines: added, worktreeDeletedLines: deleted,
    });
    const top = pickTopFiles([file("b.ts", 1, 1), file("a.ts", 1, 1), file("big.ts", 50, 5), file("small.ts", 0, 1)], 3);
    assert.deepEqual(top.map(f => f.path), ["big.ts", "a.ts", "b.ts"]);
  });

  it("returns git: null for a folder that is not a repository", async () => {
    const dir = await temp("vela-overview-plain-");
    const snapshot = await collectWorkspaceOverview(dir, { managedRoot: null });
    assert.equal(snapshot.workspace, dir);
    assert.equal(snapshot.git, null);
  });

  it("summarises branch, changes, commits and extra worktrees without a current workspace", async () => {
    const repo = await temp("vela-overview-repo-");
    await git(repo, ["init", "-b", "main"]);
    await writeFile(join(repo, "a.txt"), "one\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "first"]);
    await writeFile(join(repo, "a.txt"), "one\ntwo\nthree\n");
    await writeFile(join(repo, "new.txt"), "x\n");
    const other = await temp("vela-overview-wt-");
    await rm(other, { recursive: true });
    await mkdir(join(other, ".."), { recursive: true });
    await git(repo, ["worktree", "add", "-b", "side", other]);

    const { git: summary } = await collectWorkspaceOverview(repo, { managedRoot: null });
    assert.ok(summary);
    assert.equal(summary.branch, "main");
    assert.equal(summary.detached, false);
    assert.equal(summary.fileCount, 2);
    assert.equal(summary.counts.modified, 1);
    assert.equal(summary.counts.untracked, 1);
    assert.equal(summary.topFiles[0]?.path, "a.txt");
    assert.deepEqual(summary.commits.map(c => c.subject), ["first"]);
    assert.equal(summary.worktreeCount, 1);
    assert.equal(summary.worktrees[0]?.branch, "side");
    assert.equal(summary.operation, null);
  });

  it("handles a repository with no commits", async () => {
    const repo = await temp("vela-overview-empty-");
    await git(repo, ["init", "-b", "main"]);
    const { git: summary } = await collectWorkspaceOverview(repo, { managedRoot: null });
    assert.ok(summary);
    assert.deepEqual(summary.commits, []);
    assert.equal(summary.worktreeCount, 0);
  });
});

describe("reveal path", () => {
  it("resolves repository files, falls back to the nearest existing folder for deleted ones and rejects escapes", async () => {
    const { resolveRevealPath } = await import("../src/workspace-overview.ts");
    const repo = await temp("vela-overview-reveal-");
    await git(repo, ["init", "-b", "main"]);
    await mkdir(join(repo, "src", "deep"), { recursive: true });
    await writeFile(join(repo, "src", "deep", "a.ts"), "x\n");
    const sub = join(repo, "src");
    // The workspace may be a subfolder; paths stay relative to the repository root.
    assert.equal(await resolveRevealPath(sub, "src/deep/a.ts"), join(repo, "src", "deep", "a.ts"));
    assert.equal(await resolveRevealPath(repo, "src/deep/gone/removed.ts"), join(repo, "src", "deep"));
    assert.equal(await resolveRevealPath(repo, "gone.ts"), repo);
    await assert.rejects(resolveRevealPath(repo, "../outside.txt"), /不在仓库内/);
    await assert.rejects(resolveRevealPath(repo, "/etc/hosts"), /无效/);
    await assert.rejects(resolveRevealPath(repo, ""), /无效/);
    await assert.rejects(resolveRevealPath(await temp("vela-overview-plain2-"), "a.ts"), /不是 Git 仓库/);
  });
});
