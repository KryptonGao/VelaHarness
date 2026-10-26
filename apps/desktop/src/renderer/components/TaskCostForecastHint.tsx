import { formatCost, type SessionSnapshot, type TaskCostForecast } from "@vela/shared";
import { useEffect, useState } from "react";
import { activeIntlLocale, tr, trf } from "../locale";
import { useModelPrices } from "../model-prices";

const dismissedKey = "vela.taskCostForecast.dismissed";

function readDismissed(): boolean {
  try { return window.localStorage.getItem(dismissedKey) === "1"; } catch { return false; }
}

function money(forecast: TaskCostForecast, amount: number): string {
  return formatCost({ [forecast.currency]: amount }, activeIntlLocale()) ?? "";
}

/**
 * 开跑前的费用预估：按同类历史任务的实际用量，用现在登记的价格换算。
 * 样本不足、没登记价格时什么都不显示，不给没有依据的数。任务进行中和到达上限后不显示。
 */
export function TaskCostForecastHint({ session }: { session: SessionSnapshot | null | undefined }) {
  const prices = useModelPrices();
  const [forecast, setForecast] = useState<TaskCostForecast | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const conversationId = session?.id ?? null;
  const idle = session?.status === "ready" && (!session.taskBudget || session.taskBudget.phase === "ok");
  // 任务结束、换模型或改价格后重新取；切换对话时先清掉旧值，避免短暂显示别的对话的预估。
  const key = `${conversationId}|${session?.modelProvider}/${session?.modelId}|${idle}|${prices.length}`;
  useEffect(() => {
    const api = window.vela;
    setForecast(null);
    if (!api || !conversationId || !idle || dismissed) return;
    let active = true;
    void api.estimateTaskCost(conversationId).then(
      (next) => { if (active) setForecast(next); },
      () => undefined,
    );
    return () => { active = false; };
  }, [key, dismissed]);
  if (!forecast || !idle || dismissed) return null;
  const dismiss = () => {
    try { window.localStorage.setItem(dismissedKey, "1"); } catch { /* 存不下就只在本次运行内隐藏 */ }
    setDismissed(true);
  };
  const over = forecast.limit !== null && forecast.median >= forecast.limit;
  return <aside className="task-cost-forecast" data-over={over ? "true" : undefined} role="status">
    <span>{trf("预估费用约 {0}（常见 {1} – {2}）", "Estimated cost about {0} (usually {1} – {2})",
      money(forecast, forecast.median), money(forecast, forecast.low), money(forecast, forecast.high))}</span>
    <span className="task-cost-forecast-basis">
      {trf("依据最近 {0} 个同类任务", "Based on the last {0} similar tasks", forecast.samples)}
      {forecast.sameModel ? "" : ` · ${tr("含其他模型，按现价换算", "includes other models, repriced at current prices")}`}
    </span>
    {over ? <strong>{trf("已达本任务的费用上限 {0}", "At the task cost limit of {0}", money(forecast, forecast.limit!))}</strong> : null}
    <button type="button" className="task-cost-forecast-close" onClick={dismiss}
      aria-label={tr("关闭", "Close")} title={tr("关闭，不再显示费用预估", "Close and stop showing cost estimates")}>×</button>
  </aside>;
}
