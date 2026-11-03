import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RunConversationError, systemPromptProfileFrom, type RunReport, type RuntimeEvent } from "@vela/agent";
import { isAppLocale, redactSensitive, thinkingLevels, type SandboxApprovalRequest, type SandboxMode } from "@vela/shared";
import { SandboxPermissionManager } from "@vela/workspace";
import { environmentSecrets, runtimeEventView } from "./event-view";
import { createRunDirectory, RunRecordStore } from "./run-record";
import { createRuntimeHost, type RuntimeHost } from "./runtime-host";
import {
  defaultHeadlessTimeoutMs,
  headlessCleanupTimeoutMs,
  headlessProtocolVersion,
  HeadlessRequestError,
  maxHeadlessPromptLength,
  type HeadlessErrorCode,
  type HeadlessEventSink,
  type HeadlessRunError,
  type HeadlessRunEvent,
  type HeadlessRunMode,
  type HeadlessRunOptions,
  type HeadlessRunRequest,
  type HeadlessRunResult,
} from "./types";

interface NormalizedRequest {
  cwd: string;
  prompt: string;
  dataDir: string;
  configDir: string;
  model: { provider: string; id: string } | undefined;
  thinkingLevel: HeadlessRunRequest["thinkingLevel"];
  mode: HeadlessRunMode;
  sandboxMode: SandboxMode;
  timeoutMs: number;
  locale: NonNullable<HeadlessRunRequest["locale"]>;
}

const maxTimerMs = 2 ** 31 - 1;

async function normalizeRequest(request: HeadlessRunRequest): Promise<NormalizedRequest> {
  const invalid = (message: string): never => { throw new HeadlessRequestError("invalid_request", message); };
  if (typeof request.prompt !== "string" || request.prompt.trim().length === 0) invalid("任务内容不能为空");
  if (request.prompt.length > maxHeadlessPromptLength) invalid(`任务内容超过 ${maxHeadlessPromptLength} 个字符`);
  for (const [name, value] of [["cwd", request.cwd], ["dataDir", request.dataDir], ["configDir", request.configDir]] as const) {
    if (typeof value !== "string" || value.trim().length === 0) invalid(`${name} 不能为空`);
  }
  const cwd = resolve(request.cwd);
  try {
    if (!(await stat(cwd)).isDirectory()) invalid(`工作目录不是文件夹：${cwd}`);
  } catch (error) {
    if (error instanceof HeadlessRequestError) throw error;
    invalid(`工作目录不存在：${cwd}`);
  }
  if (request.model && (!request.model.provider?.trim() || !request.model.id?.trim())) invalid("模型需要同时提供 provider 与 id");
  if (request.thinkingLevel !== undefined && !(thinkingLevels as readonly string[]).includes(request.thinkingLevel)) invalid(`不支持的思考强度：${String(request.thinkingLevel)}`);
  const mode = request.mode ?? "agent";
  if (mode !== "agent" && mode !== "plan") invalid(`不支持的模式：${String(mode)}`);
  const sandboxMode = request.sandboxMode ?? "ask";
  if (sandboxMode !== "ask" && sandboxMode !== "smart" && sandboxMode !== "full") invalid(`不支持的沙箱模式：${String(sandboxMode)}`);
  const timeoutMs = request.timeoutMs ?? defaultHeadlessTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > maxTimerMs) invalid("超时时间必须是正数且不超过 2147483647 毫秒");
  if (request.locale !== undefined && !isAppLocale(request.locale)) invalid(`不支持的语言：${String(request.locale)}`);
  return {
    cwd,
    prompt: request.prompt,
    dataDir: resolve(request.dataDir),
    configDir: resolve(request.configDir),
    model: request.model ? { provider: request.model.provider.trim(), id: request.model.id.trim() } : undefined,
    thinkingLevel: request.thinkingLevel,
    mode,
    sandboxMode,
    timeoutMs,
    locale: request.locale ?? "en",
  };
}

interface Termination {
  status: "failed" | "blocked" | "cancelled" | "timed_out";
  error: HeadlessRunError;
  blocked?: NonNullable<HeadlessRunResult["blocked"]>;
}

/** 一次性终态仲裁：先到先得，之后的终止请求和重复完成都被忽略。 */
class Arbiter {
  private first: Termination | null = null;
  private locked = false;
  private readonly controller = new AbortController();
  readonly promise: Promise<Termination>;
  private resolveTermination!: (value: Termination) => void;

