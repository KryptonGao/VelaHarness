import { raceBadges, type Race, type RaceAdoptResult, type RaceBadge, type RaceLane, type RaceLaneStatus, type RaceStatus } from "@vela/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toUiMessage } from "../hooks/useSession";
import { localizeError, tr, trf } from "../locale";
import { acceptanceCounts, outcomeByFinalMessage, type AcceptanceRequest } from "./acceptance";
import "../race.css";

export interface RacePanelProps {
  /** 当前工作区的赛马，最新的在前。 */
  races: readonly Race[];
  onOpenConversation: (conversationId: string) => void;
  onOpenAcceptance: (request: AcceptanceRequest) => void;
}

interface LaneOutcome { passed: number; pending: number; request: AcceptanceRequest }

const laneStatusLabel = (status: RaceLaneStatus): string => ({
  starting: tr("启动中", "Starting"), running: tr("运行中", "Running"), responded: tr("已完成", "Finished"),
  failed: tr("失败", "Failed"), stopped: tr("已停止", "Stopped"), interrupted: tr("已中断", "Interrupted"),
})[status];

const raceStatusLabel = (status: RaceStatus): string => ({
  running: tr("进行中", "Running"), ready: tr("可比较", "Ready to compare"), adopted: tr("已采用", "Adopted"),
  discarded: tr("已丢弃", "Discarded"), interrupted: tr("已中断", "Interrupted"),
})[status];

const badgeLabel = (badge: RaceBadge): string => ({
  fastest: tr("最快", "Fastest"), fewest_tokens: tr("token 最少", "Fewest tokens"),
  smallest_diff: tr("改动最小", "Smallest change"), only_passing: tr("唯一通过验证", "Only one passing"),
})[badge];

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function formatTokens(total: number): string {
  return total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
}

function adoptMessage(result: RaceAdoptResult): string {
  if (result.ok) return trf("已把 {0} 个文件的改动放入暂存区。检查后自行提交。", "Staged changes to {0} files. Review them and commit when ready.", result.files.length);
  switch (result.reason) {
    case "dirty": return tr("工作区有未提交的变更，请先提交或暂存后再采用。", "The workspace has uncommitted changes. Commit or stash them before adopting a result.");
    case "conflict": return trf("与当前工作区冲突：{0}。已还原，工作区没有被改动；可以改选其他赛道。", "This conflicts with the current workspace: {0}. It was rolled back and nothing changed; you can pick another lane.", (result.conflicts ?? []).join(", "));
    case "not_ready": return tr("还有赛道在运行。等它们结束，或先停止它们。", "Some lanes are still running. Wait for them to finish, or stop them first.");
    case "no_changes": return tr("这条赛道没有可采用的改动。", "This lane has no changes to adopt.");
    default: return localizeError(result.message);
  }
}

function verificationText(lane: RaceLane, hasCommand: boolean): string {
  const { state, exitCode, durationMs } = lane.verification;
  const took = durationMs !== undefined ? ` · ${formatDuration(durationMs)}` : "";
  switch (state) {
    case "skipped": return hasCommand ? tr("未执行（没有改动）", "Not run (no changes)") : tr("未设置", "Not set");
    case "pending": return tr("等待执行", "Waiting");
    case "running": return tr("执行中…", "Running…");
    case "passed": return `${tr("通过", "Passed")}${took}`;
    case "failed": return `${exitCode !== null && exitCode !== undefined ? trf("失败（退出码 {0}）", "Failed (exit code {0})", exitCode) : tr("失败", "Failed")}${took}`;
    case "timeout": return `${tr("超时", "Timed out")}${took}`;
  }
}

