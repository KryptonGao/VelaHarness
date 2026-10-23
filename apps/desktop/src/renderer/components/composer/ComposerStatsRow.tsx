import type { ContextUsage } from "@vela/shared";
import { ContextUsageTrigger } from "../ContextUsagePopover";
import { composerStats } from "./composer-stats";
import { tr } from "../../locale";

/**
 * 输入框下方的会话统计条：输出速度、累计 token 与缓存命中率、上下文占用环。
 * 没有数据的分组整个不渲染，全部缺失时整条隐藏。
 */
export function ComposerStatsRow({ usage, contextPopover = false, part }: {
  usage: ContextUsage | undefined | null;
  contextPopover?: boolean;
  /** 只渲染一部分：activity 为输出速度，usage 为累计 token 与上下文占用；不传则全部渲染。 */
  part?: "activity" | "usage";
}) {
  // tok/s 是常驻信息：新对话也保留位置，不会让整条统计只剩占用环。
  const stats = composerStats(usage, { alwaysShowActivity: true });
  const showActivity = part !== "usage";
  const showUsage = part !== "activity";
  const hasGroup = Boolean((showActivity && stats.activity) || (showUsage && (stats.tokens || stats.percentLabel || contextPopover)));
  if (!hasGroup) return null;

  return (
    <div className="composer-stats-row" role="group" aria-label={tr("会话统计", "Chat stats")}>
      {showActivity && stats.activity ? (
        <span className="composer-stat" title={stats.activity}>
          <span className="composer-stat-text">{stats.activity}</span>
        </span>
      ) : null}
      {showUsage && stats.tokens ? (
        <span className="composer-stat" title={stats.tokens}>
          <span className="composer-stat-icon" aria-hidden="true"><TokenStackIcon /></span>
          <span className="composer-stat-text">{stats.tokens}</span>
        </span>
      ) : null}
      {!showUsage ? null : contextPopover ? (
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
