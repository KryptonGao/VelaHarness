import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import type { BackgroundShellEvents, BackgroundShellExit, BackgroundShellStatus } from "@vela/shared";
import { StringDecoder } from "node:string_decoder";

/** 每个后台命令在内存里保留的输出上限；超出后丢弃最早的部分。 */
const retainedChars = 1_000_000;
/** 一次读取最多返回的字符数；超出只给末尾。 */
export const backgroundReadLimitChars = 30_000;
const maxRunningPerConversation = 8;
const maxFinishedPerConversation = 20;
const killGraceMs = 3_000;

export interface BackgroundShellInfo {
  id: string;
  conversationId: string;
  command: string;
  cwd: string;
  status: BackgroundShellStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface BackgroundShellRead {
  info: BackgroundShellInfo;
  /** 自上次读取以来的新输出。 */
  output: string;
  truncated: boolean;
}

export interface BackgroundShellStartInput {
  conversationId: string;
  command: string;
  cwd: string;
  /** 秒；到点会终止命令，状态为 timed_out。 */
  timeout?: number;
}

interface Shell extends BackgroundShellInfo {
  controller: AbortController;
  decoder: StringDecoder;
  /** buffer 保存的是绝对偏移 bufferStart 之后的输出。 */
  buffer: string;
  bufferStart: number;
  readOffset: number;
  /** 主动终止或会话关闭：结束时不需要唤醒主代理。 */
  silent: boolean;
  /** 主代理已经通过 bash_output 拿到了结束状态，不必再通知。 */
  exitObserved: boolean;
  changed: Set<() => void>;
  done: Promise<void>;
}

/**
 * 后台命令：让主代理在命令继续运行时往下走。
 * 一个命令属于一个会话；输出留在内存里按游标增量读取；
 * 结束时通过 subscribe 通知宿主，由宿主决定是否唤醒主代理。
 */
export class BackgroundShellManager implements BackgroundShellEvents {
  private readonly shells = new Map<string, Shell>();
  private readonly listeners = new Set<(event: BackgroundShellExit) => void>();
  private counter = 0;