export function RacePanel({ races, onOpenConversation, onOpenAcceptance }: RacePanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [outcomes, setOutcomes] = useState<Record<string, LaneOutcome>>({});
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; commit?: string } | null>(null);

  const race = races.find(item => item.id === selectedId) ?? races[0] ?? null;
  const running = race?.lanes.some(lane => lane.status === "starting" || lane.status === "running") ?? false;
  // 还有赛道在跑时比较不完整，先不标徽章，避免误导。
  const badges = useMemo(() => race && !running ? raceBadges(race.lanes) : new Map<string, RaceBadge[]>(), [race, running]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => { setConfirming(null); setConfirmingDiscard(false); setMessage(null); }, [race?.id]);

  // 赛道自己跑过的验证与需求归属：只读取赛道对话的工具记录，用与聊天里「验收」相同的函数推导。
  // 每个（对话，结束时间）只读取一次；组件卸载后不再写状态。
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const api = window.vela;
    if (!api || !race) return;
    for (const lane of race.lanes) {
      if (lane.status === "starting" || lane.status === "running") continue;
      const key = `${lane.conversationId}:${lane.finishedAt}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      void api.getMessages(lane.conversationId).then(transcript => {
        const request = [...outcomeByFinalMessage(transcript.map(toUiMessage), false, lane.worktree).values()].at(-1);
        if (request && mounted.current) setOutcomes(current => ({ ...current, [key]: { ...acceptanceCounts(request.outcome), request } }));
      }).catch(() => undefined);
    }
  }, [race]);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try { await task(); }
    catch (error) { setMessage({ tone: "error", text: localizeError(error instanceof Error ? error.message : String(error)) }); }
    finally { setBusy(false); }
  }, []);

  if (!window.vela?.races) return <div className="race-panel race-empty">{tr("赛马服务不可用", "The race service is unavailable.")}</div>;
  if (!race) {
    return <div className="race-panel race-empty">
      <strong>{tr("还没有赛马", "No races yet")}</strong>
      <p>{tr("在输入框的模式菜单里选择「赛马」，让同一个任务由不同的模型或提示并行尝试。", "Choose “Race” in the composer's mode menu to let different models or prompts try the same task in parallel.")}</p>
    </div>;
  }

  const api = window.vela.races;
  const finishedAll = race.status === "ready";
  const leftover = race.lanes.some(lane => !lane.worktreeRemovedAt) && (race.status === "adopted" || race.status === "discarded");
  const canDiscard = race.status !== "discarded" && !(race.status === "adopted" && !leftover);

  async function adopt(lane: RaceLane): Promise<void> {
    await run(async () => {
      const result = await api!.adopt(race!.id, lane.id);
      setConfirming(null);
      setMessage({ tone: result.ok ? "ok" : "error", text: adoptMessage(result), ...(result.ok ? { commit: result.commitMessage } : {}) });
    });
  }

  return (
    <div className="race-panel">
      <div className="race-toolbar">
        <strong>{tr("赛马", "Race")}</strong>
        {races.length > 1 ? (
          <select aria-label={tr("选择赛马", "Choose a race")} value={race.id} onChange={event => setSelectedId(event.target.value)}>
            {races.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.prompt.slice(0, 40)}</option>)}
          </select>
        ) : null}
        <span className={`race-status is-${race.status}`}>{raceStatusLabel(race.status)}</span>
        {canDiscard ? (
          confirmingDiscard ? (
            <span className="race-confirm-inline">
              <span>{leftover ? tr("重试清理残留的 worktree？", "Retry cleaning the leftover worktrees?") : tr("丢弃整场赛马？所有赛道的改动都会删除。", "Discard this race? Every lane's changes are deleted.")}</span>
              <button type="button" className="is-danger" disabled={busy} onClick={() => void run(async () => { await api.discard(race.id); setConfirmingDiscard(false); })}>
                {leftover ? tr("重试清理", "Retry cleanup") : tr("确认丢弃", "Discard")}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmingDiscard(false)}>{tr("取消", "Cancel")}</button>
            </span>
          ) : <button type="button" disabled={busy} onClick={() => setConfirmingDiscard(true)}>{leftover ? tr("重试清理", "Retry cleanup") : tr("全部丢弃", "Discard all")}</button>
        ) : null}
      </div>

      <div className="race-summary">
        <p className="race-prompt">{race.prompt}</p>
        <p className="race-meta">
          {race.baseBranch ?? tr("游离 HEAD", "Detached HEAD")} @ <code>{race.startSha.slice(0, 7)}</code>
          {race.verifyCommand ? <> · {tr("统一验证", "Verification")}: <code>{race.verifyCommand}</code></> : null}
        </p>
        {race.status === "interrupted" ? <p className="race-note">{tr("应用退出时这场赛马还在进行。各赛道的 worktree 里可能留有未提交的改动，可以丢弃，或打开赛道对话查看。", "The app quit while this race was running. Lane worktrees may hold uncommitted changes; discard the race or open a lane's chat to inspect it.")}</p> : null}
        {leftover && race.status === "adopted" ? <p className="race-note" role="status">{tr("采用已完成，但部分赛道的 worktree 还没清理干净。", "The result was adopted, but some lane worktrees were not cleaned up yet.")}</p> : null}
        {message ? (
          <div className={`race-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
            <span>{message.text}</span>
            {message.commit ? <><code>{message.commit}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(message.commit!).catch(() => undefined)}>{tr("复制提交说明", "Copy commit message")}</button></> : null}
          </div>
        ) : null}
      </div>

      <div className="race-lanes-view">
        {race.lanes.map(lane => {
          const active = lane.status === "starting" || lane.status === "running";
          const outcome = outcomes[`${lane.conversationId}:${lane.finishedAt}`] ?? null;
          const elapsed = (lane.finishedAt ?? now) - lane.startedAt;
          const adopted = race.adoptedLaneId === lane.id;
          const laneBadges = badges.get(lane.id) ?? [];
          const canAdopt = finishedAll && Boolean(lane.commitSha) && !lane.worktreeRemovedAt;
          const why = !finishedAll ? tr("等所有赛道结束后才能采用", "Available once every lane has finished") : !lane.commitSha ? tr("这条赛道没有改动", "This lane made no changes") : "";
          return (
            <article key={lane.id} className={`race-lane is-${lane.status}${adopted ? " is-adopted" : ""}${race.status === "adopted" && !adopted ? " is-dropped" : ""}`}>
              <header>
                <h3>{lane.label}</h3>
                <span className={`race-status is-${lane.status}`}>{laneStatusLabel(lane.status)}</span>
              </header>
              <p className="race-lane-model">{lane.resolvedExecution.model.id} · {lane.resolvedExecution.thinkingLevel}</p>
              {adopted ? <span className="race-badge is-adopted">{tr("已采用", "Adopted")}</span> : null}
              {laneBadges.length ? <div className="race-badges">{laneBadges.map(badge => <span key={badge} className="race-badge">{badgeLabel(badge)}</span>)}</div> : null}
              <dl className="race-facts">
                <dt>{tr("耗时", "Time")}</dt><dd>{formatDuration(elapsed)}</dd>
                <dt>Token</dt><dd>{lane.tokens ? formatTokens(lane.tokens.total) : "—"}</dd>
                <dt>{tr("改动", "Changes")}</dt>
                <dd>{lane.diff ? (lane.diff.files === 0 ? tr("无改动", "None") : <>{trf("{0} 个文件", "{0} files", lane.diff.files)} <span className="race-added">+{lane.diff.added}</span> <span className="race-removed">−{lane.diff.removed}</span></>) : "—"}</dd>
                <dt>{tr("统一验证", "Verification")}</dt>
                <dd className={`race-verify is-${lane.verification.state}`}>{verificationText(lane, Boolean(race.verifyCommand))}</dd>
                <dt>{tr("agent 自报验收", "Agent's acceptance")}</dt>
                <dd>{outcome ? <button type="button" className="race-link" onClick={() => onOpenAcceptance(outcome.request)}>{trf("通过 {0} · 待确认 {1}", "Passed {0} · To confirm {1}", outcome.passed, outcome.pending)}</button> : "—"}</dd>
              </dl>
              {lane.verification.outputTail && (lane.verification.state === "failed" || lane.verification.state === "timeout") ? (
                <details className="race-output" open={lane.verification.state === "failed"}>
                  <summary>{tr("验证输出（末尾）", "Verification output (tail)")}</summary>
                  <pre>{lane.verification.outputTail}</pre>
                </details>
              ) : null}
              {lane.error ? <p className="race-lane-error" role="status">{localizeError(lane.error)}</p> : null}
              {lane.changedFiles.length ? (
                <details className="race-files">
                  <summary>{tr("改动的文件", "Changed files")}</summary>
                  <ul>{lane.changedFiles.slice(0, 50).map(path => <li key={path}><code>{path}</code></li>)}{lane.changedFiles.length > 50 ? <li>…</li> : null}</ul>
                </details>
              ) : null}
              <footer>
                {confirming === lane.id ? (
                  <div className="race-confirm">
                    <p>{trf("采用「{0}」：把 {1} 个文件的改动放入暂存区，其余 {2} 条赛道的 worktree 与分支会被删除。", "Adopt “{0}”: stage its changes to {1} files and delete the other {2} lanes' worktrees and branches.", lane.label, lane.diff?.files ?? 0, race.lanes.length - 1)}</p>
                    <button type="button" className="is-primary" disabled={busy} onClick={() => void adopt(lane)}>{tr("确认采用", "Adopt")}</button>
                    <button type="button" disabled={busy} onClick={() => setConfirming(null)}>{tr("取消", "Cancel")}</button>
                  </div>
                ) : (
                  <>
                    {race.status === "ready" || active ? (
                      <button type="button" className="is-primary" disabled={!canAdopt || busy} title={why} onClick={() => setConfirming(lane.id)}>{tr("采用这条", "Adopt this")}</button>
                    ) : null}
                    {active ? <button type="button" disabled={busy} onClick={() => void run(() => api.stopLane(race.id, lane.id))}>{tr("停止", "Stop")}</button> : null}
                    <button type="button" onClick={() => onOpenConversation(lane.conversationId)}>{tr("打开对话", "Open chat")}</button>
                  </>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
