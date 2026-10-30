import type { UsageLimits, UsageLimitWindow } from "@vela/shared";
import { useId } from "react";
import { tr, trf } from "../locale";
import { PopoverPresence } from "./MotionPresence";
import { peakUsedPercent, percentText, planName, resetText, usageTone, windowLabel } from "./usage-limit-format";
import "../usage-limit.css";

function Ring({ percent }: { percent: number }) {
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="usage-ring" viewBox="0 0 18 18" aria-hidden="true">
      <circle className="usage-ring-track" cx="9" cy="9" r={radius} />
      <circle
        className="usage-ring-value"
        cx="9"
        cy="9"
        r={radius}
        strokeDasharray={`${(Math.min(100, percent) / 100) * circumference} ${circumference}`}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

function Row({ window }: { window: UsageLimitWindow }) {
  const percent = window.usedPercent;
  return (
    <div className="usage-row" data-tone={usageTone(percent)}>
      <div className="usage-row-head">
        <span className="usage-row-label">{windowLabel(window.windowMinutes)}</span>
        <span className="usage-row-reset">{resetText(window.resetsAt)}</span>
        <span className="usage-row-percent">{percentText(percent)}</span>
      </div>
      <div
        className="usage-bar"
        role="progressbar"
        aria-label={windowLabel(window.windowMinutes)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className="usage-bar-fill" style={{ width: `${Math.min(100, Math.max(percent > 0 ? 1.5 : 0, percent))}%` }} />
      </div>
    </div>
  );
}

/** 模型名称右侧的额度圆环；点击展开各额度窗口的用量和重置时间。 */
export function UsageLimitMenu({ limits, open, onToggle }: { limits: UsageLimits; open: boolean; onToggle: () => void }) {
  const popoverId = useId();
  const peak = peakUsedPercent(limits);
  const plan = planName(limits.plan);
  const summary = trf("额度已用 {0}", "{0} of usage limit used", percentText(peak));
  return (
    <div className="dock-menu usage-menu">
      <button
        type="button"
        className="usage-ring-button"
        data-tone={usageTone(peak)}
        title={summary}
        aria-label={summary}
        aria-haspopup="true"
        aria-controls={popoverId}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Ring percent={peak} />
      </button>
      <PopoverPresence present={open}>
        <div id={popoverId} className="dock-popover usage-popover" role="group" aria-label={tr("套餐额度", "Plan usage limits")}>
          <div className="usage-popover-heading">
            {tr("套餐额度", "Plan usage limits")}
            {plan ? ` · ${plan}` : ""}
          </div>
          {limits.windows.map((window) => <Row key={window.windowMinutes} window={window} />)}
        </div>
      </PopoverPresence>
    </div>
  );
}
