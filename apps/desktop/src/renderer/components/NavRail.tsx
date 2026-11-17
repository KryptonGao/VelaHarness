import type { ReactNode } from "react";
import { tr, trf } from "../locale";
import { modKeyLabel } from "../platform";
import { useSidebarItems } from "../hooks/useSidebarItems";
import "../nav-rail.css";
import { Icon } from "./icons";

export type NavCategory = "home" | "scheduledTasks" | "recipes" | "agentInbox" | "prInbox" | "settings";

interface NavRailProps {
  active: NavCategory;
  platform: string;
  /** 需要用户处理的事项数；为 0 时不显示徽标。 */
  agentInboxBadge: number;
  onSelect: (category: NavCategory) => void;
}

/** 分类视图最左侧的图标栏：主页是「侧栏 + 对话」，其余分类各占整块内容区。 */
export function NavRail({ active, platform, agentInboxBadge, onSelect }: NavRailProps) {
  const items = useSidebarItems();
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
      {button("settings", tr("设置", "Settings"), <Icon name="settings" size={18} filled={active === "settings"} />, { title: `${tr("设置", "Settings")} (${mod},)` })}
    </div>
  </nav>;
}
