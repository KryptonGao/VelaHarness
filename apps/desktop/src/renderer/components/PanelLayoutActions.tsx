import { tr } from "../locale";
import { modKeyLabel } from "../platform";
import { PanelLayoutIcon } from "./icons";

/** Window-level layout controls stay in place while the panels beneath them move. */
export function PanelLayoutActions({ workbenchOpen, onToggleWorkbench, contextOpen, onToggleContext, platform }: {
  workbenchOpen: boolean;
  onToggleWorkbench?: () => void;
  contextOpen: boolean;
  onToggleContext?: () => void;
  platform: string;
}) {
  if (!onToggleWorkbench && !onToggleContext) return null;
  const workbenchLabel = workbenchOpen ? tr("折叠工作面板", "Collapse workbench") : tr("展开工作面板", "Expand workbench");
  const contextLabel = contextOpen ? tr("收起右侧面板", "Collapse right panel") : tr("展开右侧面板", "Expand right panel");
  return <div className="panel-layout-actions" data-controls={Number(!!onToggleWorkbench) + Number(!!onToggleContext)}>
    {onToggleWorkbench && <button className={`view-icon-btn ${workbenchOpen ? "workbench-collapse" : "workbench-expand"}`}
      type="button" title={workbenchLabel} aria-label={workbenchLabel} aria-expanded={workbenchOpen} onClick={onToggleWorkbench}>
      <PanelLayoutIcon columns={onToggleContext ? 3 : 2} />
    </button>}
    {onToggleContext && <button className="view-icon-btn context-sidebar-toggle" type="button"
      title={`${contextLabel} (${modKeyLabel(platform)}J)`} aria-label={contextLabel} aria-expanded={contextOpen} onClick={onToggleContext}>
      <PanelLayoutIcon />
    </button>}
  </div>;
}
