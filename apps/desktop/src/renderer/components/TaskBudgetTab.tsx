import { formatTaskBudgetDuration, formatTaskBudgetTokens, type ConversationTaskBudget, type TaskBudgetSettings, type TaskBudgetState } from "@vela/shared";
import { useCallback, useEffect, useState } from "react";
import { localizeError, tr, trf, useAppLocale } from "../locale";
import { settingsCopy } from "./settings-copy";
import { TaskBudgetFields } from "./settings/TaskBudgetFields";

function describe(settings: TaskBudgetSettings): string {
  if (!settings.enabled) return tr("未启用", "Off");
  const parts: string[] = [];
  if (settings.maxMinutes !== null) parts.push(trf("{0} 分钟", "{0} min", settings.maxMinutes));
  if (settings.maxTokens !== null) parts.push(`${formatTaskBudgetTokens(settings.maxTokens)} Token`);
  return parts.join(" · ");
}

const phaseLabels = {
  ok: ["进行中", "In progress"],
  warning: ["接近上限", "Near limit"],
  exhausted: ["已到上限", "Limit reached"],
} as const;

function Stat({ label, used, limit, value, max }: { label: string; used: number; limit: number | null; value: string; max: string }) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  return <div className="tb-stat">
    <span className="tb-stat-label">{label}</span>
    <div className="tb-stat-value">
      <strong>{value}</strong>
      <span>{limit === null ? tr("不限", "No limit") : `/ ${max}`}</span>
    </div>
    <div className="tb-bar" aria-hidden="true">
      <span data-level={ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok"} style={{ width: `${ratio * 100}%` }} />
    </div>
  </div>;
}

function CurrentTask({ budget }: { budget: TaskBudgetState | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  const live = budget !== null && budget !== undefined && budget.phase !== "exhausted";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  if (!budget) return <p className="tb-empty">{tr("当前没有进行中的任务，或没有启用上限。", "No task is running, or no limit is enabled.")}</p>;
  const elapsed = (budget.exhaustedAt ?? now) - budget.startedAt;
  const [zh, en] = phaseLabels[budget.phase];
  return <>
    <span className="tb-pill" data-phase={budget.phase}>{tr(zh, en)}</span>
    <div className="tb-stats">
      <Stat label="Token" used={budget.tokensUsed} limit={budget.maxTokens} value={formatTaskBudgetTokens(budget.tokensUsed)} max={formatTaskBudgetTokens(budget.maxTokens ?? 0)} />
      <Stat label={tr("时间", "Time")} used={elapsed} limit={budget.maxMs} value={formatTaskBudgetDuration(elapsed)} max={formatTaskBudgetDuration(budget.maxMs ?? 0)} />
    </div>
  </>;
}

/** 「用量限制」标签页：只管当前对话的上限，并显示当前任务的实时用量。 */
export function TaskBudgetTab({ conversationId, budget }: { conversationId: string | null; budget: TaskBudgetState | null | undefined }) {
  const text = settingsCopy(useAppLocale()).agent;
  const [state, setState] = useState<ConversationTaskBudget | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 默认就是「本对话自定义」：先用全局值作为起点，调整之后才写成这个对话自己的设置。
  const [followGlobal, setFollowGlobal] = useState(false);

  useEffect(() => {
    const api = window.vela;
    if (!api || !conversationId) return;
    let active = true;
    setState(null);
    setFollowGlobal(false);
    void api.getConversationTaskBudget(conversationId).then(
      (loaded) => { if (active) setState(loaded); },
      (caught: unknown) => { if (active) setError(localizeError(caught instanceof Error ? caught.message : String(caught))); },
    );
    return () => { active = false; };
  }, [conversationId]);

  const save = useCallback(async (next: TaskBudgetSettings | null) => {
    const api = window.vela;
    if (!api || !conversationId) return;
    setState(await api.setConversationTaskBudget(conversationId, next));
    setError(null);
  }, [conversationId]);

  const custom = !followGlobal;
  return <div className="tb-tab">
    <div className="tb-inner">
      <header className="tb-header">
        <h2>{tr("用量限制", "Usage limit")}</h2>
        <p>{tr("为当前对话设置一次任务的时间与 Token 上限，统计包含子代理。这里的设置只对当前对话生效，不影响其他对话。",
          "Set a time and token limit for a single task in this conversation, subagents included. These settings apply to this conversation only.")}</p>
      </header>
      <section className="tb-card">
        <div className="tb-card-head"><h3>{tr("当前任务", "Current task")}</h3></div>
        <CurrentTask budget={budget} />
      </section>
      <section className="tb-card">
        <div className="tb-card-head"><h3>{tr("上限来源", "Limit source")}</h3></div>
        <div className="tb-seg" role="radiogroup" aria-label={tr("上限来源", "Limit source")}>
          {([["custom", tr("本对话自定义", "Custom for this chat")], ["global", tr("沿用全局设置", "Use global setting")]] as const).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={(custom ? "custom" : "global") === id} data-active={(custom ? "custom" : "global") === id ? "true" : undefined}
              onClick={() => {
                if (!state) return;
                setFollowGlobal(id === "global");
                if (id === "custom") return;
                void save(null).catch((caught: unknown) => setError(localizeError(caught instanceof Error ? caught.message : String(caught))));
              }}>{label}</button>
          ))}
        </div>
        {state && !custom ? <p className="tb-note">{trf("全局设置：{0}。可在 设置 › 默认与权限 中修改。", "Global setting: {0}. Change it under Settings › Defaults & permissions.", describe(state.global))}</p> : null}
        {state && custom ? <>
          {state.override === null
            ? <p className="tb-note">{tr("调整后才会保存为本对话的设置，在此之前仍沿用全局值。", "Your changes are saved as this chat's own setting. Until then the global values apply.")}</p>
            : null}
          <TaskBudgetFields text={text} value={state.override ?? state.global} onCommit={save} />
        </> : null}
        {error ? <p className="settings-error">{error}</p> : null}
      </section>
    </div>
  </div>;
}
