import {
  emptyGitStatusCounts,
  workspaceOverviewCommitLimit,
  workspaceOverviewTopFiles,
  workspaceOverviewWorktreeLimit,
  type GitFileChange,
  type WorkspaceOverviewCommit,
  type WorkspaceOverviewFile,
  type WorkspaceOverviewGit,
  type WorkspaceOverviewSnapshot,
} from "@vela/shared";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { gitQuery } from "./git-run";
import { collectStatus, isPathInsideReal } from "./git-service";
import { resolveRepoRoot } from "./git-state";
import { listWorktrees } from "./git-worktree";

export interface WorkspaceOverviewOptions {
  /** Vela 受管 worktree 根目录,用于标记 managed。 */
  managedRoot: string | null;
}

/** 改动行数最多的文件在前;行数相同按路径排序,保证输出稳定。 */
export function pickTopFiles(files: readonly GitFileChange[], limit = workspaceOverviewTopFiles): WorkspaceOverviewFile[] {
  return [...files]
    .sort((a, b) => (b.addedLines + b.deletedLines) - (a.addedLines + a.deletedLines) || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map(file => ({ path: file.path, status: file.status, addedLines: file.addedLines, deletedLines: file.deletedLines }));
}

/** 解析 `git log --format=%H%x1f%h%x1f%ct%x1f%s` 的输出;坏行直接丢弃。 */
export function parseCommitLog(stdout: string): WorkspaceOverviewCommit[] {
  const commits: WorkspaceOverviewCommit[] = [];
  for (const line of stdout.split("\n")) {
    const [sha, shortSha, seconds, ...subject] = line.split("\x1f");
    const at = Number(seconds) * 1000;
    if (!sha || !shortSha || !Number.isFinite(at)) continue;
    commits.push({ sha, shortSha, subject: subject.join("\x1f").trim(), at });
  }
  return commits;
}

async function recentCommits(cwd: string): Promise<WorkspaceOverviewCommit[]> {
  try {
    const stdout = await gitQuery(cwd, ["log", `-${workspaceOverviewCommitLimit}`, "--format=%H%x1f%h%x1f%ct%x1f%s"]);
    return parseCommitLog(stdout);
  } catch {
    // 还没有任何提交的仓库:没有历史可列。
    return [];
  }
}

/** 只读收集一个路径的 Git 概况;不是仓库时返回 git: null。不触碰全局「当前工作区」。 */
export async function collectWorkspaceOverview(workspace: string, options: WorkspaceOverviewOptions): Promise<WorkspaceOverviewSnapshot> {
  const status = await collectStatus(workspace);
  if (!status?.repo) return { workspace, git: null, generatedAt: Date.now() };
  const self = resolve(workspace);
  const [commits, allWorktrees] = await Promise.all([
    recentCommits(workspace),
    listWorktrees(workspace, { managedRoot: options.managedRoot, currentWorkspace: workspace }).catch(() => []),
  ]);
  const others = allWorktrees.filter(item => !item.current && !item.bare && !item.prunable && resolve(item.path) !== self && resolve(item.path) !== resolve(status.repo!.root));
  const counts = emptyGitStatusCounts();
  for (const file of status.files) counts[file.status] += 1;
  const git: WorkspaceOverviewGit = {
    repoRoot: status.repo.root,
    repoName: status.repo.name,
    subdir: status.repo.subdir,
    branch: status.branch,
    detached: status.detached,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    operation: status.operation?.kind ?? null,
    fileCount: status.files.length,
    addedLines: status.addedLines,
    deletedLines: status.deletedLines,
    counts,
    topFiles: pickTopFiles(status.files),
    commits,
    worktrees: others.slice(0, workspaceOverviewWorktreeLimit)
      .map(item => ({ path: item.path, branch: item.branch, changeCount: item.changeCount, managed: item.managed })),
    worktreeCount: others.length,
  };
  return { workspace, git, generatedAt: Date.now() };
}

/**
 * 把总览里点击的文件(相对仓库根的路径)解析成可在 Finder 中显示的绝对路径。
 * 路径必须落在仓库内(含符号链接解析后);文件已被删除时返回最近的、仍存在的上级目录。
 */
export async function resolveRevealPath(workspace: string, relativePath: string): Promise<string> {
  if (!relativePath || relativePath.includes("\0") || isAbsolute(relativePath)) throw new Error("无效的文件路径");
  const root = await resolveRepoRoot(workspace);
  if (!root) throw new Error("这个工作区不是 Git 仓库");
  let target = resolve(root, relativePath);
  if (!(await isPathInsideReal(target, root))) throw new Error("文件不在仓库内");
  while (target !== root && !(await access(target).then(() => true, () => false))) target = dirname(target);
  return target;
}
