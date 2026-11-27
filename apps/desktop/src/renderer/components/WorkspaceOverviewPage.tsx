import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { ConversationSummary, GitInProgressOperation, ScheduledTask, WorkspaceOverviewGit, WorkspaceRecent } from "@vela/shared";
import { useAutoHideScrollbarsWithin } from "../hooks/useAutoHideScrollbar";
import { useWorkspaceOverview } from "../hooks/useWorkspaceOverview";
import type { ActivityOptions } from "./conversation-activity";
import { displayConversationTitle } from "./conversation-title";
import { activeIntlLocale, tr, trf } from "../locale";
import { findWorkspace, folderName, workspaceTitle } from "./workspace-names";
import {
  attentionItems,
  changeBreakdown,
  dailyCreatedConversations,
  overviewCounts,
  scheduleSummary,
  workspaceConversations,
} from "./workspace-overview-model";
import { VersionControlView } from "./version-control/VersionControlView";
import { FileTypeIcon } from "./FileTypeIcon";
import { Icon } from "./icons";
// 页面外壳(.scheduled-tasks-page-shell 等)的样式在这份表里,与定时任务页共用。
import "../scheduled-tasks.css";
import "../workspace-overview.css";

interface WorkspaceOverviewPageProps {
  workspace: string;
  versionControl?: {
    viewProps: Omit<ComponentProps<typeof VersionControlView>, "hidden">;
    open: boolean;
    switchFailed: boolean;
    onOpen: () => void;
    onBack: () => void;
  };
  conversations: ConversationSummary[];
  workspaces: readonly WorkspaceRecent[];
  waitingConversationIds: readonly string[];
  onOpenConversation: (id: string) => void;
  onNewChat: (cwd: string) => void;
  onEditWorkspace: (cwd: string) => void;
  onOpenScheduledTasks: () => void;
}

