import { displayConversationTitle } from "./conversation-title";
import { overlapsForConversation, type ConversationSummary, type WorkspaceRecent } from "@vela/shared";
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { isBoolean, isBooleanRecord, useStoredState } from "../hooks/useStoredState";
import { modKeyLabel } from "../platform";
import { tr, trf, useAppLocale } from "../locale";
import type { SidebarResize } from "../hooks/useSidebarResize";
import { MotionList } from "./BatchMotion";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { VelaLogoLockup } from "./VelaLogo";
import { groupActiveConversations, searchActiveConversations, workspaceName } from "./conversation-search";
import {
  activityDay,
  activityReason,
  groupActivityConversations,
  isSidebarView,
  type ActivityGroupId,
  type ActivityReason,
  type SidebarView,
} from "./conversation-activity";
import { ConversationSearchDialog } from "./ConversationSearchDialog";
import { ConflictContext } from "./conflict-context";
import { useSidebarItems } from "../hooks/useSidebarItems";
import { conversationWorkspace, findWorkspace, workspaceTitle } from "./workspace-names";
import { WorkspaceHoverCard } from "./WorkspaceHoverCard";
import { Icon } from "./icons";

interface SidebarProps {
  onOpenPrInbox: () => void;
  prInboxOpen: boolean;
  onOpenAgentInbox: () => void;
  agentInboxOpen: boolean;
  /** 需要用户处理的事项数；为 0 时不显示徽标。 */
  agentInboxBadge: number;
  onOpenRecipes: () => void;
  recipesOpen: boolean;
  onOpenScheduledTasks: () => void;
  scheduledTasksOpen: boolean;
  collapsed: boolean;
  /** 分类视图：页面入口和设置移到最左侧图标栏，这里只保留新对话、活动视图、搜索。 */
  railMode?: boolean;
  resize: SidebarResize;
  platform: string;
  conversations: ConversationSummary[];
  waitingConversationIds?: readonly string[];
  activeConversationId: string | null;
  settingsOpen: boolean;
  settingsLabel: string;
  onToggle: () => void;
  onOpenSettings: () => void;
  onNewChat: (cwd?: string) => void;
  /** 已登记的工作区,用于显示自定义名称。 */
  workspaces?: readonly WorkspaceRecent[];
  onEditWorkspace?: (cwd: string) => void;
  /** 当前打开着总览的工作区;没有打开时为 null。 */
  overviewWorkspace?: string | null;
  /** 点击工作区左侧的文件夹图标:打开这个工作区的总览。 */
  onOpenWorkspaceOverview?: (cwd: string) => void;
  onSwitchConversation: (id: string) => void;
  onArchiveConversation: (id: string) => void;
  onRenameConversation?: (id: string) => void;
}

const workspaceConversationLimit = 5;
/** 悬停多久后弹出工作区信息卡;离开后留一小段时间让指针移进卡片。 */
const cardOpenDelayMs = 400;
const cardCloseDelayMs = 150;

