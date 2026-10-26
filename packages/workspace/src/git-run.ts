import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout 超过 maxOutputBytes 被截断(子进程已被结束,code 不可信)。 */
  truncated: boolean;
}

export interface GitRunOptions {
  /** 写入子进程 stdin 并关闭(如 commit --file -、git apply -)。 */
  input?: string;
  /** 追加/覆盖的环境变量,用于 GIT_EDITOR 等非交互场景。 */
  env?: Record<string, string>;
  /** stdout 的字节上限;超出后结束子进程并返回已读取的部分。 */
  maxOutputBytes?: number;
}

/** 默认 stdout 上限:防止任何一条命令把巨量输出整体读进主进程。 */
export const defaultGitMaxOutputBytes = 64 * 1024 * 1024;
const maxStderrBytes = 1024 * 1024;
// 独立进程组,超时或截断时能连同 git-remote-https、ssh 等孙进程一起结束。
const useProcessGroup = process.platform !== "win32";

/**
 * 运行 git 命令。只读命令统一加 --no-optional-locks,避免 status 触发
 * .git/index 写入后又被文件监听捕获造成刷新循环。
 * 传入一个字符串 input 时写入子进程 stdin 并关闭(如 commit --file -)。
 */
export async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = 15_000,
  inputOrOptions?: string | GitRunOptions,
): Promise<GitRunResult> {
  const options: GitRunOptions =
    typeof inputOrOptions === "string" ? { input: inputOrOptions } : inputOrOptions ?? {};
  const maxOutputBytes = options.maxOutputBytes ?? defaultGitMaxOutputBytes;
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      detached: useProcessGroup,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...options.env },
    });
    const stdout = new ByteCollector(maxOutputBytes);
    const stderr = new ByteCollector(maxStderrBytes);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      reject(new Error("git 命令超时"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (!stdout.push(chunk)) killProcessTree(child);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    // 命令提前退出时 stdin 可能已关闭,忽略 EPIPE 即可。
    child.stdin.on("error", () => undefined);
    if (options.input !== undefined) {
      try {
        child.stdin.write(options.input);
      } catch {
        // ignore
      }
    }
    try {
      child.stdin.end();
    } catch {
      // ignore
    }

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("git 命令启动失败"));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated,
      });
    });
  });
}

/** 按字节累积输出;超过上限只保留前缀,并保证不切断 UTF-8 字符。 */
class ByteCollector {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  /** 返回 false 表示已达上限。 */
  push(chunk: Buffer): boolean {
    if (this.truncated) return false;
    const room = this.limit - this.size;
    if (chunk.length <= room) {
      this.chunks.push(chunk);
      this.size += chunk.length;
      return true;
    }
    this.chunks.push(chunk.subarray(0, utf8Boundary(chunk, room)));
    this.truncated = true;
    return false;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/** 不超过 end 的最大 UTF-8 字符边界(只看末尾是否落在续字节上)。 */
function utf8Boundary(buffer: Buffer, end: number): number {
  let index = Math.max(0, Math.min(end, buffer.length));
  while (index > 0 && index < buffer.length && (buffer[index]! & 0xc0) === 0x80) index--;
  return index;
}

function killProcessTree(child: ChildProcess): void {
  if (useProcessGroup && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // 进程组已退出,退回到只结束子进程。
    }
  }
  child.kill("SIGKILL");
}

/** 运行只读 git 查询命令,非零退出抛错(带 stderr)。 */
export async function gitQuery(cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const result = await runGit(cwd, ["--no-optional-locks", ...args], timeoutMs);
  if (result.truncated) throw new Error("git 输出过大");
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} 失败`);
  }
  return result.stdout;
}

/**
 * 运行可能产生巨量输出的只读查询(diff、show):超过 maxOutputBytes 时提前结束
 * 子进程并返回截断到最后一个完整行的前缀,而不是先全部读进内存再截断。
 */
export async function gitQueryCapped(
  cwd: string,
  args: string[],
  maxOutputBytes: number,
  timeoutMs?: number,
): Promise<{ stdout: string; truncated: boolean }> {
  const result = await runGit(cwd, ["--no-optional-locks", ...args], timeoutMs, { maxOutputBytes });
  if (result.truncated) return { stdout: completeLines(result.stdout), truncated: true };
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} 失败`);
  }
  return { stdout: result.stdout, truncated: false };
}

/** 截断后的输出只保留到最后一个完整行,避免 Diff 末尾出现半行。 */
export function completeLines(text: string): string {
  const lastNewline = text.lastIndexOf("\n");
  return lastNewline >= 0 ? text.slice(0, lastNewline + 1) : "";
}

/** 运行会改变仓库状态的 git 命令(不加 --no-optional-locks),非零退出抛错。 */
export async function gitMutate(
  cwd: string,
  args: string[],
  timeoutMs?: number,
  options?: GitRunOptions,
): Promise<string> {
  const result = await runGit(cwd, args, timeoutMs, options);
  if (result.truncated) throw new Error("git 输出过大");
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} 失败`);
  }
  return result.stdout;
}

/** 校验分支/引用名,阻断参数注入(拒绝 "-" 开头、空白、控制字符),并用 git 自身的规则兜底。 */
export async function assertValidRefName(cwd: string, name: string): Promise<void> {
  if (!name || name.startsWith("-") || /\s/.test(name) || name.length > 200) {
    throw new Error("分支名不正确");
  }
  const result = await runGit(cwd, ["check-ref-format", "--branch", name]);
  if (result.code !== 0) {
    throw new Error("分支名不正确");
  }
}

/** 校验任何会作为 git 参数的短名称(远程名、标签名等)。 */
export function assertSafeName(value: string, label: string): string {
  if (!value || value.startsWith("-") || /[\s\0]/.test(value) || value.length > 200) {
    throw new Error(`${label}不正确`);
  }
  return value;
}

/** 校验仓库相对路径:拒绝绝对路径、上跳、选项前缀与 NUL。 */
export function assertRepoRelativePath(path: string): string {
  if (!path || path.startsWith("-") || isAbsolute(path) || path.includes("\0")) {
    throw new Error("路径不正确");
  }
  const segments = path.split(/[\\/]/);
  if (segments.some((segment) => segment === "..")) {
    throw new Error("路径不正确");
  }
  return path;
}

/** 校验可作为 git 参数的修订版本(分支、SHA、tag)。 */
export function assertSafeRevision(value: string): string {
  if (!value || value.startsWith("-") || /\s/.test(value) || value.includes("\0") || value.length > 300) {
    throw new Error("修订版本不正确");
  }
  return value;
}

/** 远程 URL 校验:拒绝选项前缀、空白、控制字符与超长内容。 */
export function assertRemoteUrl(value: string): string {
  const url = value.trim();
  if (!url || url.startsWith("-") || url.length > 2000 || /[\s\0]/.test(url)) {
    throw new Error("远程地址不正确");
  }
  return url;
}

/** 解析当前仓库的 .git 目录(worktree 下为 worktree 专属 git 目录)。 */
export async function gitDir(cwd: string): Promise<string> {
  const stdout = await gitQuery(cwd, ["rev-parse", "--absolute-git-dir"]);
  return stdout.trim();
}
