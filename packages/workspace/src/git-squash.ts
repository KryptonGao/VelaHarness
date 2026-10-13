import { assertValidRefName, runGit } from "./git-run";

/** 赛马用到的 git 操作：在赛道 worktree 里留档、统计 diff，并把胜出分支 squash 到主工作区。 */

export interface WorktreeCommitResult {
  /** 没有任何变更时为 null。 */
  commitSha: string | null;
  files: string[];
  added: number;
  removed: number;
}

export type SquashResult =
  | { ok: true; files: string[] }
  | { ok: false; reason: "dirty" | "conflict" | "failed"; message: string; conflicts: string[] };

const commitTimeoutMs = 120_000;

function firstLine(text: string): string | null {
  return text.split("\n").map(line => line.trim()).find(Boolean) ?? null;
}

async function hasIdentity(cwd: string): Promise<boolean> {
  const [name, email] = await Promise.all([runGit(cwd, ["config", "user.name"]), runGit(cwd, ["config", "user.email"])]);
  return name.code === 0 && name.stdout.trim() !== "" && email.code === 0 && email.stdout.trim() !== "";
}

/** 解析 `git diff --numstat -z`：每条 `added\tremoved\tpath`，二进制文件的数字是 `-`。 */
export function parseNumstat(output: string): { path: string; added: number; removed: number }[] {
  const entries: { path: string; added: number; removed: number }[] = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(record);
    if (!match) continue;
    entries.push({ path: match[3], added: match[1] === "-" ? 0 : Number(match[1]), removed: match[2] === "-" ? 0 : Number(match[2]) });
  }
  return entries;
}

/**
 * 把 worktree 里的所有变更提交到当前（Vela 专属的 vela/race-*）分支，并统计相对 base 的 diff。
 * 不跑 hook、不签名：这只是一个让 squash 能取用的中间提交，最终提交由使用者自己完成。
 */
export async function commitWorktreeChanges(cwd: string, base: string, message: string): Promise<WorktreeCommitResult> {
  const add = await runGit(cwd, ["add", "-A"], commitTimeoutMs);
  if (add.code !== 0) throw new Error(firstLine(add.stderr) ?? "git add 失败");
  const staged = await runGit(cwd, ["diff", "--cached", "--quiet"]);
  if (staged.code === 1) {
    const identity = (await hasIdentity(cwd)) ? [] : ["-c", "user.name=Vela", "-c", "user.email=vela@localhost"];
    const commit = await runGit(cwd, [...identity, "-c", "commit.gpgsign=false", "commit", "--no-verify", "-m", message], commitTimeoutMs);
    if (commit.code !== 0) throw new Error(firstLine(commit.stderr) ?? firstLine(commit.stdout) ?? "git commit 失败");
  } else if (staged.code !== 0) {
    throw new Error(firstLine(staged.stderr) ?? "无法检查暂存区");
  }
  const head = await runGit(cwd, ["rev-parse", "HEAD"]);
  if (head.code !== 0) throw new Error(firstLine(head.stderr) ?? "无法读取 HEAD");
  const sha = head.stdout.trim();
  const stat = await runGit(cwd, ["diff", "--numstat", "-z", base, sha], 60_000);
  if (stat.code !== 0) throw new Error(firstLine(stat.stderr) ?? "无法统计 diff");
  const entries = parseNumstat(stat.stdout);
  if (entries.length === 0) return { commitSha: null, files: [], added: 0, removed: 0 };
  return {
    commitSha: sha,
    files: entries.map(entry => entry.path),
    added: entries.reduce((sum, entry) => sum + entry.added, 0),
    removed: entries.reduce((sum, entry) => sum + entry.removed, 0),
  };
}

/** 已追踪文件有未提交变更；未跟踪文件不算（merge 遇到会覆盖的未跟踪文件会自己失败）。 */
export async function hasTrackedChanges(cwd: string): Promise<boolean> {
  const status = await runGit(cwd, ["status", "--porcelain", "--untracked-files=no"]);
  if (status.code !== 0) throw new Error(firstLine(status.stderr) ?? "无法读取 git 状态");
  return status.stdout.trim().length > 0;
}

export async function currentHead(cwd: string): Promise<{ sha: string; branch: string | null }> {
  const sha = await runGit(cwd, ["rev-parse", "HEAD"]);
  if (sha.code !== 0) throw new Error(firstLine(sha.stderr) ?? "当前目录没有可用的提交");
  const branch = await runGit(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return { sha: sha.stdout.trim(), branch: branch.code === 0 ? branch.stdout.trim() || null : null };
}

/**
 * 在主工作区对分支做 squash 合并：变更留在暂存区，不提交。
 * 前置：已追踪文件必须干净。冲突时用 `reset --merge` 还原，保证失败不留半成品。
 */
export async function squashMergeBranch(cwd: string, branch: string): Promise<SquashResult> {
  await assertValidRefName(cwd, branch);
  if (await hasTrackedChanges(cwd)) {
    return { ok: false, reason: "dirty", message: "工作区有未提交的变更，请先提交或暂存后再采用。", conflicts: [] };
  }
  const merge = await runGit(cwd, ["merge", "--squash", branch], commitTimeoutMs);
  if (merge.code !== 0) {
    const unmerged = await runGit(cwd, ["diff", "--name-only", "--diff-filter=U"]);
    const conflicts = unmerged.code === 0 ? unmerged.stdout.split("\n").map(line => line.trim()).filter(Boolean) : [];
    const reset = await runGit(cwd, ["reset", "--merge"], 60_000);
    const restored = reset.code === 0;
    return {
      ok: false,
      reason: conflicts.length > 0 ? "conflict" : "failed",
      message: conflicts.length > 0
        ? `与当前工作区冲突：${conflicts.slice(0, 5).join("、")}${conflicts.length > 5 ? " 等" : ""}。已还原，未改动工作区。`
        : `${firstLine(merge.stderr) ?? firstLine(merge.stdout) ?? "合并失败"}${restored ? "" : "；还原也失败，请检查 git 状态"}`,
      conflicts,
    };
  }
  const staged = await runGit(cwd, ["diff", "--cached", "--name-only", "-z"]);
  if (staged.code !== 0) throw new Error(firstLine(staged.stderr) ?? "无法读取暂存区");
  return { ok: true, files: staged.stdout.split("\0").filter(Boolean) };
}

export async function deleteLocalBranch(cwd: string, branch: string): Promise<void> {
  await assertValidRefName(cwd, branch);
  const result = await runGit(cwd, ["branch", "-D", branch], 30_000);
  if (result.code !== 0 && !/not found/i.test(result.stderr)) throw new Error(firstLine(result.stderr) ?? "删除分支失败");
}