export function Sidebar({
  onOpenPrInbox,
  prInboxOpen,
  onOpenAgentInbox,
  agentInboxOpen,
  agentInboxBadge,
  onOpenRecipes,
  recipesOpen,
  onOpenScheduledTasks,
  scheduledTasksOpen,
  collapsed,
  railMode = false,
  resize,
  platform,
  conversations: allConversations,
  waitingConversationIds,
  activeConversationId,
  settingsOpen,
  settingsLabel,
  onToggle,
  onOpenSettings,
  onNewChat,
  workspaces,
  onEditWorkspace,
  overviewWorkspace = null,
  onOpenWorkspaceOverview,
  onSwitchConversation,
  onArchiveConversation,
  onRenameConversation,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const items = useSidebarItems();
  const [view, setView] = useStoredState<SidebarView>("vela.sidebarView", "activity", isSidebarView);
  const [priorityConversations, setPriorityConversations] = useStoredState<Record<string, boolean>>(
    "vela.priorityConversations", {}, isBooleanRecord,
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollAreaRef.current;
    if (!scroller) return;
    let hideTimer: number | undefined;
    const showScrollbar = () => {
      scroller.classList.add("is-scrolling");
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        scroller.classList.remove("is-scrolling");
      }, 1000);
    };
    scroller.addEventListener("scroll", showScrollbar, { passive: true });
    return () => {
      window.clearTimeout(hideTimer);
      scroller.classList.remove("is-scrolling");
      scroller.removeEventListener("scroll", showScrollbar);
    };
  }, []);
  const priorityFocusRef = useRef<string | null>(null);
  // 优先标记会让行跨分组移动，重新挂载后恢复按钮焦点以便继续键盘操作。
  useEffect(() => {
    const id = priorityFocusRef.current;
    if (!id) return;
    priorityFocusRef.current = null;
    const buttons = sidebarRef.current?.querySelectorAll<HTMLButtonElement>(".subchat-priority") ?? [];
    [...buttons].find(button => button.dataset.conversationId === id && !button.closest("[inert]"))?.focus();
  }, [priorityConversations]);
  const [today, setToday] = useState(() => activityDay(Date.now()));
  const locale = useAppLocale();
  useEffect(() => {
    if (view !== "activity") return;
    const refresh = () => setToday(activityDay(Date.now()));
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [view]);
  const searchId = useId();
  const untitledLabel = tr("新对话", "New chat");
  const groups = useMemo(
    () => groupActiveConversations(allConversations, "", untitledLabel),
    [allConversations, untitledLabel],
  );
  const recentConversations = useMemo(
    () => searchActiveConversations(allConversations, "", untitledLabel).filter(conversation => conversation.hasWorkspace === false),
    [allConversations, untitledLabel],
  );
  const activityOptions = useMemo(() => ({ priorityConversations, waitingConversationIds }), [priorityConversations, waitingConversationIds]);
  const activityGroups = useMemo(
    () => groupActivityConversations(allConversations, activityOptions, today),
    [allConversations, activityOptions, today],
  );
  const togglePriority = (id: string) => {
    if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.conversationId === id) {
      priorityFocusRef.current = id;
    }
    setPriorityConversations(current => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };
  const renderConversation = (conversation: ConversationSummary) => (
    <ConversationRow conversation={conversation} active={conversation.id === activeConversationId}
      activity={view === "activity"} reason={activityReason(conversation, activityOptions)}
      priority={Boolean(priorityConversations[conversation.id])} locale={locale} today={today}
      onSelect={onSwitchConversation} onTogglePriority={togglePriority}
      onRename={onRenameConversation} onArchive={onArchiveConversation} />
  );

  const [collapsedWorkspaces, setCollapsedWorkspaces] = useStoredState<Record<string, boolean>>(
    "vela.collapsedWorkspaces", {}, isBooleanRecord,
  );
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const [pinnedWorkspaces, setPinnedWorkspaces] = useStoredState<Record<string, boolean>>(
    "vela.pinnedWorkspaces", {}, isBooleanRecord,
  );
  const [pinnedSectionCollapsed, setPinnedSectionCollapsed] = useStoredState<boolean>(
    "vela.pinnedWorkspacesCollapsed", false, isBoolean,
  );
  const pinnedGroups = useMemo(() => groups.filter(group => pinnedWorkspaces[group.cwd]), [groups, pinnedWorkspaces]);
  const otherGroups = useMemo(() => groups.filter(group => !pinnedWorkspaces[group.cwd]), [groups, pinnedWorkspaces]);
  // 置顶/取消置顶时工作区在两个列表之间移动:它在原列表里立即消失、在新列表里直接出现,避免短暂地同时显示两份。
  const movedWorkspaces = useRef(new Set<string>());
  useEffect(() => { movedWorkspaces.current.clear(); }, [pinnedWorkspaces]);
  const togglePinnedWorkspace = (cwd: string) => {
    movedWorkspaces.current.add(cwd);
    setPinnedWorkspaces(current => {
      const next = { ...current };
      if (next[cwd]) delete next[cwd];
      else next[cwd] = true;
      return next;
    });
  };
  const activeConversationItem = allConversations.find(
    (item) => item.id === activeConversationId && item.archivedAt === null,
  );
  const activeWorkspace = activeConversationItem ? conversationWorkspace(activeConversationItem) : null;

  // 激活对话变化时(新建/切换)自动展开它所在的工作区分组。
  useEffect(() => {
    if (!activeWorkspace) return;
    setCollapsedWorkspaces((current) =>
      current[activeWorkspace] ? { ...current, [activeWorkspace]: false } : current,
    );
  }, [activeWorkspace]);

  const renderGroup = (group: (typeof groups)[number]) => {
    const isCollapsed = Boolean(collapsedWorkspaces[group.cwd]);
    const groupName = workspaceTitle(workspaces, group.cwd);
    const isExpanded = Boolean(expandedWorkspaces[group.cwd]);
    const hasOverflow = group.conversations.length > workspaceConversationLimit;
    let visibleConversations = isExpanded ? group.conversations : group.conversations.slice(0, workspaceConversationLimit);
    // 搜索或外部入口打开较早的对话时，仍在收起后的列表里显示当前对话。
    const selected = group.conversations.find(conversation => conversation.id === activeConversationId);
    if (!isExpanded && selected && !visibleConversations.includes(selected)) {
      visibleConversations = [...visibleConversations.slice(0, workspaceConversationLimit - 1), selected];
    }
    const listId = `${searchId}-workspace-${encodeURIComponent(group.cwd)}`;
    return (
      <div className={`session-group${isCollapsed ? " collapsed" : ""}`} key={group.cwd}>
        <WorkspaceGroupRow
          cwd={group.cwd} name={groupName} folders={findWorkspace(workspaces, group.cwd)?.folders ?? []}
          chatCount={group.conversations.length} collapsed={isCollapsed} listId={listId}
          pinned={Boolean(pinnedWorkspaces[group.cwd])}
          onToggleCollapsed={() => {
            setCollapsedWorkspaces((current) => ({ ...current, [group.cwd]: !isCollapsed }));
            if (!isCollapsed) {
              setExpandedWorkspaces(current => ({ ...current, [group.cwd]: false }));
            }
          }}
          onTogglePin={() => togglePinnedWorkspace(group.cwd)}
          onEdit={onEditWorkspace ? () => onEditWorkspace(group.cwd) : undefined}
          overviewOpen={overviewWorkspace === group.cwd}
          onOpenOverview={onOpenWorkspaceOverview ? () => onOpenWorkspaceOverview(group.cwd) : undefined}
          onNewChat={() => onNewChat(group.cwd)} />
        <div id={listId} className={`session-group-content${isCollapsed ? "" : " is-open"}`}
          inert={isCollapsed} aria-hidden={isCollapsed || undefined}>
          <div className="session-group-content-inner">
            <MotionList className="subchat-list workspace-chat-list" items={visibleConversations} keyOf={(conversation) => conversation.id}>
              {renderConversation}
            </MotionList>
            {hasOverflow ? <button className="session-group-show-more" type="button"
              aria-expanded={isExpanded} aria-controls={listId}
              aria-label={`${isExpanded ? tr("收起", "Show less") : tr("展开显示", "Show more")} · ${groupName}`}
              onClick={() => setExpandedWorkspaces(current => ({ ...current, [group.cwd]: !isExpanded }))}>
              {isExpanded ? tr("收起", "Show less") : tr("展开显示", "Show more")}
            </button> : null}
          </div>
        </div>
      </div>
    );
  };

  const mod = modKeyLabel(platform);

  return (
    <aside ref={sidebarRef} className={`sidebar-left${collapsed ? " collapsed" : ""}${railMode ? " is-rail" : ""}`} inert={collapsed ? true : undefined}>
      <SidebarResizeHandle target="left" resize={resize} />
      <div className="sidebar-left-header">
        <div className="titlebar-drag-row">
          <button
            className="icon-btn-ghost"
            type="button"
            title={`${tr("收起侧边栏", "Collapse sidebar")} (${mod}B)`}
            aria-label={tr("收起侧边栏", "Collapse sidebar")}
            onClick={onToggle}
          >
            <Icon name="sidebar" size={14} />
          </button>
        </div>
        <div className="workspace-title-row">
          <div className="workspace-dropdown-trigger">
            <VelaLogoLockup />
          </div>
          <div className="sidebar-header-actions">
            {railMode && items.newChat ? <button className="icon-btn-ghost sidebar-new-chat-trigger" type="button"
              title={tr("新对话", "New chat")} aria-label={tr("新对话", "New chat")} onClick={() => onNewChat()}>
              <Icon name="compose" size={14} />
            </button> : null}
            <button className="icon-btn-ghost sidebar-activity-trigger" type="button"
              title={tr("活动视图：按优先级排布对话", "Activity view: chats ordered by priority")}
              aria-label={tr("活动视图", "Activity view")} aria-pressed={view === "activity"}
              onClick={() => setView(current => current === "activity" ? "workspaces" : "activity")}>
              <Icon name="bell" size={16} />
            </button>
            <button
              className="icon-btn-ghost sidebar-search-trigger"
              type="button"
              title={tr("搜索会话", "Search chats")}
              aria-label={tr("搜索会话", "Search chats")}
              aria-expanded={searchOpen}
              aria-haspopup="dialog"
              aria-controls={searchId}
              onClick={() => setSearchOpen(true)}
            >
              <Icon name="search" size={14} />
            </button>
          </div>
        </div>
      </div>

      {!railMode && Object.values(items).some(Boolean) ? <div className="sidebar-quick-actions">
        {items.prInbox ? <button className="quick-action-item" type="button" aria-current={prInboxOpen ? "page" : undefined} onClick={onOpenPrInbox}>
          <span className="quick-action-item-left"><Icon name="pull-request" size={16} /><span>Pull Request</span></span>
        </button> : null}
        {items.agentInbox ? <button className="quick-action-item" type="button" aria-current={agentInboxOpen ? "page" : undefined}
          aria-label={agentInboxBadge > 0 ? trf("Agent 收件箱，{0} 项需要处理", "Agent Inbox, {0} need your attention", agentInboxBadge) : undefined} onClick={onOpenAgentInbox}>
          <span className="quick-action-item-left"><Icon name="inbox" size={16} /><span>{tr("Agent 收件箱", "Agent Inbox")}</span></span>
          {agentInboxBadge > 0 ? <span className="quick-action-badge" aria-hidden="true">{agentInboxBadge > 99 ? "99+" : agentInboxBadge}</span> : null}
        </button> : null}
        {items.scheduledTasks ? <button className="quick-action-item" type="button" aria-current={scheduledTasksOpen ? "page" : undefined} onClick={onOpenScheduledTasks}>
          <span className="quick-action-item-left"><Icon name="clock" size={14} /><span>{tr("定时任务", "Scheduled Tasks")}</span></span>
        </button> : null}
        {items.newChat ? <button className="quick-action-item" type="button" onClick={() => onNewChat()}>
          <span className="quick-action-item-left">
            <Icon name="compose" size={14} />
            <span>{tr("新对话", "New chat")}</span>
          </span>
        </button> : null}
        {items.recipes ? <button className="quick-action-item" type="button" aria-current={recipesOpen ? "page" : undefined} onClick={onOpenRecipes}>
          <span className="quick-action-item-left"><Icon name="clipboard" size={16} /><span>{tr("任务配方", "Task Recipes")}</span></span>
        </button> : null}
      </div> : null}

      <div ref={scrollAreaRef} className="sidebar-scroll-area">
        {view === "activity" ? <div className="sidebar-activity-view">
          <MotionList items={activityGroups} keyOf={group => group.id}>{group => (
            <section className="activity-group" aria-label={activityGroupLabel(group.id)}>
              {group.id !== "priority" ? <div className="activity-group-header">
                <span>{activityGroupLabel(group.id)}</span>
                <span className="activity-group-count">{group.conversations.length}</span>
              </div> : null}
              <MotionList className="activity-list" items={group.conversations} keyOf={conversation => conversation.id}>
                {renderConversation}
              </MotionList>
            </section>
          )}</MotionList>
          {activityGroups.length === 0 ? <div className="sidebar-empty-hint" role="status">{tr("还没有会话", "No chats yet")}</div> : null}
        </div> : <>
          {pinnedGroups.length > 0 ? <section className="sidebar-pinned-workspaces" aria-label={tr("置顶", "Pinned")}>
            <button className="sidebar-section-title sidebar-section-toggle" type="button"
              aria-expanded={!pinnedSectionCollapsed} aria-controls={`${searchId}-pinned`}
              onClick={() => setPinnedSectionCollapsed(current => !current)}>
              <span>{tr("置顶", "Pinned")}</span>
              <span className={`sidebar-section-chevron${pinnedSectionCollapsed ? " collapsed" : ""}`} aria-hidden="true"><Icon name="chevron-down" size={12} /></span>
            </button>
            <div id={`${searchId}-pinned`} className={`session-group-content${pinnedSectionCollapsed ? "" : " is-open"}`}
              inert={pinnedSectionCollapsed} aria-hidden={pinnedSectionCollapsed || undefined}>
              <div className="session-group-content-inner">
                <MotionList className="session-groups" items={pinnedGroups} keyOf={(group) => group.cwd} instantKeys={movedWorkspaces.current}>{renderGroup}</MotionList>
              </div>
            </div>
          </section> : null}
          {pinnedGroups.length > 0 && otherGroups.length > 0 ? <div className="sidebar-section-title sidebar-workspaces-title">{tr("工作区", "Workspaces")}</div> : null}
          <MotionList className="session-groups" items={otherGroups} keyOf={(group) => group.cwd} instantKeys={movedWorkspaces.current}>{renderGroup}</MotionList>
          {recentConversations.length > 0 ? (
            <section className="sidebar-recent-chats" aria-label={tr("最近", "Recent")}>
              <div className="sidebar-section-title">{tr("最近", "Recent")}</div>
              <MotionList className="subchat-list recent-chat-list" items={recentConversations} keyOf={conversation => conversation.id}>
                {renderConversation}
              </MotionList>
            </section>
          ) : null}
          {groups.length === 0 && recentConversations.length === 0 ? (
            <div className="sidebar-empty-hint" role="status">{tr("还没有会话", "No chats yet")}</div>
          ) : null}
        </>}
      </div>

      {!railMode ? <div className="sidebar-left-footer">
        <button
          className={`sidebar-user-pill${settingsOpen ? " active" : ""}`}
          type="button"
          title={`${settingsLabel} (${mod},)`}
          aria-pressed={settingsOpen}
          onClick={onOpenSettings}
        >
          <span className="sidebar-settings-icon" aria-hidden="true">
            <Icon name="settings" size={14} />
          </span>
          <span className="user-name-text">{settingsLabel}</span>
          <span className="sidebar-shortcut-hint" aria-hidden="true">
            {mod},
          </span>
        </button>
      </div> : null}
      {searchOpen ? <ConversationSearchDialog
        id={searchId}
        conversations={allConversations}
        activeConversationId={activeConversationId}
        onSelect={onSwitchConversation}
        onNewChat={onNewChat}
        onClose={() => setSearchOpen(false)}
      /> : null}
    </aside>
  );
}

