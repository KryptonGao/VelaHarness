import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import type {
  SandboxExecutionContext,
  SandboxApprovalEvent,
  SandboxApprovalKind,
  SandboxMcpContext,
  SandboxMode,
  SandboxRiskEvaluator,
  SandboxRiskInput,
  SandboxRiskVerdict,
} from "@vela/shared";
import {
  compilePermissionRules,
  emptyRuleSet,
  evaluatePermissionRules,
  suggestRules,
  type PermissionRuleSet,
  type RuleDecision,
} from "./permission-rules";

/** 无人回复时自动拒绝的等待时间；Agent Inbox 据此区分「拒绝」与「超时」。 */
export const sandboxApprovalTimeoutMs = 5 * 60_000;
const approvalTimeoutMs = sandboxApprovalTimeoutMs;
/** 判定结论缓存上限,避免长时间会话里无限增长。 */
const verdictCacheLimit = 200;

interface SandboxSettings {
  sandboxMode: SandboxMode;
}

export type SandboxRequestInput = SandboxExecutionContext & {
  kind: SandboxApprovalKind;
  command?: string | null;
  path?: string | null;
  cwd?: string | null;
  workspace?: string | null;
  insideWorkspace?: boolean;
  mcp?: SandboxMcpContext;
  signal?: AbortSignal;
};

/** deniedByRule 有值表示被「永远拒绝」的记录拦截(未询问用户);否则 false 是用户拒绝、超时或中断。 */
export interface SandboxDecision {
  allowed: boolean;
  deniedByRule?: string;
}

/** 「始终允许」和「永远拒绝」的记录:放在用户自己的数据目录里、按项目路径分组,不进仓库,克隆来的项目无法预置。 */
const projectGrantsFileName = "project-permissions.json";

type ApprovalListener = (event: SandboxApprovalEvent) => void;

/**
 * Agent 操作的权限门。三种模式:
 * - ask(默认):bash、browser_repl、MCP 和网页抓取(web)逐条审批,工作区外文件写入也要审批;
 * - smart:交给当前对话模型判断,只有风险操作或判断失败时请求批准;
 * - full:在授权范围内直接放行。
 * 审批卡片有四个选项:允许一次、始终允许、拒绝、永远拒绝。后两个「始终/永远」按项目记下来,
 * 之后同类操作先查记录:永远拒绝在任何模式下直接拒绝,始终允许在 ask / smart 下直接放行;
 * 没有记录时才按模式处理。
 */
export class SandboxPermissionManager {
  private mode: SandboxMode = "ask";
  private riskEvaluator: SandboxRiskEvaluator | null = null;
  private readonly pending = new Map<string, (allowed: boolean) => void>();
  /** 每个等待中的审批对应的项目和「始终允许 / 永远拒绝」会记下的规则,只来自本进程生成的建议。 */
  private readonly pendingRules = new Map<string, { workspace: string; allow: string[]; deny: string[] }>();
  private grantsMtime = -2;
  private grants = new Map<string, PermissionRuleSet>();
  private readonly listeners = new Set<ApprovalListener>();
  /** 判定结论缓存:同一条命令、同一个文件不重复调用模型。 */
  private readonly verdicts = new Map<string, SandboxRiskVerdict>();
  /** 同一操作的判定进行中时复用同一个 Promise。 */
  private readonly evaluations = new Map<string, Promise<SandboxRiskVerdict>>();
  private readonly settingsPath: string;