  constructor() {
    this.promise = new Promise(resolve => { this.resolveTermination = resolve; });
  }

  get signal(): AbortSignal { return this.controller.signal; }
  get termination(): Termination | null { return this.first; }

  terminate(termination: Termination): boolean {
    if (this.first || this.locked) return false;
    this.first = termination;
    this.controller.abort();
    this.resolveTermination(termination);
    return true;
  }

  /** 进入收尾：此后不再接受终止请求。返回锁定前已经发生的终止（如果有）。 */
  lock(): Termination | null {
    this.locked = true;
    return this.first;
  }
}

/** 事件按序投递；sink 返回 Promise 时等待它（背压），排队期间相邻的文本增量合并。 */
class EventPipe {
  private readonly queue: { type: HeadlessRunEvent["type"]; payload: unknown; timestamp: string }[] = [];
  private pumping: Promise<void> | null = null;
  private sequence = 0;
  private sinkFailed = false;

  constructor(private readonly runId: string, private readonly sink: HeadlessEventSink | undefined) {}

  push<T extends HeadlessRunEvent["type"]>(type: T, payload: Extract<HeadlessRunEvent, { type: T }>["payload"]): void {
    if (!this.sink || this.sinkFailed) return;
    const last = this.queue.at(-1);
    const next = payload as { event?: { type?: string; conversationId?: string; delta?: string } };
    const prev = last?.payload as typeof next | undefined;
    if (last && type === "runtime" && last.type === "runtime" && next.event?.type === "text_delta" && prev?.event?.type === "text_delta"
      && prev.event.conversationId === next.event.conversationId) {
      prev.event.delta = `${prev.event.delta ?? ""}${next.event.delta ?? ""}`;
      return;
    }
    this.queue.push({ type, payload, timestamp: new Date().toISOString() });
    this.pumping ??= this.pump();
  }

  private async pump(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const event = { version: headlessProtocolVersion, runId: this.runId, sequence: ++this.sequence, timestamp: item.timestamp, type: item.type, payload: item.payload } as HeadlessRunEvent;
      try { await this.sink?.(event); }
      catch { this.sinkFailed = true; this.queue.length = 0; }
    }
    this.pumping = null;
  }

  async flush(): Promise<void> {
    while (this.pumping) await this.pumping;
  }
}

