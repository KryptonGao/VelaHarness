import { useState } from "react";
import { PopoverPresence } from "../MotionPresence";
import type { ProjectApi } from "../../hooks/useProject";
import { useDismissable } from "../../hooks/useDismissable";
import { CheckIcon, CloseIcon, FolderIcon, PlusIcon, SearchIcon } from "../icons";
import { tr } from "../../locale";
import { workspaceTitle } from "../workspace-names";

export function WorkspaceChip({ project }: { project: ProjectApi }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const current = project.workspace?.current ?? null;
  const recents = project.workspace?.recents ?? [];
  const needle = query.trim().toLowerCase();
  const visible = recents.filter((recent) =>
    !needle || `${workspaceTitle(recents, recent.path)}\n${recent.path}`.toLowerCase().includes(needle));

  function toggle(): void {
    setOpen((value) => !value);
    setQuery("");
  }

  return (
    <div className="composer-chip-anchor" ref={ref}>
      <button
        type="button"
        className="composer-chip"
        title={current ?? tr("选择工作区", "Choose workspace")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <FolderIcon />
        <span>{current ? workspaceTitle(recents, current) : tr("选择工作区", "Choose workspace")}</span>
      </button>
      <PopoverPresence present={open}>
        <div className="dock-popover composer-popover up workspace-picker">
          <label className="workspace-search">
            <SearchIcon />
            <input
              autoFocus
              value={query}
              placeholder={tr("搜索工作区", "Search workspaces")}
              aria-label={tr("搜索工作区", "Search workspaces")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="workspace-recent-list">
            {visible.map((recent) => (
              <button
                type="button"
                key={recent.path}
                className={`workspace-recent-main${recent.path === current ? " active" : ""}`}
                title={recent.path}
                onClick={() => {
                  setOpen(false);
                  if (recent.path !== current) void project.selectRecentWorkspace(recent.path);
                }}
              >
                <FolderIcon />
                <span className="workspace-recent-name">{workspaceTitle(recents, recent.path)}</span>
                {recent.path === current ? <CheckIcon /> : null}
              </button>
            ))}
            {visible.length === 0 ? <div className="workspace-empty">{tr("没有匹配的工作区", "No matching workspaces")}</div> : null}
          </div>
          <div className="workspace-picker-footer">
            <button
              type="button"
              className="workspace-action-row"
              onClick={() => {
                setOpen(false);
                void project.openWorkspaceDialog();
              }}
            >
              <PlusIcon />
              <span>{tr("打开新的文件夹…", "Open a new folder…")}</span>
            </button>
            {current ? (
              <button
                type="button"
                className="workspace-action-row"
                onClick={() => {
                  setOpen(false);
                  void project.closeWorkspace();
                }}
              >
                <CloseIcon />
                <span>{tr("清除当前工作区", "Clear current workspace")}</span>
              </button>
            ) : null}
          </div>
        </div>
      </PopoverPresence>
    </div>
  );
}
