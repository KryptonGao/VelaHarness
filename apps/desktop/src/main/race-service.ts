import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  commitWorktreeChanges, createWorktree, currentHead, deleteLocalBranch, hasTrackedChanges, removeWorktree, squashMergeBranch,
} from "@vela/workspace";
import {
  createLogger, parseRaceDraft, raceBranchName, raceBranchPattern, raceLimits, raceShaPattern,
  type Race, type RaceAdoptResult, type RaceDraft, type RaceLane, type RaceLaneConfig, type RaceLaneStatus, type RacePreflight,
  type RaceStatus, type RaceTokens, type RaceVerificationState, type RacesState, type SandboxMode, type ThinkingLevel,
} from "@vela/shared";
import type { LaneRequest, LaneResult } from "@vela/agent";
import { writeJsonAtomic } from "./atomic-json";
import { runVerifyCommand, type VerifyResult } from "./race-verify";

const log = createLogger("race");

export interface RaceHostRuntime {
  resolveExecution(lane: RaceLaneConfig, sandboxMode: SandboxMode): Promise<{ model: { provider: string; id: string }; thinkingLevel: ThinkingLevel; sandboxMode: SandboxMode }>;
  runLane(request: LaneRequest): Promise<LaneResult>;
  stopLane(conversationId: string): void;
  laneStats(conversationId: string): RaceTokens | null;
  workspaces(): string[];
  sandboxMode(): SandboxMode;
  /** 受管 worktree 目录里某个赛道分支对应的路径，也是读档时校验路径的唯一依据。 */
  worktreePath(branch: string): string;
  /** 测试可替换；默认在 worktree 里用 /bin/sh 执行。 */
  verify?(command: string, cwd: string): Promise<VerifyResult>;
}

interface Store { schemaVersion: 1; races: Race[] }

const laneStatuses: RaceLaneStatus[] = ["starting", "running", "responded", "failed", "stopped", "interrupted"];
const raceStatuses: RaceStatus[] = ["running", "ready", "adopted", "discarded", "interrupted"];
const verificationStates: RaceVerificationState[] = ["skipped", "pending", "running", "passed", "failed", "timeout"];
const maxActiveRaces = 2;
/** 保留的历史上限；只清理已结束且 worktree 已移除的，进行中的永不丢。 */
const maxStoredRaces = 50;

const hint = "You are working in an isolated git worktree for a side-by-side comparison run. Edit files directly in the current directory; do not switch branches, push, or touch other directories.";

export class RaceService {
  private store: Store = { schemaVersion: 1, races: [] };
  private loaded = false;
  private error: string | null = null;
  private stopped = false;
  private readonly listeners = new Set<() => void>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly busy = new Set<string>();

  constructor(private readonly file: string, private readonly runtime: RaceHostRuntime) {}

  init(): void { this.load(); }

