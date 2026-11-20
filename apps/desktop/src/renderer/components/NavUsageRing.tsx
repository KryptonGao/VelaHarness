import type { UsageLimits, UsageLimitWindow } from "@vela/shared";
import { useEffect, useId, useState } from "react";
import { useDismissable } from "../hooks/useDismissable";
import { tr, trf } from "../locale";
import { PopoverPresence } from "./MotionPresence";
import { percentText, planName, remainingPercent, remainingTone, resetText, usageRingArcs, usageRingLayout, windowLabel, type UsageRingLayout } from "./usage-limit-format";
import "../usage-limit.css";

const radius = 9.5;
const center = 12;

function point(degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  return `${(center + radius * Math.sin(radians)).toFixed(3)} ${(center - radius * Math.cos(radians)).toFixed(3)}`;
}

function arcPath([from, to]: [number, number]): string {
  return `M ${point(from)} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

/** 一段弧：先画底轨，再按剩余额度画进度（pathLength=100，不用自己算弧长）。 */
function Arc({ path, window, threshold }: { path: string; window: UsageLimitWindow; threshold: number }) {
  const remaining = remainingPercent(window.usedPercent);
  return <>
    <path className="nav-usage-track" d={path} pathLength={100} />
    {remaining > 0 ? <path className="nav-usage-value" d={path} pathLength={100} strokeDasharray={`${remaining} 100`} data-tone={remainingTone(window.usedPercent, threshold)} /> : null}
  </>;
}

function Ring({ layout, threshold }: { layout: UsageRingLayout; threshold: number }) {
  if (layout.kind === "single") {
    const remaining = remainingPercent(layout.window.usedPercent);
    return <svg className="nav-usage-ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="nav-usage-track" cx={center} cy={center} r={radius} />
      {remaining > 0 ? <circle className="nav-usage-value" cx={center} cy={center} r={radius} pathLength={100} strokeDasharray={`${remaining} 100`}
        transform={`rotate(-90 ${center} ${center})`} data-tone={remainingTone(layout.window.usedPercent, threshold)} /> : null}
    </svg>;
  }
  const arcs = usageRingArcs();
  return <svg className="nav-usage-ring" viewBox="0 0 24 24" aria-hidden="true">
    <Arc path={arcPath(arcs.short)} window={layout.short} threshold={threshold} />
    <Arc path={arcPath(arcs.long)} window={layout.long} threshold={threshold} />
  </svg>;
}

function Row({ window, threshold }: { window: UsageLimitWindow; threshold: number }) {
  const remaining = remainingPercent(window.usedPercent);
  return <div className="usage-row" data-tone={remainingTone(window.usedPercent, threshold)}>
    <div className="usage-row-head">
      <span className="usage-row-label">{windowLabel(window.windowMinutes)}</span>
      <span className="usage-row-percent">{trf("剩余 {0}", "{0} left", percentText(remaining))}</span>
    </div>
    <div className="usage-bar" role="progressbar" aria-label={windowLabel(window.windowMinutes)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remaining)}>
      <div className="usage-bar-fill" style={{ width: `${Math.min(100, Math.max(remaining > 0 ? 1.5 : 0, remaining))}%` }} />
    </div>
    {window.resetsAt !== null ? <span className="usage-row-reset">{resetText(window.resetsAt)}</span> : null}
  </div>;
}

/** 导航栏设置上方的 Codex 剩余额度圆环；点击在右侧展开各额度窗口的详情。 */
export function NavUsageRing({ limits, threshold, onOpen }: { limits: UsageLimits; threshold: number; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const root = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const layout = usageRingLayout(limits);
  // 额度被读到之后重新进入无数据状态时，别留着一个悬空的弹窗。
  useEffect(() => { if (!layout) setOpen(false); }, [layout]);
  if (!layout) return null;
  const plan = planName(limits.plan);
  const summary = layout.kind === "split"
    ? trf("Codex 剩余额度：5 小时 {0}，每周 {1}", "Codex usage left: 5-hour {0}, weekly {1}",
      percentText(remainingPercent(layout.short.usedPercent)), percentText(remainingPercent(layout.long.usedPercent)))
    : trf("Codex 剩余额度 {0}", "Codex usage left: {0}", percentText(remainingPercent(layout.window.usedPercent)));
  return <div ref={root} className="nav-usage">
    <button type="button" className="nav-rail-item nav-usage-button" title={summary} aria-label={summary} data-tooltip
      aria-haspopup="true" aria-controls={popoverId} aria-expanded={open}
      onClick={() => { if (!open) onOpen?.(); setOpen((current) => !current); }}>
      <Ring layout={layout} threshold={threshold} />
    </button>
    <PopoverPresence present={open}>
      <div id={popoverId} className="dock-popover nav-usage-popover" role="group" aria-label={tr("Codex 额度", "Codex usage")}>
        <div className="usage-popover-heading">{tr("套餐额度", "Plan usage limits")}{plan ? ` · ${plan}` : ""}</div>
        {limits.windows.map((window) => <Row key={window.windowMinutes} window={window} threshold={threshold} />)}
      </div>
    </PopoverPresence>
  </div>;
}
