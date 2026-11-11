import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { GitStatusSnapshot } from "@vela/shared";
import type { ProjectApi } from "../../hooks/useProject";
import type { VersionControlApi } from "../../hooks/useVersionControl";
import { useDismissable } from "../../hooks/useDismissable";
import { tr } from "../../locale";
import { ArrowDownIcon, ArrowUpIcon, BranchIcon, CloudIcon, FolderIcon, HistoryIcon, MonitorIcon, MoreIcon, RefreshIcon, StackIcon, TagIcon } from "../icons";
import { BranchMenu } from "./BranchMenu";

export type RepositoryPanel = "branches" | "remotes" | "stash" | "worktrees" | "sync" | "force-push" | "tags" | "operations" | "reflog" | "compare";

/** A quieter toolbar; every operation still uses the existing guarded Git API. */
export function ReviewRepositoryToolbar({ project, api, status, sync, onPush, onPanel }: {
  project: ProjectApi;
  api: VersionControlApi;
  status: GitStatusSnapshot;
  sync: ReactNode;
  onPush(): void;
  onPanel(panel: RepositoryPanel): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const anchor = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  useEffect(() => { setOpen(false); }, [status.repo?.root]);
  const actions: { panel: RepositoryPanel; label: string; icon: ReactNode }[] = [
    { panel: "branches", label: tr("分支", "Branches"), icon: <BranchIcon size={15} /> },
    { panel: "remotes", label: tr("远程", "Remotes"), icon: <CloudIcon size={15} /> },
    { panel: "stash", label: tr("Stash", "Stash"), icon: <StackIcon size={15} /> },
    { panel: "worktrees", label: tr("Worktree", "Worktree"), icon: <MonitorIcon size={15} /> },
    { panel: "compare", label: tr("比较", "Compare"), icon: <BranchIcon size={15} /> },
    { panel: "sync", label: tr("同步策略", "Sync strategy"), icon: <ArrowDownIcon size={15} /> },
    ...(status.branch && !status.detached && status.ahead > 0
      ? [{ panel: "force-push" as const, label: tr("安全强推", "Force push"), icon: <ArrowUpIcon size={15} /> }]
      : []),
    { panel: "tags", label: tr("标签 / 发布", "Tags / releases"), icon: <TagIcon size={15} /> },
    { panel: "operations", label: tr("操作记录", "Operations"), icon: <HistoryIcon size={15} /> },
    { panel: "reflog", label: tr("Reflog", "Reflog"), icon: <HistoryIcon size={15} /> },
  ];
  return <div className="vc-review-toolbar">
    <div className="vc-review-repository">
      <span className="vc-review-repo-icon" aria-hidden="true"><FolderIcon size={20} /></span>
      <div className="vc-repo-info">
        <div className="vc-repo-title"><b>{status.repo?.name}</b></div>
        <div className="vc-repo-path" title={status.repo?.root}>{status.repo?.root}</div>
      </div>
    </div>
    <BranchMenu contained branches={project.branches} current={status.branch}
      disabled={api.busy !== null || api.guard?.agentRunning === true}
      onSwitch={name => void project.switchBranch(name)} onCreate={name => void project.createBranch(name)} />
    <div className="vc-review-sync-actions">
      {sync}
      <button type="button" className="vc-btn vc-btn-ghost" disabled={api.busy !== null} onClick={() => void api.fetch(null)}>
        <RefreshIcon size={14} />{api.busy === "fetch" ? tr("Fetch 中…", "Fetching…") : "Fetch"}
      </button>
      <button type="button" className="vc-btn vc-btn-ghost" disabled={api.busy !== null || !status.upstream || api.guard?.agentRunning === true}
        title={status.upstream ? undefined : tr("没有 upstream，先发布分支", "No upstream; publish the branch first")} onClick={() => void api.pull()}>
        <ArrowDownIcon size={14} />{api.busy === "pull" ? tr("Pull 中…", "Pulling…") : "Pull"}
      </button>
      <button type="button" className="vc-btn" disabled={api.busy !== null || !status.branch} onClick={onPush}>
        <ArrowUpIcon size={14} />{status.upstream ? "Push" : tr("发布分支", "Publish branch")}
        {status.ahead > 0 ? <span className="vc-review-ahead">{status.ahead}</span> : null}
      </button>
      <div className="vc-review-menu-anchor" ref={anchor}>
        <button type="button" className="vc-icon-btn" ref={trigger} aria-label={tr("仓库管理", "Repository")}
          aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
          onClick={() => setOpen(value => !value)} onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
          }}><MoreIcon size={18} /></button>
        {open ? <div className="vc-popover vc-review-menu" id={id} ref={menu} role="menu" aria-label={tr("仓库管理", "Repository")}
          onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
            else if (event.key === "Tab") setOpen(false);
            else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }
          }}>
          {actions.map(action => <button key={action.panel} type="button" role="menuitem" onClick={() => {
            setOpen(false); trigger.current?.focus(); onPanel(action.panel);
          }}><span aria-hidden="true">{action.icon}</span>{action.label}</button>)}
        </div> : null}
      </div>
    </div>
  </div>;
}
