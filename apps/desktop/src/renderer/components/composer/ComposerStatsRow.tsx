import { useEffect, useState } from "react";
import type { ContextUsage } from "@vela/shared";
import { ContextUsageTrigger } from "../ContextUsagePopover";
import { COMPOSER_STAT_ROTATE_MS, composerStats } from "./composer-stats";
import { tr } from "../../locale";

/**
 * 输入框下方的会话统计条：输出速度、缓存命中率与 token 总量（每 30 秒轮流展示）、上下文占用环。
 * 没有数据的分组整个不渲染，全部缺失时整条隐藏。
 */
export function ComposerStatsRow({ usage, contextPopover = false }: {
  usage: ContextUsage | undefined | null;
  contextPopover?: boolean;
}) {
  // tok/s 是常驻信息：新对话也保留位置，不会让整条统计只剩占用环。
  const stats = composerStats(usage, { alwaysShowSpeed: true });
  const hasGroup = Boolean(stats.speed || stats.rotating.length > 0 || stats.percentLabel || contextPopover);
  if (!hasGroup) return null;

  return (
    <div className="composer-stats-row" role="group" aria-label={tr("会话统计", "Chat stats")}>
      {stats.speed ? (
        <span className="composer-stat" title={stats.speed}>
          <span className="composer-stat-text">{stats.speed}</span>
        </span>
      ) : null}
      {stats.rotating.length > 0 ? (
        <span className="composer-stat">
          <span className="composer-stat-icon" aria-hidden="true"><TokenStackIcon /></span>
          <RotatingText items={stats.rotating} />
        </span>
      ) : null}
      {contextPopover ? (
        <ContextUsageTrigger usage={usage} high={(stats.percent ?? 0) >= 80}>
          <ContextRing percent={stats.percent ?? 0} />
          <span className="composer-stat-text">{stats.percentLabel ?? (usage?.tokens ? "—" : "0%")}</span>
        </ContextUsageTrigger>
      ) : stats.percentLabel ? (
        <span
          className={`composer-stat composer-stat-context${(stats.percent ?? 0) >= 80 ? " high" : ""}`}
          title={`${tr("上下文占用", "Context used")} ${stats.percentLabel}`}
        >
          <ContextRing percent={stats.percent ?? 0} />
          <span className="composer-stat-text">{stats.percentLabel}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * 几项文字在同一位置定时轮流展示。所有项叠在同一个网格格子里，宽度取最宽的一项，
 * 切换时不会挤动旁边的统计；进出用淡入淡出加轻微上下位移表现。
 */
function RotatingText({ items }: { items: string[] }) {
  const [tick, setTick] = useState(0);
  const count = items.length;
  useEffect(() => {
    if (count < 2) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), COMPOSER_STAT_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [count]);
  const active = tick % count;
  return (
    <span className="composer-stat-rotator" title={items[active]}>
      {items.map((text, index) => (
        <span
          key={index}
          className={`composer-stat-text composer-stat-rotator-item${index === active ? " is-active" : ""}`}
          aria-hidden={index === active ? undefined : true}
        >
          {text}
        </span>
      ))}
    </span>
  );
}

/** 占用环：底圈固定，进度圈用 dashoffset 表现百分比。 */
function ContextRing({ percent }: { percent: number }) {
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, percent / 100));
  const offset = circumference * (1 - clamped);
  return (
    <span className="composer-stat-ring" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14">
        <circle className="composer-stat-ring-track" cx="7" cy="7" r={radius} />
        <circle
          className="composer-stat-ring-progress"
          cx="7"
          cy="7"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
    </span>
  );
}

function TokenStackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="6" rx="8" ry="3.2" />
      <path d="M4 6v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V6" />
      <path d="M4 12v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-6" />
    </svg>
  );
}
