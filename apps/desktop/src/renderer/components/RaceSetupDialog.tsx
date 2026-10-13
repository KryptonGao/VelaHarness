import { raceLimits, type ModelSummary, type Race, type RaceLaneConfig, type RacePreflight, type SandboxMode, type ThinkingLevel } from "@vela/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { useModels } from "../hooks/useModels";
import { localizeError, tr, trf } from "../locale";
import "../race.css";

interface LaneDraft {
  id: string;
  /** `provider/id`；空串表示沿用当前默认模型。 */
  model: string;
  thinkingLevel: ThinkingLevel | "";
  extraPrompt: string;
}

const storageKey = "vela.race.setup";
const sandboxModes: SandboxMode[] = ["ask", "smart", "full"];

const newLane = (): LaneDraft => ({ id: crypto.randomUUID(), model: "", thinkingLevel: "", extraPrompt: "" });

function readRemembered(): { lanes: Omit<LaneDraft, "id">[]; verifyCommand: string } | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lanes?: unknown; verifyCommand?: unknown };
    if (!Array.isArray(parsed.lanes)) return null;
    const lanes = parsed.lanes.slice(0, raceLimits.maxLanes).map(entry => {
      const lane = entry as Partial<LaneDraft>;
      return { model: typeof lane.model === "string" ? lane.model : "", thinkingLevel: (typeof lane.thinkingLevel === "string" ? lane.thinkingLevel : "") as ThinkingLevel | "", extraPrompt: typeof lane.extraPrompt === "string" ? lane.extraPrompt : "" };
    });
    return { lanes, verifyCommand: typeof parsed.verifyCommand === "string" ? parsed.verifyCommand : "" };
  } catch { return null; }
}

function remember(lanes: LaneDraft[], verifyCommand: string): void {
  try { window.localStorage.setItem(storageKey, JSON.stringify({ lanes: lanes.map(({ id: _id, ...rest }) => rest), verifyCommand })); }
  catch { /* 仅为便利，存不下就算了 */ }
}

const sandboxLabel = (mode: SandboxMode): string =>
  mode === "ask" ? tr("每次询问", "Ask every time") : mode === "smart" ? tr("帮我批准", "Smart approve") : tr("完全访问", "Full access");

/** 起名：模型 · 强度，带附加提示时加标记，重名的加序号。 */
export function laneLabels(lanes: readonly LaneDraft[], models: readonly ModelSummary[]): string[] {
  const base = lanes.map(lane => {
    const model = models.find(item => `${item.provider}/${item.id}` === lane.model);
    const parts = [model?.name ?? tr("默认模型", "Default model")];
    if (lane.thinkingLevel) parts.push(lane.thinkingLevel);
    if (lane.extraPrompt.trim()) parts.push(tr("附加提示", "extra prompt"));
    return parts.join(" · ");
  });
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const label of base) total.set(label, (total.get(label) ?? 0) + 1);
  return base.map(label => {
    if ((total.get(label) ?? 0) < 2) return label;
    const index = (seen.get(label) ?? 0) + 1;
    seen.set(label, index);
    return `${label} #${index}`;
  }).map(label => label.slice(0, raceLimits.labelLength));
}

export interface RaceSetupDialogProps {
  workspace: string;
  initialPrompt: string;
  models: ReturnType<typeof useModels>;
  onClose: () => void;
  onStarted: (race: Race) => void;
}

