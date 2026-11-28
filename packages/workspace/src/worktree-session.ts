import { randomBytes } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ConversationWorktree, WorktreeHandoffResult, WorktreeRemoveResult } from "@vela/shared";
import { gitMutate, gitQuery, runGit } from "./git-run";

export interface CreatedWorktree {
  /** 会话应当使用的工作目录:worktree 根,或仓库子目录在 worktree 里的对应位置。 */
  cwd: string;
  /** worktree 根目录。 */
  path: string;
  worktree: ConversationWorktree;
}

/**
 * 会话级 git worktree。每个会话在 `root` 下拥有自己的 detached worktree,
 * 从创建时的提交出发;之后会话的工具、终端都以它为 cwd。
 * 分支、提交与历史与原仓库共享,源码与未提交改动各自独立。
 */
export class WorktreeSessions {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  isManaged(path: string): boolean {
    const target = resolve(path);
    return target === this.root || target.startsWith(this.root + sep);
  }

  /** cwd 所在的受管 worktree 根目录(cwd 可能是 worktree 里的子目录);不在受管目录下返回 null。 */
  rootOf(cwd: string): string | null {
    const target = resolve(cwd);
    if (!target.startsWith(this.root + sep)) return null;
    const first = relative(this.root, target).split(sep)[0];
    return first ? join(this.root, first) : null;
  }

  /** 没有任何改动、HEAD 也没离开基线:删掉后能原样重建,不会丢东西。 */
  async isPristine(path: string, worktree: ConversationWorktree): Promise<boolean> {
    const changes = await this.changes(path, worktree);
    if (!changes) return false;
    const head = await headSha(path);
    return changes.files.length === 0 && head === worktree.baseSha;
  }

  /** 在原路径按基线重建一个已被清理的 worktree(取消归档时用)。已存在则什么都不做。 */
  async restore(path: string, worktree: ConversationWorktree): Promise<void> {
    if (!this.isManaged(path) || (await exists(path))) return;
    await mkdir(this.root, { recursive: true });
    const home = await managementRoot(worktree);
    await runGit(home, ["worktree", "prune"], 30_000).catch(() => undefined);
    await gitMutate(home, ["worktree", "add", "--detach", path, worktree.baseSha], 120_000);
  }