function activityGroupLabel(id: ActivityGroupId): string {
  switch (id) {
    case "priority": return tr("优先级", "Priority");
    case "today": return tr("今天", "Today");
    case "yesterday": return tr("昨天", "Yesterday");
    case "earlier": return tr("更早", "Earlier");
  }
}

function activityReasonLabel(reason: ActivityReason, conversation: ConversationSummary): string {
  switch (reason) {
    case "waiting": return tr("等待回答", "Waiting for your reply");
    case "error": return tr("发生错误", "Needs attention");
    case "priority": return tr("优先关注", "Marked as priority");
    case "streaming": return tr("正在回复", "Replying");
    case "starting": return tr("正在准备", "Starting");
    case "recent": return conversation.turnCompletedAt ? tr("已完成", "Completed") : tr("最近更新", "Recently updated");
  }
}

function WorkspaceGroupRow({ cwd, name, folders, chatCount, collapsed, listId, pinned, overviewOpen, onToggleCollapsed, onTogglePin, onEdit, onOpenOverview, onNewChat }: {
  cwd: string; name: string; folders: readonly string[]; chatCount: number; collapsed: boolean; listId: string; pinned: boolean;
  overviewOpen: boolean;
  onToggleCollapsed: () => void; onTogglePin: () => void; onEdit?: () => void; onOpenOverview?: () => void; onNewChat: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  /** 正在等待的动作:true 为打开、false 为关闭、null 为没有。 */
  const pending = useRef<boolean | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const schedule = (open: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    if (delay === 0) { pending.current = null; setCardOpen(open); return; }
    pending.current = open;
    timer.current = window.setTimeout(() => { pending.current = null; setCardOpen(open); }, delay);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div ref={rowRef} className="session-group-row"
      // 指针原本停在已卸载的节点上时(例如刚在卡片里点了置顶),React 收不到 mouseenter,所以也在 mousemove 里兜底。
      onMouseMove={() => { if (pending.current === false || (!cardOpen && pending.current === null)) schedule(true, cardOpen ? 0 : cardOpenDelayMs); }}
      onMouseLeave={() => schedule(false, cardCloseDelayMs)}
      onFocus={event => { if (event.target.matches(":focus-visible")) schedule(true, 0); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) schedule(false, 0); }}
      onKeyDown={event => { if (event.key === "Escape" && cardOpen) { event.stopPropagation(); schedule(false, 0); } }}>
      {onOpenOverview ? <button className="session-group-folder session-group-overview" type="button"
        title={tr("工作区总览", "Workspace overview")}
        aria-label={`${tr("工作区总览", "Workspace overview")} · ${name}`}
        aria-current={overviewOpen ? "page" : undefined} onClick={onOpenOverview}>
        <Icon name={collapsed ? "folder" : "folder-open"} size={16} />
      </button> : null}
      <button className={`session-group-header${onOpenOverview ? " has-overview" : ""}`} type="button" aria-expanded={!collapsed} aria-controls={listId}
        onClick={onToggleCollapsed}>
        {onOpenOverview ? null : <span className="session-group-folder" aria-hidden="true">
          <Icon name={collapsed ? "folder" : "folder-open"} size={16} />
        </span>}
        <span className="session-group-name">{name}</span>
        <span className="session-group-count">{chatCount}</span>
      </button>
      {onEdit ? <button className="subchat-action session-group-settings" type="button"
        title={tr("工作区设置", "Workspace settings")}
        aria-label={`${tr("工作区设置", "Workspace settings")} · ${name}`}
        onClick={onEdit}>
        <Icon name="sliders" size={14} />
      </button> : null}
      <button className="subchat-action session-group-new-chat" type="button"
        title={tr("新建对话", "New chat")} aria-label={`${tr("新建对话", "New chat")} · ${name}`}
        onClick={onNewChat}>
        <Icon name="compose" size={14} />
      </button>
      {cardOpen ? <WorkspaceHoverCard anchor={rowRef} name={name} cwd={cwd} folders={folders.filter(folder => folder !== cwd)}
        chatCount={chatCount} pinned={pinned} onTogglePin={onTogglePin}
        onEdit={onEdit ? () => { schedule(false, 0); onEdit(); } : undefined} /> : null}
    </div>
  );
}

