import { tr } from "../locale";
import { modKeyLabel } from "../platform";
import { Icon } from "./icons";

interface WindowNavigationProps {
  platform: string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

export function WindowNavigation({ platform, sidebarCollapsed, onToggleSidebar, canGoBack, canGoForward, onBack, onForward }: WindowNavigationProps) {
  const mac = platform === "darwin";
  const mod = modKeyLabel(platform);
  const sidebar = sidebarCollapsed ? tr("展开侧边栏", "Expand sidebar") : tr("收起侧边栏", "Collapse sidebar");
  const back = tr("后退", "Back");
  const forward = tr("前进", "Forward");
  return <div className="window-navigation">
    <button className="sidebar-collapse-btn" type="button" onClick={onToggleSidebar}
      aria-expanded={!sidebarCollapsed} aria-label={sidebar} title={`${sidebar} (${mod}B)`}>
      <Icon name={sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"} size={16} />
    </button>
    <div className="nav-history-buttons" role="group" aria-label={tr("导航历史", "Navigation history")}>
      <button className="icon-btn-ghost" type="button" disabled={!canGoBack} onClick={onBack}
        title={`${back} (${mac ? `${mod}[` : "Alt+←"})`} aria-label={back}>
        <Icon name="arrow-left" size={16} />
      </button>
      <button className="icon-btn-ghost" type="button" disabled={!canGoForward} onClick={onForward}
        title={`${forward} (${mac ? `${mod}]` : "Alt+→"})`} aria-label={forward}>
        <Icon name="arrow-right" size={16} />
      </button>
    </div>
  </div>;
}