  /**
   * 为 `cwd` 所在的 checkout 创建一个 detached worktree,基线是该 checkout 当前的 HEAD。
   * cwd 可以是主检出,也可以是另一个 feature worktree:基线、交接目的地跟随它;
   * `git worktree` 命令则统一在仓库的主检出里执行。
   */
  async create(cwd: string): Promise<CreatedWorktree> {
    const source = await sourceCheckout(cwd);
    if (!source) throw new Error("这个工作区不是 Git 仓库，无法创建 worktree");
    const baseSha = await headSha(source);
    if (!baseSha) throw new Error("仓库还没有提交，无法创建 worktree");
    const managedFrom = (await mainCheckout(source)) ?? source;
    await mkdir(this.root, { recursive: true });
    let path = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      path = join(this.root, `${basename(source)}-${randomBytes(3).toString("hex")}`);
      if (!(await exists(path))) break;
      if (attempt === 7) throw new Error("无法为 worktree 生成唯一目录");
    }
    await gitMutate(managedFrom, ["worktree", "add", "--detach", path, baseSha], 120_000);
    const inner = relative(source, resolve(cwd));
    const inside = inner !== "" && !inner.startsWith("..") && !isAbsolute(inner);
    const target = inside ? join(path, inner) : path;
    return { cwd: (await exists(target)) ? target : path, path, worktree: { repository: source, managedFrom, baseSha, branch: null } };
  }

  /** worktree 里相对基线有哪些改动(含未跟踪文件与未归属分支的提交)。 */
  async changes(path: string, worktree: ConversationWorktree): Promise<{ files: string[]; unreachableCommits: number } | null> {
    if (!(await exists(path))) return null;
    try {
      const status = await gitQuery(path, ["status", "--porcelain"]);
      const files = status.split("\n").map((line) => line.slice(3).trim()).filter(Boolean);
      const head = await headSha(path);
      let unreachableCommits = 0;
      if (head && head !== worktree.baseSha) {
        const ahead = Number((await gitQuery(path, ["rev-list", "--count", `${worktree.baseSha}..HEAD`])).trim()) || 0;
        // for-each-ref 不会像 `git branch` 那样把 detached HEAD 自己列成一项。
        const branches = (await gitQuery(path, ["for-each-ref", "--contains", "HEAD", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"])).trim();
        unreachableCommits = branches ? 0 : ahead;
      }
      return { files, unreachableCommits };
    } catch {
      return null;
    }
  }

  /**
   * 把 worktree 相对基线的全部改动(含提交与未跟踪文件)应用到本地仓库的工作区,不提交。
   * 先 --check,本地同一文件已有冲突改动时不动任何文件并返回冲突清单。
   */
  async handoffToLocal(path: string, worktree: ConversationWorktree): Promise<WorktreeHandoffResult> {
    if (!(await exists(path))) return { ok: false, status: "error", message: "worktree 目录已不存在", files: 0, conflicts: [] };
    if (!(await exists(worktree.repository))) return { ok: false, status: "error", message: "原工作区目录已不存在", files: 0, conflicts: [] };
    // 在 worktree 自己的索引里暂存全部(含未跟踪),不影响本地仓库。
    await gitMutate(path, ["add", "-A"]);
    const diff = await runGit(path, ["diff", "--cached", "--binary", "--full-index", worktree.baseSha], 120_000);
    if (diff.code !== 0) return { ok: false, status: "error", message: firstLine(diff.stderr) ?? "生成改动失败", files: 0, conflicts: [] };
    if (!diff.stdout.trim()) return { ok: true, status: "empty", message: "", files: 0, conflicts: [] };
    const files = (await gitQuery(path, ["diff", "--cached", "--name-only", worktree.baseSha])).split("\n").filter(Boolean);

    for (const mode of [[], ["--3way"]] as const) {
      const check = await runGit(worktree.repository, ["apply", "--check", "--binary", ...mode], 120_000, diff.stdout);
      if (check.code !== 0) continue;
      const applied = await runGit(worktree.repository, ["apply", "--binary", ...mode], 120_000, diff.stdout);
      if (applied.code === 0) {
        return { ok: true, status: "applied", message: "", files: files.length, conflicts: [] };
      }
    }
    const check = await runGit(worktree.repository, ["apply", "--check", "--binary"], 120_000, diff.stdout);
    const conflicts = conflictFiles(check.stderr, files);
    return {
      ok: false,
      status: conflicts.length > 0 ? "conflict" : "error",
      message: conflicts.length > 0 ? "" : firstLine(check.stderr) ?? "交接失败",
      files: files.length,
      conflicts,
    };
  }

  /** 删除 worktree 目录。还有未交接的改动或未归属分支的提交时拒绝,除非 force。 */
  async remove(path: string, worktree: ConversationWorktree, force = false): Promise<WorktreeRemoveResult> {
    if (!this.isManaged(path)) return { ok: false, message: "不是 Vela 管理的 worktree", changeCount: null };
    if (!(await exists(path))) {
      await runGit(await managementRoot(worktree), ["worktree", "prune"], 30_000).catch(() => undefined);
      return { ok: true, message: "worktree 已不存在", changeCount: 0 };
    }
    const changes = await this.changes(path, worktree);
    const count = changes ? changes.files.length + changes.unreachableCommits : null;
    if (!force && count !== null && count > 0) {
      return { ok: false, message: `还有 ${count} 处改动没有交接,删除会丢失它们`, changeCount: count };
    }
    const result = await runGit(await managementRoot(worktree), ["worktree", "remove", ...(force ? ["--force"] : []), path], 60_000);
    if (result.code !== 0) {
      return { ok: false, message: firstLine(result.stderr) ?? "删除 worktree 失败", changeCount: count };
    }
    return { ok: true, message: "已删除 worktree", changeCount: count ?? 0 };
  }
}

/** cwd 所在 checkout 的根目录(主检出或任意 linked worktree);裸仓库或非仓库返回 null。 */
async function sourceCheckout(cwd: string): Promise<string | null> {
  try {
    return (await gitQuery(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
  }
}

/** 仓库的主检出:`git worktree list` 的第一项。--git-common-dir 的上一级不可靠(裸仓库、自定义 gitdir)。 */
async function mainCheckout(cwd: string): Promise<string | null> {
  try {
    const list = await gitQuery(cwd, ["worktree", "list", "--porcelain"]);
    const line = list.split("\n").find((entry) => entry.startsWith("worktree "));
    return line ? line.slice("worktree ".length).trim() || null : null;
  } catch {
    return null;
  }
}

/** 执行 worktree add/remove/prune 的目录:优先记录的主检出,它不在了就用源 checkout。 */
async function managementRoot(worktree: ConversationWorktree): Promise<string> {
  for (const candidate of [worktree.managedFrom, worktree.repository]) {
    if (candidate && (await exists(candidate))) return candidate;
  }
  return worktree.managedFrom ?? worktree.repository;
}

async function headSha(cwd: string): Promise<string | null> {
  try {
    return (await gitQuery(cwd, ["rev-parse", "--verify", "HEAD"])).trim() || null;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function conflictFiles(stderr: string, candidates: readonly string[]): string[] {
  const found = new Set<string>();
  for (const line of stderr.split("\n")) {
    const match = /^error: (?:patch failed: )?(.+?)(?::\d+)?(?:: (?:patch does not apply|already exists in working directory|does not match index|does not exist in index))?$/.exec(line.trim());
    const file = match?.[1];
    if (file && candidates.includes(file)) found.add(file);
  }
  return [...found];
}

function firstLine(text: string): string | null {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
}
