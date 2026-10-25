import type { RecommendedAction, RecommendedActions } from "@vela/shared";
import { useState } from "react";
import { CloseIcon } from "./icons";
import { tr } from "../locale";

/**
 * 一轮结束后模型推荐的后续操作。点击按钮把模型写好的 prompt 作为下一条用户消息发出;
 * 发送失败时卡片保留，可以重试或关闭。
 */
export function RecommendedActionsCard({
  recommendation,
  onSelect,
  onDismiss,
}: {
  recommendation: RecommendedActions;
  /** 返回 false 或抛错表示没有发出去。 */
  onSelect: (action: RecommendedAction) => Promise<void | boolean>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function select(action: RecommendedAction): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if ((await onSelect(action)) === false) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="recommended-actions" aria-label={tr("推荐操作", "Recommended actions")}>
      <button
        type="button"
        className="recommended-actions-close"
        aria-label={tr("关闭推荐操作", "Dismiss recommended actions")}
        title={tr("关闭", "Close")}
        onClick={onDismiss}
      >
        <CloseIcon size={14} />
      </button>
      <p className="recommended-actions-question">{recommendation.question}</p>
      <div className="recommended-actions-buttons" role="group" aria-label={tr("推荐操作", "Recommended actions")}>
        {recommendation.actions.map((action, index) => (
          <button
            type="button"
            key={`${index}:${action.label}`}
            className={`recommended-action${index === 0 ? " is-primary" : ""}`}
            title={action.prompt}
            disabled={busy}
            onClick={() => void select(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {failed ? <p className="recommended-actions-error" role="alert">{tr("没有发送成功，请重试", "Not sent. Try again.")}</p> : null}
    </section>
  );
}
