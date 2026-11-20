import type { ContextUsage } from "@vela/shared";
import { ContextUsageTrigger } from "../ContextUsagePopover";
import { composerStats } from "./composer-stats";
import { tr } from "../../locale";
import { Icon } from "../icons";

/** 输入框下方并列展示输出速度、缓存命中率、累计 token 和上下文占用环。 */
export function ComposerStatsRow({ usage, contextPopover = false }: {
  usage: ContextUsage | undefined | null;
  contextPopover?: boolean;
}) {
  // tok/s 是常驻信息：新对话也保留位置，不会让整条统计只剩占用环。
  const stats = composerStats(usage, { alwaysShowSpeed: true });

  return (
    <div className="composer-stats-row" role="group" aria-label={tr("会话统计", "Chat stats")}>
      {stats.speed ? (
        <span className="composer-stat composer-stat-speed" title={stats.speed}>
          <span className="composer-stat-text">{stats.speed}</span>
        </span>
      ) : null}
      {stats.cacheHit ? (
        <span className="composer-stat composer-stat-cache" title={stats.cacheHit}>
          <span className="composer-stat-icon" aria-hidden="true"><Icon name="stack" size={14} /></span>
          <span className="composer-stat-text">{stats.cacheHit}</span>
        </span>
      ) : null}
      {stats.total ? (
        <span className="composer-stat composer-stat-total" title={stats.total}>
          <span className="composer-stat-text">{stats.total}</span>
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
