import type { AppLocale, SandboxApprovalKind, SandboxMode, ThinkingLevel } from "@vela/shared";

export const headlessProtocolVersion = 1;
/** 整体超时：初始化、模型执行、后台等待都计入。 */
export const defaultHeadlessTimeoutMs = 30 * 60_000;
/** 释放资源与收尾的上限。 */
export const headlessCleanupTimeoutMs = 5000;
/** 与桌面输入框一致的文本上限。 */
export const maxHeadlessPromptLength = 100_000;

export type HeadlessRunMode = "agent" | "plan";

export interface HeadlessRunRequest {
  cwd: string;
  prompt: string;
  /** 运行数据根目录；每次运行在 <dataDir>/runs/<runId> 下独占一个目录。 */
  dataDir: string;
  /** 模型配置目录（auth.json / models.json / selection.json）；只读复用，不写入默认选择。 */
  configDir: string;
  model?: { provider: string; id: string };
  thinkingLevel?: ThinkingLevel;
  mode?: HeadlessRunMode;
  /** 默认 ask：需要人工批准的请求会立即阻塞退出。 */
  sandboxMode?: SandboxMode;
  timeoutMs?: number;
  locale?: AppLocale;
}

/** completed 只表示执行正常结束，不代表代码验证通过。 */
export type HeadlessRunStatus = "completed" | "failed" | "blocked" | "cancelled" | "timed_out";

export type HeadlessErrorCode =
  | "invalid_request"
  | "config_error"
  | "model_unavailable"
  | "thinking_unsupported"
  | "start_failed"
  | "runtime_error"
  | "subagent_failed"
  | "budget_exhausted"
  | "plan_missing"
  | "persistence_failed"
  | "approval_required"
  | "question_required"
  | "cancelled"
  | "timed_out"
  | "internal_error";

/** 参数或配置层面的错误：调用方应当修正输入，而不是重试。 */
export const configErrorCodes: readonly HeadlessErrorCode[] = ["invalid_request", "config_error", "model_unavailable", "thinking_unsupported"];

export interface HeadlessRunError {
  code: HeadlessErrorCode;
  message: string;
}

export interface HeadlessTokenUsage { input: number; output: number; cacheRead: number; total: number }

export interface HeadlessRunResult {
  runId: string;
  conversationId: string | null;
  runDir: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: HeadlessRunStatus;
  error: HeadlessRunError | null;
  mode: HeadlessRunMode;
  sandboxMode: SandboxMode;
  /** 实际使用的模型与思考强度。 */
  model: { provider: string; id: string } | null;
  thinkingLevel: ThinkingLevel | null;
  /** 最后一次主代理回复。 */
  finalText: string | null;
  /** Plan 模式的最新计划；不会被自动批准或执行。 */
  plan: { id: string; revision: number; markdown: string } | null;
  tokens: { root: HeadlessTokenUsage; subagents: (HeadlessTokenUsage & { agentId: string; path: string })[]; total: HeadlessTokenUsage } | null;
  subagentFailures: { agentId: string; path: string; task: string; error: string | null }[];
  /** status 为 blocked 时说明需要人做什么。 */
  blocked: { kind: "approval" | "question"; detail: string } | null;
  /** 不影响状态的收尾提示，例如后台命令没有在上限内退出。 */
  warnings: string[];
}

interface Envelope<T extends string, P> {
  version: typeof headlessProtocolVersion;
  runId: string;
  /** 从 1 开始，同一次运行内连续递增。 */
  sequence: number;
  timestamp: string;
  type: T;
  payload: P;
}

export type HeadlessRunEvent =
  | Envelope<"run_started", { runDir: string; cwd: string; mode: HeadlessRunMode; sandboxMode: SandboxMode; model: { provider: string; id: string } | null; thinkingLevel: ThinkingLevel | null }>
  | Envelope<"runtime", { event: unknown }>
  | Envelope<"approval", { requestId: string; kind: SandboxApprovalKind; command: string | null; path: string | null; cwd: string | null; outcome: "denied" }>
  | Envelope<"question", { requestId: string; question: string; outcome: "cancelled" }>
  /** 最后一条，且只有一条。 */
  | Envelope<"run_result", HeadlessRunResult>;

export type HeadlessRunEventType = HeadlessRunEvent["type"];

export type HeadlessEventSink = (event: HeadlessRunEvent) => void | Promise<void>;

export interface HeadlessRunOptions {
  signal?: AbortSignal;
  /** 返回 Promise 时 Runner 等它完成再投递下一条（stdout 背压）。 */
  onEvent?: HeadlessEventSink;
}

/** 请求本身无效（未开始运行）：没有运行目录，也不会有 run_result。 */
export class HeadlessRequestError extends Error {
  constructor(readonly code: "invalid_request" | "config_error", message: string) {
    super(message);
    this.name = "HeadlessRequestError";
  }
}

export type { AppLocale };
