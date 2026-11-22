import { useEffect, type ReactNode } from "react";
import { tr, trf } from "../locale";
import { modKeyLabel } from "../platform";
import { useSidebarItems } from "../hooks/useSidebarItems";
import { quotaProviderId, usageLimitProvider, useUsageLimits } from "../hooks/useUsageLimits";
import { useUsageRingPrefs } from "../hooks/useUsageRingPrefs";
import "../nav-rail.css";
import { Icon } from "./icons";
import { NavUsageRing } from "./NavUsageRing";

export type NavCategory = "home" | "scheduledTasks" | "recipes" | "agentInbox" | "prInbox" | "settings";

interface NavRailProps {
  active: NavCategory;
  modelProvider?: string | null;
  platform: string;
  /** 需要用户处理的事项数；为 0 时不显示徽标。 */
  agentInboxBadge: number;
  onSelect: (category: NavCategory) => void;
}

/** 分类视图最左侧的图标栏：主页是「侧栏 + 对话」，其余分类各占整块内容区。 */
export function NavRail({ active, modelProvider, platform, agentInboxBadge, onSelect }: NavRailProps) {
  const items = useSidebarItems();
  const usageRing = useUsageRingPrefs();
  // 关掉圆环后不再请求额度接口。
  const usage = useUsageLimits(usageRing.enabled ? quotaProviderId(modelProvider) ?? usageLimitProvider : null);
  const refreshUsage = usage.refresh;
  // 切回窗口时补读一次，圆环不用等下一个 5 分钟周期。
  useEffect(() => {
    window.addEventListener("focus", refreshUsage);
    return () => window.removeEventListener("focus", refreshUsage);
  }, [refreshUsage]);
  const mod = modKeyLabel(platform);
  const button = (category: NavCategory, label: string, glyph: ReactNode, options: { badge?: number; title?: string } = {}) => {
    const badge = options.badge ?? 0;
    return <button key={category} className="nav-rail-item" type="button" title={options.title ?? label} data-tooltip
      aria-label={badge > 0 ? trf("{0}，{1} 项需要处理", "{0}, {1} need your attention", label, badge) : label}
      aria-current={active === category ? "page" : undefined} onClick={() => onSelect(category)}>
      <span className="nav-rail-icon">{glyph}</span>
      {badge > 0 ? <span className="nav-rail-badge" aria-hidden="true">{badge > 9 ? "9+" : badge}</span> : null}
    </button>;
  };
  return <nav className="nav-rail" aria-label={tr("分类", "Categories")}>
    <div className="nav-rail-titlebar" />
    <div className="nav-rail-group">
      {button("home", tr("主页", "Home"), <Icon name="home" size={18} filled={active === "home"} />)}
      {items.scheduledTasks ? button("scheduledTasks", tr("定时任务", "Scheduled Tasks"), <Icon name="clock" size={18} filled={active === "scheduledTasks"} />) : null}
      {items.recipes ? button("recipes", tr("任务配方", "Task Recipes"), <Icon name="clipboard" size={18} filled={active === "recipes"} />) : null}
      {items.agentInbox ? button("agentInbox", tr("Agent 收件箱", "Agent Inbox"), <Icon name="inbox" size={18} filled={active === "agentInbox"} />, { badge: agentInboxBadge }) : null}
      {items.prInbox ? button("prInbox", "Pull Request", <Icon name="pull-request" size={18} filled={active === "prInbox"} />) : null}
    </div>
    <div className="nav-rail-group nav-rail-footer">
      {usage.limits ? <NavUsageRing limits={usage.limits} prefs={usageRing} onOpen={refreshUsage} /> : null}
      {button("settings", tr("设置", "Settings"), <Icon name="settings" size={18} filled={active === "settings"} />, { title: `${tr("设置", "Settings")} (${mod},)` })}
    </div>
  </nav>;
}
