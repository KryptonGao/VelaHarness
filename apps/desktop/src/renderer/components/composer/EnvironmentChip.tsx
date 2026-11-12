import { PopoverPresence } from "../MotionPresence";
import type { ProjectApi } from "../../hooks/useProject";
import { useDismissable } from "../../hooks/useDismissable";
import { CheckIcon, MonitorIcon } from "../icons";
import { useState } from "react";
import type { SelectableEnvironmentKind, WorktreeHandoffResult } from "@vela/shared";
import { localizeError, tr, trf } from "../../locale";

function handoffText(result: WorktreeHandoffResult): string {
  if (result.status === "applied") return trf("已交接 {0} 个文件到本地", "Handed off {0} files to Local", result.files);
  if (result.status === "empty") return tr("没有需要交接的改动", "Nothing to hand off");
  if (result.status === "conflict") return tr("本地有冲突的改动，没有交接任何文件", "Local edits conflict, so nothing was handed off");
  return localizeError(result.message);
}

export function EnvironmentChip({ project }: { project: ProjectApi }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<SelectableEnvironmentKind | "handoff" | null>(null);
  const [handoff, setHandoff] = useState<WorktreeHandoffResult | null>(null);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const environment = project.environment;
  const environments = project.environments;
  if (!environment) return null;

  const local = environments.find((entry) => entry.kind === "local") ?? null;
  const worktree = environments.find((entry) => entry.kind === "worktree") ?? null;
  const worktreeActive = environment.kind === "worktree";
  const activeKind = environment.kind;
  const activeLabel = activeKind === "local"
    ? tr("本地", "Local")
    : activeKind === "worktree"
      ? tr("工作树", "Worktree")
      : activeKind === "sandbox"
        ? tr("沙箱", "Sandbox")
        : activeKind === "remote"
          ? tr("远程", "Remote")
          : environment.label;

  async function switchTo(kind: SelectableEnvironmentKind): Promise<void> {
    if (pending || kind === activeKind) return;
    setPending(kind);
    setHandoff(null);
    try {
      // 切换会在所选环境里开一个新对话;新对话成为当前对话后菜单就没有必要停留。
      if (await project.setEnvironment(kind)) setOpen(false);
    } finally {
      setPending(null);
    }
  }

  async function handOffToLocal(): Promise<void> {
    if (pending) return;
    setPending("handoff");
    try {
      setHandoff(await project.handoffWorktree());
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="composer-chip-anchor" ref={ref}>
      <button
        type="button"
        className="composer-chip"
        title={`${tr("执行环境", "Execution environment")}: ${activeLabel} (${environment.path})`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MonitorIcon />
        <span>{activeLabel}</span>
      </button>
      <PopoverPresence present={open}>
        <div className="dock-popover composer-popover up">
          <div className="composer-popover-title">{tr("执行环境", "Execution environment")}</div>
          <button
            type="button"
            className={`environment-row${worktreeActive ? "" : " active"}`}
            disabled={Boolean(pending) || !worktreeActive}
            onClick={() => void switchTo("local")}
          >
            <MonitorIcon size={14} />
            <div className="environment-text">
              <span className="environment-name">{tr("本地", "Local")}{pending === "local" ? tr(" · 切换中", " · Switching…") : ""}</span>
              <span className="environment-path" title={local?.path || environment.path}>
                {local?.path || environment.path}
              </span>
            </div>
            {worktreeActive ? null : <CheckIcon />}
          </button>
          <button
            type="button"
            className={`environment-row${worktreeActive ? " active" : ""}`}
            disabled={Boolean(pending) || worktreeActive}
            onClick={() => void switchTo("worktree")}
          >
            <MonitorIcon size={14} />
            <div className="environment-text">
              <span className="environment-name">{tr("工作树", "Worktree")}{pending === "worktree" ? tr(" · 创建中", " · Creating…") : ""}</span>
              <span className="environment-path" title={worktree?.path}>
                {worktreeActive
                  ? environment.path
                  : tr("在新对话里使用独立工作树", "Use an isolated worktree in a new chat")}
              </span>
            </div>
            {worktreeActive ? <CheckIcon /> : null}
          </button>
          {worktreeActive ? (
            <>
              <button
                type="button"
                className="environment-row"
                disabled={Boolean(pending)}
                onClick={() => void handOffToLocal()}
              >
                <div className="environment-text">
                  <span className="environment-name">
                    {pending === "handoff" ? tr("交接中…", "Handing off…") : tr("交接改动到本地", "Hand off changes to Local")}
                  </span>
                </div>
              </button>
              {handoff ? (
                <div className={`environment-result${handoff.ok ? "" : " failed"}`} role="status">
                  {handoffText(handoff)}
                  {handoff.conflicts.length > 0 ? <span className="environment-path" title={handoff.conflicts.join("\n")}>{handoff.conflicts.join(", ")}</span> : null}
                </div>
              ) : null}
            </>
          ) : null}
          {(["sandbox", "remote"] as const).map((kind) => (
            <div className="environment-row disabled" key={kind}>
              <MonitorIcon size={14} />
              <div className="environment-text">
                <span className="environment-name">{kind === "sandbox" ? tr("沙箱", "Sandbox") : tr("远程", "Remote")}</span>
              </div>
              <span className="environment-soon">{tr("即将支持", "Coming soon")}</span>
            </div>
          ))}
        </div>
      </PopoverPresence>
    </div>
  );
}
