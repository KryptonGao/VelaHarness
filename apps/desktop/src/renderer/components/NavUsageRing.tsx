import type { UsageLimits, UsageLimitWindow } from "@vela/shared";
import { useEffect, useId, useState } from "react";
import { useDismissable } from "../hooks/useDismissable";
import type { UsageRingPrefs } from "../hooks/useUsageRingPrefs";
import { tr, trf } from "../locale";
import { PopoverPresence } from "./MotionPresence";
import { percentText, planName, remainingPercent, remainingTone, resetText, usageRingArcs, usageRingLayout, windowLabel, type UsageRingLayout } from "./usage-limit-format";
import "../usage-limit.css";

// Both outlines start at the top and run clockwise. Progress follows the outline itself.
const circleOutline = "M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19Z";
// The reference mark has six equal-radius lobes. The first lobe straddles the progress origin.
const codexOutline = `M10.47 .86
  A5.38 5.38 0 0 1 14.51 2.69
  A5.38 5.38 0 0 1 21.32 9.52
  A5.38 5.38 0 0 1 18.80 18.83
  A5.38 5.38 0 0 1 9.49 21.31
  A5.38 5.38 0 0 1 2.68 14.48
  A5.38 5.38 0 0 1 5.20 5.17
  A5.38 5.38 0 0 1 10.47 .86 Z`;

function OutlineProgress({ path, window, threshold, arc = [0, 360] }: {
  path: string;
  window: UsageLimitWindow;
  threshold: number;
  arc?: [number, number];
}) {
  const [start, end] = arc;
  const span = (end - start) / 360 * 100;
  const value = remainingPercent(window.usedPercent) / 100 * span;
  return <g strokeDashoffset={-start / 360 * 100}>
    <path className="nav-usage-track" d={path} pathLength={100} strokeDasharray={span < 100 ? `${span} ${100 - span}` : undefined} />
    {value > 0 && <path className="nav-usage-value" d={path} pathLength={100} strokeDasharray={`${value} ${100 - value}`}
      data-tone={remainingTone(window.usedPercent, threshold)} />}
  </g>;
}

function Ring({ layout, threshold, showCodexLogo }: { layout: UsageRingLayout; threshold: number; showCodexLogo: boolean }) {
  const path = showCodexLogo ? codexOutline : circleOutline;
  const arcs = usageRingArcs();
  return <svg className="nav-usage-ring" data-logo={showCodexLogo} viewBox="0 0 24 24" aria-hidden="true">
    {layout.kind === "single"
      ? <OutlineProgress path={path} window={layout.window} threshold={threshold} />
      : <>
        <OutlineProgress path={path} window={layout.short} threshold={threshold} arc={arcs.short} />
        <OutlineProgress path={path} window={layout.long} threshold={threshold} arc={arcs.long} />
      </>}
    {showCodexLogo && <path className="nav-usage-prompt" d="M6.6 8.8 7.92 10.98Q8.68 12.13 8.02 13.27L6.55 15.55 M12.75 15.42H17.30" />}
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
export function NavUsageRing({ limits, prefs, onOpen }: { limits: UsageLimits; prefs: UsageRingPrefs; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const root = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const { threshold, showCodexLogo } = prefs;
  const layout = usageRingLayout(limits, prefs.plusWindow);
  // 额度被读到之后重新进入无数据状态时，别留着一个悬空的弹窗。
  useEffect(() => { if (!layout) setOpen(false); }, [layout]);
  if (!layout) return null;
  const plan = planName(limits.plan);
  const summary = layout.kind === "split"
    ? trf("Codex 剩余额度：5 小时 {0}，每周 {1}", "Codex usage left: 5-hour {0}, weekly {1}",
      percentText(remainingPercent(layout.short.usedPercent)), percentText(remainingPercent(layout.long.usedPercent)))
    : trf("Codex {0}，剩余 {1}", "Codex {0}, {1} left", windowLabel(layout.window.windowMinutes), percentText(remainingPercent(layout.window.usedPercent)));
  return <div ref={root} className="nav-usage">
    <button type="button" className="nav-rail-item nav-usage-button" title={summary} aria-label={summary} data-tooltip
      aria-haspopup="true" aria-controls={popoverId} aria-expanded={open}
      onClick={() => { if (!open) onOpen?.(); setOpen((current) => !current); }}>
      <Ring layout={layout} threshold={threshold} showCodexLogo={showCodexLogo} />
    </button>
    <PopoverPresence present={open}>
      <div id={popoverId} className="dock-popover nav-usage-popover" role="group" aria-label={tr("Codex 额度", "Codex usage")}>
        <div className="usage-popover-heading">{tr("套餐额度", "Plan usage limits")}{plan ? ` · ${plan}` : ""}</div>
        {limits.windows.map((window) => <Row key={window.windowMinutes} window={window} threshold={threshold} />)}
      </div>
    </PopoverPresence>
  </div>;
}