  private load(): void {
    try {
      let raw: string;
      try { raw = readFileSync(this.file, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { this.loaded = true; this.error = null; return; } throw error; }
      const store = JSON.parse(raw) as Store;
      if (store.schemaVersion !== 1) throw new Error("赛马 schemaVersion 不兼容，已停止写入");
      if (!Array.isArray(store.races)) throw new Error("赛马资料损坏");
      const ids = new Set<string>();
      for (const race of store.races) { this.validate(race); if (ids.has(race.id)) throw new Error("赛马 ID 重复"); ids.add(race.id); }
      this.store = store; this.loaded = true; this.error = null;
      if (store.races.some(race => race.status === "running")) this.commit(next => {
        for (const race of next.races) {
          if (race.status !== "running") continue;
          race.status = "interrupted"; race.finishedAt = Date.now();
          for (const lane of race.lanes) {
            if (lane.status === "starting" || lane.status === "running") {
              Object.assign(lane, { status: "interrupted" as const, finishedAt: Date.now(), error: "应用退出导致赛道中断；worktree 里可能还有未提交的改动" });
            }
            if (lane.verification.state === "pending" || lane.verification.state === "running") lane.verification = { state: "skipped" };
          }
        }
      });
    } catch (error) { this.loaded = false; this.error = error instanceof Error ? error.message : String(error); log.error("race store load failed", error); }
  }

  /** 读档时的结构校验。分支与路径必须是 Vela 自己生成的格式，防止被改过的文件诱导删除别处。 */
  private validate(race: Race): void {
    const bad = (what: string) => new Error(`赛马记录损坏：${what}`);
    if (!race || typeof race.id !== "string" || !race.id || race.id.length > raceLimits.idLength) throw bad("id");
    if (typeof race.workspace !== "string" || !isAbsolute(race.workspace)) throw bad("workspace");
    if (typeof race.startSha !== "string" || !raceShaPattern.test(race.startSha)) throw bad("startSha");
    if (typeof race.prompt !== "string" || !raceStatuses.includes(race.status) || !Number.isFinite(race.createdAt)) throw bad("meta");
    if (race.finishedAt !== null && !Number.isFinite(race.finishedAt)) throw bad("finishedAt");
    if (!Array.isArray(race.lanes) || race.lanes.length < raceLimits.minLanes || race.lanes.length > raceLimits.maxLanes) throw bad("lanes");
    const branches = new Set<string>();
    for (const lane of race.lanes) {
      if (!lane || typeof lane.id !== "string" || typeof lane.conversationId !== "string" || !laneStatuses.includes(lane.status)) throw bad("lane");
      if (typeof lane.branch !== "string" || !raceBranchPattern.test(lane.branch) || branches.has(lane.branch)) throw bad("branch");
      branches.add(lane.branch);
      if (typeof lane.worktree !== "string" || !isAbsolute(lane.worktree) || lane.worktree !== this.runtime.worktreePath(lane.branch)) throw bad("worktree");
      if (!Number.isFinite(lane.startedAt) || (lane.finishedAt !== null && !Number.isFinite(lane.finishedAt))) throw bad("lane time");
      if (lane.commitSha !== null && (typeof lane.commitSha !== "string" || !raceShaPattern.test(lane.commitSha))) throw bad("commitSha");
      if (!lane.verification || !verificationStates.includes(lane.verification.state)) throw bad("verification");
      if (!Array.isArray(lane.changedFiles)) throw bad("files");
    }
  }

  private assertWritable(): void {
    if (!this.loaded) this.load();
    if (!this.loaded) throw new Error(this.error ?? "赛马资料不可用");
  }

  private commit(mutate: (store: Store) => void): void {
    const next = structuredClone(this.store);
    mutate(next);
    writeJsonAtomic(this.file, next, 2);
    this.store = next;
    this.emit();
  }

  private emit(): void { for (const listener of [...this.listeners]) { try { listener(); } catch (error) { log.error("race listener failed", error); } } }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  list(): RacesState {
    if (!this.loaded) this.load();
    return structuredClone({ races: this.store.races, error: this.error });
  }

  private race(id: string): Race {
    const race = this.store.races.find(item => item.id === id);
    if (!race) throw new Error("赛马不存在或已清理");
    return race;
  }

  private patchRace(id: string, patch: Partial<Race>): void {
    this.commit(next => { Object.assign(next.races.find(item => item.id === id)!, patch); });
  }

  private patchLane(raceId: string, laneId: string, patch: Partial<RaceLane>): void {
    this.commit(next => { Object.assign(next.races.find(item => item.id === raceId)!.lanes.find(item => item.id === laneId)!, patch); });
  }

  async preflight(workspace: unknown): Promise<RacePreflight> {
    if (typeof workspace !== "string" || !this.runtime.workspaces().includes(workspace)) throw new Error("工作区未登记");
    const sandboxMode = this.runtime.sandboxMode();
    try {
      const head = await currentHead(workspace);
      return { git: true, branch: head.branch, dirty: await hasTrackedChanges(workspace), sandboxMode };
    } catch {
      return { git: false, branch: null, dirty: false, sandboxMode };
    }
  }

  async start(raw: unknown): Promise<Race> {
    this.assertWritable();
    if (this.stopped) throw new Error("应用正在退出");
    const draft = parseRaceDraft(raw);
    if (!this.runtime.workspaces().includes(draft.workspace)) throw new Error("工作区未登记");
    if (this.store.races.filter(race => race.status === "running").length >= maxActiveRaces) throw new Error(`最多同时进行 ${maxActiveRaces} 场赛马，请先等待或丢弃其中一场`);
    let head: { sha: string; branch: string | null };
    try { head = await currentHead(draft.workspace); }
    catch { throw new Error("赛马需要 git 仓库，且至少有一个提交"); }
    const executions: RaceLane["resolvedExecution"][] = [];
    for (const lane of draft.lanes) executions.push(await this.runtime.resolveExecution(lane, draft.sandboxMode));

    const id = randomUUID();
    const now = Date.now();
    const lanes: RaceLane[] = draft.lanes.map((config, index) => {
      const branch = raceBranchName(id, index);
      return {
        id: config.id, label: config.label, resolvedExecution: executions[index], extraPrompt: config.extraPrompt ?? "",
        branch, worktree: this.runtime.worktreePath(branch), conversationId: randomUUID(),
        status: "starting", startedAt: now, finishedAt: null, tokens: null, diff: null, commitSha: null, changedFiles: [],
        verification: { state: "skipped" }, error: null,
      };
    });
    const race: Race = {
      id, workspace: draft.workspace, startSha: head.sha, baseBranch: head.branch, prompt: draft.prompt,
      ...(draft.verifyCommand ? { verifyCommand: draft.verifyCommand } : {}),
      status: "running", lanes, createdAt: now, finishedAt: null,
    };
    // 先落盘再建 worktree：崩溃后记录还在，discard 能把残留清掉。
    this.commit(next => { next.races.push(race); });
    const created: RaceLane[] = [];
    try {
      for (const lane of lanes) {
        const result = await createWorktree(draft.workspace, { branch: lane.branch, newBranch: true, startPoint: head.sha, path: lane.worktree }, null);
        if (!result.ok || result.path !== lane.worktree) throw new Error(result.message || "worktree 创建失败");
        created.push(lane);
      }
    } catch (error) {
      for (const lane of created) await this.removeLane(race, lane).catch(() => undefined);
      this.commit(next => { next.races = next.races.filter(item => item.id !== id); });
      throw error;
    }
    const run = this.runRace(race, draft).catch(error => {
      log.error("race run failed", error);
      this.markAllInterrupted(id, error instanceof Error ? error.message : String(error));
    }).finally(() => { this.runs.delete(id); });
    this.runs.set(id, run);
    return structuredClone(this.race(id));
  }

  private markAllInterrupted(raceId: string, message: string): void {
    try {
      this.commit(next => {
        const race = next.races.find(item => item.id === raceId);
        if (!race) return;
        race.status = "interrupted"; race.finishedAt = Date.now();
        for (const lane of race.lanes) if (lane.status === "starting" || lane.status === "running") Object.assign(lane, { status: "interrupted" as const, finishedAt: Date.now(), error: message });
      });
    } catch (error) { log.error("race interrupt write failed", error); }
  }

  private async runRace(race: Race, draft: RaceDraft): Promise<void> {
    await Promise.all(race.lanes.map(lane => this.runLane(race, lane, draft)));
    if (this.stopped) return;
    const verify = this.runtime.verify ?? runVerifyCommand;
    if (race.verifyCommand) {
      for (const lane of this.race(race.id).lanes) {
        if (this.stopped) return;
        if (lane.verification.state !== "pending") continue;
        this.patchLane(race.id, lane.id, { verification: { state: "running" } });
        let state: RaceVerificationState = "failed";
        let result: VerifyResult | null = null;
        try {
          result = await verify(race.verifyCommand, lane.worktree);
          state = result.timedOut ? "timeout" : result.exitCode === 0 ? "passed" : "failed";
        } catch (error) {
          result = { exitCode: null, timedOut: false, durationMs: 0, outputTail: error instanceof Error ? error.message : String(error) };
        }
        this.patchLane(race.id, lane.id, { verification: { state, exitCode: result.exitCode, durationMs: result.durationMs, outputTail: result.outputTail } });
      }
    }
    this.patchRace(race.id, { status: "ready", finishedAt: Date.now() });
  }

  private async runLane(race: Race, lane: RaceLane, draft: RaceDraft): Promise<void> {
    this.patchLane(race.id, lane.id, { status: "running", startedAt: Date.now() });
    const prompt = `${draft.prompt}${lane.extraPrompt ? `\n\n${lane.extraPrompt}` : ""}\n\n${hint}`;
    let result: LaneResult;
    try {
      result = await this.runtime.runLane({
        conversationId: lane.conversationId, cwd: lane.worktree, title: `赛马 · ${lane.label}`, prompt,
        execution: { model: lane.resolvedExecution.model, thinkingLevel: lane.resolvedExecution.thinkingLevel, sandboxMode: lane.resolvedExecution.sandboxMode },
      });
    } catch (error) { result = { status: "failed", error: error instanceof Error ? error.message : String(error) }; }
    if (this.stopped) return;
    const patch: Partial<RaceLane> = { status: result.status, finishedAt: Date.now(), tokens: this.runtime.laneStats(lane.conversationId), error: result.error ?? null };
    try {
      const commit = await commitWorktreeChanges(lane.worktree, race.startSha, `race: ${lane.label}`);
      Object.assign(patch, {
        commitSha: commit.commitSha, changedFiles: commit.files,
        diff: commit.commitSha ? { files: commit.files.length, added: commit.added, removed: commit.removed } : { files: 0, added: 0, removed: 0 },
        verification: { state: race.verifyCommand && commit.commitSha ? "pending" : "skipped" },
      });
    } catch (error) {
      patch.error = `${patch.error ? `${patch.error}；` : ""}无法保存赛道改动：${error instanceof Error ? error.message : String(error)}`;
    }
    this.patchLane(race.id, lane.id, patch);
  }

  stopLane(raceId: unknown, laneId: unknown): void {
    if (typeof raceId !== "string" || typeof laneId !== "string") throw new Error("赛道不正确");
    const lane = this.race(raceId).lanes.find(item => item.id === laneId);
    if (!lane) throw new Error("赛道不存在");
    if (lane.status === "starting" || lane.status === "running") this.runtime.stopLane(lane.conversationId);
  }

  /** 移除一条赛道的 worktree 与分支。worktree 是 Vela 自己建的一次性目录，且改动已提交，所以直接强制移除（里面可能有验证产生的构建产物）。 */
  private async removeLane(race: Race, lane: RaceLane): Promise<void> {
    if (lane.worktreeRemovedAt) return;
    if (lane.worktree !== this.runtime.worktreePath(lane.branch) || !raceBranchPattern.test(lane.branch)) throw new Error("赛道记录与受管路径不一致，已拒绝清理");
    const removed = await removeWorktree(race.workspace, { path: lane.worktree, force: true }, null);
    if (!removed.ok) throw new Error(removed.message);
    await deleteLocalBranch(race.workspace, lane.branch);
    if (this.store.races.some(item => item.id === race.id)) this.patchLane(race.id, lane.id, { worktreeRemovedAt: Date.now() });
  }

  private async cleanup(raceId: string): Promise<string[]> {
    const failures: string[] = [];
    for (const lane of this.race(raceId).lanes) {
      try { await this.removeLane(this.race(raceId), lane); }
      catch (error) { failures.push(`${lane.label}：${error instanceof Error ? error.message : String(error)}`); }
    }
    return failures;
  }

  async adopt(raceId: unknown, laneId: unknown): Promise<RaceAdoptResult> {
    this.assertWritable();
    if (typeof raceId !== "string" || typeof laneId !== "string") throw new Error("赛道不正确");
    const race = this.race(raceId);
    const lane = race.lanes.find(item => item.id === laneId);
    if (!lane) throw new Error("赛道不存在");
    if (race.status !== "ready") return { ok: false, reason: "not_ready", message: "还有赛道在运行，请等待完成，或先停止仍在运行的赛道。" };
    if (!lane.commitSha || lane.worktreeRemovedAt) return { ok: false, reason: "no_changes", message: "这条赛道没有可采用的改动。" };
    if (this.busy.has(raceId)) throw new Error("正在处理这场赛马");
    this.busy.add(raceId);
    try {
      const merged = await squashMergeBranch(race.workspace, lane.branch);
      if (!merged.ok) return { ok: false, reason: merged.reason, message: merged.message, ...(merged.conflicts.length ? { conflicts: merged.conflicts } : {}) };
      if (merged.files.length === 0) return { ok: false, reason: "no_changes", message: "这条赛道的改动与当前工作区已经一致，没有需要采用的内容。" };
      this.patchRace(raceId, { status: "adopted", adoptedLaneId: lane.id });
      const failures = await this.cleanup(raceId);
      const base = `已把「${lane.label}」的 ${merged.files.length} 个文件改动放入暂存区，检查后自行提交。`;
      return {
        ok: true, files: merged.files,
        message: failures.length ? `${base}部分赛道清理未完成：${failures.join("；")}（可在赛马面板重试清理）` : base,
        commitMessage: `${race.prompt.split("\n")[0].slice(0, 72)}`,
      };
    } catch (error) {
      return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
    } finally { this.busy.delete(raceId); }
  }

  /** 丢弃整场赛马：停止仍在运行的赛道、清掉 worktree 与分支。已采用的赛马用它重试未完成的清理。 */
  async discard(raceId: unknown): Promise<void> {
    this.assertWritable();
    if (typeof raceId !== "string") throw new Error("赛马不正确");
    const race = this.race(raceId);
    if (this.busy.has(raceId)) throw new Error("正在处理这场赛马");
    this.busy.add(raceId);
    try {
      if (race.status === "running") {
        for (const lane of race.lanes) if (lane.status === "starting" || lane.status === "running") this.runtime.stopLane(lane.conversationId);
        await this.runs.get(raceId);
      }
      const failures = await this.cleanup(raceId);
      if (failures.length) throw new Error(`清理未完成：${failures.join("；")}`);
      if (this.race(raceId).status !== "adopted") this.patchRace(raceId, { status: "discarded", finishedAt: this.race(raceId).finishedAt ?? Date.now() });
      this.prune();
    } finally { this.busy.delete(raceId); }
  }

  /** 历史只保留最近一批已结束且已清理的记录。 */
  private prune(): void {
    const removable = this.store.races
      .filter(race => race.status !== "running" && race.lanes.every(lane => lane.worktreeRemovedAt))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(maxStoredRaces)
      .map(race => race.id);
    if (removable.length) this.commit(next => { next.races = next.races.filter(race => !removable.includes(race.id)); });
  }

  /** 应用退出：停掉所有赛道，记录由下次启动时标记为中断。 */
  stop(): void {
    this.stopped = true;
    for (const race of this.store.races) {
      if (race.status !== "running") continue;
      for (const lane of race.lanes) if (lane.status === "starting" || lane.status === "running") this.runtime.stopLane(lane.conversationId);
    }
    try {
      this.commit(next => {
        for (const race of next.races) {
          if (race.status !== "running") continue;
          race.status = "interrupted"; race.finishedAt = Date.now();
          for (const lane of race.lanes) {
            if (lane.status === "starting" || lane.status === "running") Object.assign(lane, { status: "interrupted" as const, finishedAt: Date.now(), error: "应用退出导致赛道中断；worktree 里可能还有未提交的改动" });
            if (lane.verification.state === "pending" || lane.verification.state === "running") lane.verification = { state: "skipped" };
          }
        }
      });
    } catch (error) { log.error("race shutdown write failed", error); }
  }
}
