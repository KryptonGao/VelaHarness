import type { ReactNode } from "react";
import { tr, trf } from "../locale";
import { modKeyLabel } from "../platform";
import { useSidebarItems } from "../hooks/useSidebarItems";
import { ClockIcon, GearIcon, HomeIcon, InboxIcon, PullRequestIcon, RecipeIcon } from "./icons";
import "../nav-rail.css";

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
    return <button key={category} className="nav-rail-item" type="button" title={options.title ?? label}
      aria-label={badge > 0 ? trf("{0}，{1} 项需要处理", "{0}, {1} need your attention", label, badge) : label}
      aria-current={active === category ? "page" : undefined} onClick={() => onSelect(category)}>
      <span className="nav-rail-icon">{glyph}</span>
      {badge > 0 ? <span className="nav-rail-badge" aria-hidden="true">{badge > 9 ? "9+" : badge}</span> : null}
    </button>;
  };
  return <nav className="nav-rail" aria-label={tr("分类", "Categories")}>
    <div className="nav-rail-titlebar" />
    <div className="nav-rail-group">
      {button("home", tr("主页", "Home"), <HomeIcon size={18} />)}
      {items.scheduledTasks ? button("scheduledTasks", tr("定时任务", "Scheduled Tasks"), <ClockIcon size={18} />) : null}
      {items.recipes ? button("recipes", tr("任务配方", "Task Recipes"), <RecipeIcon size={18} />) : null}
      {items.agentInbox ? button("agentInbox", tr("Agent 收件箱", "Agent Inbox"), <InboxIcon size={18} />, { badge: agentInboxBadge }) : null}
      {items.prInbox ? button("prInbox", "Pull Request", <PullRequestIcon size={18} />) : null}
    </div>
    <div className="nav-rail-group nav-rail-footer">
      {button("settings", tr("设置", "Settings"), <GearIcon size={18} />, { title: `${tr("设置", "Settings")} (${mod},)` })}
    </div>
  </nav>;
}
