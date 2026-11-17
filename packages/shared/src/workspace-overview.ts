import type { GitFileStatus } from "./index";

/** 工作区总览里列出的变更文件数上限;其余只计入总数。 */
export const workspaceOverviewTopFiles = 3;
/** 总览里列出的最近提交数。 */
export const workspaceOverviewCommitLimit = 3;
/** 总览里列出的 worktree 数上限。 */
export const workspaceOverviewWorktreeLimit = 5;

export interface WorkspaceOverviewFile {
  /** 相对仓库根目录的路径。 */
  path: string;
  status: GitFileStatus;
  addedLines: number;
  deletedLines: number;
}

export interface WorkspaceOverviewCommit {
  sha: string;
  shortSha: string;
  subject: string;
  /** 提交时间(毫秒)。 */
  at: number;
}

export interface WorkspaceOverviewWorktree {
  path: string;
  branch: string | null;
  /** 未提交改动的文件数;目录缺失时为 null。 */
  changeCount: number | null;
  /** 位于 Vela 受管 worktree 根目录下(赛马、会话 worktree)。 */
  managed: boolean;
}

/** 工作区的 Git 概况:只读、按路径查询,不依赖「当前工作区」。 */
export interface WorkspaceOverviewGit {
  repoRoot: string;
  repoName: string;
  /** 工作区在仓库里的子目录;工作区即仓库根时为 null。 */
  subdir: string | null;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** 进行中的 merge/rebase 等;没有时为 null。 */
  operation: string | null;
  fileCount: number;
  addedLines: number;
  deletedLines: number;
  /** 各状态的文件数。 */
  counts: Record<GitFileStatus, number>;
  /** 改动行数最多的文件,最多 workspaceOverviewTopFiles 个。 */
  topFiles: WorkspaceOverviewFile[];
  commits: WorkspaceOverviewCommit[];
  /** 除工作区自身之外的 worktree。 */
  worktrees: WorkspaceOverviewWorktree[];
  worktreeCount: number;
}

export interface WorkspaceOverviewSnapshot {
  workspace: string;
  /** 不是 Git 仓库时为 null。 */
  git: WorkspaceOverviewGit | null;
  generatedAt: number;
}

export interface WorkspaceOverviewApi {
  /** 读取一个已登记工作区的概况;路径未登记时抛错。 */
  get(workspace: string): Promise<WorkspaceOverviewSnapshot>;
  /** 在 Finder 中显示这个工作区仓库里的一个文件(路径相对仓库根);文件已被删除时显示最近的上级目录。 */
  reveal(workspace: string, path: string): Promise<void>;
}

export const WorkspaceOverviewIpc = {
  get: "workspace-overview:get",
  reveal: "workspace-overview:reveal",
} as const;

export const emptyGitStatusCounts = (): Record<GitFileStatus, number> => ({
  modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0,
});