/** 配置一场赛马：同一个任务，N 条赛道各自的模型、思考强度与附加提示，以及可选的统一验证指令。 */
export function RaceSetupDialog({ workspace, initialPrompt, models, onClose, onStarted }: RaceSetupDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const startingRef = useRef(false);
  const headingId = useId();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [lanes, setLanes] = useState<LaneDraft[]>(() => {
    const remembered = readRemembered();
    const saved = remembered?.lanes.length ? remembered.lanes : [{ model: "", thinkingLevel: "" as const, extraPrompt: "" }, { model: "", thinkingLevel: "" as const, extraPrompt: "" }];
    while (saved.length < raceLimits.minLanes) saved.push({ model: "", thinkingLevel: "", extraPrompt: "" });
    return saved.map(lane => ({ ...lane, id: crypto.randomUUID() }));
  });
  const [verifyCommand, setVerifyCommand] = useState(() => readRemembered()?.verifyCommand ?? "");
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>("smart");
  const [preflight, setPreflight] = useState<RacePreflight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const catalog = useMemo(() => (models.catalog?.models ?? []).filter(model => model.available), [models.catalog]);
  const labels = useMemo(() => laneLabels(lanes, catalog), [lanes, catalog]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest("[inert]")) opener.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    window.vela?.races?.preflight(workspace).then(result => {
      if (!active) return;
      setPreflight(result);
      setSandboxMode(result.sandboxMode);
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { active = false; };
  }, [workspace]);

  function patchLane(id: string, patch: Partial<LaneDraft>): void {
    setLanes(current => current.map(lane => lane.id === id ? { ...lane, ...patch } : lane));
  }

  function levelsFor(lane: LaneDraft): ThinkingLevel[] {
    return catalog.find(model => `${model.provider}/${model.id}` === lane.model)?.thinkingLevels ?? [];
  }

  async function start(): Promise<void> {
    const api = window.vela?.races;
    if (!api || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const configs: RaceLaneConfig[] = lanes.map((lane, index) => {
        const model = catalog.find(item => `${item.provider}/${item.id}` === lane.model);
        return {
          id: lane.id, label: labels[index],
          model: model ? { provider: model.provider, id: model.id } : null,
          thinkingLevel: lane.thinkingLevel || null,
          ...(lane.extraPrompt.trim() ? { extraPrompt: lane.extraPrompt.trim() } : {}),
        };
      });
      const race = await api.start({ workspace, prompt: prompt.trim(), lanes: configs, sandboxMode, ...(verifyCommand.trim() ? { verifyCommand: verifyCommand.trim() } : {}) });
      remember(lanes, verifyCommand.trim());
      onStarted(race);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  const blocked = preflight !== null && !preflight.git;
  const canStart = !starting && !blocked && preflight !== null && prompt.trim().length > 0;

  return (
    <dialog
      ref={dialogRef}
      className="race-dialog"
      aria-labelledby={headingId}
      onCancel={event => { event.preventDefault(); if (!startingRef.current) onClose(); }}
      onKeyDown={event => {
        event.stopPropagation();
        const composing = event.nativeEvent.isComposing || event.keyCode === 229;
        if (composing && (event.key === "Enter" || event.key === "Escape")) { event.preventDefault(); return; }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canStart) { event.preventDefault(); void start(); }
      }}
    >
      <header>
        <h2 id={headingId}>{tr("赛马：多路并行尝试", "Race: try several approaches in parallel")}</h2>
        <button type="button" className="race-close" aria-label={tr("关闭", "Close")} disabled={starting} onClick={onClose}>×</button>
      </header>
      <div className="race-dialog-body">
        <p className="race-note">{tr(
          "同一个任务在各自独立的 worktree 里同时运行。结束后并排比较改动、耗时、token 与验证结果，再一键采用其中一条，其余丢弃。",
          "The same task runs in separate worktrees at the same time. When they finish, compare changes, time, tokens and verification side by side, then adopt one and discard the rest.",
        )}</p>

        {blocked ? <p className="race-warning" role="alert">{tr("当前工作区不是 git 仓库，或还没有任何提交，无法赛马。", "This workspace is not a git repository, or has no commits yet, so it cannot race.")}</p> : null}
        {preflight?.git && preflight.dirty ? <p className="race-warning" role="status">{tr(
          "工作区有未提交的改动。各赛道从当前 HEAD 开始，不会带上这些改动；采用时也需要先提交或暂存它们。",
          "The workspace has uncommitted changes. Lanes start from the current HEAD without them, and you will need to commit or stash them before adopting a result.",
        )}</p> : null}

        <label className="race-field">
          <span>{tr("任务", "Task")}</span>
          <textarea value={prompt} rows={4} maxLength={raceLimits.promptLength} onChange={event => setPrompt(event.target.value)} placeholder={tr("描述要完成的任务", "Describe the task to complete")} />
        </label>

        <div className="race-lanes">
          {lanes.map((lane, index) => (
            <fieldset className="race-lane-config" key={lane.id}>
              <legend>{trf("赛道 {0}", "Lane {0}", index + 1)} <em>{labels[index]}</em></legend>
              <div className="race-row">
                <label className="race-field">
                  <span>{tr("模型", "Model")}</span>
                  <select value={lane.model} onChange={event => patchLane(lane.id, { model: event.target.value, thinkingLevel: "" })}>
                    <option value="">{tr("当前默认模型", "Current default model")}</option>
                    {catalog.map(model => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.providerName} · {model.name}</option>)}
                  </select>
                </label>
                <label className="race-field">
                  <span>{tr("思考强度", "Thinking")}</span>
                  <select value={lane.thinkingLevel} onChange={event => patchLane(lane.id, { thinkingLevel: event.target.value as ThinkingLevel | "" })}>
                    <option value="">{tr("默认", "Default")}</option>
                    {levelsFor(lane).map(level => <option key={level} value={level}>{level}</option>)}
                  </select>
                </label>
              </div>
              <label className="race-field">
                <span>{tr("附加提示（选填）", "Extra prompt (optional)")}</span>
                <textarea value={lane.extraPrompt} rows={2} maxLength={raceLimits.extraPromptLength} onChange={event => patchLane(lane.id, { extraPrompt: event.target.value })}
                  placeholder={tr("例如：优先保持改动最小", "For example: keep the change as small as possible")} />
              </label>
              {lanes.length > raceLimits.minLanes ? (
                <button type="button" className="race-remove" onClick={() => setLanes(current => current.filter(item => item.id !== lane.id))}>{tr("移除这条赛道", "Remove this lane")}</button>
              ) : null}
            </fieldset>
          ))}
          {lanes.length < raceLimits.maxLanes ? (
            <button type="button" className="race-add" onClick={() => setLanes(current => [...current, newLane()])}>{tr("添加赛道", "Add lane")}</button>
          ) : null}
        </div>

        <label className="race-field">
          <span>{tr("统一验证指令（选填）", "Common verification command (optional)")}</span>
          <input value={verifyCommand} maxLength={raceLimits.verifyCommandLength} onChange={event => setVerifyCommand(event.target.value)} placeholder="pnpm test" spellCheck={false} />
          <em>{tr("全部赛道结束后，依序在每个赛道的 worktree 里以相同方式执行，结果才可公平比较。", "After all lanes finish, it runs in each lane's worktree one after another in the same way, so results are comparable.")}</em>
        </label>

        <label className="race-field">
          <span>{tr("沙箱模式", "Sandbox mode")}</span>
          <select value={sandboxMode} onChange={event => setSandboxMode(event.target.value as SandboxMode)}>
            {sandboxModes.map(mode => <option key={mode} value={mode}>{sandboxLabel(mode)}</option>)}
          </select>
          {sandboxMode === "ask"
            ? <em className="race-caution">{tr("赛道在后台无人值守运行，需要授权的操作会一直等待你批准。", "Lanes run unattended in the background, so operations that need approval will wait for you.")}</em>
            : null}
        </label>

        {error ? <p className="race-warning" role="alert">{localizeError(error)}</p> : null}
      </div>
      <footer>
        <span className="race-cost">{trf("将同时启动 {0} 个 agent，会消耗 {0} 份 token", "This starts {0} agents at once and uses {0} times the tokens", lanes.length)}</span>
        <button type="button" disabled={starting} onClick={onClose}>{tr("取消", "Cancel")}</button>
        <button type="button" className="is-primary" disabled={!canStart} onClick={() => void start()}>
          {starting ? tr("正在启动…", "Starting…") : tr("开始赛马", "Start race")}
        </button>
      </footer>
    </dialog>
  );
}
