import { PrInboxPage } from "./components/PrInboxPage";
import { AgentInboxPage } from "./components/AgentInboxPage";
import { useAgentInbox } from "./hooks/useAgentInbox";
import { uiStorage } from "./ui-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyAgentUsage, type AgentInboxNavigation, type AgentInfo, type ReleaseNotes, type TaskRecipe } from "@vela/shared";
import { AgentWorkspaceProvider } from "./components/AgentPanel";
import { SessionChatView } from "./components/SessionChatView";
import { ContextPanel } from "./components/ContextPanel";
import { useMessages } from "./hooks/useMessages";
import { FileIconThemeProvider } from "./components/FileTypeIcon";
import { OnboardingView } from "./components/OnboardingView";
import { PlanDocumentProvider } from "./components/PlanPanel";
import { ScreenPresence } from "./components/MotionPresence";
import { Presence } from "./components/Presence";
import { SettingsView } from "./components/SettingsView";
import { UpdateNotice } from "./components/UpdateNotice";
import { WhatsNewCard } from "./components/WhatsNewCard";
import { restoreScreen, type OnboardingScreen } from "./components/onboarding-flow";
import { TaskRecipesPage, type RecipeMessageSeed } from "./components/TaskRecipesPage";
import { RecipeActionsContext } from "./components/recipe-actions-context";
import { RaceActionsContext } from "./components/race-actions-context";
import { useRaces } from "./hooks/useRaces";
import { ComposerSeedContext, type ComposerSeed } from "./components/composer-seed-context";
import { HandoffPackDialog } from "./components/HandoffPackDialog";
import { ScheduledTasksPage } from "./components/ScheduledTasksPage";
import { Sidebar } from "./components/Sidebar";
import { RenameConversationDialog } from "./components/RenameConversationDialog";
import { WorkspaceSettingsDialog } from "./components/WorkspaceSettingsDialog";
import { findWorkspace, folderName } from "./components/workspace-names";
import { CheckpointTimelineDialog } from "./components/CheckpointTimelineDialog";
import { FilePreviewProvider, type PreviewFileDescriptor } from "./components/preview/FilePreviewContext";
import type { StartTabAction } from "./components/StartView";
import { WorkbenchPanel, type WorkbenchTab } from "./components/WorkbenchPanel";
import { WorkbenchChatView } from "./components/WorkbenchChatView";
import { SideChatView } from "./components/SideChatView";
import { BrowserViewHost } from "./components/browser/BrowserViewHost";
import { useBrowserTabs } from "./browser/useBrowserTabs";
import { routeConversationLink } from "./browser/conversation-link-policy";
import { useModels } from "./hooks/useModels";
import { usePreferences } from "./hooks/usePreferences";
import { useNotificationSounds } from "./hooks/useNotificationSounds";
import { isBoolean, useStoredState } from "./hooks/useStoredState";
import { useProject } from "./hooks/useProject";
import { usePrInboxBackgroundRefresh } from "./hooks/usePrInboxCache";
import { useSidebarItems } from "./hooks/useSidebarItems";
import { useSession, type UiMessage } from "./hooks/useSession";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useAcceptance } from "./hooks/useAcceptance";
import type { AcceptanceRequest } from "./components/acceptance";
import { useTurnReview } from "./hooks/useTurnReview";
import type { TurnReviewRequest } from "./components/turn-changes";
import {
  emptyPlanDocumentState,
  planDocumentReducer,
  type PlanDocumentAction,
  type PlanDocumentState,
} from "./plan-draft";
import { AppLocaleProvider, localizeError, setActiveLocale, tr, trf } from "./locale";
import { createLogger } from "./logger";

const log = createLogger("app");

const onboardingCompleteKey = "vela.onboarding.complete";
const onboardingStepKey = "vela.onboarding.step";
const onboardingScreenKey = "vela.onboarding.screen";
const whatsNewSeenKey = "vela.whatsNew.seen";
const settingsPageKey = "vela.settingsPage";

function scopedTabId(kind: string, scope: string, id = ""): string {
  return `${kind}:${encodeURIComponent(scope)}${id ? `:${encodeURIComponent(id)}` : ""}`;
}

function fileTabId(workspaceKey: string, fileId: string): string {
  return scopedTabId("file", workspaceKey, fileId);
}

const filesTabId = "files";
const raceTabId = "races";

function readOnboardingComplete(): boolean {
  try {
    return uiStorage.getItem(onboardingCompleteKey) === "true";
  } catch {
    return false;
  }
}

/** 上次停在引导的哪一页；旧版本存的是数字步骤，一并兼容。 */
function readOnboardingScreen(): OnboardingScreen {
  try {
    return restoreScreen(uiStorage.getItem(onboardingScreenKey), uiStorage.getItem(onboardingStepKey));
  } catch {
    return "language";
  }
}

function readWhatsNewSeen(): string | null {
  try {
    return uiStorage.getItem(whatsNewSeenKey);
  } catch {
    return null;
  }
}

function writeWhatsNewSeen(version: string): void {
  try {
    uiStorage.setItem(whatsNewSeenKey, version);
  } catch {
    // 写不进去时，下次启动会再提示一次。
  }
}

/**
 * 从已渲染的工具记录里还原一个已结束子代理的快照。
 * agent 树只在内存里，应用重启后点击历史卡片时用它让 Agent Pane 仍能打开。
 */
function findAgentInMessages(messages: UiMessage[], agentId: string): AgentInfo | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const tools = messages[index]?.tools ?? [];
    for (const tool of tools) {
      const activity = tool.activity;
      if (activity?.agentId !== agentId) continue;
      const path = activity.agentPath ?? tool.name;
      const name = path.split("/").filter(Boolean).pop() ?? path;
      return {
        id: agentId,
        parentId: null,
        path,
        name,
        kind: activity.agent ?? "general",
        status: tool.status === "running" ? "running" : tool.status === "error" ? "failed" : "completed",
        depth: 1,
        task: "",
        steps: activity.steps ?? [],
        mutated: activity.mutated === true,
        finalText: tool.activity.body ?? null,
        error: null,
        usage: { ...emptyAgentUsage },
        activeMs: 0,
        runningSince: null,
        pauseRequested: false,
        createdAt: 0,
        updatedAt: 0,
      };
    }
  }
  return null;
}