async function bounded<T>(work: Promise<T>, onTimeout: () => void, ms = headlessCleanupTimeoutMs): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>(resolve => { timer = setTimeout(() => { onTimeout(); resolve(undefined); }, ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function describeApproval(request: SandboxApprovalRequest): string {
  const target = request.command ?? request.path ?? request.mcp?.tool ?? "";
  return `${request.kind}${target ? `：${target.length > 200 ? `${target.slice(0, 200)}…` : target}` : ""}`;
}

type Outcome = { status: "completed" } | Termination;

function failed(code: HeadlessErrorCode, message: string): Termination {
  return { status: "failed", error: { code, message } };
}

function mapWorkError(error: unknown, phase: "init" | "run"): Termination {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RunConversationError) return failed(error.code, message);
  return failed(phase === "init" ? "config_error" : "runtime_error", message);
}

function evaluate(mode: HeadlessRunMode, report: RunReport | null, runtimeError: string | null, budgetExhausted: boolean): Outcome {
  if (runtimeError) return failed("runtime_error", runtimeError);
  if (report?.budgetExhausted || budgetExhausted) return failed("budget_exhausted", "任务用量已到上限，执行被中止");
  if (report && report.subagentFailures.length > 0) {
    const summary = report.subagentFailures.map(item => `${item.path}${item.error ? `（${item.error}）` : ""}`).join("；");
    return failed("subagent_failed", `有子代理失败且未被处理：${summary}`);
  }
  if (mode === "plan" && !report?.plan) return failed("plan_missing", "Plan 模式结束时没有生成有效的 Proposed Plan");
  return { status: "completed" };
}

function requestMeta(input: NormalizedRequest): Record<string, unknown> {
  return {
    cwd: input.cwd,
    mode: input.mode,
    sandboxMode: input.sandboxMode,
    model: input.model ?? null,
    thinkingLevel: input.thinkingLevel ?? null,
    timeoutMs: input.timeoutMs,
    locale: input.locale,
    dataDir: input.dataDir,
    configDir: input.configDir,
    promptLength: input.prompt.length,
    promptSha256: createHash("sha256").update(input.prompt).digest("hex"),
  };
}

/**
 * 无界面的单次任务：每次调用创建独立 Runtime 与运行目录，并在结束时释放。
 * 不同调用可以并行，但不共写运行目录。请求本身无效时抛出 HeadlessRequestError（尚未开始运行）；
 * 其余情形都以 HeadlessRunResult 返回，且恰好发出一条 run_result 事件。
 */
export async function runHeadless(request: HeadlessRunRequest, options: HeadlessRunOptions = {}): Promise<HeadlessRunResult> {
  const input = await normalizeRequest(request);
  const runId = randomUUID();
  const dirs = await createRunDirectory(input.dataDir, runId, input.configDir);
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const pipe = new EventPipe(runId, options.onEvent);
  const warnings: string[] = [];
  const secrets = environmentSecrets();
  const store = new RunRecordStore(dirs.runDir, { runId, status: "starting", createdAt: startedAt, request: requestMeta(input) }, secrets);
  try { await store.update({}); }
  catch (error) { throw new HeadlessRequestError("config_error", `无法写入运行记录：${error instanceof Error ? error.message : String(error)}`); }
  pipe.push("run_started", { runDir: dirs.runDir, cwd: input.cwd, mode: input.mode, sandboxMode: input.sandboxMode, model: input.model ?? null, thinkingLevel: input.thinkingLevel ?? null });

  const arbiter = new Arbiter();
  let host: RuntimeHost | null = null;
  let conversationId: string | null = null;
  let actualModel: HeadlessRunResult["model"] = null;
  let actualThinking: HeadlessRunResult["thinkingLevel"] = null;
  let runtimeError: string | null = null;
  let budgetExhausted = false;
  let phase: "init" | "run" = "init";
  const unsubscribers: (() => void)[] = [];
  /** 同步记下终止原因，再异步拒绝并中断，避免在事件回调里重入 Runtime。 */
  const deferred = (action: () => void): void => { setImmediate(() => { try { action(); } catch { /* 清理阶段会兜底 */ } }); };
  const abortConversation = (): Promise<void> => conversationId && host ? host.runtime.abort(conversationId).catch(() => undefined) : Promise.resolve();

  const timer = setTimeout(() => arbiter.terminate({
    status: "timed_out",
    error: { code: "timed_out", message: `任务超过 ${Math.round(input.timeoutMs / 1000)} 秒仍未结束` },
  }), input.timeoutMs);
  const onCallerAbort = (): void => { arbiter.terminate({ status: "cancelled", error: { code: "cancelled", message: "任务已被取消" } }); };
  if (options.signal?.aborted) onCallerAbort();
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const work = async (): Promise<void> => {
    const sandbox = new SandboxPermissionManager(join(dirs.runDir, "sandbox.json"));
    host = createRuntimeHost({
      cwd: input.cwd,
      agentDir: dirs.agentDir,
      modelDirectory: { configDir: input.configDir, cacheDir: dirs.cacheDir, readOnlyConfig: true, refreshCatalogOnStart: false },
      hostProfile: "headless",
      locale: () => input.locale,
      systemPromptProfile: systemPromptProfileFrom(process.env.VELA_SYSTEM_PROMPT),
      isWorkspaceCwd: () => true,
      sandbox,
      onCleanupIssue: message => warnings.push(message),
    });
    const { runtime } = host;

    // 无人值守：任何需要人批准的请求都立即拒绝并中止，不会自动批准。
    unsubscribers.push(sandbox.subscribe(event => {
      if (event.type !== "request") return;
      const request = event.request;
      const detail = describeApproval(request);
      arbiter.terminate({
        status: "blocked",
        error: { code: "approval_required", message: `需要人工批准：${detail}` },
        blocked: { kind: "approval", detail },
      });
      pipe.push("approval", { requestId: request.id, kind: request.kind, command: request.command, path: request.path, cwd: request.cwd, outcome: "denied" });
      deferred(() => { sandbox.reply(request.id, false); void abortConversation(); });
    }));
    unsubscribers.push(runtime.subscribeQuestions(event => {
      if (event.type !== "request") return;
      const request = event.request;
      arbiter.terminate({
        status: "blocked",
        error: { code: "question_required", message: `需要人工回答：${request.question}` },
        blocked: { kind: "question", detail: request.question },
      });
      pipe.push("question", { requestId: request.id, question: request.question, outcome: "cancelled" });
      deferred(() => { runtime.replyQuestion(request.id, null); void abortConversation(); });
    }));
    unsubscribers.push(runtime.subscribe((event: RuntimeEvent) => {
      if (!conversationId || event.conversationId !== conversationId) return;
      if (event.type === "error" && runtimeError === null && !arbiter.termination) runtimeError = event.message;
      if (event.type === "task_budget" && event.phase === "exhausted") budgetExhausted = true;
      const view = runtimeEventView(event, secrets);
      if (view !== null) pipe.push("runtime", { event: view });
    }));

    const info = await runtime.createRunConversation({
      cwd: input.cwd,
      mode: input.mode,
      sandboxMode: input.sandboxMode,
      ...(input.model ? { model: input.model } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    });
    conversationId = info.conversationId;
    actualModel = info.model;
    actualThinking = info.thinkingLevel;
    phase = "run";
    await store.update({ status: "running", conversationId });
    if (arbiter.termination) return;
    await runtime.prompt(conversationId, input.prompt);
    if (arbiter.termination) return;
    // prompt() 返回不等于任务结束：子代理、后台命令和合并通知还可能再唤醒主代理。
    await runtime.waitForIdle(conversationId, { signal: arbiter.signal, includeBackgroundShells: true });
  };

  let outcome: Outcome;
  let report: RunReport | null = null;
  try {
    const settled = await Promise.race([
      work().then(() => ({ kind: "done" as const }), (error: unknown) => ({ kind: "error" as const, error })),
      arbiter.promise.then(() => ({ kind: "terminated" as const })),
    ]);
    const earlier = arbiter.lock();
    if (earlier) outcome = earlier;
    else if (settled.kind === "error") outcome = mapWorkError(settled.error, phase);
    else outcome = { status: "completed" };

    const liveHost = host as RuntimeHost | null;
    if (liveHost && conversationId) {
      // 终止场景先停下 Runtime，再取已有的结果；失败的取数不影响终态。
      if (outcome.status !== "completed") await bounded(abortConversation(), () => warnings.push("中断会话超时"));
      try { report = liveHost.runtime.getRunReport(conversationId); } catch { report = null; }
    }
    if (outcome.status === "completed") outcome = evaluate(input.mode, report, runtimeError, budgetExhausted);

    // 释放前严格落盘：写盘失败不能再报告成功。
    if (liveHost) {
      try { await liveHost.runtime.persistStrict(); }
      catch (error) {
        const message = `无法保存会话数据：${error instanceof Error ? error.message : String(error)}`;
        if (outcome.status === "completed") outcome = failed("persistence_failed", message);
        else warnings.push(message);
      }
    }
  } catch (error) {
    outcome = failed("internal_error", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
    for (const unsubscribe of unsubscribers) { try { unsubscribe(); } catch { /* 监听已随 Runtime 释放 */ } }
    const closing = host as RuntimeHost | null;
    if (closing) await bounded(closing.dispose().catch((error: unknown) => { warnings.push(`释放资源失败：${error instanceof Error ? error.message : String(error)}`); }), () => warnings.push("释放资源超时"));
  }

  const endedMs = Date.now();
  const build = (final: Outcome): HeadlessRunResult => ({
    runId,
    conversationId,
    runDir: dirs.runDir,
    startedAt,
    endedAt: new Date(endedMs).toISOString(),
    durationMs: endedMs - startedMs,
    status: final.status,
    error: final.status === "completed" ? null : final.error,
    mode: input.mode,
    sandboxMode: input.sandboxMode,
    model: actualModel,
    thinkingLevel: actualThinking,
    finalText: report?.finalText ?? null,
    plan: report?.plan ?? null,
    tokens: report?.tokens ?? null,
    subagentFailures: report?.subagentFailures ?? [],
    blocked: final.status === "blocked" ? final.blocked ?? null : null,
    warnings: [...warnings],
  });
  let result = build(outcome!);
  try {
    await store.update({ status: result.status, endedAt: result.endedAt, result, error: result.error });
  } catch (error) {
    // 终态写不进 run.json 时，不能让调用方以为一切正常。
    if (result.status === "completed") {
      result = build(failed("persistence_failed", `无法写入运行记录：${error instanceof Error ? error.message : String(error)}`));
    } else {
      result = { ...result, warnings: [...result.warnings, `无法写入运行记录：${error instanceof Error ? error.message : String(error)}`] };
    }
  }
  // 事件流和 run.json 都经过脱敏；返回给 API 调用方的对象保持原文。
  pipe.push("run_result", redactSensitive(result, secrets) as HeadlessRunResult);
  await pipe.flush();
  return result;
}
