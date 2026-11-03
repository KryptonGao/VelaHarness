import { readFile } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { configErrorCodes, HeadlessRequestError, maxHeadlessPromptLength, runHeadless, type HeadlessRunEvent, type HeadlessRunResult } from "@vela/runner";
import pkg from "../package.json" with { type: "json" };
import { helpText, parseCommand, UsageError, type RunOptions } from "./args";
import { LineWriter } from "./output";

export type CliSignal = "SIGINT" | "SIGTERM";

export interface CliIo {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** 注册退出信号监听；返回取消函数。 */
  onSignal(listener: (signal: CliSignal) => void): () => void;
  /** 第二次收到信号时立即结束进程，不再等待清理。 */
  forceExit(code: number): void;
}

export const exitCodes = { ok: 0, failed: 1, usage: 2, blocked: 3, timedOut: 124, sigint: 130, sigterm: 143 } as const;

const signalExit = (signal: CliSignal): number => signal === "SIGINT" ? exitCodes.sigint : exitCodes.sigterm;

/** 结果到退出码：0 正常，1 失败，2 参数 / 配置，3 需要人工，124 超时，130 / 143 信号。 */
export function exitCodeFor(result: HeadlessRunResult, signal: CliSignal | null): number {
  switch (result.status) {
    case "completed": return exitCodes.ok;
    case "blocked": return exitCodes.blocked;
    case "timed_out": return exitCodes.timedOut;
    case "cancelled": return signal ? signalExit(signal) : exitCodes.failed;
    case "failed": return result.error && configErrorCodes.includes(result.error.code) ? exitCodes.usage : exitCodes.failed;
  }
}

async function readStream(stream: Readable, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    // UTF-8 一个字符最多 4 字节；超过上限就不必继续读。
    if (size > limit * 4) throw new UsageError(`任务内容超过 ${limit} 个字符`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function loadPrompt(options: RunOptions, io: CliIo): Promise<string> {
  if (options.prompt !== null) return options.prompt;
  if (options.promptFile === "-") return readStream(io.stdin, maxHeadlessPromptLength);
  try { return await readFile(options.promptFile!, "utf8"); }
  catch (error) { throw new UsageError(`无法读取 --prompt-file：${error instanceof Error ? error.message : String(error)}`); }
}

const progressLimit = 140;
const clip = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > progressLimit ? `${line.slice(0, progressLimit)}…` : line;
};

/** text 模式下写到 stderr 的进度行；jsonl 模式不写进度。 */
function progressLine(event: HeadlessRunEvent): string | null {
  if (event.type === "run_started") return `vela-runner: 运行 ${event.runId}\nvela-runner: 数据目录 ${event.payload.runDir}`;
  if (event.type === "approval") return `vela-runner: 需要批准，已拒绝：${event.payload.kind} ${clip(event.payload.command ?? event.payload.path ?? "")}`;
  if (event.type === "question") return `vela-runner: 需要回答，已取消：${clip(event.payload.question)}`;
  if (event.type !== "runtime") return null;
  const inner = event.payload.event as { type?: string; toolName?: string; activity?: { command?: string; path?: string } } | null;
  if (inner?.type !== "tool_start") return null;
  const target = inner.activity?.command ?? inner.activity?.path ?? "";
  return `  · ${inner.toolName ?? "tool"}${target ? ` ${clip(target)}` : ""}`;
}

function summarize(result: HeadlessRunResult): string {
  const detail = result.error?.message ?? "";
  return `vela-runner: ${result.status}${result.error ? ` (${result.error.code})` : ""}${detail ? `：${detail}` : ""}\nvela-runner: 运行记录 ${result.runDir}`;
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const stderr = new LineWriter(io.stderr);
  const fail = async (message: string, code: number): Promise<number> => {
    await stderr.write(`vela-runner: ${message}\n`);
    await stderr.flush();
    return code;
  };

  let command;
  try { command = parseCommand(argv, { cwd: io.cwd, ...(io.env.INIT_CWD ? { initCwd: io.env.INIT_CWD } : {}) }); }
  catch (error) { return fail(error instanceof Error ? error.message : String(error), exitCodes.usage); }
  if (command.kind === "help" || command.kind === "version") {
    const out = new LineWriter(io.stdout);
    await out.write(command.kind === "help" ? helpText : `${pkg.version}\n`);
    await out.flush();
    return exitCodes.ok;
  }
  const options = command.options;

  let prompt: string;
  try { prompt = await loadPrompt(options, io); }
  catch (error) { return fail(error instanceof Error ? error.message : String(error), exitCodes.usage); }

  const controller = new AbortController();
  let receivedSignal: CliSignal | null = null;
  let outputBroken = false;
  const stdout = new LineWriter(io.stdout, () => { outputBroken = true; controller.abort(); });
  const stopListening = io.onSignal(signal => {
    if (receivedSignal) { io.forceExit(signalExit(receivedSignal)); return; }
    receivedSignal = signal;
    void stderr.write(`vela-runner: 收到 ${signal}，正在清理（再次发送将立即退出）\n`);
    controller.abort();
  });

  const sink = options.format === "jsonl"
    ? (event: HeadlessRunEvent) => stdout.write(`${JSON.stringify(event)}\n`)
    : (event: HeadlessRunEvent) => {
      const line = progressLine(event);
      return line ? stderr.write(`${line}\n`) : undefined;
    };

  let result: HeadlessRunResult;
  try {
    result = await runHeadless({
      cwd: options.cwd,
      prompt,
      dataDir: options.dataDir,
      configDir: options.configDir,
      mode: options.mode,
      sandboxMode: options.sandboxMode,
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.locale ? { locale: options.locale } : {}),
    }, { signal: controller.signal, onEvent: sink });
  } catch (error) {
    stopListening();
    if (error instanceof HeadlessRequestError) return fail(error.message, exitCodes.usage);
    return fail(`内部错误：${error instanceof Error ? error.message : String(error)}`, exitCodes.failed);
  }
  stopListening();

  if (result.status === "completed" && options.format === "text") {
    const body = options.mode === "plan" ? result.plan?.markdown ?? "" : result.finalText ?? "";
    if (body) await stdout.write(body.endsWith("\n") ? body : `${body}\n`);
  }
  if (result.status !== "completed") await stderr.write(`${summarize(result)}\n`);
  for (const warning of result.warnings) await stderr.write(`vela-runner: 警告：${warning}\n`);
  await stdout.flush();
  await stderr.flush();
  // 输出被关闭时任务已取消并清理；用失败码告诉调用方结果没有送达。
  if (outputBroken) return exitCodes.failed;
  return exitCodeFor(result, receivedSignal);
}
