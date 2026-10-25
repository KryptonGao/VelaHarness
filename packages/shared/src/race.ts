import type { SandboxMode, ThinkingLevel } from "./index";

/** 赛马：同一个任务在 N 个独立 worktree 里并行尝试，用客观证据并排比较后采用其一。 */

export const raceLimits = {
  minLanes: 2,
  maxLanes: 4,
  promptLength: 20_000,
  extraPromptLength: 4_000,
  labelLength: 60,
  verifyCommandLength: 500,
  outputTail: 4_000,
  idLength: 100,
} as const;

const thinkingLevelNames = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
const sandboxModeNames = ["ask", "smart", "full"] as const;

export interface RaceModelRef { provider: string; id: string }

export interface RaceLaneConfig {
  id: string;
  label: string;
  model?: RaceModelRef | null;
  thinkingLevel?: ThinkingLevel | null;
  extraPrompt?: string;
}

export interface RaceDraft {
  workspace: string;
  prompt: string;
  lanes: RaceLaneConfig[];
  sandboxMode: SandboxMode;
  /** 结束后在每个 worktree 里依序执行的统一验证指令；空表示不执行。 */
  verifyCommand?: string;
}

export type RaceLaneStatus = "starting" | "running" | "responded" | "failed" | "stopped" | "interrupted";
export type RaceStatus = "running" | "ready" | "adopted" | "discarded" | "interrupted";
export type RaceVerificationState = "skipped" | "pending" | "running" | "passed" | "failed" | "timeout";

export interface RaceTokens { input: number; output: number; cacheRead: number; total: number }
export interface RaceDiffStat { files: number; added: number; removed: number }
export interface RaceVerification {
  state: RaceVerificationState;
  exitCode?: number | null;
  durationMs?: number;
  outputTail?: string;
}

export interface RaceLane {
  id: string;
  label: string;
  resolvedExecution: { model: RaceModelRef; thinkingLevel: ThinkingLevel; sandboxMode: SandboxMode };
  extraPrompt: string;
  branch: string;
  worktree: string;
  conversationId: string;
  status: RaceLaneStatus;
  startedAt: number;
  finishedAt: number | null;
  tokens: RaceTokens | null;
  diff: RaceDiffStat | null;
  /** 赛道结束后提交在 vela/race-* 分支上的 commit；没有任何变更时为 null，不可采用。 */
  commitSha: string | null;
  changedFiles: string[];
  verification: RaceVerification;
  error: string | null;
  worktreeRemovedAt?: number;
}

export interface Race {
  id: string;
  workspace: string;
  startSha: string;
  baseBranch: string | null;
  prompt: string;
  verifyCommand?: string;
  status: RaceStatus;
  lanes: RaceLane[];
  adoptedLaneId?: string;
  createdAt: number;
  finishedAt: number | null;
}

export interface RacesState { races: Race[]; error: string | null }

export interface RacePreflight {
  git: boolean;
  branch: string | null;
  /** 已追蹤文件有未提交变更：赛道只从 HEAD 开始，不会带入这些变更。 */
  dirty: boolean;
  sandboxMode: SandboxMode;
}

export type RaceAdoptResult =
  | { ok: true; message: string; commitMessage: string; files: string[] }
  | { ok: false; reason: "dirty" | "conflict" | "not_ready" | "no_changes" | "failed"; message: string; conflicts?: string[] };

export interface RacesApi {
  preflight(workspace: string): Promise<RacePreflight>;
  list(): Promise<RacesState>;
  start(draft: RaceDraft): Promise<Race>;
  stopLane(raceId: string, laneId: string): Promise<void>;
  adopt(raceId: string, laneId: string): Promise<RaceAdoptResult>;
  discard(raceId: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export const RaceIpc = {
  preflight: "races:preflight",
  list: "races:list",
  start: "races:start",
  stopLane: "races:stop-lane",
  adopt: "races:adopt",
  discard: "races:discard",
  state: "races:state",
} as const;

/** 分支只允许 Vela 自己生成的格式，防止被改过的 races.json 诱导删除别的分支或目录。 */
export const raceBranchPattern = /^vela\/race-[a-z0-9]{4,16}-[1-9]$/;
export const raceShaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function raceBranchName(raceId: string, index: number): string {
  return `vela/race-${raceId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8)}-${index + 1}`;
}

function text(value: unknown, label: string, max: number, required: boolean): string {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}不能为空`);
    return "";
  }
  if (typeof value !== "string") throw new Error(`${label}格式不正确`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${label}不能为空`);
  if (trimmed.length > max) throw new Error(`${label}最多 ${max} 个字符`);
  return trimmed;
}