export function App() {
  const preferences = usePreferences();
  const sounds = useNotificationSounds(preferences.soundEffects);
  const session = useSession(sounds.notify);
  const [renamingConversation, setRenamingConversation] = useState<{ id: string; title: string } | null>(null);
  const openRenameConversation = useCallback((id: string) => {
    const conversation = session.conversations.find(item => item.id === id);
    if (conversation) setRenamingConversation({ id, title: conversation.title });
  }, [session.conversations]);
  /** 检查点时间轴：打开时记录对话和预先选中的轮次。 */
  const [checkpoints, setCheckpoints] = useState<{ conversationId: string; turnIndex: number | null } | null>(null);
  const openCheckpoints = useCallback((turnIndex?: number) => {
    const id = session.activeConversationId;
    if (id) setCheckpoints({ conversationId: id, turnIndex: turnIndex ?? null });
  }, [session.activeConversationId]);
  const forkCheckpoint = useCallback((turnIndex: number, restoreFiles: boolean) =>
    session.forkCheckpoint(turnIndex, { restoreFiles }), [session.forkCheckpoint]);
  /** 任务交接包：预览确认后新建对话，并把交接文本填入新对话的输入框。 */
  const [handoff, setHandoff] = useState<{ conversationId: string; factsOnly?: boolean } | null>(null);
  const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null);
  const consumeComposerSeed = useCallback((id: string) => setComposerSeed(current => current?.id === id ? null : current), []);
  const offerComposerSeed = useCallback((conversationId: string, text: string) =>
    setComposerSeed({ id: crypto.randomUUID(), conversationId, text }), []);
  const startHandoff = useCallback(async (conversationId: string, text: string) => {
    const source = session.conversations.find(item => item.id === conversationId);
    const newId = await session.newChat(source && source.hasWorkspace !== false ? source.cwd : undefined);
    if (!newId) throw new Error("新建对话失败");
    setComposerSeed({ id: crypto.randomUUID(), conversationId: newId, text });
  }, [session.conversations, session.newChat]);
  const models = useModels(session.setAppState);
  const project = useProject(sounds.notify);
  setActiveLocale(preferences.locale);
  const [editingWorkspace, setEditingWorkspace] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useStoredState("vela.leftCollapsed", false, isBoolean);
  // Keep the conversation as the default focus; open the inspector when a tool
  // preview or workspace-change action needs it.
  const [rightCollapsed, setRightCollapsed] = useStoredState("vela.rightCollapsed", true, isBoolean);
  const [scheduledTasksOpen, setScheduledTasksOpen] = useState(false);
  const [prInboxOpen, setPrInboxOpen] = useState(false);
  const [agentInboxOpen, setAgentInboxOpen] = useState(false);
  const { snapshot: agentInbox } = useAgentInbox();
  const [agentInboxNav, setAgentInboxNav] = useState<{ target: AgentInboxNavigation; nonce: number } | null>(null);
  const agentInboxNavNonce = useRef(0);
  const handleAgentInboxNavigated = useCallback((nonce: number) => setAgentInboxNav(current => current?.nonce === nonce ? null : current), []);
  usePrInboxBackgroundRefresh(useSidebarItems().prInbox);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [recipeToUse, setRecipeToUse] = useState<TaskRecipe | null>(null);
  const consumeRecipeSelection = useCallback(() => setRecipeToUse(null), []);
  const [recipeSeed, setRecipeSeed] = useState<RecipeMessageSeed | null>(null);
  const recipeLeaveGuard = useRef<((action: () => void) => void) | null>(null);
  const registerRecipeLeave = useCallback((guard: ((action: () => void) => void) | null) => { recipeLeaveGuard.current = guard; }, []);
  const leaveRecipes = useCallback((action: () => void) => {
    const leave = () => { setRecipesOpen(false); action(); };
    if (recipeLeaveGuard.current) recipeLeaveGuard.current(leave); else leave();
  }, []);
  const openRecipes = useCallback(() => { setSettingsOpen(false); setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false); setRecipesOpen(true); }, []);
  const consumeRecipeSeed = useCallback(() => setRecipeSeed(null), []);
  // 通知点击、菜单栏入口：主进程要求打开收件箱的某个位置。窗口刚创建时订阅还没建立，先取走暂存的请求。
  useEffect(() => {
    const api = window.vela?.agentInbox;
    if (!api) return;
    let live = true;
    const open = (target: AgentInboxNavigation) => {
      if (!live) return;
      leaveRecipes(() => {
        setSettingsOpen(false); setScheduledTasksOpen(false); setPrInboxOpen(false); setAgentInboxOpen(true);
        agentInboxNavNonce.current += 1;
        setAgentInboxNav({ target, nonce: agentInboxNavNonce.current });
      });
    };
    const off = api.onNavigate(open);
    void api.takeNavigation().then(target => { if (target) open(target); }, () => {});
    return () => { live = false; off(); };
  }, [leaveRecipes]);
  const floatingInfo = preferences.infoLayout !== "sidebar";
  const infoCards = preferences.infoLayout === "cards";
  // 新对话的首页不显示右侧信息卡，发出第一句话后再出现。
  const conversationEmpty = useMessages(session.messageStore, session.activeConversationId).length === 0;
  const contextSidebarOpen = !floatingInfo && !rightCollapsed && !conversationEmpty && !scheduledTasksOpen && !recipesOpen && !prInboxOpen && !agentInboxOpen;
  const [environmentCollapsed, setEnvironmentCollapsed] = useStoredState("vela.environmentCollapsed", false, isBoolean);
  const toggleInfo = useCallback(() => {
    if (floatingInfo) setEnvironmentCollapsed(value => !value);
    else setRightCollapsed(value => !value);
  }, [floatingInfo]);
  const resize = useSidebarResize(!leftCollapsed, contextSidebarOpen, floatingInfo);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const workspaceKey = project.workspace?.current ?? "";
  const conversationKey = session.activeConversationId ?? "";
  const { review: turnReview, tabId: turnReviewTabId, open: showTurnReview, close: dismissTurnReview } = useTurnReview(workspaceKey, conversationKey);
  const { acceptance, tabId: acceptanceTabId, open: showAcceptance, close: dismissAcceptance } = useAcceptance(workspaceKey, conversationKey);
  const [reviewTargets, setReviewTargets] = useState<Record<string, { path: string; requestKey: number; diffToolId?: string }>>({});
  const [fileTabsByWorkspace, setFileTabsByWorkspace] = useState<Record<string, PreviewFileDescriptor[]>>({});
  const fileWorkspaceRef = useRef<string | null>(null);
  const [changesByWorkspace, setChangesByWorkspace] = useState<Record<string, {
    open: boolean;
    initialPath: string | null;
    requestKey: number;
  }>>({});
  const [dismissedAgentsByConversation, setDismissedAgentsByConversation] = useState<Record<string, string[]>>({});
  const [planDocuments, setPlanDocuments] = useState<Record<string, PlanDocumentState>>({});
  const planDocument = planDocuments[conversationKey] ?? emptyPlanDocumentState;
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const [activeWorkbenchTabId, setActiveWorkbenchTabId] = useState<string | null>(null);
  const [workbenchCollapsed, setWorkbenchCollapsed] = useState(false);
  useEffect(() => { setWorkbenchCollapsed(false); }, [activeWorkbenchTabId]);
  const [startTabState, setStartTabState] = useState<{ id: string }[]>([]);
  const [chatTabState, setChatTabState] = useState<{ id: string; conversationId: string }[]>([]);
  /** 侧边聊天不绑定工作区，切换目录或对话都保留；记忆跟随当前主对话。 */
  const [sideChatTabState, setSideChatTabState] = useState<{ id: string; number: number }[]>([]);
  const [pendingChatTabs, setPendingChatTabs] = useState<string[]>([]);
  const [startErrors, setStartErrors] = useState<Record<string, string>>({});
  const chatRequests = useRef(new Set<string>());
  const cancelledChatTabs = useRef(new Set<string>());
  const startTabsRef = useRef(startTabState);
  startTabsRef.current = startTabState;
  const chatWorkspaceRef = useRef(workspaceKey);
  chatWorkspaceRef.current = workspaceKey;
  const browser = useBrowserTabs(session.activeConversationId);
  const pendingBrowserTab = useRef<string | null>(null);
  const previousBrowserConversation = useRef(session.activeConversationId);
  const browserFocusNonce = useRef<number | null>(null);
  useEffect(() => {
    const focus = browser.state.focusRequest;
    if (!focus || browserFocusNonce.current === focus.nonce) return;
    browserFocusNonce.current = focus.nonce;
    if (!browser.tabs.some(tab => tab.id === focus.tabId)) return;
    setSettingsOpen(false);
    setWorkbenchCollapsed(false);
    setActiveWorkbenchTabId(focus.tabId);
  }, [browser.state.focusRequest, browser.tabs]);
  // 终端与文件浏览标签不按工作区拆开存:工作区状态加载前(地址为空)创建的标签
  // 不能因为工作区地址随后确定而消失;真正切换工作区时再统一关闭。
  const [terminalTabState, setTerminalTabState] = useState<{ id: string; sessionId: string; label: string }[]>([]);
  const [filesTabOpen, setFilesTabOpen] = useState(false);
  const raceState = useRaces();
  const [raceTabOpen, setRaceTabOpen] = useState(false);
  const lastKnownWorkspace = useRef("");
  const tabSeq = useRef(0);
  const lastOpenedPlanFocusNonce = useRef<number | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(readOnboardingComplete);
  const [onboardingScreen, setOnboardingScreen] = useState(readOnboardingScreen);
  const [introReplay, setIntroReplay] = useState(false);
  const [whatsNew, setWhatsNew] = useState<ReleaseNotes | null>(null);
  // 刚走完引导的这一次不再弹「新到港」：引导里已经看过了。
  const skipWhatsNew = useRef(false);
  const platform = window.vela?.platform ?? "darwin";
  const toggleLeft = useCallback(() => setLeftCollapsed(value => !value), [setLeftCollapsed]);
  const replyQuestion = useCallback((id: string, answer: string | null) => { void session.replyQuestion(id, answer); }, [session.replyQuestion]);
  const branchTurn = useCallback((index: number) => { void session.branch(index); }, [session.branch]);
  const dispatchPlanDocument = useCallback((action: PlanDocumentAction) => {
    setPlanDocuments((current) => ({
      ...current,
      [conversationKey]: planDocumentReducer(current[conversationKey] ?? emptyPlanDocumentState, action),
    }));
  }, [conversationKey]);

  const allAgents = useMemo(() => {
    const byId = new Map<string, AgentInfo>();
    for (const agent of session.agents) {
      if (agent.kind !== "root") byId.set(agent.id, agent);
    }
    for (const message of session.agentHistory) {
      for (const tool of message.tools) {
        const id = tool.activity?.agentId;
        if (!id || byId.has(id)) continue;
        const restored = findAgentInMessages(session.agentHistory, id);
        if (restored) byId.set(id, restored);
      }
    }
    return [...byId.values()];
  }, [session.agents, session.agentHistory]);

  const openPlan = useCallback((planId: string) => {
    dispatchPlanDocument({ type: "open", planId });
    setActiveWorkbenchTabId(scopedTabId("plan", conversationKey));
  }, [conversationKey, dispatchPlanDocument]);

  const closePlan = useCallback(() => dispatchPlanDocument({ type: "close" }), [dispatchPlanDocument]);
  const selectPlanRevision = useCallback(
    (planId: string) => dispatchPlanDocument({ type: "select", planId }),
    [dispatchPlanDocument],
  );

  const openAgentPane = useCallback((agentId: string) => {
    setDismissedAgentsByConversation((current) => ({
      ...current,
      [conversationKey]: (current[conversationKey] ?? []).filter((id) => id !== agentId),
    }));
    setActiveWorkbenchTabId(scopedTabId("agent", conversationKey, agentId));
  }, [conversationKey]);

  const openChanges = useCallback((path?: string) => {
    setChangesByWorkspace((current) => {
      const existing = current[workspaceKey] ?? { open: false, initialPath: null, requestKey: 0 };
      return {
        ...current,
        [workspaceKey]: { open: true, initialPath: path ?? null, requestKey: existing.requestKey + 1 },
      };
    });
    setActiveWorkbenchTabId(scopedTabId("changes", workspaceKey));
  }, [workspaceKey]);

  const onReviewTurn = useCallback((request: TurnReviewRequest) => {
    showTurnReview(request);
    setReviewTargets(current => { const next = { ...current }; delete next[turnReviewTabId]; return next; });
    setActiveWorkbenchTabId(turnReviewTabId);
  }, [showTurnReview, turnReviewTabId]);
  const onOpenAcceptance = useCallback((request: AcceptanceRequest) => {
    showAcceptance(request);
    setActiveWorkbenchTabId(acceptanceTabId);
  }, [showAcceptance, acceptanceTabId]);
  const onAcceptanceDiff = useCallback((request: AcceptanceRequest, path: string, diffToolId?: string) => {
    if (!request.changes?.files.some(file => file.path === path)) return;
    showTurnReview({ turnId: request.turnId, changes: request.changes });
    setReviewTargets(current => ({ ...current, [turnReviewTabId]: { path, diffToolId, requestKey: (current[turnReviewTabId]?.requestKey ?? 0) + 1 } }));
    setActiveWorkbenchTabId(turnReviewTabId);
  }, [showTurnReview, turnReviewTabId]);

  const onOpenFile = useCallback((file: PreviewFileDescriptor) => {
    fileWorkspaceRef.current = workspaceKey;
    setFileTabsByWorkspace((current) => {
      const files = current[workspaceKey] ?? [];
      const index = files.findIndex((item) => item.id === file.id);
      if (index < 0) return { ...current, [workspaceKey]: [...files, file] };
      return { ...current, [workspaceKey]: files.map((item, itemIndex) => itemIndex === index ? file : item) };
    });
    const id = fileTabId(workspaceKey, file.id);
    setTabOrder((current) => current.includes(id) ? current : [...current, id]);
    setActiveWorkbenchTabId(id);
  }, [workspaceKey]);

  const onCloseFileTab = useCallback((fileId: string) => {
    const owner = fileWorkspaceRef.current ?? workspaceKey;
    const id = fileTabId(owner, fileId);
    setFileTabsByWorkspace((current) => ({
      ...current,
      [owner]: (current[owner] ?? []).filter((file) => file.id !== fileId),
    }));
    setActiveWorkbenchTabId((current) => current === id ? null : current);
  }, [workspaceKey]);

  const onCloseAllFileTabs = useCallback((fileIds: string[]) => {
    const owner = fileWorkspaceRef.current ?? workspaceKey;
    const ids = new Set(fileIds);
    setFileTabsByWorkspace((current) => ({
      ...current,
      [owner]: (current[owner] ?? []).filter((file) => fileIds.length > 0 && !ids.has(file.id)),
    }));
    setActiveWorkbenchTabId((current) => {
      if (!current) return current;
      return fileIds.some((fileId) => current === fileTabId(owner, fileId)) ? null : current;
    });
    fileWorkspaceRef.current = null;
  }, [workspaceKey]);

  /** 新建起始标签页;⌘T 和标签栏的 + 都走这里。 */
  const openStartTab = useCallback(() => {
    tabSeq.current += 1;
    const id = `start:${tabSeq.current}`;
    setStartTabState((current) => current.some((tab) => tab.id === id) ? current : [...current, { id }]);
    setActiveWorkbenchTabId(id);
  }, []);

  const openTerminalTab = useCallback(() => {
    tabSeq.current += 1;
    const sessionId = `term-${tabSeq.current}`;
    const id = `terminal:${sessionId}`;
    setTerminalTabState((current) => [
      ...current,
      { id, sessionId, label: trf("终端 {0}", "Terminal {0}", current.length + 1) },
    ]);
    setActiveWorkbenchTabId(id);
  }, []);

  const openSideChatTab = useCallback(() => {
    tabSeq.current += 1;
    const id = `side-chat:${tabSeq.current}`;
    setSideChatTabState((current) => [...current, { id, number: Math.max(0, ...current.map((tab) => tab.number)) + 1 }]);
    setActiveWorkbenchTabId(id);
  }, []);

  const openFilesTab = useCallback(() => {
    setFilesTabOpen(true);
    setActiveWorkbenchTabId(filesTabId);
  }, []);

  // 在赛道对话里工作区会变成赛道的 worktree，所以也要按赛道的 worktree 匹配，面板才不会凭空消失。
  const workspaceRaces = useMemo(() => raceState.state.races
    .filter(race => race.status !== "discarded" && (race.workspace === workspaceKey || race.lanes.some(lane => lane.worktree === workspaceKey)))
    .sort((left, right) => right.createdAt - left.createdAt), [raceState.state.races, workspaceKey]);
  const openRaceTab = useCallback(() => {
    setRaceTabOpen(true);
    setActiveWorkbenchTabId(raceTabId);
  }, []);

  const openBrowserTab = useCallback((url?: string) => {
    const id = `browser:${crypto.randomUUID()}`;
    pendingBrowserTab.current = id;
    void browser.open(id, url).catch((error: unknown) => {
      if (pendingBrowserTab.current === id) pendingBrowserTab.current = null;
      setActiveWorkbenchTabId(current => current === id ? null : current);
      log.error("could not open browser tab", error);
    });
    setWorkbenchCollapsed(false);
    setActiveWorkbenchTabId(id);
  }, [browser.open]);

  const openConversationLink = useCallback((url: string) =>
    routeConversationLink(url, preferences.conversationLinkTarget, openBrowserTab),
  [preferences.conversationLinkTarget, openBrowserTab]);

  /** 起始页选好入口后关闭起始标签,换成对应内容。 */
  const handleStartAction = useCallback((tab: WorkbenchTab, action: StartTabAction) => {
    if (action === "chat") {
      const api = window.vela;
      if (!api || chatRequests.current.has(tab.id)) return;
      chatRequests.current.add(tab.id);
      setPendingChatTabs(current => [...current, tab.id]);
      setStartErrors(current => ({ ...current, [tab.id]: "" }));
      void api.createConversation(workspaceKey || undefined, { activate: false }).then(next => {
        const id = next.activeConversationId;
        if (!id) throw new Error(tr("新建对话失败", "Failed to create chat"));
        // 请求完成前关闭入口或切换目录时，不再把标签带回前台。
        if (cancelledChatTabs.current.has(tab.id) || chatWorkspaceRef.current !== workspaceKey || !startTabsRef.current.some(item => item.id === tab.id)) return;
        setChatTabState(current => [...current, { id: tab.id, conversationId: id }]);
        setStartTabState(current => current.filter(item => item.id !== tab.id));
      }).catch((error: unknown) => {
        setStartErrors(current => ({ ...current, [tab.id]: error instanceof Error ? localizeError(error.message) : tr("新建对话失败", "Failed to create chat") }));
      }).finally(() => {
        chatRequests.current.delete(tab.id);
        cancelledChatTabs.current.delete(tab.id);
        setPendingChatTabs(current => current.filter(id => id !== tab.id));
      });
      return;
    }
    setStartTabState((current) => current.filter((candidate) => candidate.id !== tab.id));
    if (action === "changes") openChanges();
    else if (action === "side-chat") openSideChatTab();
    else if (action === "terminal") openTerminalTab();
    else if (action === "browser") openBrowserTab();
    else openFilesTab();
  }, [openChanges, openSideChatTab, openTerminalTab, openFilesTab, openBrowserTab, workspaceKey]);

  const fileTabs = useMemo<WorkbenchTab[]>(() => (fileTabsByWorkspace[workspaceKey] ?? []).map((file) => ({
    id: fileTabId(workspaceKey, file.id),
    kind: "file",
    label: file.name,
    title: file.path,
    path: file.id,
  })), [fileTabsByWorkspace, workspaceKey]);
  const changesState = useMemo(
    () => changesByWorkspace[workspaceKey] ?? { open: false, initialPath: null, requestKey: 0 },
    [changesByWorkspace, workspaceKey],
  );
  const changeTab = useMemo<WorkbenchTab | null>(() => changesState.open
    ? { id: scopedTabId("changes", workspaceKey), kind: "changes", label: tr("变更", "Changes") }
    : null, [changesState.open, workspaceKey]);
  const planTab = useMemo<WorkbenchTab | null>(() => planDocument.activePlanId
    ? { id: scopedTabId("plan", conversationKey), kind: "plan", label: tr("计划", "Plan") }
    : null, [planDocument.activePlanId, conversationKey]);
  const reviewTab = useMemo<WorkbenchTab | null>(() => turnReview
    ? { id: turnReviewTabId, kind: "turn-review", label: tr("变更审查", "Change review"), review: turnReview, target: reviewTargets[turnReviewTabId] }
    : null, [turnReview, turnReviewTabId, reviewTargets, preferences.locale]);
  const acceptanceTab = useMemo<WorkbenchTab | null>(() => acceptance
    ? { id: acceptanceTabId, kind: "acceptance", label: tr("验收", "Acceptance"), acceptance }
    : null, [acceptance, acceptanceTabId, preferences.locale]);
  const agentTabs = useMemo<WorkbenchTab[]>(() => {
    const dismissedAgentIds = new Set(dismissedAgentsByConversation[conversationKey] ?? []);
    return allAgents.filter((agent) => !dismissedAgentIds.has(agent.id)).map((agent) => ({
      id: scopedTabId("agent", conversationKey, agent.id),
      kind: "agent",
      label: agent.name,
      title: agent.path,
      agent,
    }));
  }, [allAgents, dismissedAgentsByConversation, conversationKey]);
  const terminalTabs = useMemo<WorkbenchTab[]>(() => terminalTabState.map((tab) => ({
    id: tab.id,
    kind: "terminal",
    label: tab.label,
    sessionId: tab.sessionId,
  })), [terminalTabState]);
  const filesTab = useMemo<WorkbenchTab | null>(() => filesTabOpen
    ? { id: filesTabId, kind: "files", label: tr("文件", "Files") }
    : null, [filesTabOpen]);
  const raceTab = useMemo<WorkbenchTab | null>(() => raceTabOpen
    ? { id: raceTabId, kind: "race", label: tr("赛马", "Race") }
    : null, [raceTabOpen, preferences.locale]);
  const startTabItems = useMemo<WorkbenchTab[]>(() => startTabState.map((tab) => ({
    id: tab.id,
    kind: "start",
    label: tr("新标签页", "New tab"),
  })), [startTabState]);
  const chatTabs = useMemo<WorkbenchTab[]>(() => chatTabState.map(tab => ({
    ...tab,
    kind: "chat",
    label: session.conversations.find(item => item.id === tab.conversationId)?.title || tr("聊天", "Chat"),
  })), [chatTabState, session.conversations, preferences.locale]);
  const sideChatTabs = useMemo<WorkbenchTab[]>(() => sideChatTabState.map((tab) => ({
    id: tab.id,
    kind: "side-chat",
    label: tab.number > 1 ? trf("侧边聊天 {0}", "Side chat {0}", tab.number) : tr("侧边聊天", "Side chat"),
  })), [sideChatTabState, preferences.locale]);
  const unorderedTabs = useMemo<WorkbenchTab[]>(() => [
    ...fileTabs,
    ...(planTab ? [planTab] : []),
    ...(changeTab ? [changeTab] : []),
    ...(reviewTab ? [reviewTab] : []),
    ...(acceptanceTab ? [acceptanceTab] : []),
    ...(raceTab ? [raceTab] : []),
    ...agentTabs,
    ...(filesTab ? [filesTab] : []),
    ...terminalTabs,
    ...chatTabs,
    ...sideChatTabs,
    ...browser.tabs.map((tab): WorkbenchTab => ({ ...tab, kind: "browser", label: tr("浏览器", "Browser") })),
    ...startTabItems,
  ], [fileTabs, planTab, changeTab, reviewTab, acceptanceTab, raceTab, agentTabs, filesTab, terminalTabs, chatTabs, sideChatTabs, browser.tabs, startTabItems]);
  const workbenchTabs = useMemo(() => {
    const tabIdSet = new Set(unorderedTabs.map((tab) => tab.id));
    return [
      ...tabOrder.filter((id) => tabIdSet.has(id)).map((id) => unorderedTabs.find((tab) => tab.id === id)!),
      ...unorderedTabs.filter((tab) => !tabOrder.includes(tab.id)),
    ];
  }, [tabOrder, unorderedTabs]);
  const activeWorkbenchTab = workbenchTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null;

  useEffect(() => {
    const liveIds = new Set(unorderedTabs.map((tab) => tab.id));
    setTabOrder((current) => {
      const retained = current.filter((id) => liveIds.has(id));
      const next = [
        ...retained,
        ...unorderedTabs.filter((tab) => !retained.includes(tab.id)).map((tab) => tab.id),
      ];
      // 依赖恒定时返回原引用,避免 effect 里 setState 造成渲染死循环。
      const unchanged =
        next.length === current.length && next.every((id, index) => current[index] === id);
      return unchanged ? current : next;
    });
  }, [unorderedTabs]);

  useEffect(() => {
    const changedConversation = previousBrowserConversation.current !== session.activeConversationId;
    previousBrowserConversation.current = session.activeConversationId;
    if (changedConversation) pendingBrowserTab.current = null;
    const selected = browser.state.selected[conversationKey];
    if (selected && browser.tabs.some(tab => tab.id === selected) &&
      (changedConversation || activeWorkbenchTab?.kind === "browser") && !pendingBrowserTab.current) {
      setActiveWorkbenchTabId(selected);
    }
  }, [session.activeConversationId, conversationKey, browser.state.selected, browser.tabs, activeWorkbenchTab?.kind]);

  useEffect(() => {
    if (pendingBrowserTab.current) {
      if (!workbenchTabs.some(tab => tab.id === pendingBrowserTab.current)) return;
      pendingBrowserTab.current = null;
    }
    if (activeWorkbenchTabId && workbenchTabs.some((tab) => tab.id === activeWorkbenchTabId)) return;
    const selected = browser.state.selected[conversationKey];
    setActiveWorkbenchTabId(workbenchTabs.some(tab => tab.id === selected) ? selected : workbenchTabs.at(-1)?.id ?? null);
  }, [activeWorkbenchTabId, workbenchTabs, browser.state.selected, conversationKey]);

  // 真正切换工作区后旧目录的终端已失效,连同文件浏览与聊天标签一起关闭;
  // 启动时 "" → 工作区地址只是状态尚未到位,保留已有标签。
  useEffect(() => {
    const previous = lastKnownWorkspace.current;
    lastKnownWorkspace.current = workspaceKey;
    if (!previous || previous === workspaceKey) return;
    setTerminalTabState([]);
    setChatTabState([]);
    setFilesTabOpen(false);
  }, [workspaceKey]);

  // 启动瞬间打开的文件/变更标签会先落在 "" 作用域;工作区地址确定后归到真实 key,
  // 否则标签会因为工作区 key 变化而消失。
  useEffect(() => {
    if (!workspaceKey) return;
    const adopt = <T,>(record: Record<string, T>): Record<string, T> => {
      if (!("" in record)) return record;
      const { "": pending, ...rest } = record;
      return { ...rest, [workspaceKey]: pending };
    };
    setFileTabsByWorkspace(adopt);
    setChangesByWorkspace(adopt);
  }, [workspaceKey]);

  const openAllChanges = useCallback(() => openChanges(), [openChanges]);

  const closeActiveAgent = useCallback(() => {
    if (activeWorkbenchTab?.kind === "agent") {
      setDismissedAgentsByConversation((current) => ({
        ...current,
        [conversationKey]: [...new Set([...(current[conversationKey] ?? []), activeWorkbenchTab.agent.id])],
      }));
      setActiveWorkbenchTabId(null);
    }
  }, [activeWorkbenchTab, conversationKey]);

  const closeWorkbenchTab = useCallback((tab: WorkbenchTab) => {
    const index = workbenchTabs.findIndex((candidate) => candidate.id === tab.id);
    const neighbor = workbenchTabs[index + 1] ?? workbenchTabs[index - 1] ?? null;
    setActiveWorkbenchTabId((current) => current === tab.id ? neighbor?.id ?? null : current);
    setTabOrder((current) => current.filter((id) => id !== tab.id));
    if (tab.kind === "plan") {
      dispatchPlanDocument({ type: "close" });
    } else if (tab.kind === "changes") {
      setChangesByWorkspace((current) => ({
        ...current,
        [workspaceKey]: { ...changesState, open: false },
      }));
    } else if (tab.kind === "acceptance") {
      dismissAcceptance();
    } else if (tab.kind === "race") {
      setRaceTabOpen(false);
    } else if (tab.kind === "turn-review") {
      dismissTurnReview();
    } else if (tab.kind === "agent") {
      setDismissedAgentsByConversation((current) => ({
        ...current,
        [conversationKey]: [...new Set([...(current[conversationKey] ?? []), tab.agent.id])],
      }));
    } else if (tab.kind === "terminal") {
      setTerminalTabState((current) => current.filter((candidate) => candidate.id !== tab.id));
    } else if (tab.kind === "chat") {
      setChatTabState(current => current.filter(candidate => candidate.id !== tab.id));
    } else if (tab.kind === "side-chat") {
      setSideChatTabState(current => current.filter(candidate => candidate.id !== tab.id));
    } else if (tab.kind === "browser") {
      browser.close(tab.id);
    } else if (tab.kind === "files") {
      setFilesTabOpen(false);
    } else if (tab.kind === "start") {
      setStartTabState((current) => current.filter((candidate) => candidate.id !== tab.id));
    }
  }, [workbenchTabs, dispatchPlanDocument, workspaceKey, changesState, conversationKey, dismissTurnReview, dismissAcceptance, browser.close]);

  const workbenchOpen = workbenchTabs.length > 0;
  const previousWorkbenchOpen = useRef(false);
  useEffect(() => {
    // Only the opening edge folds the card; a manual expansion stays open.
    // The info cards sit over the chat column beside the workbench, so they stay up.
    const open = floatingInfo && preferences.infoLayout !== "cards" && workbenchOpen;
    if (open && !previousWorkbenchOpen.current) setEnvironmentCollapsed(true);
    previousWorkbenchOpen.current = open;
  }, [floatingInfo, preferences.infoLayout, workbenchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!onboardingComplete) return;
      if (document.querySelector(".rename-conversation-dialog[open], .conversation-search-dialog[open]")) return;
      if (event.key === "Escape") {
        // 对话框和输入框各自处理 Esc,只有停在设置页本身时才关闭设置。
        if (event.isComposing || document.querySelector(".sheet-presence")) return;
        if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
        setSettingsOpen(false);
        return;
      }
      const mod = platform === "darwin" ? event.metaKey : event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        setLeftCollapsed((value) => !value);
      } else if (key === "j") {
        event.preventDefault();
        toggleInfo();
      } else if (key === "t") {
        event.preventDefault();
        leaveRecipes(() => { setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false); openStartTab(); });
      } else if (event.code === "Comma") {
        event.preventDefault();
        leaveRecipes(() => { setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false); setSettingsOpen((open) => !open); });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onboardingComplete, platform, openStartTab, toggleInfo, leaveRecipes]);

  useEffect(() => {
    // <proposed_plan> 开始生成时自动打开 Plan Document，正文实时填入。
    if (!session.planFocus || lastOpenedPlanFocusNonce.current === session.planFocus.nonce) return;
    lastOpenedPlanFocusNonce.current = session.planFocus.nonce;
    openPlan(session.planFocus.planId);
  }, [session.planFocus, openPlan]);

  useEffect(() => {
    const vela = window.vela;
    if (!vela) return;
    // 应用菜单的「新建会话/设置」经主进程转发到这里,行为与侧边栏按钮一致。
    return vela.onMenuAction((action) => {
      if (!onboardingComplete) return;
      if (action === "new-chat") {
        leaveRecipes(() => { setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false); setSettingsOpen(false); void session.newChat(); });
      } else {
        leaveRecipes(() => { setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false); setSettingsOpen((open) => !open); });
      }
    });
  }, [onboardingComplete, session.newChat, leaveRecipes]);

  useEffect(() => {
    window.vela?.setLocale(preferences.locale);
  }, [preferences.locale]);

  // 更新后第一次打开：安装版读取包内的发布说明，没看过这个版本就盖一张「新到港」。
  useEffect(() => {
    if (!onboardingComplete || skipWhatsNew.current) return;
    const api = window.vela?.releaseNotes;
    if (!api) return;
    let active = true;
    void api.shouldAnnounce().then(async (announce) => {
      if (!announce || !active) return;
      const notes = await api.get(preferences.locale);
      if (active && notes && readWhatsNewSeen() !== notes.version && !skipWhatsNew.current) setWhatsNew(notes);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [onboardingComplete]);

  if (!session.available) {
    return (
      <div className="boot-fallback">
        <p>{tr("Vela 需要在桌面窗口中运行。", "Vela must run in the desktop app.")}</p>
      </div>
    );
  }

  return (
    <FileIconThemeProvider value={preferences.fileIconTheme}>
      <AppLocaleProvider locale={preferences.locale}>
        <RecipeActionsContext.Provider value={{ conversationId: session.activeConversationId, open: openRecipes, useRecipe: recipe => { setRecipeToUse(recipe); openRecipes(); }, fromMessage: seed => { setRecipeSeed(seed); openRecipes(); }, createHandoff: (conversationId, options) => setHandoff({ conversationId, ...(options?.factsOnly ? { factsOnly: true } : {}) }) }}>
        <RaceActionsContext.Provider value={{ started: openRaceTab, open: openRaceTab, count: workspaceRaces.length }}>
        <ComposerSeedContext.Provider value={{ seed: composerSeed, consume: consumeComposerSeed, offer: offerComposerSeed }}>
        <div className="app-screens">
          <BrowserViewHost tabs={browser.allTabs}
            activeTabId={browser.tabs.some(tab => tab.id === activeWorkbenchTabId) ? activeWorkbenchTabId : null}
            visible={onboardingComplete && !settingsOpen && !scheduledTasksOpen && !recipesOpen && !prInboxOpen && !agentInboxOpen && !workbenchCollapsed} hosted={browser.hosted} command={browser.command} />
          <ScreenPresence present={!onboardingComplete} className="app-screen-onboarding">
            <div className={`vela-window platform-${platform} onboarding-window`}>
              <OnboardingView
                preferences={preferences}
                models={models}
                project={project}
                initialScreen={onboardingScreen}
                onScreenChange={(screen) => {
                  try {
                    uiStorage.setItem(onboardingScreenKey, screen);
                  } catch {
                    // Keep onboarding usable when local storage is unavailable.
                  }
                }}
                onComplete={(options) => {
                  skipWhatsNew.current = true;
                  void window.vela?.releaseNotes?.get(preferences.locale).then((notes) => { if (notes) writeWhatsNewSeen(notes.version); }).catch(() => undefined);
                  setOnboardingComplete(true);
                  setSettingsOpen(Boolean(options?.settingsPage));
                  try {
                    if (options?.settingsPage) uiStorage.setItem(settingsPageKey, JSON.stringify(options.settingsPage));
                    uiStorage.setItem(onboardingCompleteKey, "true");
                    uiStorage.removeItem(onboardingStepKey);
                    uiStorage.removeItem(onboardingScreenKey);
                  } catch {
                    // Completion applies for this run even if storage is unavailable.
                  }
                }}
              />
            </div>
          </ScreenPresence>
          <ScreenPresence present={onboardingComplete} className="app-screen-main">
            <div className={`vela-window platform-${platform}${leftCollapsed ? " left-collapsed" : ""}${!contextSidebarOpen ? " right-collapsed" : ""}${floatingInfo ? " layout-floating" : ""}`}>
              <Sidebar
                prInboxOpen={prInboxOpen}
                onOpenPrInbox={() => leaveRecipes(() => { setSettingsOpen(false); setScheduledTasksOpen(false); setAgentInboxOpen(false); setPrInboxOpen(true); })}
                agentInboxOpen={agentInboxOpen}
                agentInboxBadge={agentInbox.badge}
                onOpenAgentInbox={() => leaveRecipes(() => { setSettingsOpen(false); setScheduledTasksOpen(false); setPrInboxOpen(false); setAgentInboxOpen(true); })}
                onOpenRecipes={openRecipes}
                recipesOpen={recipesOpen}
                onOpenScheduledTasks={() => leaveRecipes(() => {
                  setSettingsOpen(false);
                  setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(true);
                })}
                collapsed={leftCollapsed}
                resize={resize}
                platform={platform}
                conversations={session.conversations}
                waitingConversationIds={session.waitingConversationIds}
                scheduledTasksOpen={scheduledTasksOpen}
                activeConversationId={scheduledTasksOpen || recipesOpen || prInboxOpen || agentInboxOpen ? null : session.activeConversationId}
                settingsOpen={settingsOpen}
                settingsLabel={tr("设置", "Settings")}
                onToggle={() => setLeftCollapsed((value) => !value)}
                onOpenSettings={() => leaveRecipes(() => { setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false); setSettingsOpen((open) => !open); })}
                onNewChat={(cwd) => leaveRecipes(() => {
                  setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false); setSettingsOpen(false); void session.newChat(cwd);
                })}
                workspaces={project.workspace?.recents}
                onEditWorkspace={setEditingWorkspace}
                onSwitchConversation={(id) => leaveRecipes(() => {
                  setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false); setSettingsOpen(false); void session.switchTo(id);
                })}
                onArchiveConversation={(id) => void session.archive(id)}
                onRenameConversation={openRenameConversation}
              />
              <div className="main-stage">
                <FilePreviewProvider
                  onOpenFile={onOpenFile}
                  onCloseFileTab={onCloseFileTab}
                  onCloseAllFileTabs={onCloseAllFileTabs}
                >
                  <Presence present={!settingsOpen && !scheduledTasksOpen && !recipesOpen && !prInboxOpen && !agentInboxOpen} keepMounted={scheduledTasksOpen || recipesOpen || prInboxOpen || agentInboxOpen} className="main-stage-pane">
                    <PlanDocumentProvider
                      plans={session.state?.session.planRevisions ?? []}
                      draft={session.planDraft}
                      activePlanId={planDocument.activePlanId}
                      selectedRevisionId={planDocument.selectedRevisionId}
                      openPlan={openPlan}
                      closePlan={closePlan}
                      selectRevision={selectPlanRevision}
                    >
                      <AgentWorkspaceProvider
                        agents={allAgents}
                        activeAgentId={activeWorkbenchTab?.kind === "agent" ? activeWorkbenchTab.agent.id : null}
                        openAgent={openAgentPane}
                        closeAgent={closeActiveAgent}
                      >
                        <SessionChatView
                          messageStore={session.messageStore}
                          state={session.state}
                          sendError={session.sendError}
                          platform={platform}
                          leftCollapsed={leftCollapsed}
                          onToggleLeft={toggleLeft}
                          onRenameConversation={openRenameConversation}
                          rightCollapsed={floatingInfo ? environmentCollapsed : rightCollapsed}
                          onToggleRight={toggleInfo}
                          floatingInfo={floatingInfo}
                          infoCards={infoCards}
                          onResumeGoal={() => void session.resumeGoal()}
                          environmentCollapsed={environmentCollapsed}
                          changesActive={activeWorkbenchTab?.kind === "changes"}
                          project={project}
                          toolDisplay={preferences.toolDisplay}
                          toolFold={preferences.toolFold}
                          runView={preferences.runView}
                          toolProcessDetails={preferences.toolProcessDetails}
                          summaryEnabled={preferences.thinkingSummary}
                          summaryStyle={preferences.thinkingSummaryStyle}
                          summaryModel={preferences.thinkingSummaryModel}
                          predictionEnabled={preferences.inputPrediction}
                          predictionModel={preferences.inputPredictionModel}
                          locale={preferences.locale}
                          hiddenModels={preferences.hiddenModels}
                          sendButtonIcon={preferences.sendButtonIcon}
                          onSend={session.send}
                          onRemoveInstruction={session.removeInstruction}
                          onEdit={session.edit}
                          onAbort={session.abort}
                          onMode={session.setMode}
                          models={models}
                          question={session.question}
                          getQuestion={session.getQuestion}
                          onReplyQuestion={replyQuestion}
                          onBranch={branchTurn}
                          onOpenCheckpoints={openCheckpoints}
                          // 工作面板自己没开(没有标签页)或已折叠时,顶栏补一个新建标签页入口;
                          // 工作面板展开时它自己标签栏里的 + 已经够用,不再重复。
                          showNewTab={workbenchTabs.length === 0 || workbenchCollapsed}
                          onExpandWorkbench={workbenchCollapsed && workbenchTabs.length > 0
                            ? () => {
                              setWorkbenchCollapsed(false);
                              requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.workbench-tab[aria-selected="true"]')?.focus());
                            } : undefined}
                          onNewTab={openStartTab}
                          onOpenWebLink={openConversationLink}
                          onOpenChanges={openAllChanges}
                          onReviewTurn={onReviewTurn}
                          onOpenAcceptance={onOpenAcceptance}
                          planDraft={session.planDraft}
                          onOpenPlan={openPlan}
                        />
                      </AgentWorkspaceProvider>
                      <WorkbenchPanel
                        browserOperating={browser.state.operating.includes(conversationKey)}
                        tabs={workbenchTabs}
                        collapsed={workbenchCollapsed}
                        onCollapse={() => {
                          setWorkbenchCollapsed(true);
                          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".workbench-expand")?.focus());
                        }}
                        activeTabId={activeWorkbenchTabId}
                        contextOpen={contextSidebarOpen}
                        leftOpen={!leftCollapsed}
                        resize={resize}
                        project={project}
                        busy={session.state?.session.status !== "ready"}
                        execution={session.state?.session.executionPlan ?? null}
                        onRevise={() => void session.setMode("plan")}
                        onExecutePlan={(strategy) => void session.executePlan(strategy)}
                        initialDiffPath={changesState.initialPath}
                        initialDiffPathRequestKey={changesState.requestKey}
                        onShowDiff={openChanges}
                        onAcceptanceDiff={onAcceptanceDiff}
                        races={workspaceRaces}
                        onOpenConversation={id => { void session.switchTo(id); }}
                        onOpenAcceptance={onOpenAcceptance}
                        agents={allAgents}
                        messageStore={session.messageStore}
                        conversationId={session.activeConversationId}
                        toolDisplay={preferences.toolDisplay}
                        ensureAgentMessages={session.ensureAgentMessages}
                        onControlAgent={session.controlAgent}
                        onOpenAgent={openAgentPane}
                        onNewTab={openStartTab}
                        onStartAction={handleStartAction}
                        pendingStartTabIds={pendingChatTabs}
                        startErrors={startErrors}
                        renderChat={tab => <WorkbenchChatView key={tab.conversationId}
                          conversationId={tab.conversationId} preferences={preferences} project={project}
                          onRenameConversation={openRenameConversation}
                          onOpenConversation={id => { void session.switchTo(id); }}
                          onNewTab={openStartTab} onShowDiff={openChanges} onOpenWebLink={openConversationLink} />}
                        renderSideChat={(tab, visible) => <SideChatView key={tab.id}
                          conversationId={session.activeConversationId} locale={preferences.locale} visible={visible}
                          models={models} hiddenModels={preferences.hiddenModels}
                          defaultChoice={session.state?.session.modelProvider && session.state.session.modelId
                            ? { provider: session.state.session.modelProvider, id: session.state.session.modelId, thinkingLevel: session.state.session.thinkingLevel }
                            : null} />}
                        gitAvailable={Boolean(project.git?.repo)}
                        onActivateTab={(tab) => {
                          if (tab.kind === "browser") browser.select(tab.id);
                          setActiveWorkbenchTabId(tab.id);
                        }}
                        onCloseTab={closeWorkbenchTab}
                        onTabCloseRequested={tab => { if (chatRequests.current.has(tab.id)) cancelledChatTabs.current.add(tab.id); }}
                      />
                      {!floatingInfo ? <ContextPanel
                        collapsed={rightCollapsed || conversationEmpty}
                        leftOpen={!leftCollapsed}
                        resize={resize}
                        state={session.state}
                        planDraft={session.planDraft}
                        project={project}
                        onToggle={() => setRightCollapsed(true)}
                        onOpenPlan={openPlan}
                        onResumeGoal={() => void session.resumeGoal()}
                        changesActive={activeWorkbenchTab?.kind === "changes"}
                        onOpenChanges={openAllChanges}
                      /> : null}
                    </PlanDocumentProvider>
                  </Presence>
                </FilePreviewProvider>
                <Presence present={prInboxOpen} keepMounted className="main-stage-pane scheduled-tasks-stage">
                  <PrInboxPage active={prInboxOpen} sidebarCollapsed={leftCollapsed} onToggleSidebar={toggleLeft}
                    onOpenConversation={(id) => { setPrInboxOpen(false); setAgentInboxOpen(false); void session.switchTo(id); }} />
                </Presence>
                <Presence present={agentInboxOpen} keepMounted className="main-stage-pane scheduled-tasks-stage">
                  <AgentInboxPage active={agentInboxOpen} sidebarCollapsed={leftCollapsed} onToggleSidebar={toggleLeft}
                    messageStore={session.messageStore} ensureTranscript={session.ensureTranscript}
                    navigation={agentInboxNav} onNavigationHandled={handleAgentInboxNavigated}
                    catalog={models.catalog} catalogError={models.catalogError}
                    onOpenConversation={(id) => { setAgentInboxOpen(false); void session.switchTo(id); }} />
                </Presence>
                <Presence present={recipesOpen} className="main-stage-pane scheduled-tasks-stage">
                  <TaskRecipesPage catalog={models.catalog} workspace={project.workspace?.current ?? null}
                    workspaces={[...new Set([...(project.workspace?.recents.map(r => r.path) ?? []), ...session.conversations.filter(c => c.hasWorkspace !== false).map(c => c.cwd)])]}
                    locale={preferences.locale} sidebarCollapsed={leftCollapsed} onToggleSidebar={toggleLeft}
                    seed={recipeSeed} onConsumeSeed={consumeRecipeSeed} selectedRecipe={recipeToUse} onConsumeSelection={consumeRecipeSelection} registerLeaveGuard={registerRecipeLeave}
                    onOpenConversation={id => leaveRecipes(() => { void session.switchTo(id); })} />
                </Presence>
                <Presence present={scheduledTasksOpen} className="main-stage-pane scheduled-tasks-stage">
                  <ScheduledTasksPage
                    catalog={models.catalog}
                    catalogError={models.catalogError}
                    workspace={project.workspace?.current ?? null}
                    workspaces={project.workspace?.recents.map(recent => recent.path) ?? []}
                    sidebarCollapsed={leftCollapsed}
                    onToggleSidebar={toggleLeft}
                    onOpenConversation={(id) => {
                      setPrInboxOpen(false); setAgentInboxOpen(false); setScheduledTasksOpen(false);
                      void session.switchTo(id);
                    }}
                  />
                </Presence>
                <Presence present={settingsOpen && !scheduledTasksOpen && !recipesOpen && !prInboxOpen && !agentInboxOpen} className="main-stage-pane">
                  <SettingsView
                    onPreviewSound={sounds.preview}
                    preferences={preferences}
                    platform={platform}
                    project={project}
                    models={models}
                    conversations={session.conversations}
                    conversationId={session.activeConversationId}
                    onUnarchiveConversation={(id) => void session.unarchive(id)}
                    onClose={() => setSettingsOpen(false)}
                    onReplayIntro={() => setIntroReplay(true)}
                    onRestartOnboarding={() => {
                      // 开发版：回到引导的第一页（语言），不清除任何已保存的设置。
                      try {
                        uiStorage.removeItem(onboardingCompleteKey);
                        uiStorage.removeItem(onboardingStepKey);
                        uiStorage.setItem(onboardingScreenKey, "language");
                      } catch {
                        // 本次运行仍然生效。
                      }
                      setOnboardingScreen("language");
                      setSettingsOpen(false);
                      setOnboardingComplete(false);
                    }}
                  />
                </Presence>
              </div>
            </div>
          </ScreenPresence>
        </div>
        {checkpoints && checkpoints.conversationId === session.activeConversationId ? <CheckpointTimelineDialog
          key={checkpoints.conversationId}
          conversationId={checkpoints.conversationId}
          initialTurn={checkpoints.turnIndex}
          busy={session.state?.session.status === "streaming"}
          onRestore={session.restoreCheckpoint}
          onFork={forkCheckpoint}
          onClose={() => setCheckpoints(null)}
        /> : null}
        {renamingConversation ? <RenameConversationDialog
          key={renamingConversation.id}
          conversation={renamingConversation}
          onSave={session.rename}
          onClose={() => setRenamingConversation(null)}
        /> : null}
        {editingWorkspace ? <WorkspaceSettingsDialog
          key={editingWorkspace}
          workspace={findWorkspace(project.workspace?.recents, editingWorkspace)
            ?? { path: editingWorkspace, name: folderName(editingWorkspace), lastUsedAt: 0, folders: [] }}
          onSave={project.updateWorkspace}
          onRemove={project.removeRecentWorkspace}
          onPickFolder={project.pickWorkspaceFolder}
          onClose={() => setEditingWorkspace(null)}
        /> : null}
        {handoff ? <HandoffPackDialog
          key={handoff.conversationId}
          conversationId={handoff.conversationId}
          factsOnly={handoff.factsOnly}
          onConfirm={text => startHandoff(handoff.conversationId, text)}
          onClose={() => setHandoff(null)}
        /> : null}
        {onboardingComplete ? <UpdateNotice locale={preferences.locale} /> : null}
        {introReplay ? (
          <div className="ob-replay" role="dialog" aria-modal="true">
            <OnboardingView preferences={preferences} models={models} project={project} mode="intro" onComplete={() => setIntroReplay(false)} />
          </div>
        ) : null}
        {whatsNew && !introReplay ? (
          <WhatsNewCard notes={whatsNew} locale={preferences.locale} onClose={() => { writeWhatsNewSeen(whatsNew.version); setWhatsNew(null); }} />
        ) : null}
        </ComposerSeedContext.Provider>
        </RaceActionsContext.Provider>
        </RecipeActionsContext.Provider>
      </AppLocaleProvider>
    </FileIconThemeProvider>
  );
}