  private readonly grantsPath: string;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
    this.grantsPath = join(dirname(settingsPath), projectGrantsFileName);
  }

  async init(): Promise<SandboxMode> {
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<SandboxSettings>;
      if (isSandboxMode(raw.sandboxMode)) this.mode = raw.sandboxMode;
    } catch {
      // 首次启动没有设置文件,保持默认 ask。
    }
    return this.mode;
  }

  getMode(): SandboxMode {
    return this.mode;
  }

  /** 注入模型判定。切换后清空旧结论,避免沿用上一个模型的判断。 */
  setRiskEvaluator(evaluator: SandboxRiskEvaluator): void {
    this.riskEvaluator = evaluator;
    this.verdicts.clear();
    this.evaluations.clear();
  }

  subscribe(listener: ApprovalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async setMode(mode: SandboxMode): Promise<SandboxMode> {
    this.mode = mode;
    await this.persist();
    return this.mode;
  }

  /** 读-改-写:设置文件里不属于沙箱的字段原样保留。 */
  private async persist(): Promise<void> {
    let existing: Record<string, unknown> = {};
    try {
      const raw: unknown = JSON.parse(await readFile(this.settingsPath, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) existing = raw as Record<string, unknown>;
    } catch {
      // 没有或损坏的设置文件按空处理。
    }
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, `${JSON.stringify({ ...existing, sandboxMode: this.mode }, null, 2)}\n`, "utf8");
  }

  private ruleDecision(input: SandboxRequestInput): RuleDecision | null {
    return evaluatePermissionRules(this.projectGrants(input.workspace), input);
  }

  /** request 的布尔版本;调用方需要区分「规则拦截」和「用户拒绝」时用 decide。 */
  async request(input: SandboxRequestInput): Promise<boolean> {
    return (await this.decide(input)).allowed;
  }

  /**
   * 请求批准。先查该项目的记录:永远拒绝在任何模式下直接拒绝,始终允许直接放行。
   * 没有记录时:full 直接放行;ask 下 bash、browser_repl 和 MCP 逐条审批,工作区内的文件改动放行;
   * smart 下先交给模型判断,只有风险或判断失败才推送审批请求。
   */
  async decide(input: SandboxRequestInput): Promise<SandboxDecision> {
    if (input.signal?.aborted) return { allowed: false };
    const mode = input.sandboxMode ?? this.mode;
    const rule = this.ruleDecision(input);
    if (rule?.action === "deny") return { allowed: false, deniedByRule: rule.rule };
    if (mode === "full") return { allowed: true };
    // 记录文件决定了以后放行什么,agent 改写它必须由用户批准,不能被记录或模型判断静默放行。
    const target = (input.kind === "edit" || input.kind === "write" || input.kind === "mkdir") && input.path ? resolvePath(input.path) : null;
    const protectedFile = target !== null && target === resolvePath(this.grantsPath);
    if (rule?.action === "allow" && !protectedFile) return { allowed: true };
    // 常驻 Agent 创建后台任务不是文件或命令操作，模型无法判断其风险：smart 模式下也交给用户。
    const alwaysAsk = input.kind === "delegate" || protectedFile;
    if (!alwaysAsk && mode === "ask" && input.kind !== "bash" && input.kind !== "browser_repl" && input.kind !== "mcp" && input.kind !== "web" && input.insideWorkspace === true) return { allowed: true };
    if (!alwaysAsk && mode === "smart" && this.riskEvaluator) {
      const verdict = await withApprovalAbort(this.evaluateRisk(input), input.signal);
      if (input.signal?.aborted) return { allowed: false };
      if (verdict === "safe") return { allowed: true };
    }
    const id = randomUUID();
    // 「始终 / 永远」按项目保存,没有项目、或是在改记录文件本身时不提供。
    const suggestion = protectedFile || !input.workspace ? { allow: [], deny: [] } : suggestRules(input);
    if (input.workspace && (suggestion.allow.length || suggestion.deny.length)) this.pendingRules.set(id, { workspace: input.workspace, ...suggestion });
    const request = {
      id,
      ...(suggestion.allow.length ? { suggestedAllow: suggestion.allow } : {}),
      ...(suggestion.deny.length ? { suggestedDeny: suggestion.deny } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      kind: input.kind,
      command: input.command ?? null,
      path: input.path ?? null,
      cwd: input.cwd ?? null,
      ...(input.mcp ? { mcp: input.mcp } : {}),
      createdAt: Date.now(),
    };
    return new Promise<SandboxDecision>((resolve) => {
      const finish = (allowed: boolean): void => {
        if (!this.pending.delete(id)) return;
        this.pendingRules.delete(id);
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        this.emit({ type: "resolved", id, allowed });
        resolve({ allowed });
      };
      const abort = (): void => finish(false);
      const timer = setTimeout(() => finish(false), approvalTimeoutMs);
      this.pending.set(id, finish);
      input.signal?.addEventListener("abort", abort, { once: true });
      this.emit({ type: "request", request });
    });
  }

  /**
   * 返回 false 表示该请求已不在等待(已回复、超时、被中断或应用重启)。
   * always:允许时记下「始终允许」,拒绝时记下「永远拒绝」,规则取自该请求自带的建议,记在它所属的项目下。
   */
  reply(id: string, allowed: boolean, options?: { always?: boolean }): boolean {
    const finish = this.pending.get(id);
    if (!finish) return false;
    const pending = options?.always ? this.pendingRules.get(id) : undefined;
    if (pending) this.remember(pending.workspace, allowed ? "allow" : "deny", allowed ? pending.allow : pending.deny);
    finish(allowed);
    return true;
  }

  /** 某个项目里记下的「始终允许」规则。 */
  getProjectAllowRules(workspace: string): string[] {
    return this.projectGrants(workspace).allow.map(rule => rule.source);
  }

  /** 某个项目里记下的「永远拒绝」规则。 */
  getProjectDenyRules(workspace: string): string[] {
    return this.projectGrants(workspace).deny.map(rule => rule.source);
  }

  /** 同步读写:回复审批时规则必须立刻对下一次请求生效。 */
  private remember(workspace: string, list: "allow" | "deny", rules: readonly string[]): void {
    type Entry = { allow?: string[]; deny?: string[] };
    const key = projectKey(workspace);
    let file: { version: 1; projects: Record<string, Entry> } = { version: 1, projects: {} };
    try {
      const raw = JSON.parse(readFileSync(this.grantsPath, "utf8")) as { projects?: Record<string, Entry> };
      if (raw.projects && typeof raw.projects === "object") file = { version: 1, projects: raw.projects };
    } catch {
      // 没有或损坏的记录文件按空处理。
    }
    const entry = file.projects[key] ?? {};
    const existing = new Set(entry[list] ?? []);
    const added = compilePermissionRules({ [list]: rules.filter(rule => !existing.has(rule)) })[list].map(rule => rule.source);
    if (!added.length) return;
    file.projects[key] = { ...entry, [list]: [...(entry[list] ?? []), ...added] };
    try {
      mkdirSync(dirname(this.grantsPath), { recursive: true });
      writeFileSync(this.grantsPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    } catch {
      // 写不进去时这条记录不保存,下次仍会询问。
      return;
    }
    this.grantsMtime = -2;
  }

  private projectGrants(workspace: string | null | undefined): PermissionRuleSet {
    if (!workspace) return emptyRuleSet();
    const mtime = mtimeOf(this.grantsPath);
    if (mtime !== this.grantsMtime) {
      this.grantsMtime = mtime;
      this.grants = new Map();
      try {
        const raw = JSON.parse(readFileSync(this.grantsPath, "utf8")) as { projects?: Record<string, { allow?: unknown; deny?: unknown }> };
        for (const [path, entry] of Object.entries(raw.projects ?? {})) this.grants.set(path, compilePermissionRules(entry));
      } catch {
        // 读取失败时没有记录,回到按模式处理;永远拒绝的记录此时也不生效。
      }
    }
    return this.grants.get(projectKey(workspace)) ?? emptyRuleSet();
  }

  private async evaluateRisk(input: SandboxRequestInput): Promise<SandboxRiskVerdict> {
    const evaluator = this.riskEvaluator;
    if (!evaluator) return "unknown";
    // REPL state and external MCP state can change between identical calls.
    // Do not cache verdicts or share in-flight evaluations for these operations.
    if (input.kind === "browser_repl" || input.kind === "mcp") {
      try {
        return await evaluator({
          conversationId: input.conversationId,
          kind: input.kind,
          command: input.command ?? null,
          path: null,
          cwd: input.cwd ?? null,
          workspace: input.workspace ?? null,
          insideWorkspace: false,
          ...(input.mcp ? { mcp: input.mcp } : {}),
          signal: input.signal,
        });
      } catch {
        return "unknown";
      }
    }
    const key = `${input.conversationId ?? ""}\0${riskCacheKey(input)}`;
    const cached = this.verdicts.get(key);
    if (cached) return cached;
    const running = this.evaluations.get(key);
    if (running) return running;
    const risk: SandboxRiskInput = {
      conversationId: input.conversationId,
      kind: input.kind,
      command: input.command ?? null,
      path: input.path ?? null,
      cwd: input.cwd ?? null,
      workspace: input.workspace ?? null,
      insideWorkspace: input.insideWorkspace === true,
    };
    const evaluation = (async (): Promise<SandboxRiskVerdict> => {
      let verdict: SandboxRiskVerdict = "unknown";
      try {
        verdict = await evaluator(risk);
      } catch {
        verdict = "unknown";
      }
      this.rememberVerdict(key, verdict);
      return verdict;
    })();
    this.evaluations.set(key, evaluation);
    void evaluation.finally(() => {
      if (this.evaluations.get(key) === evaluation) this.evaluations.delete(key);
    });
    return evaluation;
  }

  private rememberVerdict(key: string, verdict: SandboxRiskVerdict): void {
    // 判断失败不缓存,下次重新交给模型;成功结论按 FIFO 淘汰旧条目。
    if (verdict === "unknown") return;
    if (this.verdicts.size >= verdictCacheLimit) {
      const oldest = this.verdicts.keys().next().value;
      if (oldest !== undefined) this.verdicts.delete(oldest);
    }
    this.verdicts.set(key, verdict);
  }

  private emit(event: SandboxApprovalEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** bash 按命令文本缓存,文件操作按路径与是否越界缓存,edit 和 write 共享同一结论。 */
function riskCacheKey(input: {
  kind: SandboxApprovalKind;
  command?: string | null;
  path?: string | null;
  cwd?: string | null;
  insideWorkspace?: boolean;
}): string {
  if (input.kind === "bash" || input.kind === "browser_repl") return `${input.kind}\0${input.command ?? ""}\0${input.cwd ?? ""}`;
  // 网页抓取按完整 URL 缓存，不与文件操作共用「路径」键。
  if (input.kind === "web") return `web\0${input.command ?? ""}`;
  return `file\0${input.insideWorkspace === true ? "in" : "out"}\0${input.path ?? ""}`;
}

function projectKey(workspace: string): string {
  const resolved = resolvePath(workspace);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return value === "ask" || value === "smart" || value === "full";
}


/** Stop should not wait for a slow model risk evaluation before cancelling the tool. */
async function withApprovalAbort(evaluation: Promise<SandboxRiskVerdict>, signal?: AbortSignal): Promise<SandboxRiskVerdict> {
  if (!signal) return evaluation;
  if (signal.aborted) return "unknown";
  return new Promise((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); resolve("unknown"); };
    signal.addEventListener("abort", abort, { once: true });
    evaluation.then(verdict => {
      signal.removeEventListener("abort", abort);
      resolve(verdict);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}