  subscribe(listener: (event: BackgroundShellExit) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(input: BackgroundShellStartInput): BackgroundShellInfo {
    const running = this.forConversation(input.conversationId).filter((shell) => shell.status === "running").length;
    if (running >= maxRunningPerConversation) {
      throw new Error(`同时运行的后台命令已达上限(${maxRunningPerConversation})，先用 bash_kill 结束不再需要的命令`);
    }
    this.pruneFinished(input.conversationId);
    const controller = new AbortController();
    const shell: Shell = {
      id: `bg-${++this.counter}`,
      conversationId: input.conversationId,
      command: input.command,
      cwd: input.cwd,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      controller,
      decoder: new StringDecoder("utf8"),
      buffer: "",
      bufferStart: 0,
      readOffset: 0,
      silent: false,
      exitObserved: false,
      changed: new Set(),
      done: Promise.resolve(),
    };
    this.shells.set(shell.id, shell);
    shell.done = this.run(shell, input.timeout);
    return snapshot(shell);
  }

  list(conversationId: string): BackgroundShellInfo[] {
    return this.forConversation(conversationId).map(snapshot);
  }

  /**
   * 读取自上次以来的新输出。wait(秒)大于 0 时，命令仍在运行就等它结束或超时再读；
   * signal 取消只是不再等待，命令本身继续运行。
   */
  async read(conversationId: string, id: string, options: { wait?: number; signal?: AbortSignal } = {}): Promise<BackgroundShellRead> {
    const shell = this.require(conversationId, id);
    const wait = Math.min(Math.max(options.wait ?? 0, 0), 600);
    if (wait > 0 && shell.status === "running") await waitForEnd(shell, wait * 1000, options.signal);
    const result = this.take(shell);
    if (shell.status !== "running") shell.exitObserved = true;
    return result;
  }

  /** 终止命令及其子进程；已结束的命令返回 false。 */
  async kill(conversationId: string, id: string): Promise<boolean> {
    const shell = this.require(conversationId, id);
    if (shell.status !== "running") return false;
    shell.silent = true;
    shell.controller.abort();
    await Promise.race([shell.done, new Promise<void>((resolve) => setTimeout(resolve, killGraceMs))]);
    return true;
  }

  /** 会话关闭：终止全部运行中的命令，且不再唤醒任何人。 */
  killConversation(conversationId: string): void {
    for (const shell of this.forConversation(conversationId)) {
      if (shell.status !== "running") continue;
      shell.silent = true;
      shell.controller.abort();
    }
  }

  dispose(): void {
    for (const shell of this.shells.values()) {
      if (shell.status !== "running") continue;
      shell.silent = true;
      shell.controller.abort();
    }
    this.listeners.clear();
  }

  private forConversation(conversationId: string): Shell[] {
    return [...this.shells.values()].filter((shell) => shell.conversationId === conversationId);
  }

  private require(conversationId: string, id: string): Shell {
    const shell = this.shells.get(id);
    if (!shell || shell.conversationId !== conversationId) throw new Error(`没有这个后台命令：${id}`);
    return shell;
  }

  private pruneFinished(conversationId: string): void {
    const finished = this.forConversation(conversationId).filter((shell) => shell.status !== "running");
    for (const shell of finished.slice(0, Math.max(0, finished.length - maxFinishedPerConversation + 1))) this.shells.delete(shell.id);
  }

  private async run(shell: Shell, timeout: number | undefined): Promise<void> {
    let status: Exclude<BackgroundShellStatus, "running"> = "exited";
    let exitCode: number | null = null;
    try {
      const result = await createLocalBashOperations().exec(shell.command, shell.cwd, {
        onData: (chunk) => this.append(shell, shell.decoder.write(chunk)),
        signal: shell.controller.signal,
        ...(timeout ? { timeout } : {}),
      });
      exitCode = result.exitCode;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "aborted") status = "killed";
      else if (message.startsWith("timeout:")) status = "timed_out";
      else {
        status = "failed";
        this.append(shell, `${shell.buffer && !shell.buffer.endsWith("\n") ? "\n" : ""}${message}\n`);
      }
    }
    this.append(shell, shell.decoder.end());
    shell.status = status;
    shell.exitCode = exitCode;
    shell.endedAt = Date.now();
    for (const wake of [...shell.changed]) wake();
    // 让正在 wait 的 bash_output 先读走结果；它读到了结束状态就不再重复通知。
    await new Promise<void>((resolve) => setImmediate(resolve));
    const notify = !shell.silent && !shell.exitObserved;
    const read = notify ? this.take(shell) : { output: "", truncated: false };
    const event: BackgroundShellExit = {
      conversationId: shell.conversationId,
      id: shell.id,
      command: shell.command,
      status,
      exitCode,
      durationMs: shell.endedAt - shell.startedAt,
      output: read.output,
      truncated: read.truncated,
      notify,
    };
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { /* 监听者出错不能影响其他监听者。 */ }
    }
  }

  private append(shell: Shell, text: string): void {
    if (!text) return;
    shell.buffer += text;
    // 超出上限一半以上才裁剪，避免每个数据块都复制整段字符串。
    if (shell.buffer.length > retainedChars * 1.5) {
      const drop = shell.buffer.length - retainedChars;
      shell.buffer = shell.buffer.slice(drop);
      shell.bufferStart += drop;
    }
  }

  private take(shell: Shell): BackgroundShellRead {
    let truncated = false;
    if (shell.readOffset < shell.bufferStart) {
      shell.readOffset = shell.bufferStart;
      truncated = true;
    }
    let output = shell.buffer.slice(shell.readOffset - shell.bufferStart);
    shell.readOffset = shell.bufferStart + shell.buffer.length;
    if (output.length > backgroundReadLimitChars) {
      output = output.slice(output.length - backgroundReadLimitChars);
      truncated = true;
    }
    return { info: snapshot(shell), output, truncated };
  }
}

function snapshot(shell: Shell): BackgroundShellInfo {
  const { id, conversationId, command, cwd, status, exitCode, startedAt, endedAt } = shell;
  return { id, conversationId, command, cwd, status, exitCode, startedAt, endedAt };
}

/** 等命令结束、超时或 signal 取消，三者先到为准。 */
function waitForEnd(shell: Shell, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      shell.changed.delete(finish);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    shell.changed.add(finish);
    if (signal?.aborted) finish();
    else signal?.addEventListener("abort", finish, { once: true });
  });
}
