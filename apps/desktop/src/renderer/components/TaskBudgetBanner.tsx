import { formatCost, formatTaskBudgetDuration, formatTaskBudgetTokens, type TaskBudgetState } from "@vela/shared";
import { useContext, useEffect, useState } from "react";
import { activeIntlLocale, tr, trf } from "../locale";
import { RecipeActionsContext } from "./recipe-actions-context";

function usageLine(budget: TaskBudgetState, elapsedMs: number): string {
  const parts: string[] = [];
  if (budget.maxTokens !== null) parts.push(`${formatTaskBudgetTokens(budget.tokensUsed)} / ${formatTaskBudgetTokens(budget.maxTokens)} Token`);
  if (budget.maxMs !== null) parts.push(`${formatTaskBudgetDuration(elapsedMs)} / ${formatTaskBudgetDuration(budget.maxMs)}`);
  if (budget.maxCost !== null && budget.costUsed !== null) {
    const { currency, amount } = budget.maxCost;
    const locale = activeIntlLocale();
    parts.push(`${formatCost({ [currency]: budget.costUsed }, locale)} / ${formatCost({ [currency]: amount }, locale)}`);
  }
  return parts.join(" · ");
}

/** 有模型没能计入费用时说明一下，免得把「没超」当成「花得少」。 */
export function uncountedNote(budget: TaskBudgetState): string | null {
  if (budget.maxCost === null || budget.uncountedModels === 0) return null;
  return trf("有 {0} 个模型没有登记 {1} 价格，没有计入费用，实际花费可能更高。",
    "{0} model(s) have no {1} price and are not counted, so the real spend may be higher.", budget.uncountedModels, budget.maxCost.currency);
}

/**
 * 任务用量提示：接近上限时提醒；到达上限后说明已停止新增模型请求，
 * 并提供不调用模型的交接整理入口。
 */
export function TaskBudgetBanner({ budget, conversationId }: { budget: TaskBudgetState | null | undefined; conversationId: string | null | undefined }) {
  const actions = useContext(RecipeActionsContext);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<number | null>(null);
  const live = budget?.phase === "warning";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  if (!budget || budget.phase === "ok") return null;
  const exhausted = budget.phase === "exhausted";
  if (!exhausted && dismissed === budget.startedAt) return null;
  const elapsed = (exhausted ? budget.exhaustedAt ?? now : now) - budget.startedAt;
  const reason = budget.reason === "time" ? tr("时间", "time") : budget.reason === "cost" ? tr("费用", "cost") : "Token";
  const uncounted = uncountedNote(budget);
  return <aside className={`task-budget-banner${exhausted ? " exhausted" : ""}`} role={exhausted ? "alert" : "status"} aria-live="polite">
    <span className="task-budget-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="8" cy="8" r="6.2" /><path d="M8 4.8V8.4" /><circle cx="8" cy="11" r="0.5" fill="currentColor" />
      </svg>
    </span>
    <div className="task-budget-text">
      <strong>{exhausted
        ? trf("已到任务用量上限（{0}）", "Task usage limit reached ({0})", reason)
        : tr("任务用量接近上限", "Task usage is near its limit")}</strong>
      <span>{exhausted
        ? tr("已停止新增模型请求，子代理也已停止。可以整理交接后在新对话里继续，或直接发送新消息开始新的任务。",
          "New model requests have stopped, including subagents. Prepare a handoff to continue in a new conversation, or send a message to start a new task.")
        : tr("到达上限后会停止新增模型请求并整理交接。统计包含子代理。",
          "At the limit, new model requests stop and a handoff is prepared. Subagents are included.")}</span>
      <span className="task-budget-usage">{usageLine(budget, elapsed)}</span>
      {uncounted ? <span>{uncounted}</span> : null}
    </div>
    <div className="task-budget-actions">
      {exhausted && conversationId && actions?.createHandoff
        ? <button className="primary-btn" type="button" onClick={() => actions.createHandoff?.(conversationId, { factsOnly: true })}>{tr("整理交接", "Prepare handoff")}</button>
        : null}
      {exhausted ? null : <button className="settings-secondary" type="button" onClick={() => setDismissed(budget.startedAt)}>{tr("知道了", "Dismiss")}</button>}
    </div>
  </aside>;
}