/** 短相对时间;超过一周退回日期。 */
function relativeTime(at: number, now: number): string {
  const seconds = (at - now) / 1000;
  const abs = Math.abs(seconds);
  const locale = activeIntlLocale();
  if (abs >= 7 * 86400) {
    const date = new Date(at);
    return date.toLocaleDateString(locale, date.getFullYear() === new Date(now).getFullYear() ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
  }
  const [divisor, unit] = abs >= 86400 ? [86400, "day"] : abs >= 3600 ? [3600, "hour"] : abs >= 60 ? [60, "minute"] : [1, "second"];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" }).format(Math.round(seconds / Number(divisor)), unit as Intl.RelativeTimeFormatUnit);
}

function fileBaseName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function dateTime(at: number): string {
  return new Date(at).toLocaleString(activeIntlLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function operationLabel(operation: GitInProgressOperation | string): string {
  switch (operation) {
    case "merge": return tr("合并", "Merge");
    case "rebase": return tr("变基", "Rebase");
    case "cherry-pick": return tr("Cherry-pick", "Cherry-pick");
    case "revert": return tr("回退提交", "Revert");
    default: return operation;
  }
}

export function WorkspaceOverviewPage({
  workspace, versionControl, conversations, workspaces, waitingConversationIds,
  onOpenConversation, onNewChat, onEditWorkspace, onOpenScheduledTasks,
}: WorkspaceOverviewPageProps) {
  const pageRef = useRef<HTMLElement>(null);
  useAutoHideScrollbarsWithin(pageRef);
  const data = useWorkspaceOverview(workspace);
  const untitled = tr("新对话", "New chat");
  const options: ActivityOptions = useMemo(() => ({ waitingConversationIds }), [waitingConversationIds]);
  const list = useMemo(() => workspaceConversations(conversations, workspace, untitled), [conversations, workspace, untitled]);
  const counts = useMemo(() => overviewCounts(list, options), [list, options]);
  const git = data.snapshot?.git ?? null;
  const attention = useMemo(() => attentionItems(list, options, git), [list, options, git]);
  const now = Date.now();
  const series = useMemo(() => dailyCreatedConversations(list, Date.now()), [list]);
  const weekSeries = series.slice(-7);
  const weekCount = weekSeries.reduce((sum, entry) => sum + entry.count, 0);
  const weekMax = Math.max(1, ...weekSeries.map(entry => entry.count));
  const schedule = data.schedule ? scheduleSummary(data.schedule.tasks, workspace) : null;
  const entry = findWorkspace(workspaces, workspace);
  const name = workspaceTitle(workspaces, workspace);
  const extraFolders = (entry?.folders ?? []).filter(folder => folder !== workspace);
  const byId = useMemo(() => new Map(list.map(item => [item.id, item])), [list]);
  const empty = list.length === 0;

  const project = versionControl?.viewProps.project;
  const activeWorkspace = project?.workspace?.current === workspace;
  const repositoryOpen = versionControl?.open;
  // A workspace-change event can precede its Git snapshot. Wait for the same checkout before offering Git actions.
  const repositoryReady = activeWorkspace && git && project?.git?.repo?.root === git.repoRoot && project.git.repo.subdir === git.subdir;

  return <main className="scheduled-tasks-page-shell wo-shell" ref={pageRef}>
    <header className="main-chat-header scheduled-tasks-page-toolbar">
      <div className="chat-title-group">
        {repositoryOpen && <button type="button" className="view-icon-btn" onClick={versionControl.onBack}
          title={tr("工作区总览", "Workspace overview")} aria-label={tr("工作区总览", "Workspace overview")}><Icon name="arrow-left" size={16} /></button>}
        <span className="chat-active-title">{repositoryOpen ? `${tr("版本控制", "Version Control")} · ${name}` : tr("工作区总览", "Workspace overview")}</span>
      </div>
    </header>
    {repositoryOpen && (repositoryReady ? <VersionControlView {...versionControl.viewProps} hidden={false}
      session={versionControl.viewProps.session?.cwd === workspace ? versionControl.viewProps.session : null}
      pendingInteraction={versionControl.viewProps.session?.cwd === workspace && versionControl.viewProps.pendingInteraction} />
      : <div className="vc-empty" role="status">{data.snapshotError ? tr("无法读取仓库信息", "Couldn't read repository details")
        : !git && !data.loading ? tr("这个工作区不是 Git 仓库", "This workspace isn't a Git repository") : tr("正在读取…", "Loading…")}</div>)}
    <div className="scheduled-tasks-page-scroll autohide-scrollbar" hidden={repositoryOpen}>
      <section className="wo-page" aria-label={`${tr("工作区总览", "Workspace overview")} · ${name}`}>
        <header className="wo-head">
          <span className="wo-tile" aria-hidden="true"><Icon name="folder" size={24} /></span>
          <div className="wo-head-main">
            <h1 tabIndex={-1}>{name}</h1>
            <div className="wo-meta">
              <span className="wo-path" title={workspace}>{workspace}</span>
              {extraFolders.length > 0 ? <button className="wo-chip" type="button" onClick={() => onEditWorkspace(workspace)}
                title={extraFolders.map(folderName).join("\n")}>
                <Icon name="folder" size={12} />{trf("另有 {0} 个文件夹", extraFolders.length === 1 ? "1 more folder" : "{0} more folders", extraFolders.length)}
              </button> : null}
              {git?.branch ? <span className="wo-chip wo-mono"><Icon name="branch" size={12} />{git.branch}</span> : null}
              {git?.detached ? <span className="wo-chip">{tr("游离 HEAD", "Detached HEAD")}</span> : null}
              {git?.upstream && git.ahead === 0 && git.behind === 0 ? <span className="wo-chip wo-ok"><Icon name="check" size={12} />{tr("已与远程同步", "In sync with remote")}</span> : null}
              {git && (git.ahead > 0 || git.behind > 0) ? <span className="wo-chip wo-num" title={tr("领先 / 落后远程", "Ahead / behind remote")}>↑{git.ahead} ↓{git.behind}</span> : null}
            </div>
          </div>
          <div className="wo-actions">
            {versionControl && git && <button className="wo-btn" type="button" onClick={versionControl.onOpen}>
              <Icon name="branch" size={16} />{activeWorkspace ? tr("版本控制", "Version Control")
                : tr("切换到此工作区并打开版本控制", "Switch to this workspace and open Version Control")}
            </button>}
            <button className="wo-btn wo-icon-btn" type="button" title={tr("工作区设置", "Workspace settings")} aria-label={tr("工作区设置", "Workspace settings")}
              onClick={() => onEditWorkspace(workspace)}><Icon name="sliders" size={16} /></button>
            <button className="wo-btn wo-primary" type="button" onClick={() => onNewChat(workspace)}><Icon name="compose" size={16} />{tr("新对话", "New chat")}</button>
          </div>
        </header>

        {data.snapshotError && !data.snapshot ? <p className="wo-error" role="alert">{tr("无法读取仓库信息", "Couldn't read repository details")}</p> : null}

        {attention.length > 0 ? <section className="wo-card wo-attention" aria-labelledby="wo-attention-title">
          <div className="wo-card-head"><h2 id="wo-attention-title"><Icon name="warning" size={14} />{tr("需要你处理", "Needs your attention")}<span className="wo-n">{attention.length}</span></h2></div>
          <ul className="wo-attention-list">{attention.map(item => {
            const conversation = item.conversationId ? byId.get(item.conversationId) : null;
            const title = conversation ? displayConversationTitle(conversation.title) : operationLabel(git?.operation ?? "");
            const sub = item.kind === "waiting" ? tr("等待回答", "Waiting for your reply")
              : item.kind === "error" ? tr("发生错误", "Needs attention")
              : tr("进行中的 Git 操作，有冲突需要解决", "A Git operation is in progress and has conflicts to resolve");
            return <li key={item.conversationId ?? "operation"} className="wo-attention-row">
              <span className={`wo-attention-icon wo-${item.kind}`} aria-hidden="true"><Icon name={item.kind === "waiting" ? "question" : item.kind === "error" ? "alert" : "git-merge"} size={14} /></span>
              <span className="wo-attention-text"><b>{title}</b><span>{sub}{conversation ? ` · ${relativeTime(conversation.updatedAt, now)}` : ""}</span></span>
              {item.conversationId ? <button className="wo-btn wo-small" type="button" onClick={() => onOpenConversation(item.conversationId!)}>
                {item.kind === "waiting" ? tr("回答", "Reply") : tr("查看", "Open")}</button> : null}
            </li>;
          })}</ul>
        </section> : null}

        {empty ? <section className="wo-card wo-empty" aria-labelledby="wo-empty-title">
          <span className="wo-empty-icon" aria-hidden="true"><Icon name="sparkles" size={24} /></span>
          <h2 id="wo-empty-title">{tr("这个工作区还没有对话", "No chats in this workspace yet")}</h2>
          <p>{tr("从一个任务开始，对话、变更和活动会汇总在这里。", "Start a task and its chats, changes and activity will show up here.")}</p>
          <button className="wo-btn wo-primary" type="button" onClick={() => onNewChat(workspace)}><Icon name="compose" size={16} />{tr("新对话", "New chat")}</button>
        </section> : <section className="wo-stats" aria-label={tr("概况", "Summary")}>
          <div className="wo-card wo-stat">
            <span className="wo-stat-label"><Icon name="chat" size={14} />{tr("对话", "Chats")}</span>
            <span className="wo-stat-value wo-num">{counts.total}</span>
            <span className="wo-stat-sub">
              <span className={counts.running ? "wo-run" : ""}>{trf("{0} 进行中", "{0} active", counts.running)}</span>
              {counts.waiting > 0 ? <span className="wo-wait">{trf("{0} 等待", "{0} waiting", counts.waiting)}</span> : null}
              {counts.error > 0 ? <span className="wo-err">{trf("{0} 出错", "{0} failed", counts.error)}</span> : null}
            </span>
          </div>
          {git ? <div className="wo-card wo-stat">
            <span className="wo-stat-label"><Icon name="file-diff" size={14} />{tr("未提交的变更", "Uncommitted changes")}</span>
            <span className="wo-stat-value wo-num">{git.fileCount}<small>{tr("个文件", git.fileCount === 1 ? "file" : "files")}</small></span>
            <span className="wo-stat-sub wo-num">
              {git.fileCount > 0 ? <><span className="wo-add">+{git.addedLines}</span><span className="wo-del">−{git.deletedLines}</span></> : <span className="wo-ok">{tr("工作区干净", "Clean")}</span>}
              {git.worktreeCount > 0 ? <span>{trf("{0} 个工作树", git.worktreeCount === 1 ? "1 worktree" : "{0} worktrees", git.worktreeCount)}</span> : null}
            </span>
          </div> : null}
          <div className="wo-card wo-stat">
            <span className="wo-stat-label"><Icon name="history" size={14} />{tr("本周新对话", "New chats this week")}</span>
            <span className="wo-stat-value wo-num">{weekCount}</span>
            <div className="wo-spark" aria-hidden="true">{weekSeries.map(entry => <i key={entry.day} style={{ height: `${entry.count === 0 ? 4 : Math.max(18, (entry.count / weekMax) * 100)}%` }} />)}</div>
          </div>
          {schedule ? <button className="wo-card wo-stat wo-stat-link" type="button" onClick={onOpenScheduledTasks}>
            <span className="wo-stat-label"><Icon name="clock" size={14} />{tr("定时任务", "Scheduled tasks")}</span>
            <span className="wo-stat-value wo-num">{schedule.active}</span>
            <span className="wo-stat-sub">{schedule.nextRunAt ? trf("下次 {0}", "Next {0}", dateTime(schedule.nextRunAt)) : tr("没有排队中的执行", "Nothing scheduled")}</span>
          </button> : null}
        </section>}

        {!empty ? <RepositoryCard workspace={workspace} git={git} loading={data.loading && !data.snapshot} now={now} /> : null}

        {!empty ? <div className="wo-split-even">
          <ActivityCard series={series} />
          <MemoryCard memory={data.memory} />
        </div> : null}

        {!empty ? <div className="wo-split-even">
          <ToolsCard mcp={data.mcp} hooks={data.hooks} />
          <ScheduleCard tasks={data.schedule?.tasks.filter(task => task.workspace === workspace && task.status === "active") ?? null} onOpen={onOpenScheduledTasks} />
        </div> : null}
      </section>
    </div>
  </main>;
}

function RepositoryCard({ workspace, git, loading, now }: { workspace: string; git: WorkspaceOverviewGit | null; loading: boolean; now: number }) {
  if (!git) {
    return <section className="wo-card" aria-labelledby="wo-repo-title">
      <div className="wo-card-head"><h2 id="wo-repo-title">{tr("仓库", "Repository")}</h2></div>
      <p className="wo-none">{loading ? tr("正在读取…", "Loading…") : tr("这个工作区不是 Git 仓库", "This workspace isn't a Git repository")}</p>
    </section>;
  }
  const parts = changeBreakdown(git.counts);
  const partLabel = { modified: tr("修改", "modified"), added: tr("新增", "added"), deleted: tr("删除", "deleted"), other: tr("其他", "other") };
  const changes = git.fileCount > 0 ? <div key="changes">
    <div className="wo-sec"><span>{tr("工作区变更", "Working tree")}</span><span className="wo-num"><span className="wo-add">+{git.addedLines}</span> <span className="wo-del">−{git.deletedLines}</span></span></div>
    <div className="wo-splitbar" role="img" aria-label={parts.map(part => `${part.count} ${partLabel[part.status]}`).join(", ")}>
      {parts.map(part => <i key={part.status} className={`wo-part-${part.status}`} style={{ flexGrow: part.count }} />)}
    </div>
    <div className="wo-legend wo-num">{parts.map(part => <span key={part.status}><i className={`wo-part-${part.status}`} />{part.count} {partLabel[part.status]}</span>)}</div>
    <ul className="wo-files wo-num">{git.topFiles.map(file => <li key={file.path}>
      <button className="wo-file" type="button" title={`${tr("在 Finder 中显示", "Reveal in Finder")} · ${file.path}`}
        aria-label={`${tr("在 Finder 中显示", "Reveal in Finder")} · ${fileBaseName(file.path)}`}
        onClick={() => { void window.vela?.workspaceOverview?.reveal(workspace, file.path).catch(() => undefined); }}>
        <FileTypeIcon path={file.path} /><span className="wo-file-name">{fileBaseName(file.path)}</span>
      </button>
      <span className="wo-add">+{file.addedLines}</span><span className="wo-del">−{file.deletedLines}</span>
    </li>)}</ul>
  </div> : null;
  const worktrees = git.worktreeCount > 0 ? <div key="worktrees">
    <div className="wo-sec"><span>{trf("工作树 · {0}", "Worktrees · {0}", git.worktreeCount)}</span></div>
    <ul className="wo-worktrees">{git.worktrees.map(item => <li key={item.path}>
      <Icon name="branch" size={12} />
      <span className="wo-mono wo-wt-name" title={item.path}>{item.branch ?? folderName(item.path)}</span>
      <span className="wo-faint">{item.changeCount ? trf("{0} 处改动", item.changeCount === 1 ? "1 change" : "{0} changes", item.changeCount) : tr("无改动", "Clean")}</span>
    </li>)}</ul>
  </div> : null;
  const commits = git.commits.length > 0 ? <div key="commits">
    <div className="wo-sec"><span>{tr("最近提交", "Recent commits")}</span></div>
    <ul className="wo-commits">{git.commits.map(commit => <li key={commit.sha}>
      <span className="wo-hash wo-mono">{commit.shortSha}</span>
      <span className="wo-commit-subject" title={commit.subject}>{commit.subject}</span>
      <span className="wo-faint">{relativeTime(commit.at, now)}</span>
    </li>)}</ul>
  </div> : null;
  // 有变更时：左列变更，右列工作树和提交；没有变更时：工作树和提交各占一列，不留空列。
  const columns = changes ? [changes, worktrees || commits ? <div key="side" className="wo-repo-side">{worktrees}{commits}</div> : null] : [worktrees, commits];
  const shown = columns.filter(Boolean);
  return <section className="wo-card" aria-labelledby="wo-repo-title">
    <div className="wo-card-head"><h2 id="wo-repo-title">{tr("仓库", "Repository")}</h2></div>
    <div className="wo-card-body wo-repo">
      <div className="wo-branch-line">
        <Icon name="branch" size={14} />
        <span className="wo-mono wo-branch">{git.branch ?? tr("游离 HEAD", "Detached HEAD")}</span>
        {git.fileCount === 0 ? <span className="wo-chip wo-ok"><Icon name="check" size={12} />{tr("没有未提交的变更", "Working tree clean")}</span> : null}
        {git.upstream ? <span className="wo-sync wo-num"><span>↑{git.ahead}</span><span>↓{git.behind}</span></span> : null}
      </div>
      {shown.length > 0 ? <div className="wo-repo-cols">{shown}</div> : null}
    </div>
  </section>;
}

function ActivityCard({ series }: { series: ReturnType<typeof dailyCreatedConversations> }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...series.map(entry => entry.count));
  const total = series.reduce((sum, entry) => sum + entry.count, 0);
  const label = (index: number) => {
    const entry = series[index]!;
    return `${new Date(entry.day).toLocaleDateString(activeIntlLocale(), { month: "numeric", day: "numeric", weekday: "short" })} · ${trf("{0} 个新对话", entry.count === 1 ? "1 new chat" : "{0} new chats", entry.count)}`;
  };
  return <section className="wo-card" aria-labelledby="wo-activity-title">
    <div className="wo-card-head"><h2 id="wo-activity-title">{trf("近 {0} 天", "Last {0} days", series.length)}</h2></div>
    <div className="wo-card-body">
      <div className="wo-big"><span className="wo-big-value wo-num">{total}</span><span className="wo-faint">{tr("个新对话", total === 1 ? "new chat" : "new chats")}</span></div>
      <div className="wo-chart" role="group" aria-label={tr("每天新建的对话数", "Chats created per day")} onMouseLeave={() => setActive(null)}>
        {series.map((entry, index) => <div key={entry.day} className={`wo-col${index === series.length - 1 ? " is-today" : ""}`} tabIndex={0}
          role="img" aria-label={label(index)} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
          <i style={{ height: `${entry.count === 0 ? 0 : Math.max(6, (entry.count / max) * 100)}%` }} />
        </div>)}
      </div>
      <div className="wo-readout" aria-live="polite">{active === null ? tr("悬停柱子查看当天数量", "Hover a bar for that day") : label(active)}</div>
    </div>
  </section>;
}

function MemoryCard({ memory }: { memory: ReturnType<typeof useWorkspaceOverview>["memory"] }) {
  return <section className="wo-card" aria-labelledby="wo-memory-title">
    <div className="wo-card-head"><h2 id="wo-memory-title"><Icon name="brain" size={14} />{tr("项目记忆", "Project memory")}</h2></div>
    <ScrollBody>
      {memory === null ? <p className="wo-none wo-flush">{tr("正在读取…", "Loading…")}</p>
        : !memory.exists ? <p className="wo-none wo-flush">{tr("还没有项目记忆。让 Agent 提炼对话经验后会出现在这里。", "No project memory yet. It appears here after the agent distils lessons from your chats.")}</p>
        : <>
          <div className="wo-summary wo-num"><span><b>{memory.entries.length}</b>{tr("条记忆", memory.entries.length === 1 ? "entry" : "entries")}</span><span><b>{(memory.bytes / 1024).toFixed(1)}</b>KB</span></div>
          <ul className="wo-list">{memory.entries.map((text, index) => <li key={index}><span className="wo-clamp" title={text}>{text}</span></li>)}</ul>
        </>}
    </ScrollBody>
  </section>;
}

function ToolsCard({ mcp, hooks }: { mcp: ReturnType<typeof useWorkspaceOverview>["mcp"]; hooks: ReturnType<typeof useWorkspaceOverview>["hooks"] }) {
  const servers = (mcp?.servers ?? []).filter(server => server.enabled);
  const hookRules = (hooks?.documents ?? []).flatMap(document => document.config.hooks.filter(hook => hook.enabled !== false).map(hook => ({ hook, trusted: document.trusted })));
  const untrusted = hookRules.some(rule => !rule.trusted);
  return <section className="wo-card" aria-labelledby="wo-tools-title">
    <div className="wo-card-head"><h2 id="wo-tools-title"><Icon name="mcp" size={14} />{tr("工具与扩展", "Tools & extensions")}</h2></div>
    <ScrollBody>
      <ul className="wo-list">
        <li><span className="wo-list-label">MCP</span>
          {mcp === null ? <span className="wo-faint">—</span> : servers.length === 0 ? <span className="wo-faint">{tr("没有启用的服务器", "No servers enabled")}</span>
            : <span className="wo-servers">{servers.map(server => <span key={`${server.scope}:${server.name}`} className="wo-server" title={server.error ?? server.name}>
              <i className={`wo-dot wo-dot-${server.connectionStatus === "connected" ? "ok" : server.connectionStatus === "error" || server.authStatus === "required" ? "error" : "recent"}`} />{server.name}</span>)}
            </span>}
        </li>
        <li><span className="wo-list-label">Hooks</span>
          {hooks === null ? <span className="wo-faint">—</span> : hookRules.length === 0 ? <span className="wo-faint">{tr("未配置", "None configured")}</span>
            : <span>{trf("{0} 条已启用", hookRules.length === 1 ? "1 enabled" : "{0} enabled", hookRules.length)}{untrusted ? <span className="wo-wait"> · {tr("待授权", "Needs approval")}</span> : null}</span>}
        </li>
      </ul>
    </ScrollBody>
  </section>;
}

function ScheduleCard({ tasks, onOpen }: { tasks: ScheduledTask[] | null; onOpen: () => void }) {
  const list = tasks?.slice().sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)) ?? null;
  return <section className="wo-card" aria-labelledby="wo-schedule-title">
    <div className="wo-card-head"><h2 id="wo-schedule-title"><Icon name="clock" size={14} />{tr("定时任务", "Scheduled tasks")}</h2><button className="wo-link" type="button" onClick={onOpen}>{tr("管理", "Manage")}</button></div>
    <ScrollBody>
      {list === null ? <p className="wo-none wo-flush">{tr("正在读取…", "Loading…")}</p>
        : list.length === 0 ? <p className="wo-none wo-flush">{tr("这个工作区没有定时任务", "No scheduled tasks in this workspace")}</p>
        : <ul className="wo-list">{list.map(task => <li key={task.id}>
          <span className="wo-clamp" title={task.title}>{task.title}</span>
          <span className="wo-faint wo-num">{task.nextRunAt ? dateTime(task.nextRunAt) : "—"}</span>
        </li>)}</ul>}
    </ScrollBody>
  </section>;
}


/** 卡片里可滚动的内容区：上下还有被裁掉的内容时，对应一侧渐隐，提示可以滚动。 */
function ScrollBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const above = el.scrollTop > 1;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    el.dataset.fade = above && below ? "both" : above ? "top" : below ? "bottom" : "none";
  }, []);
  useEffect(() => {
    update();
    const observer = new ResizeObserver(update);
    if (ref.current) observer.observe(ref.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [update]);
  return <div ref={ref} className="wo-card-body wo-scroll autohide-scrollbar" tabIndex={0} data-fade="none" onScroll={update}>
    <div ref={inner}>{children}</div>
  </div>;
}