/** 严格解析来自 renderer 的草稿：多余字段丢弃，越界直接报错，不做静默截断。 */
export function parseRaceDraft(raw: unknown): RaceDraft {
  if (!raw || typeof raw !== "object") throw new Error("赛马设置不正确");
  const input = raw as Record<string, unknown>;
  const workspace = text(input.workspace, "工作区", 2_000, true);
  const prompt = text(input.prompt, "任务", raceLimits.promptLength, true);
  const sandboxMode = input.sandboxMode;
  if (typeof sandboxMode !== "string" || !(sandboxModeNames as readonly string[]).includes(sandboxMode)) throw new Error("沙箱模式不正确");
  if (!Array.isArray(input.lanes)) throw new Error("赛道设置不正确");
  if (input.lanes.length < raceLimits.minLanes || input.lanes.length > raceLimits.maxLanes) {
    throw new Error(`赛道数量需要在 ${raceLimits.minLanes} 到 ${raceLimits.maxLanes} 之间`);
  }
  const ids = new Set<string>();
  const lanes = input.lanes.map((entry, index): RaceLaneConfig => {
    if (!entry || typeof entry !== "object") throw new Error("赛道设置不正确");
    const lane = entry as Record<string, unknown>;
    const id = text(lane.id, "赛道 ID", raceLimits.idLength, true);
    if (ids.has(id)) throw new Error("赛道 ID 重复");
    ids.add(id);
    let model: RaceModelRef | null = null;
    if (lane.model !== undefined && lane.model !== null) {
      const candidate = lane.model as Record<string, unknown>;
      if (typeof candidate !== "object" || typeof candidate.provider !== "string" || typeof candidate.id !== "string"
        || !candidate.provider || !candidate.id || candidate.provider.length > 200 || candidate.id.length > 200) throw new Error("模型设置不正确");
      model = { provider: candidate.provider, id: candidate.id };
    }
    let thinkingLevel: ThinkingLevel | null = null;
    if (lane.thinkingLevel !== undefined && lane.thinkingLevel !== null) {
      if (typeof lane.thinkingLevel !== "string" || !(thinkingLevelNames as readonly string[]).includes(lane.thinkingLevel)) throw new Error("思考强度不正确");
      thinkingLevel = lane.thinkingLevel as ThinkingLevel;
    }
    const label = text(lane.label, "赛道名称", raceLimits.labelLength, false) || model?.id || `#${index + 1}`;
    const extraPrompt = text(lane.extraPrompt, "附加提示", raceLimits.extraPromptLength, false);
    return { id, label, model, thinkingLevel, ...(extraPrompt ? { extraPrompt } : {}) };
  });
  const verifyCommand = text(input.verifyCommand, "验证指令", raceLimits.verifyCommandLength, false);
  return { workspace, prompt, lanes, sandboxMode: sandboxMode as SandboxMode, ...(verifyCommand ? { verifyCommand } : {}) };
}

export type RaceBadge = "fastest" | "fewest_tokens" | "smallest_diff" | "only_passing";

/**
 * 只标出事实上的最优，不加权评分、不挑胜者。
 * 只有一条赛道具备该指标时不加徽章（没有可比较的对象）；并列时都加。
 */
export function raceBadges(lanes: readonly RaceLane[]): Map<string, RaceBadge[]> {
  const badges = new Map<string, RaceBadge[]>();
  const add = (id: string, badge: RaceBadge) => badges.set(id, [...(badges.get(id) ?? []), badge]);
  const finished = lanes.filter(lane => lane.finishedAt !== null && lane.status === "responded");
  const best = (select: (lane: RaceLane) => number | null, badge: RaceBadge) => {
    const scored = finished.map(lane => ({ lane, value: select(lane) })).filter((entry): entry is { lane: RaceLane; value: number } => entry.value !== null);
    if (scored.length < 2) return;
    const min = Math.min(...scored.map(entry => entry.value));
    const winners = scored.filter(entry => entry.value === min);
    if (winners.length === scored.length) return;
    for (const entry of winners) add(entry.lane.id, badge);
  };
  best(lane => (lane.finishedAt === null ? null : lane.finishedAt - lane.startedAt), "fastest");
  best(lane => lane.tokens?.total ?? null, "fewest_tokens");
  best(lane => (lane.diff && lane.commitSha ? lane.diff.added + lane.diff.removed : null), "smallest_diff");
  const verified = finished.filter(lane => lane.verification.state !== "skipped");
  const passing = verified.filter(lane => lane.verification.state === "passed");
  if (verified.length >= 2 && passing.length === 1) add(passing[0].id, "only_passing");
  return badges;
}