function ConversationRow({ conversation, active, activity, reason, priority, locale, today, onSelect, onTogglePriority, onRename, onArchive }: {
  conversation: ConversationSummary; active: boolean; activity: boolean; reason: ActivityReason;
  priority: boolean; locale: string; today: number; onSelect: (id: string) => void;
  onTogglePriority: (id: string) => void; onRename?: (id: string) => void; onArchive: (id: string) => void;
}) {
  const title = displayConversationTitle(conversation.title);
  const conflictState = useContext(ConflictContext).state;
  const conflictCount = useMemo(() => overlapsForConversation(conflictState, conversation.id).length, [conflictState, conversation.id]);
  const conflictLabel = conflictCount > 0 ? trf("与其他对话改了同一处（{0} 个文件）", "Edits the same files as another chat ({0})", conflictCount) : "";
  const statusLabel = activityReasonLabel(reason, conversation);
  const priorityLabel = priority ? tr("取消优先关注", "Remove priority") : tr("设为优先关注", "Mark as priority");
  const workspaceLabel = conversation.hasWorkspace === false ? "" : workspaceName(conversationWorkspace(conversation));
  const worktreeLabel = conversation.worktree ? tr("工作树", "Worktree") : "";
  const updatedAt = new Date(conversation.updatedAt);
  const timeLabel = updatedAt.toLocaleString(locale, {
    ...(conversation.updatedAt < today ? { month: "2-digit", day: "2-digit" } as const : {}),
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return <div className={`subchat-row${activity ? " activity-row" : ""}${onRename ? " has-rename" : ""}`}>
    <button className={`subchat-item${active ? " active" : ""}`} type="button"
      title={activity ? [title, workspaceLabel ? conversation.cwd : "", worktreeLabel, `${statusLabel} · ${updatedAt.toLocaleString(locale)}`].filter(Boolean).join("\n") : title}
      aria-label={activity ? [title, workspaceLabel, worktreeLabel, statusLabel, conflictLabel].filter(Boolean).join(", ") : [title, worktreeLabel, conflictLabel].filter(Boolean).join(", ")}
      aria-current={active ? "page" : undefined} onClick={() => onSelect(conversation.id)}>
      {activity ? <span className="activity-row-content">
        <span className="activity-row-heading">
          <span className="subchat-title">{title}</span>
          {worktreeLabel ? <span className="subchat-worktree" role="img" aria-label={worktreeLabel} title={worktreeLabel}><Icon name="branch" size={12} /></span> : null}
          {conflictCount > 0 ? <span className="subchat-conflict" role="img" aria-label={conflictLabel} title={conflictLabel} /> : null}
          {workspaceLabel ? <span className="activity-workspace">{workspaceLabel}</span> : null}
        </span>
        <span className="activity-row-detail">
          <span className={`activity-status activity-status-${reason}`}>
            {reason === "streaming" || reason === "starting" ? <span className="subchat-streaming-dot" aria-hidden="true" /> : null}
            {statusLabel}
          </span>
          <time className="activity-time" dateTime={updatedAt.toISOString()}>{timeLabel}</time>
        </span>
      </span> : <>
        <span className="subchat-title">{title}</span>
        {worktreeLabel ? <span className="subchat-worktree" role="img" aria-label={worktreeLabel} title={worktreeLabel}><Icon name="branch" size={12} /></span> : null}
        {conflictCount > 0 ? <span className="subchat-conflict" role="img" aria-label={conflictLabel} title={conflictLabel} /> : null}
        {conversation.status === "streaming" ? <span className="subchat-streaming-dot" role="img" aria-label={tr("正在回复", "Replying")} title={tr("正在回复", "Replying")} /> : null}
      </>}
    </button>
    <button className="subchat-action subchat-priority" type="button" title={priorityLabel} data-conversation-id={conversation.id}
      aria-label={`${priorityLabel} “${title}”`} aria-pressed={priority} onClick={() => onTogglePriority(conversation.id)}>
      <Icon name="star" size={14} />
    </button>
    {onRename ? <button className="subchat-action subchat-rename" type="button"
      title={tr("重命名对话", "Rename chat")} aria-label={`${tr("重命名", "Rename")} “${title}”`}
      onClick={() => onRename(conversation.id)}><Icon name="edit" size={14} /></button> : null}
    <button className="subchat-action subchat-archive" type="button"
      title={tr("归档对话", "Archive chat")} aria-label={`${tr("归档", "Archive")} “${title}”`}
      onClick={() => onArchive(conversation.id)}><Icon name="archive" size={14} /></button>
  </div>;
}

