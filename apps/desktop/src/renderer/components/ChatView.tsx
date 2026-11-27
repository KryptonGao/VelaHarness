import { displayConversationTitle } from "./conversation-title";
import { QuestionContext } from "./QuestionContext";
import { LazyMount } from "./LazyMount";
import { VersionControlView } from "./version-control/VersionControlView";
import { webChatMessages } from "./web-chat-messages";
import { isAgentBusy, visualToolName, type AppState, type AskUserQuestionRequest, type InteractionMode, type ToolTrace } from "@vela/shared";
import { Fragment, memo, startTransition, useCallback, useContext, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useOptimistic, useRef, useState, type ReactNode } from "react";
import { useAgentWorkspace } from "./AgentPanel";
import { modKeyLabel } from "../platform";
import { readModelHint, writeModelHint } from "../startup-hint";
import { useFloatingChatDrag } from "../hooks/useFloatingChatDrag";
import { useSecondClock } from "../hooks/useSecondClock";
import { finishTurnQuota, startTurnQuota, useTurnQuota } from "../hooks/useTurnQuota";
import { quotaProviderId } from "../hooks/useUsageLimits";
import { TurnQuotaPill } from "./TurnQuotaPill";
import { speakReply, stopSpeaking, useSpeechPlayback, useSpeechState } from "../hooks/useSpeech";
import { trackEnteredMessages, type EnterTrack } from "./message-motion";
import type { useModels } from "../hooks/useModels";
import type { ProjectApi } from "../hooks/useProject";
import type { ToolDisplay, ToolFold } from "../hooks/usePreferences";
import type { UiMessage } from "../hooks/useSession";
import type { MessageStore } from "../hooks/message-store";
import { RepoCard } from "./RepoCard";
import { Composer } from "./Composer";
import { TaskBudgetBanner } from "./TaskBudgetBanner";
import { ConflictBanner } from "./ConflictBanner";
import { TaskCostForecastHint } from "./TaskCostForecastHint";
import { RunViewDock } from "./RunViewDock";
import { PlanLiveContext } from "./PlanLiveContext";
import { latestTodoTool } from "../run-view";
import { JumpOrb } from "./JumpOrb";
import type { OrbActivity } from "./jump-orb";
import {
  AtelierBackdrop,
  NewChatAtelierHeader,
  NewChatAtelierLedger,
  NewChatDeckBento,
  NewChatDeckHeader,
  NewChatGreeting,
  NewChatPrompts,
  VelaMark,
} from "./NewChatHome";
import { useStartPageStyle, type StartPageStyle } from "../hooks/useStartPageStyle";
import { useHomePrompts } from "../hooks/useHomePrompts";
import { RaceActionsContext } from "./race-actions-context";
import { useContentArrival } from "./BatchMotion";
import { Markdown } from "./Markdown";
import { AssistantMarkdown } from "./intelligent-ui/AssistantMarkdown";
import { ConversationLinkContext } from "./ConversationLinkContext";
import { SelectionActions } from "./SelectionActions";
import { SideChatLauncherContext } from "./selection-actions";
import { replyStore, useReplyCards } from "../browser/reply-store";
import { handoffCommands } from "./annotation-images";
import { OpenInAppButton } from "./OpenInAppButton";
import { CoherentGroup, CoherentThought, ThinkingGroup } from "./Thinking";
import { groupsByReply, useNamedThinkingMessages, useThinkingGroupMode } from "./ThinkingGroupModeContext";
import { partitionThinkingGroups, supportsThinkingGroups } from "../thinking-model";
import { ThinkingSummaryContext } from "./ThinkingSummaryContext";
import type { ThinkingSummariesApi } from "../hooks/useThinkingSummaries";
import { ToolCard, ToolList, CompactToolGroup, CompactToolLine, ToolRunGroup, type QuestionLookup } from "./ToolCard";
import { VisualToolCard } from "./VisualToolCard";
import { toolCompactKind } from "./tool-compact";
import { attachFollowerTools, buildTurnItems, groupCoherentItems, groupProcessItems, hasCoherentTools, isFlatCoherentGroup, latestThoughtId, type CoherentNode, type ProcessNode } from "./tool-sequence";
import { readToolDuration } from "./tool-duration";
import { foldSequenceId } from "./tool-fold-state";
import { selectFinalReplies } from "./final-replies";
import { useToolExpanded, useToolProcessDetails, useToolsDuration } from "./ToolProcessContext";
import { PlanPreviewList } from "./PlanPanel";
import { collectPlanIds, planReferenceModel } from "../plan-draft";
import { SkillToken } from "./composer/SkillMenu";
import { parseSkillSegments } from "./composer/skill-picker";
import { useFilePreview } from "./preview/FilePreviewContext";
import { InfoCardStack } from "./info-cards/InfoCardStack";
import {
  isContentClamp,
  nextStreamFollow,
  releasesStreamFollow,
  shouldResumeFollowForMessages,
  shouldShowJumpToLatest,
} from "./chat-scroll";
import { outcomeByFinalMessage, type AcceptanceRequest } from "./acceptance";
import { ChangeSummaryPill } from "./composer/ChangeSummaryPill";
import { createLiveChangesSelector, summarizeTurnChanges, type TurnChanges, type TurnReviewRequest } from "./turn-changes";
import { chatLaneDefaultMaxWidth, planChatLane, planInfoCardLane } from "../chat-lane";
import { ConversationViewTabs, conversationPanelId, conversationTabId } from "./ConversationViewTabs";
import { isConversationDetail, isEmptyConversationView, type ConversationViewKey } from "./conversation-detail";
import { ConversationDetailView } from "./ConversationDetailView";
import type { QuestionReplyHandler } from "./QuestionCard";
import { RecommendedActionsCard } from "./RecommendedActionsCard";
import { latestRecommendedActions } from "./recommended-actions";
import { RecipeChatCard } from "./RecipeChatContext";
import { RecipeActionsContext } from "./recipe-actions-context";
import { ChatActionsMenu } from "./ChatActionsMenu";
import { UserMessageFrame } from "./UserMessageFrame";
import { TurnNav } from "./TurnNav";
import { TURN_NAV_MIN_TURNS, buildTurnNavItems, findActiveTurnIndex } from "./turn-nav";
import { ImageViewer, type ImageViewerRequest } from "./ImageViewer";
import { showToast } from "../toast";
import { localizeError, tr, trf, activeIntlLocale } from "../locale";
import { ProviderErrorCard } from "./ProviderErrorCard";
import { parseProviderError } from "./provider-error";
import { Icon } from "./icons";
import { FileTypeIcon } from "./FileTypeIcon";

interface FollowState {
  pinned: boolean;
  lastScrollTop: number;
  /** 上一次布局或滚动时的内容高度;高度缩小导致的滚动位置回退不是用户在向上滚。 */
  lastScrollHeight: number;
  ignoreScroll: boolean;
  conversationId: string | null | undefined;
  userMessageId: string | null | undefined;
}

function scrollFollowToEnd(scroller: HTMLDivElement, follow: FollowState) {
  const maxScroll = scroller.scrollHeight - scroller.clientHeight;
  follow.lastScrollHeight = scroller.scrollHeight;
  if (maxScroll - scroller.scrollTop < 1) {
    follow.lastScrollTop = scroller.scrollTop;
    return;
  }
  follow.ignoreScroll = true;
  scroller.scrollTop = scroller.scrollHeight;
  if (follow.ignoreScroll) {
    follow.ignoreScroll = false;
    follow.lastScrollTop = scroller.scrollTop;
  }
}

function latestUserMessageId(messages: UiMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.id;
  }
  return null;
}

interface MessageTurn {
  id: string;
  user: UiMessage | null;
  assistants: UiMessage[];
}

/** 按轮次缓存最终回复数组:新数组会让 CompletedAssistantTurn 的 memo 失效,流式时所有历史轮次每帧都重渲染。 */
const finalRepliesCache = new WeakMap<MessageTurn, UiMessage[]>();

function groupMessagesIntoTurns(messages: UiMessage[], previous: MessageTurn[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let current: MessageTurn | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      current = { id: message.id, user: message, assistants: [] };
      turns.push(current);
    } else {
      if (!current) {
        current = { id: message.id, user: null, assistants: [] };
        turns.push(current);
      }
      current.assistants.push(message);
    }
  }
  const old = new Map(previous.map(turn => [turn.id, turn]));
  return turns.map(turn => {
    const before = old.get(turn.id);
    return before && before.user === turn.user && before.assistants.length === turn.assistants.length &&
      before.assistants.every((message, index) => message === turn.assistants[index]) ? before : turn;
  });
}

function joinReplyText(replies: UiMessage[]): string {
  return replies.map((reply) => reply.text.trim()).filter(Boolean).join("\n\n");
}

function lastTextReplyId(replies: readonly UiMessage[]): string | null {
  for (let index = replies.length - 1; index >= 0; index -= 1) {
    if (replies[index]!.text.trim().length > 0) return replies[index]!.id;
  }
  return null;
}

function formatElapsedTime(startedAt: number | undefined, completedAt: number | undefined): string | null {
  if (startedAt === undefined || completedAt === undefined) return null;
  return formatWholeSeconds(completedAt - startedAt);
}

/** 只显示整秒,不带小数。 */
function formatWholeSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (totalSeconds < 1) return tr("不到 1 秒", "<1 sec");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return trf("{0}小时{1}分{2}秒", "{0}h {1}m {2}s", hours, minutes, seconds);
  if (minutes > 0 && seconds === 0) return trf("{0}分", "{0}m", minutes);
  if (minutes > 0) return trf("{0}分{1}秒", "{0}m {1}s", minutes, seconds);
  return trf("{0}秒", "{0}s", seconds);
}

/**
 * 运行中的轮次在最终回复出现前显示“已处理 xx”。回复完成后这一行会被
 * CompletedAssistantTurn 的“用时 xx”触发器接替,位置与分界线保持不变。
 */
function TurnProgressHeader({ startedAt, quota }: { startedAt: number; quota: string | null }) {
  const now = useSecondClock();
  const windows = useTurnQuota(startedAt);
  useEffect(() => {
    if (!quota) return;
    startTurnQuota(startedAt, quota);
    // 本轮结束（或离开这一轮）时补读最终额度。
    return () => finishTurnQuota(startedAt);
  }, [quota, startedAt]);
  const elapsed = formatElapsedTime(startedAt, now);
  if (!elapsed) return null;
  return (
    // 每秒更新的计时不进入 role="log" 的朗读范围。
    <span className="time-spent-trigger assistant-turn-trigger" aria-live="off">
      <span>{trf("已处理 {0}", "Worked {0}", elapsed)}</span>
      <TurnQuotaPill windows={windows} />
    </span>
  );
}

export interface ChatViewProps {
  /** 工作面板内复用消息与输入框，省去窗口级操作。 */
  embedded?: boolean;
  /** The user opened a new chat; its draft is available before the create IPC returns. */
  openingChat?: number | null;
  visible?: boolean;
  floatingChat?: boolean;
  conversationWorkbenchTabs?: boolean;
  onOpenWorkspaceOverview?: (workspace: string) => void;
  onOpenVersionControl?: (workspace: string) => void;
  onOpenAgentDirectory?: () => void;
  agentDirectoryActive?: boolean;
  messages: UiMessage[];
  messageStore?: MessageStore;
  state: AppState | null;
  sendError: string | null;
  platform: string;
  onRenameConversation?: (id: string) => void;
  floatingInfo?: boolean;
  /** 悬浮信息布局下，用可排序的信息卡片栈代替单张环境卡片。 */
  infoCards?: boolean;
  workbenchPhase?: "open" | "closing";
  onResumeGoal?: () => void;
  environmentCollapsed?: boolean;
  changesActive?: boolean;
  rightCollapsed: boolean;
  onToggleRight: () => void;
  project: ProjectApi;
  toolDisplay?: ToolDisplay;
  toolFold?: ToolFold;
  /** 运行视图:运行中在本轮过程末尾显示待办清单与当前步骤状态,随对话滚动。 */
  runView?: boolean;
  showChangeSummary?: boolean;
  thinkingSummaries?: ThinkingSummariesApi;
  /** 在输入框模型列表中隐藏的模型，key 为 `provider/id`。 */
  hiddenModels?: string[];
  /** 输入预测：回复结束后在空输入框里以灰色显示预测内容。 */
  predictionEnabled?: boolean;
  /** 预测使用的模型；null 表示跟随当前对话模型。 */
  predictionModel?: import("@vela/shared").ThinkingSummaryModel | null;
  /** 推荐操作：回复结束后在消息流末尾显示模型给出的后续操作卡片。 */
  recommendedActionsEnabled?: boolean;
  onSend: (text: string, images?: import("@vela/shared").ImageAttachment[], deliverAs?: import("@vela/shared").RuntimeInstructionMode) => Promise<void | boolean>;
  /** 撤销一条还没被模型消费的排队/调整指令。 */
  onRemoveInstruction: (instructionId: string) => Promise<void>;
  /** 把队列里的一条消息改成立即发送,不等当前任务完成。 */
  onPromoteInstruction?: (instructionId: string) => Promise<void>;
  onEdit?: (turnIndex: number, text: string, images?: import("@vela/shared").ImageAttachment[]) => Promise<void>;
  onAbort: () => Promise<void>;
  onMode: (mode: InteractionMode) => void | Promise<void>;
  models: ReturnType<typeof useModels>;
  question?: AskUserQuestionRequest | null;
  getQuestion: QuestionLookup;
  onReplyQuestion: QuestionReplyHandler;
  /** 从某一轮回复处分支出新对话;参数是可见用户消息的序号。 */
  onBranch: (turnIndex: number) => void;
  /** 打开检查点时间轴；传入轮次时选中那一轮。 */
  onOpenCheckpoints?: (turnIndex?: number) => void;
  /** 顶栏的「新建标签页」入口:工作面板没开、或右侧栏收起时才显示,避免和标签栏的 + 重复。 */
  showNewTab: boolean;
  onOpenWebLink?: (url: string) => boolean;
  onNewTab: () => void;
  onOpenChanges: () => void;
  onReviewTurn?: (request: TurnReviewRequest) => void;
  liveReviewId?: string;
  onRefreshReview?: (liveId: string, request: TurnReviewRequest) => void;
  onOpenAcceptance?: (request: AcceptanceRequest) => void;
  planDraft?: import("../plan-draft").PlanDraft | null;
  /** 当前对话的后台命令，信息卡片模式下显示在「后台任务」卡片里。 */
  backgroundShells?: readonly import("@vela/shared").BackgroundShellItem[];
  onOpenBackgroundTasks?: () => void;
  onOpenPlan?: (planId: string) => void;
}

export function ChatView({
  embedded = false,
  openingChat = null,
  visible = false,
  floatingChat = false,
  conversationWorkbenchTabs = false,
  onOpenWorkspaceOverview,
  onOpenVersionControl,
  onOpenAgentDirectory,
  agentDirectoryActive = false,
  messages: sourceMessages,
  messageStore,
  state,
  sendError,
  platform,
  onRenameConversation,
  rightCollapsed,
  onToggleRight,
  floatingInfo = false,
  infoCards = false,
  workbenchPhase,
  onResumeGoal,
  environmentCollapsed = false,
  changesActive = false,
  project,
  toolDisplay = "card",
  toolFold = "message",
  runView = false,
  showChangeSummary = true,
  thinkingSummaries,
  hiddenModels = [],
  predictionEnabled = false,
  predictionModel = null,
  recommendedActionsEnabled = true,
  onSend,
  onRemoveInstruction,
  onPromoteInstruction,
  onEdit,
  onAbort,
  onMode,
  models,
  question = null,
  getQuestion,
  onReplyQuestion,
  onBranch,
  onOpenCheckpoints,
  showNewTab,
  onOpenWebLink,
  onNewTab,
  onOpenChanges,
  onReviewTurn,
  liveReviewId,
  onRefreshReview,
  onOpenAcceptance,
  planDraft = null,
  backgroundShells = [],
  onOpenBackgroundTasks,
  onOpenPlan,
}: ChatViewProps) {
  const messages = useNamedThinkingMessages(sourceMessages);
  const thinkingGroupMode = useThinkingGroupMode();
  const tabIdPrefix = useId();
  const [views, setViews] = useState<Record<string, ConversationViewKey>>({});
  const [vcMounted, setVcMounted] = useState(false);
  const [imageView, setImageView] = useState<ImageViewerRequest | null>(null);
  const startSideChat = useContext(SideChatLauncherContext);
  const recipeActions = useContext(RecipeActionsContext);
  const raceActions = useContext(RaceActionsContext);
  const [raceOpenRequest, setRaceOpenRequest] = useState(0);
  const activeConversationId = state?.activeConversationId ?? null;
  /** 选中文字后点「回复」得到的引用、浏览器里的元素批注，随下一条消息一起发送。 */
  const replyKey = activeConversationId ?? "";
  const replies = useReplyCards(replyKey);
  // 选中文字的引用只属于当时的对话，切走就丢掉；元素批注属于浏览器标签页，保留。
  useEffect(() => () => replyStore.dropTextReplies(replyKey), [replyKey]);
  // 换会话时收起全屏查看器:里面是上一条对话的图片。
  useEffect(() => { setImageView(null); }, [state?.activeConversationId]);
  const viewKey = state?.activeConversationId ?? "empty";
  const hasWorkspace = state?.conversations?.find(conversation => conversation.id === state.activeConversationId)?.hasWorkspace
    ?? Boolean(project.workspace?.current);
  const distillMemoryAction = recipeActions?.distillMemory;
  const distillMemory = useMemo(
    () => (hasWorkspace && activeConversationId && distillMemoryAction
      ? (turnIndex: number | null) => distillMemoryAction(activeConversationId, turnIndex !== null ? { upToTurn: turnIndex } : undefined)
      : undefined),
    [hasWorkspace, activeConversationId, distillMemoryAction],
  );
  const savedView = views[viewKey] ?? "chat";
  const emptyConversation = messages.length === 0;
  const showViewTabs = !floatingChat && !conversationWorkbenchTabs;
  const view = !showViewTabs || (savedView === "versionControl" && !hasWorkspace) || isEmptyConversationView(savedView, emptyConversation) ? "chat" : savedView;
  const setView = (next: ConversationViewKey) => {
    if (next === "versionControl" && !hasWorkspace) return;
    if (next === "versionControl") setVcMounted(true);
    setViews(current => ({ ...current, [viewKey]: next }));
  };
  // 当前对话没有待回答的问题时无需扫描消息；有问题时只在消息或问题变化时重算。
  const hasPendingQuestion = useMemo(
    () => question !== null && messages.some(message => message.tools.some(tool => getQuestion(tool.id))),
    [messages, question, getQuestion],
  );
  const pendingInteraction = Boolean(project.approval) || hasPendingQuestion;
  const session = state?.session;
  // Keep immediate mode feedback local while the runtime applies the change.
  const [pendingMode, setPendingMode] = useOptimistic<{ id: string; mode: InteractionMode } | null>(null);
  const mode = pendingMode && pendingMode.id === activeConversationId ? pendingMode.mode : session?.mode ?? "agent";
  const changeMode = (next: InteractionMode) => {
    if (!activeConversationId || next === mode) return;
    startTransition(async () => {
      setPendingMode({ id: activeConversationId, mode: next });
      await onMode(next);
    });
  };
  // 冷启动时会话还没就绪,先用上次的模型占位;禁用状态和 modelReady 仍以真实会话为准。
  const [modelHint] = useState(readModelHint);
  const hintModel = !embedded && !session?.modelProvider ? modelHint : null;
  const rememberModel = useEffectEvent(() => {
    if (embedded || session?.status !== "ready" || !session.modelReady || !session.model || !session.modelProvider || !session.modelId) return;
    writeModelHint({
      label: session.model,
      provider: session.modelProvider,
      id: session.modelId,
      thinkingLevel: session.thinkingLevel,
      thinkingLevels: session.thinkingLevels,
    });
  });
  // IPC snapshots clone the levels array even when the model is unchanged.
  const thinkingLevelsKey = session?.thinkingLevels?.join(",");
  useEffect(() => { rememberModel(); }, [
    embedded, session?.status, session?.modelReady, session?.model, session?.modelProvider, session?.modelId,
    session?.thinkingLevel, thinkingLevelsKey,
  ]);
  const streaming = session?.status === "streaming";
  const [floatExpanded, setFloatExpanded] = useState(streaming);
  useLayoutEffect(() => { setFloatExpanded(streaming); }, [activeConversationId, floatingChat, streaming]);
  const [floatHidden, setFloatHidden] = useState(false);
  const visibleConversation = visible && view === "chat" && !imageView && (!floatingChat || (floatExpanded && !floatHidden))
    ? activeConversationId : null;
  useLayoutEffect(() => {
    const inbox = window.vela?.agentInbox;
    if (!inbox || !visibleConversation) return;
    void inbox.setVisibleConversation(tabIdPrefix, visibleConversation).catch(() => {});
    return () => { void inbox.setVisibleConversation(tabIdPrefix, null).catch(() => {}); };
  }, [tabIdPrefix, visibleConversation]);
  const { chatRef, headerEvents, resizeHandle, resizeEvents } = useFloatingChatDrag(floatingChat && !floatHidden, setFloatExpanded);
  const restoreFloatRef = useRef<HTMLButtonElement>(null);
  const focusAfterFloatToggle = useRef(false);
  useLayoutEffect(() => {
    if (!floatingChat || !focusAfterFloatToggle.current) return;
    focusAfterFloatToggle.current = false;
    const target = floatHidden ? restoreFloatRef.current : chatRef.current?.querySelector<HTMLElement>(".rich-input");
    target?.focus({ preventScroll: true });
  }, [floatingChat, floatHidden, chatRef]);
  function toggleFloatHidden() {
    focusAfterFloatToggle.current = true;
    setFloatHidden(hidden => !hidden);
  }
  const floatToggleLabel = floatExpanded ? tr("收起聊天浮窗", "Collapse floating chat") : tr("展开聊天浮窗", "Expand floating chat");
  const floatHideLabel = tr("隐藏聊天浮窗", "Hide floating chat");
  const floatShowLabel = tr("显示聊天浮窗", "Show floating chat");
  // 服务限额类报错在对话流里显示成卡片,输入框上方不再重复一行红字。
  const providerError = useMemo(() => parseProviderError(sendError), [sendError]);
  // 只有正在运行的这一轮里最新一次提交的待办还在进行;已结束的轮次和被取代的待办都算已结束。
  const liveTodoId = streaming ? latestTodoTool(messages)?.id ?? null : null;
  const planLive = useMemo(() => ({ liveToolId: liveTodoId }), [liveTodoId]);
  // 末条是已结束的助手回复时，它的 id 就是这一轮预测的依据；其余情况不预测。
  const lastMessage = messages[messages.length - 1];
  const predictionKey = lastMessage?.role === "assistant" && !streaming && lastMessage.text.trim() ? `${lastMessage.id}:${lastMessage.text.length}` : null;
  const [dismissedRecommendations, setDismissedRecommendations] = useState<ReadonlySet<string>>(() => new Set());
  const turnRecommendation = useMemo(() => latestRecommendedActions(messages), [messages]);
  const recommendation = recommendedActionsEnabled && session?.status === "ready" && !pendingInteraction &&
    turnRecommendation && !dismissedRecommendations.has(turnRecommendation.id)
    ? turnRecommendation
    : null;
  // 从末尾往前找最后一条助手消息，不复制数组；流式时它几乎总在末尾附近。
  const activeAssistant = useMemo(() => {
    if (!streaming) return undefined;
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]!.role === "assistant") return messages[index];
    }
    return undefined;
  }, [messages, streaming]);
  const activeAssistantId = activeAssistant?.id;
  // 回到最新按钮的圆球状态:有 bash 在跑 = 运行命令;助手还没写出正文 = 思考;其余显示箭头。
  const runningBash = activeAssistant?.tools.find((tool) => (tool.name === "bash" || tool.name === "edit" || tool.name === "write") && tool.status === "running");
  const jumpActivity: OrbActivity | undefined = !activeAssistant
    ? undefined
    : runningBash
      ? "command"
      : !activeAssistant.text
        ? "thinking"
        : undefined;
  const title = displayConversationTitle(session?.title);
  // 空对话用「首页」布局:问候、输入框、预设整体居中,而不是输入框贴底。
  // 极简起始页:不用首页布局,空对话只剩贴底的输入框。
  const startPageStyle = useStartPageStyle();
  const minimalStart = startPageStyle === "minimal";
  const homePromptsEnabled = useHomePrompts();
  const homeLayout = !floatingChat && !embedded && messages.length === 0 && !minimalStart;
  const activeHomeStyle: StartPageStyle | undefined = homeLayout ? startPageStyle : undefined;
  const hasProjectWorkspace = Boolean(project.workspace?.current);
  const modelMissing = session?.status === "ready" && !session.modelReady;
  const showHomePrompts = homeLayout && hasProjectWorkspace && !modelMissing && homePromptsEnabled;
  const composerDisabled = session?.status !== "ready" && session?.status !== "streaming";
  const modeDisabled = composerDisabled || Boolean(streaming);
  const canRace = Boolean(raceActions && project.workspace?.current && window.vela?.races && session?.modelReady);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const followRef = useRef<FollowState>({
    pinned: true,
    lastScrollTop: 0,
    lastScrollHeight: 0,
    ignoreScroll: false,
    conversationId: undefined,
    userMessageId: undefined,
  });

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState(0);
  const activeTurnIndexRef = useRef(0);
  activeTurnIndexRef.current = activeTurnIndex;
  const jumpLockRef = useRef<{ cancel: () => void } | null>(null);
  const syncActiveTurnRef = useRef<() => void>(() => {});
  const syncJumpToLatest = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setShowJumpToLatest(
      shouldShowJumpToLatest({
        following: followRef.current.pinned,
        distanceFromBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
      }),
    );
  }, []);

  // 同步执行而不是排到下一帧:流式追加内容后,新高度和贴底滚动必须在同一次绘制前完成,
  // 否则会有一帧内容已变长、滚动位置还是旧的,下方的清单和状态条整块错位一下再弹回。
  const layoutRef = useRef<() => void>(() => {});
  layoutRef.current = () => {
    const scroller = scrollerRef.current;
    const dock = dockRef.current;
    const root = scroller?.parentElement;
    if (!scroller || !dock || !root || view !== "chat") return;
    const height = dock.getBoundingClientRect().height;
    if (height > 0) {
      const dockHeight = `${Math.ceil(height)}px`;
      if (root.style.getPropertyValue("--composer-dock-height") !== dockHeight) root.style.setProperty("--composer-dock-height", dockHeight);
    }
    if (followRef.current.pinned) scrollFollowToEnd(scroller, followRef.current);
    syncJumpToLatest();
    syncActiveTurnRef.current();
  };
  const scheduleLayout = useCallback(() => layoutRef.current(), []);

  const jumpToLatest = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    jumpLockRef.current?.cancel();
    followRef.current.pinned = true;
    scrollFollowToEnd(scroller, followRef.current);
    setShowJumpToLatest(false);
    syncActiveTurnRef.current();
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const dock = dockRef.current;
    const root = scroller?.parentElement;
    if (!scroller || !dock || !root) return;

    let scrollbarHideTimer: number | undefined;
    let activeTurnRaf = 0;
    const scheduleActiveTurnSync = () => {
      if (activeTurnRaf || jumpLockRef.current) return;
      activeTurnRaf = window.requestAnimationFrame(() => {
        activeTurnRaf = 0;
        syncActiveTurnRef.current();
      });
    };
    const showScrollbar = () => {
      scroller.classList.add("is-scrolling");
      window.clearTimeout(scrollbarHideTimer);
      scrollbarHideTimer = window.setTimeout(() => {
        scroller.classList.remove("is-scrolling");
      }, 800);
    };

    const onScroll = () => {
      showScrollbar();
      scheduleActiveTurnSync();
      const follow = followRef.current;
      if (follow.ignoreScroll) {
        follow.ignoreScroll = false;
        follow.lastScrollTop = scroller.scrollTop;
        return;
      }
      const scrollTop = scroller.scrollTop;
      const distanceFromBottom = scroller.scrollHeight - scrollTop - scroller.clientHeight;
      // 内容变矮(例如总结行替换成更短的内容)时浏览器会把滚动位置往回夹,这不是用户在向上滚。
      const clamped = isContentClamp({
        scrollHeight: scroller.scrollHeight,
        previousScrollHeight: follow.lastScrollHeight,
        scrollTop,
        previousScrollTop: follow.lastScrollTop,
      });
      follow.lastScrollHeight = scroller.scrollHeight;
      if (clamped) {
        follow.lastScrollTop = scrollTop;
        if (follow.pinned) scheduleLayout();
        syncJumpToLatest();
        return;
      }
      const wasPinned = follow.pinned;
      follow.pinned = nextStreamFollow({
        following: follow.pinned,
        scrollTop,
        previousScrollTop: follow.lastScrollTop,
        distanceFromBottom,
      });
      if (!wasPinned && follow.pinned) scheduleLayout();
      else follow.lastScrollTop = scrollTop;
      syncJumpToLatest();
    };

    const cancelJumpLock = () => {
      jumpLockRef.current?.cancel();
    };
    const releaseIfScrollingUp = (towardEarlier: boolean) => {
      cancelJumpLock();
      if (releasesStreamFollow(scroller.scrollTop, towardEarlier)) {
        followRef.current.pinned = false;
        syncJumpToLatest();
      }
    };
    const onWheel = (event: WheelEvent) => releaseIfScrollingUp(event.deltaY < 0);

    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => {
      cancelJumpLock();
      touchY = event.touches[0]?.clientY ?? touchY;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y == null) return;
      releaseIfScrollingUp(y > touchY + 2);
      touchY = y;
    };

    scheduleLayout();
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(dock);
    // 展开思考或工具差异会改变消息高度,即使消息本身没有更新,贴底时也要跟随到底部,
    // 否则新增内容会被固定在底部的输入框挡住。
    const contentObserver = new ResizeObserver(scheduleLayout);
    const observedContent = new Set<Element>();
    const syncObservedContent = () => {
      const content = new Set(Array.from(scroller.children));
      for (const child of observedContent) {
        if (!content.has(child)) {
          contentObserver.unobserve(child);
          observedContent.delete(child);
        }
      }
      for (const child of content) {
        if (!observedContent.has(child)) {
          observedContent.add(child);
          contentObserver.observe(child);
        }
      }
    };
    syncObservedContent();
    const contentMutations = new MutationObserver(syncObservedContent);
    contentMutations.observe(scroller, { childList: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: true });
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    scroller.addEventListener("pointerdown", cancelJumpLock, { passive: true });
    return () => {
      window.clearTimeout(scrollbarHideTimer);
      if (activeTurnRaf) window.cancelAnimationFrame(activeTurnRaf);
      jumpLockRef.current?.cancel();
      scroller.classList.remove("is-scrolling");
      observer.disconnect();
      contentObserver.disconnect();
      contentMutations.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("pointerdown", cancelJumpLock);
      root.style.removeProperty("--composer-dock-height");
    };
  }, [scheduleLayout, syncJumpToLatest]);

  // 流式输出时只有贴着底部才跟随;用户向上滚之后保持当前位置。
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const follow = followRef.current;
    const conversationId = state?.activeConversationId ?? null;
    const userMessageId = latestUserMessageId(messages);
    if (
      shouldResumeFollowForMessages({
        conversationChanged: conversationId !== follow.conversationId,
        previousUserMessageId: follow.userMessageId ?? null,
        userMessageId,
      })
    ) {
      follow.pinned = true;
    }
    follow.conversationId = conversationId;
    follow.userMessageId = userMessageId;
    if (follow.pinned) scheduleLayout();
  }, [messages, state?.activeConversationId, scheduleLayout, view]);

  const messageSurfaceKey = JSON.stringify([project.workspace?.current ?? null, state?.activeConversationId ?? null]);
  const messageSurfaceRef = useContentArrival(messageSurfaceKey, 180, 6);

  const [infoCardsConcealed, setInfoCardsConcealed] = useState(true);
  // 信息卡片按避让后的文字宽度决定显隐;单张环境卡片按对话列的收窄预算避让。
  // 隐藏后仍测量卡片未变换的布局位置,避免隐藏释放空间后又立即显示。
  useLayoutEffect(() => {
    const pane = scrollerRef.current?.parentElement;
    if (!floatingInfo || !pane) return;

    const stage = infoCards && !environmentCollapsed ? pane.closest<HTMLElement>(".main-stage-pane") : null;
    const chat = pane.parentElement;
    const canvas = workbenchPhase && stage?.querySelector<HTMLElement>(":scope > .workbench-clip > .workbench-panel > .workbench-canvas");
    let moving = !!canvas && !!pane.querySelector(workbenchPhase === "closing"
      ? ":scope > .info-card-stack[data-concealed]" : ":scope > .info-card-stack:not([data-concealed])");
    let measuredStage = 0, measuredPanel = 0;
    const endMotion = () => {
      moving = false;
      pane.removeAttribute("data-workbench-motion");
      for (const key of ["pane-width", "panel-width", "split-shrink", "split-shift"]) pane.style.removeProperty(`--info-${key}`);
    };

    // 消息面会在工作区/会话切换时按 key 重建,每次测量都重新取一遍实时元素。
    const measure = () => {
      const surface = pane.querySelector<HTMLElement>(".chat-message-surface");
      const card = pane.querySelector<HTMLElement>(".floating-environment, .info-card-stack");
      const scroller = scrollerRef.current;
      if (!surface || !card || !scroller) return null;
      const surfaceBox = surface.getBoundingClientRect();
      if (!(surfaceBox.width > 0)) return null;
      // 列宽上限由 CSS 变量维护,JS 只负责按实测几何决定移多少、收多少。
      const maxLane =
        Number.parseFloat(getComputedStyle(pane).getPropertyValue("--chat-lane-max")) || chatLaneDefaultMaxWidth;
      const laneWidth = Math.min(surfaceBox.width, maxLane);
      const paneLeft = pane.getBoundingClientRect().left;
      const isStack = card.classList.contains("info-card-stack");
      const cardStyle = getComputedStyle(card);
      const paddingLeft = Number.parseFloat(cardStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(cardStyle.paddingRight) || 0;
      const input = {
        laneLeft: surfaceBox.left + (surfaceBox.width - laneWidth) / 2,
        laneWidth,
        minGap: Number.parseFloat(getComputedStyle(scroller).paddingLeft),
        // offsetLeft 不受进出场 transform 影响;阴影内边距不计入卡片实体。
        cardLeft: paneLeft + card.offsetLeft + (isStack ? paddingLeft : 0),
        laneLimitLeft: paneLeft,
      };
      const plan = isStack
        ? planInfoCardLane({ ...input, cardWidth: card.clientWidth - paddingLeft - paddingRight })
        : { ...planChatLane(input), concealed: false };
      return { ...plan, laneWidth, center: surfaceBox.left + surfaceBox.width / 2 };
    };

    // Probe both resting layouts (including their responsive gutters) before paint.
    // Keep the cards on the full-width pane. CSS interpolates the chat lane in those
    // coordinates using the actual divider, so reversing doesn't start a second clock.
    const apply = () => {
      if (moving && stage && canvas && chat) {
        const stageWidth = stage.getBoundingClientRect().width, panelWidth = canvas.getBoundingClientRect().width;
        const splitWidth = stageWidth - panelWidth;
        if (panelWidth <= 0 || splitWidth <= 0 || (workbenchPhase === "open" && chat.getBoundingClientRect().width <= splitWidth)) endMotion();
        else if (stageWidth !== measuredStage || panelWidth !== measuredPanel) {
          measuredStage = stageWidth; measuredPanel = panelWidth;
          pane.dataset.workbenchMotion = workbenchPhase === "open" ? "cover" : "reveal";
          pane.style.setProperty("--info-pane-width", `${splitWidth}px`);
          const split = measure();
          pane.style.setProperty("--info-pane-width", `${stageWidth}px`);
          const full = measure();
          if (!split?.concealed || !full || full.concealed) endMotion();
          else {
            pane.style.setProperty("--info-panel-width", `${panelWidth}px`);
            pane.style.setProperty("--info-split-shrink", `${full.laneWidth - split.laneWidth}px`);
            pane.style.setProperty("--info-split-shift", `${full.center - split.center}px`);
          }
        }
      }
      const plan = measure();
      if (!plan) return;
      const scroller = scrollerRef.current;
      if (scroller) pane.style.setProperty("--chat-scrollbar-width", `${scroller.offsetWidth - scroller.clientWidth}px`);
      setInfoCardsConcealed((moving && workbenchPhase === "open") || plan.concealed);
      // 只写完全展开时的几何。自动收起时沿用上一次目标，CSS 会随抽屉进度平滑归零。
      if (!plan.concealed) {
        pane.style.setProperty("--info-lane-shift", `${plan.shift}px`);
        pane.style.setProperty("--info-lane-shrink", `${plan.shrink}px`);
      }
    };

    // 栈可能在数据到达后才挂载,或在所有卡片都不可用时卸载。
    const observer = new ResizeObserver(apply);
    const observeCard = () => {
      observer.disconnect();
      observer.observe(pane);
      if (moving && stage && chat && canvas) {
        observer.observe(stage);
        observer.observe(chat);
        observer.observe(canvas);
      }
      const card = pane.querySelector<HTMLElement>(".floating-environment, .info-card-stack");
      if (card) observer.observe(card);
      else {
        setInfoCardsConcealed(true);
        pane.style.removeProperty("--info-lane-shift");
        pane.style.removeProperty("--info-lane-shrink");
      }
      apply();
    };
    observeCard();
    const children = new MutationObserver(observeCard);
    children.observe(pane, { childList: true });
    return () => {
      children.disconnect();
      observer.disconnect();
      endMotion();
      pane.style.removeProperty("--chat-scrollbar-width");
      pane.style.removeProperty("--info-lane-shift");
      pane.style.removeProperty("--info-lane-shrink");
    };
  }, [floatingInfo, infoCards, messageSurfaceKey, workbenchPhase, environmentCollapsed]);

  const enterTrack = useRef<EnterTrack | null>(null);
  enterTrack.current = trackEnteredMessages(
    enterTrack.current,
    state?.activeConversationId ?? null,
    messages.map((message) => message.id),
  );
  const entering = enterTrack.current.enter;
  const mod = modKeyLabel(platform);
  const rightLabel = floatingInfo
    ? infoCards
      ? (environmentCollapsed ? tr("展开信息卡片", "Show info cards") : tr("收起信息卡片", "Hide info cards"))
      : (environmentCollapsed ? tr("展开环境卡片", "Expand environment card") : tr("折叠环境卡片", "Collapse environment card"))
    : rightCollapsed ? tr("展开右侧面板", "Expand right panel") : tr("收起右侧面板", "Collapse right panel");
  const { agents: roster } = useAgentWorkspace();
  const subagents = useMemo(() => roster.filter((agent) => agent.kind !== "root"), [roster]);
  const runningSubagents = subagents.filter((agent) => agent.status === "running").length;
  const previousTurns = useRef<MessageTurn[]>([]);
  const turns = useMemo(() => groupMessagesIntoTurns(messages, previousTurns.current), [messages]);
  useLayoutEffect(() => { previousTurns.current = turns; }, [turns]);
  const turnNavItems = useMemo(() => (turns.length >= TURN_NAV_MIN_TURNS ? buildTurnNavItems(turns) : []), [turns]);
  const showTurnNav = !floatingChat && view === "chat" && !homeLayout && turnNavItems.length >= TURN_NAV_MIN_TURNS;

  const computeActiveTurn = useCallback(() => {
    if (!showTurnNav || jumpLockRef.current) return;
    const scroller = scrollerRef.current;
    const surface = messageSurfaceRef.current;
    if (!scroller || !surface) return;
    const elements = Array.from(surface.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element.hasAttribute("data-turn-id"),
    );
    if (elements.length === 0) return;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const scrollTop = scroller.scrollTop;
    const next = findActiveTurnIndex({
      scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      turnCount: elements.length,
      getTurnTop: (index) => elements[index]!.getBoundingClientRect().top - scrollerTop + scrollTop,
    });
    if (next >= 0 && next !== activeTurnIndexRef.current) {
      setActiveTurnIndex(next);
    }
  }, [showTurnNav]);

  syncActiveTurnRef.current = computeActiveTurn;

  useLayoutEffect(() => {
    computeActiveTurn();
  }, [computeActiveTurn, turns, messageSurfaceKey]);

  const jumpToTurn = useCallback((turnId: string, index: number) => {
    const scroller = scrollerRef.current;
    const surface = messageSurfaceRef.current;
    if (!scroller || !surface) return;
    const target = Array.from(surface.children).find(
      (element): element is HTMLElement => element instanceof HTMLElement && element.dataset.turnId === turnId,
    );
    if (!target) return;

    jumpLockRef.current?.cancel();
    followRef.current.pinned = false;
    syncJumpToLatest();
    setActiveTurnIndex(index);

    const topInset = parseFloat(getComputedStyle(scroller).paddingTop);
    const targetTop = Math.max(0, target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - topInset);
    if (Math.abs(scroller.scrollTop - targetTop) < 1) return;

    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let settled = false;
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      scroller.removeEventListener("scrollend", onSettle);
      if (jumpLockRef.current?.cancel === cancel) jumpLockRef.current = null;
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
    };
    const onSettle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // 跨过 .turn-deferred（content-visibility: auto）时，落点附近高度可能展开，微调到准确位置。
      if (target.isConnected) {
        const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - topInset;
        if (Math.abs(delta) > 24) {
          scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
        }
      }
      syncJumpToLatest();
      computeActiveTurn();
    };

    jumpLockRef.current = { cancel };
    scroller.addEventListener("scrollend", onSettle, { once: true });
    timer = window.setTimeout(onSettle, reduced ? 40 : 750);
    scroller.scrollTo({ top: targetTop, behavior: reduced ? "auto" : "smooth" });
  }, [computeActiveTurn, syncJumpToLatest]);
  const changesCache = useRef(new Map<MessageTurn, { root: string | null; changes: TurnChanges | null }>());
  const turnChanges = useMemo(() => {
    const root = project.workspace?.current ?? null;
    const cache = new Map<MessageTurn, { root: string | null; changes: TurnChanges | null }>();
    const cards = new Map<string, TurnChanges>();
    turns.forEach((turn, index) => {
      if (streaming && index === turns.length - 1) return;
      const old = changesCache.current.get(turn);
      const entry = old?.root === root ? old : {
        root, changes: summarizeTurnChanges(turn.assistants.flatMap(message => message.tools), root),
      };
      cache.set(turn, entry);
      const last = turn.assistants.at(-1);
      if (last && entry.changes) cards.set(last.id, entry.changes);
    });
    changesCache.current = cache;
    return cards;
  }, [turns, streaming, project.workspace?.current]);
  const currentTurn = streaming ? turns.at(-1) : undefined;
  const selectLiveChanges = useMemo(createLiveChangesSelector, []);
  const liveChanges = currentTurn && onReviewTurn
    ? selectLiveChanges(currentTurn.assistants, project.workspace?.current ?? null) : null;
  const currentTurnId = currentTurn?.id;
  const liveReview = useMemo<TurnReviewRequest | null>(() => currentTurnId && liveChanges
    ? { turnId: currentTurnId, changes: liveChanges, live: true } : null, [currentTurnId, liveChanges]);

  const finalReviewId = liveReviewId && liveReviewId !== currentTurnId
    ? turns.find(turn => turn.id === liveReviewId)?.assistants.at(-1)?.id : undefined;
  const finalReviewChanges = finalReviewId && turnChanges.get(finalReviewId);
  useEffect(() => {
    if (!liveReviewId || !onRefreshReview) return;
    if (liveReview?.turnId === liveReviewId) onRefreshReview(liveReviewId, liveReview);
    else if (finalReviewId && finalReviewChanges) {
      onRefreshReview(liveReviewId, { turnId: finalReviewId, changes: finalReviewChanges });
    }
  }, [liveReviewId, onRefreshReview, liveReview, finalReviewId, finalReviewChanges]);

  const outcomeCache = useRef(new Map<MessageTurn, { root: string | null; request: AcceptanceRequest | null }>());
  const turnOutcomes = useMemo(() => {
    const root = project.workspace?.current ?? null;
    const cache = new Map<MessageTurn, { root: string | null; request: AcceptanceRequest | null }>();
    const cards = new Map<string, AcceptanceRequest>();
    turns.forEach((turn, index) => {
      if (streaming && index === turns.length - 1) return;
      const last = turn.assistants.at(-1);
      if (!last) return;
      const old = outcomeCache.current.get(turn);
      const entry = old?.root === root ? old : {
        root,
        request: outcomeByFinalMessage([...(turn.user ? [turn.user] : []), ...turn.assistants], false, root).get(last.id) ?? null,
      };
      cache.set(turn, entry);
      if (entry.request) cards.set(last.id, entry.request);
    });
    outcomeCache.current = cache;
    return cards;
  }, [turns, streaming, project.workspace?.current]);
  // 分支按轮次定位:数到回复所在轮的用户消息序号,与 runtime 重建的历史一致。
  const userOrdinalById = useMemo(() => {
    const ordinal = new Map<string, number>();
    let count = 0;
    for (const message of messages) {
      if (message.role !== "user") continue;
      ordinal.set(message.id, count);
      count += 1;
    }
    return ordinal;
  }, [messages]);

  const projectPath = project.workspace?.current;
  const overviewLabel = `${tr("工作区总览", "Workspace overview")} · ${projectPath ?? ""}`;
  const projectLabel = <>
    <span className="chat-project-name">{projectPath?.split(/[\\/]/).filter(Boolean).pop()}</span>
    {project.git?.branch ? <span className="chat-project-branch">{project.git.branch}</span> : null}
  </>;
  return (
    <QuestionContext.Provider value={question}>
    <ThinkingSummaryContext.Provider value={thinkingSummaries ?? null}>
    {floatingChat && floatHidden && <button ref={restoreFloatRef} type="button" className="floating-chat-restore"
      aria-label={floatShowLabel} title={floatShowLabel} onClick={toggleFloatHidden}><Icon name="chat" size={20} /></button>}
    <main ref={chatRef} hidden={floatingChat && floatHidden} className={`main-chat-view${embedded ? " panel-chat-view" : ""}`} data-floating-chat={floatingChat ? (floatExpanded ? "expanded" : "collapsed") : undefined} data-tool-display={toolDisplay} tabIndex={-1}>
      {!floatingChat && view === "chat" && !emptyConversation ?
        <div className="chat-transcript-title-fade pane-info-header" aria-hidden="true" /> : null}
      {floatingChat && <div className="floating-chat-resize" role="separator" aria-orientation="horizontal" tabIndex={0}
        aria-label={tr("调整聊天浮窗高度", "Resize floating chat height")} aria-controls={`${tabIdPrefix}-messages`}
        ref={resizeHandle} {...resizeEvents} />}
      {floatingChat ? (
        <header className="floating-chat-header" {...headerEvents} onDoubleClick={() => setFloatExpanded(expanded => !expanded)}>
          <Icon name="folder" size={14} />
          <span className="chat-active-title overflow-fade-text" title={title}>{title}</span>
          <button type="button" className="view-icon-btn"
            aria-expanded={floatExpanded} aria-controls={`${tabIdPrefix}-messages`} aria-label={floatToggleLabel} title={floatToggleLabel}
            onDoubleClick={event => event.stopPropagation()} onClick={() => setFloatExpanded(expanded => !expanded)}>
            <Icon name="chevron-up" size={14} />
          </button>
          <button type="button" className="view-icon-btn floating-chat-hide" aria-label={floatHideLabel} title={floatHideLabel}
            onClick={toggleFloatHidden}><Icon name="minus" size={14} /></button>
        </header>
      ) : <header className="main-chat-header">
        <div className="chat-title-group">
          {state?.activeConversationId && onRenameConversation ? (
            <button
              className="chat-active-title chat-title-rename"
              type="button"
              title={tr("重命名对话", "Rename chat")} data-tooltip
              aria-label={`${tr("重命名对话", "Rename chat")} “${title}”`}
              onClick={() => onRenameConversation(state.activeConversationId!)}
            ><span>{title}</span><Icon name="edit" size={14} /></button>
          ) : <span className="chat-active-title overflow-fade-text" title={title}>{title}</span>}
        </div>
        <div className="chat-header-actions">
          {!embedded && hasWorkspace && projectPath && onOpenVersionControl ? (
            <button type="button" className="view-icon-btn" title={tr("版本控制", "Version Control")}
              aria-label={`${tr("版本控制", "Version Control")} · ${projectPath}`} onClick={() => onOpenVersionControl(projectPath)}>
              <Icon name="branch" size={16} />
            </button>
          ) : null}
          {!embedded && projectPath ? (onOpenWorkspaceOverview ?
            <button type="button" className="chat-project-context chat-project-link" title={overviewLabel} aria-label={overviewLabel}
              onClick={() => onOpenWorkspaceOverview(projectPath)}>
              <Icon name="folder" size={14} />{projectLabel}
            </button> : <span className="chat-project-context" title={projectPath}>{projectLabel}</span>
          ) : null}
          {!embedded ? <OpenInAppButton path={project.workspace?.current ?? null} /> : null}
          {subagents.length > 0 && onOpenAgentDirectory ? (
            <button
              className={`chat-agents-button${agentDirectoryActive ? " active" : ""}`}
              type="button"
              title={tr("子代理目录", "Subagent directory")}
              aria-label={tr("子代理目录", "Subagent directory")}
              onClick={onOpenAgentDirectory}
            >
              <Icon name="stack" size={14} />
              <span>
                {runningSubagents > 0
                  ? trf("{0} 运行中", "{0} running", runningSubagents)
                  : trf("{0} 个子代理", "{0} subagents", subagents.length)}
              </span>
            </button>
          ) : null}
          {showNewTab ? (
            <button
              className="view-icon-btn"
              type="button"
              title={`${tr("新建标签页", "New tab")} (${mod}T)`}
              aria-label={tr("新建标签页", "New tab")}
              onClick={onNewTab}
            >
              <Icon name="plus" size={16} />
            </button>
          ) : null}
          {onOpenCheckpoints && state?.activeConversationId && messages.some(message => message.role === "user") ? (
            <button
              className="view-icon-btn"
              type="button"
              title={tr("检查点与回滚", "Checkpoints")}
              aria-label={tr("检查点与回滚", "Checkpoints")}
              aria-haspopup="dialog"
              onClick={() => onOpenCheckpoints()}
            >
              <Icon name="history" size={16} />
            </button>
          ) : null}
          <ChatActionsMenu key={state?.activeConversationId ?? "empty"} messages={messages} streaming={Boolean(streaming)} />
          {!embedded && !emptyConversation && floatingInfo ? <button
            className="icon-btn-ghost"
            type="button"
            title={`${rightLabel} (${mod}J)`}
            aria-label={rightLabel}
            aria-pressed={!rightCollapsed}
            onClick={onToggleRight}
          >
            {infoCards ? <Icon name="cards" size={14} /> : <Icon name="list" size={14} />}
          </button> : null}
        </div>
      </header>}

      {showViewTabs && <ConversationViewTabs idPrefix={tabIdPrefix} view={view} showVersionControl={hasWorkspace && !embedded} emptyConversation={emptyConversation} onChange={setView} />}
      {isConversationDetail(view) ? (
        <div className="conversation-view-panel" role="tabpanel" id={conversationPanelId(tabIdPrefix, view)} aria-labelledby={conversationTabId(tabIdPrefix, view)}>
          <ConversationDetailView key={viewKey} view={view} state={state} agents={roster} messageStore={messageStore} providers={models.catalog?.providers ?? []}
            onConversation={() => setView("chat")} onAbort={onAbort} pendingInteraction={pendingInteraction} />
        </div>
      ) : null}
      {!conversationWorkbenchTabs && hasWorkspace && vcMounted ? <VersionControlView
        project={project}
        session={session ?? null}
        hidden={view !== "versionControl"}
        pendingInteraction={pendingInteraction}
        onOpenConversation={() => setView("chat")}
        onAbort={onAbort}
        onOpenFile={(absolutePath) => void project.openFile(absolutePath)}
      /> : null}
      <div className="chat-conversation-pane" role={showViewTabs ? "tabpanel" : undefined} id={conversationPanelId(tabIdPrefix, "chat")} aria-labelledby={showViewTabs ? conversationTabId(tabIdPrefix, "chat") : undefined} data-home={homeLayout ? "true" : undefined} data-home-style={activeHomeStyle} data-prompts={showHomePrompts ? "true" : undefined} data-turn-nav={showTurnNav ? "true" : undefined} hidden={view !== "chat"} inert={view !== "chat" ? true : undefined}>
      {activeHomeStyle === "classic" ? <VelaMark /> : null}
      {activeHomeStyle === "atelier" ? <AtelierBackdrop /> : null}
      {floatingInfo && infoCards && !emptyConversation ? (
        <InfoCardStack concealed={environmentCollapsed || infoCardsConcealed} state={state} project={project} messageStore={messageStore} planDraft={planDraft}
          backgroundShells={backgroundShells} onOpenBackgroundTasks={onOpenBackgroundTasks} changesActive={changesActive} onOpenChanges={onOpenChanges} onOpenPlan={onOpenPlan}
          onResumeGoal={onResumeGoal} />
      ) : null}
      {floatingInfo && !infoCards && !emptyConversation ? (
        <div className="info-drawer floating-environment" data-concealed={environmentCollapsed || undefined}
          inert={environmentCollapsed || undefined} aria-hidden={environmentCollapsed || undefined}>
          <RepoCard project={project} onOpenChanges={onOpenChanges} activeChanges={changesActive}
            plan={planReferenceModel(session?.proposedPlan ?? null, planDraft, session?.executionPlan ?? null)}
            onOpenPlan={onOpenPlan}
            onToggle={onToggleRight} />
        </div>
      ) : null}
      <PlanLiveContext.Provider value={planLive}>
      <ConversationLinkContext.Provider value={onOpenWebLink ?? null}>
      <div className="chat-scroll-area" id={`${tabIdPrefix}-messages`} inert={floatingChat && !floatExpanded} ref={scrollerRef}
        onFocusCapture={({ currentTarget: scroller, target }) => {
          if (!(target instanceof Element) || target === scroller || !target.matches(":focus-visible")) return;
          const style = getComputedStyle(scroller);
          if (!style.getPropertyValue("--chat-transcript-header-height")) return;
          // Native focus scrolling can leave a fully in-viewport target behind the floating title.
          const visibleTop = scroller.getBoundingClientRect().top + parseFloat(style.scrollPaddingTop);
          const covered = visibleTop - target.getBoundingClientRect().top;
          if (covered > 0) scroller.scrollTop -= covered;
        }}>
        <div
          className="chat-message-surface"
          key={messageSurfaceKey}
          ref={messageSurfaceRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={streaming}
          aria-label={tr("对话消息", "Conversation messages")}
        >
        {session?.status === "error" && session.error ? (
          <div className="chat-error-card" role="alert">
            <div className="chat-error-card-title">{tr("会话还不能开始", "Chat is not ready yet")}</div>
            <p>{localizeError(session.error)}</p>
          </div>
        ) : null}

        <RecipeChatCard />
        {messages.length === 0 ? (
          <EmptyState
            style={floatingChat ? "minimal" : embedded ? "classic" : startPageStyle}
            project={project}
            workspace={project.workspace?.current ?? null}
            modelMissing={modelMissing}
            mode={mode}
            modeDisabled={modeDisabled}
            canRace={canRace}
            onMode={changeMode}
            onOpenRace={() => setRaceOpenRequest((n) => n + 1)}
          />
        ) : (
          turns.map((turn, index) => {
            let finalReplies = finalRepliesCache.get(turn);
            if (!finalReplies) finalRepliesCache.set(turn, finalReplies = selectFinalReplies(turn.assistants));
            const finalReply = finalReplies[finalReplies.length - 1] ?? null;
            const lastAssistant = turn.assistants[turn.assistants.length - 1] ?? null;
            const isCurrentTurn = index === turns.length - 1;
            const canCollapse = finalReplies.length > 0 && (!isCurrentTurn || (
              session?.status === "ready" &&
              (lastAssistant?.turnStartedAt === undefined || lastAssistant.turnCompletedAt !== undefined)
            ));
            const changes = lastAssistant ? turnChanges.get(lastAssistant.id) ?? null : null;
            const acceptance = lastAssistant ? turnOutcomes.get(lastAssistant.id) ?? null : null;
            const branchTurn = turn.user ? userOrdinalById.get(turn.user.id) ?? null : null;
            // 只有正在运行的本轮才计时;历史中未完成的轮次没有起始时间,不显示这一行。
            const liveStartedAt = isCurrentTurn && streaming && lastAssistant?.turnCompletedAt === undefined
              ? lastAssistant?.turnStartedAt ?? [...turn.assistants].reverse().find((message) => message.turnStartedAt !== undefined)?.turnStartedAt
              : undefined;

            return (
              <Fragment key={turn.id}>
                {turn.user ? (
                  <UserTurnMessage
                    message={turn.user}
                    turnId={turn.id}
                    thinkingActive={false}
                    entering={entering.has(turn.user.id)}
                    changes={null}
                    onOpenChanges={onOpenChanges}
                    onReviewTurn={onReviewTurn}
                    canManageChanges={Boolean(project.git?.repo)}
                    getQuestion={getQuestion}
                    onReplyQuestion={onReplyQuestion}
                    onOpenImage={setImageView}
                    editDisabled={session?.status !== "ready" || subagents.some(agent => isAgentBusy(agent.status))}
                    editTurn={branchTurn}
                    onEditTurn={onEdit}
                    deferred={!isCurrentTurn}
                  />
                ) : null}
                {canCollapse && finalReply && lastAssistant ? (
                  <CompletedAssistantTurn
                    key={lastAssistant.id}
                    turnId={!turn.user ? turn.id : undefined}
                    messages={turn.assistants}
                    finalReplies={finalReplies}
                    elapsed={formatElapsedTime(lastAssistant.turnStartedAt, lastAssistant.turnCompletedAt)}
                    changes={changes}
                    onOpenChanges={onOpenChanges}
                    onReviewTurn={onReviewTurn}
                    canManageChanges={Boolean(project.git?.repo)}
                    getQuestion={getQuestion}
                    onReplyQuestion={onReplyQuestion}
                    toolDisplay={toolDisplay}
                    toolFold={toolFold}
                    branchTurn={branchTurn}
                    replyTime={finalReply.timestamp ?? lastAssistant.timestamp ?? lastAssistant.turnCompletedAt ?? null}
                    onBranch={onBranch}
                    onCheckpoints={onOpenCheckpoints}
                    onDistillMemory={distillMemory}
                    distillDisabled={session?.status !== "ready"}
                    acceptance={acceptance}
                    onOpenAcceptance={onOpenAcceptance}
                    deferred={!isCurrentTurn}
                  />
                ) : turn.assistants.length > 0 ? (
                  <div className="assistant-live-turn" data-turn-id={!turn.user ? turn.id : undefined}>
                    {liveStartedAt !== undefined ? <TurnProgressHeader startedAt={liveStartedAt} quota={quotaProviderId(session?.modelProvider)} /> : null}
                    {toolFold === "position" || (groupsByReply(thinkingGroupMode) && turn.assistants.some(supportsThinkingGroups)) ? (
                      <article className="assistant-block">
                        <ToolSequence
                          messages={webChatMessages(turn.assistants)}
                          activeAssistantId={activeAssistantId}
                          entering={entering}
                          toolDisplay={toolDisplay}
                          getQuestion={getQuestion}
                          onReplyQuestion={onReplyQuestion}
                        />
                        {changes ? (
                          <TurnChangesCard
                            turnId={lastAssistant!.id}
                            changes={changes}
                            onOpenChanges={onOpenChanges}
                            onReviewTurn={onReviewTurn}
                            canManageChanges={Boolean(project.git?.repo)}
                          />
                        ) : null}
                      </article>
                    ) : (
                      // 每一步 assistant 的思考都跟着自己的工具调用走;Thinking 组件负责运行中展开、结束后折叠。
                      attachFollowerTools(webChatMessages(turn.assistants)).map(({ message, memberIds }) => (
                        <Message
                          key={message.id}
                          message={message}
                          thinkingActive={message.id === activeAssistantId && !message.text && message.tools.length === 0}
                          streaming={activeAssistantId !== undefined && memberIds.includes(activeAssistantId)}
                          entering={entering.has(message.id)}
                          changes={turnChanges.get(message.id) ?? null}
                          onOpenChanges={onOpenChanges}
                          onReviewTurn={onReviewTurn}
                          canManageChanges={Boolean(project.git?.repo)}
                          getQuestion={getQuestion}
                          onReplyQuestion={onReplyQuestion}
                          toolDisplay={toolDisplay}
                          toolFold={toolFold}
                        />
                      ))
                    )}
                    <PlanPreviewList planIds={collectPlanIds(turn.assistants)} />
                    {finalReply || acceptance ? (
                      <ReplyActions
                        text={joinReplyText(finalReplies)}
                        speechId={lastTextReplyId(finalReplies)}
                        replyless={!lastTextReplyId(finalReplies)}
                        timestamp={finalReply?.timestamp ?? null}
                        branchTurn={branchTurn}
                        branchDisabled={session?.status !== "ready"}
                        onBranch={onBranch}
                        onCheckpoints={onOpenCheckpoints}
                        onDistillMemory={distillMemory}
                        distillDisabled={session?.status !== "ready"}
                        acceptance={acceptance}
                        onOpenAcceptance={onOpenAcceptance}
                      />
                    ) : null}
                  </div>
                ) : null}
              </Fragment>
            );
          })
        )}
        {recommendation ? (
          <RecommendedActionsCard
            key={recommendation.id}
            recommendation={recommendation.recommendation}
            onSelect={async (action) => {
              const sent = await onSend(action.prompt);
              if (sent !== false) setDismissedRecommendations((current) => new Set(current).add(recommendation.id));
              return sent;
            }}
            onDismiss={() => setDismissedRecommendations((current) => new Set(current).add(recommendation.id))}
          />
        ) : null}
        {/* 运行视图:待办清单和状态条是对话内容的一部分,紧跟在本轮过程之后,随对话一起滚动。 */}
        {runView && view === "chat" && messages.length > 0 ? <RunViewDock messages={messages} streaming={Boolean(streaming)} /> : null}
        {providerError && sendError ? <ProviderErrorCard error={providerError} raw={localizeError(sendError)} /> : null}
        </div>
      </div>

      </ConversationLinkContext.Provider>
      </PlanLiveContext.Provider>
      <SelectionActions containerRef={scrollerRef} onSideChat={startSideChat}
        onReply={(quote, text) => replyStore.addText(replyKey, quote, text)} />
      {showTurnNav ? <TurnNav items={turnNavItems} activeIndex={activeTurnIndex} onJump={jumpToTurn} /> : null}
      <button
        type="button"
        className="chat-jump-latest"
        data-visible={showJumpToLatest && view === "chat" ? "true" : "false"}
        data-activity={jumpActivity}
        tabIndex={showJumpToLatest ? 0 : -1}
        aria-hidden={!showJumpToLatest}
        onClick={jumpToLatest}
        aria-label={tr("回到最新", "Jump to latest")}
        title={tr("回到最新", "Jump to latest")}
      >
        <JumpOrb activity={jumpActivity} commandKey={runningBash?.id} running={showJumpToLatest && view === "chat"} />
      </button>
      <TaskBudgetBanner budget={session?.taskBudget} conversationId={state?.activeConversationId} />
      <TaskCostForecastHint session={session} />
      <Composer
        conflictBanner={<ConflictBanner conversationId={state?.activeConversationId} turnStartedAt={session?.turnStartedAt} />}
        changeSummary={showChangeSummary && liveReview && onReviewTurn ? (
          <ChangeSummaryPill changes={liveReview.changes} onReview={() => onReviewTurn(liveReview)} />
        ) : null}
        embedded={embedded}
        floatingChat={floatingChat}
        sandboxMode={session?.sandboxMode}
        ref={dockRef}
        openingChat={openingChat}
        disabled={composerDisabled}
        streaming={Boolean(streaming)}
        instructions={state?.session.pendingInstructions ?? []}
        newChat={!embedded && messages.length === 0 && (state?.context.turnCount ?? 0) === 0}
        showSetupControls={!embedded && messages.length === 0 && !streaming && (state?.context.turnCount ?? 0) === 0}
        model={session?.model ?? hintModel?.label}
        modelProvider={session?.modelProvider ?? hintModel?.provider ?? null}
        modelId={session?.modelId ?? hintModel?.id ?? null}
        modelReady={session?.modelReady ?? false}
        codexSpeed={session?.codexSpeed}
        subagentCodexSpeed={session?.subagentCodexSpeed}
        thinkingLevel={session?.modelProvider ? session.thinkingLevel : hintModel?.thinkingLevel ?? session?.thinkingLevel ?? "medium"}
        thinkingLevels={session?.modelProvider ? session.thinkingLevels : hintModel?.thinkingLevels ?? session?.thinkingLevels ?? ["off"]}
        hiddenModels={hiddenModels}
        predictionEnabled={predictionEnabled}
        predictionModel={predictionModel}
        predictionKey={predictionKey}
        conversationId={state?.activeConversationId ?? null}
        models={models}
        mode={mode}
        usage={state?.context ?? null}
        contextPopover={floatingChat || floatingInfo}
        project={project}
        onSend={onSend}
        replies={replies}
        onRemoveReply={(id) => replyStore.remove(replyKey, id)}
        onFocusReply={(id) => replyStore.requestFocus(id)}
        onBeginReplies={() => replyStore.beginSend(replyKey)}
        onSettleReplies={(sent, kept) => {
          // 先移交再结算：结算会让页面里的元素句柄被释放。
          if (kept) for (const command of handoffCommands(sent)) void window.vela?.browser?.command(command).catch(() => undefined);
          replyStore.settleSend(replyKey, sent, kept);
        }}
        onRemoveInstruction={onRemoveInstruction}
        onPromoteInstruction={onPromoteInstruction}
        onAbort={onAbort}
        onMode={changeMode}
        raceOpenRequest={raceOpenRequest}
      />
      {showHomePrompts ? (
        activeHomeStyle === "atelier" ? (
          <NewChatAtelierLedger project={project} conversationId={state?.activeConversationId ?? null} />
        ) : activeHomeStyle === "deck" ? (
          <NewChatDeckBento
            project={project}
            conversationId={state?.activeConversationId ?? null}
            platform={platform}
            onMode={changeMode}
            modeDisabled={modeDisabled}
          />
        ) : (
          <NewChatPrompts hasGit={Boolean(project.git?.repo)} />
        )
      ) : null}
      </div>
      {imageView ? <ImageViewer request={imageView} onClose={() => setImageView(null)} /> : null}
    </main>
    </ThinkingSummaryContext.Provider>
    </QuestionContext.Provider>
  );
}

const modeHints: Record<InteractionMode, [string, string]> = {
  agent: ["描述要完成的任务，Agent 会阅读代码、修改文件并运行命令。", "Describe a task. The agent will inspect the code, edit files, and run commands."],
  plan: ["Plan 模式只查阅代码并写出计划，确认后才会开始修改。", "Plan mode inspects the code and drafts a plan. Changes begin after you approve it."],
  goal: ["Goal 模式会围绕目标连续执行，随时可以停止。", "Goal mode works toward an objective continuously. You can stop at any time."],
};

/** 空对话的引导文案按缺失的前置条件切换:先准备模型,再提示选工作区,最后才是开始任务。工作区本身由输入框上方的晶片选择。 */
function EmptyState({
  style,
  project,
  workspace,
  modelMissing,
  mode,
  modeDisabled,
  canRace,
  onMode,
  onOpenRace,
}: {
  style: StartPageStyle;
  project: ProjectApi;
  workspace: string | null;
  modelMissing: boolean;
  mode: InteractionMode;
  modeDisabled: boolean;
  canRace: boolean;
  onMode: (mode: InteractionMode) => void;
  onOpenRace: () => void;
}) {
  const hint = modelMissing
    ? tr("还没有可用的模型。点输入框右下角的模型按钮登录提供方，或添加一个兼容接口。", "No models are available yet. Use the model button at the bottom right to sign in to a provider or add a compatible API.")
    : workspace
      ? tr(modeHints[mode][0], modeHints[mode][1])
      : tr("点输入框上方的工作区晶片，选择要处理的项目。", "Pick a project with the workspace chip above the input.");
  if (style === "minimal") {
    // 极简起始页只在缺前置条件时留一行提示,其余什么都不显示。
    return modelMissing || !workspace ? <p className="home-hint minimal-start-hint">{hint}</p> : null;
  }
  if (style === "atelier") {
    return (
      <NewChatAtelierHeader
        project={project}
        mode={mode}
        hint={hint}
        showHint={modelMissing || !workspace}
        onMode={onMode}
        modeDisabled={modeDisabled}
      />
    );
  }
  if (style === "deck") {
    return (
      <NewChatDeckHeader
        project={project}
        mode={mode}
        hint={hint}
        showHint={modelMissing || !workspace}
        onMode={onMode}
        modeDisabled={modeDisabled}
        canRace={canRace}
        onOpenRace={onOpenRace}
      />
    );
  }
  return <NewChatGreeting mode={mode} hint={hint} />;
}

function UserText({ text }: { text: string }) {
  const segments = parseSkillSegments(text);
  if (!segments) return <Markdown text={text} />;
  return (
    <div className="user-skill-message">
      {segments.map((segment, index) => segment.type === "skill"
        ? <SkillToken key={index} name={segment.name} />
        : <span key={index}>{segment.text}</span>)}
    </div>
  );
}

const UserTurnMessage = memo(function UserTurnMessage({ editTurn, onEditTurn, ...props }:
  Omit<Parameters<typeof Message>[0], "onEdit"> & { editTurn: number | null; onEditTurn?: ChatViewProps["onEdit"] }) {
  const edit = useCallback((text: string) => onEditTurn!(editTurn!, text, props.message.images),
    [onEditTurn, editTurn, props.message.images]);
  return <Message {...props} onEdit={onEditTurn && editTurn !== null ? edit : undefined} />;
});

const Message = memo(function Message({
  message,
  turnId,
  thinkingActive,
  streaming = false,
  entering,
  changes,
  onOpenChanges,
  onReviewTurn,
  canManageChanges,
  getQuestion,
  onReplyQuestion,
  onOpenImage,
  editDisabled = true,
  onEdit,
  toolDisplay,
  toolFold,
  deferred = false,
}: {
  message: UiMessage;
  turnId?: string;
  thinkingActive: boolean;
  streaming?: boolean;
  entering: boolean;
  changes: TurnChanges | null;
  onOpenChanges: () => void;
  onReviewTurn?: (request: TurnReviewRequest) => void;
  canManageChanges: boolean;
  getQuestion: QuestionLookup;
  onReplyQuestion: QuestionReplyHandler;
  /** 只有用户消息的图片会打开全屏查看器;助手消息沿用同一个组件时不需要传。 */
  onOpenImage?: (request: ImageViewerRequest) => void;
  editDisabled?: boolean;
  onEdit?: (text: string) => Promise<void>;
  toolDisplay?: ToolDisplay;
  toolFold?: ToolFold;
  /** 已结束且不是最新的一轮:离屏时由浏览器跳过渲染,见 styles.css 的 .turn-deferred。 */
  deferred?: boolean;
}) {
  const enterClass = `${entering ? " message-enter" : ""}${deferred ? " turn-deferred" : ""}`;
  if (message.role === "user") {
    const images = message.images ?? [];
    return (
      <UserMessageFrame text={message.text} timestamp={message.timestamp} disabled={editDisabled} className={enterClass} turnId={turnId} onEdit={onEdit}>
        {images.length > 0 ? (
          <div className="user-attachments">
            {images.map((image, index) => (
              <button
                key={index}
                className="user-attachment-thumb"
                type="button"
                aria-label={trf("全屏查看图片 {0}", "View image {0} full screen", index + 1)}
                title={tr("全屏查看", "View full screen")}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  onOpenImage?.({
                    images: images.map((item, position) => ({
                      src: `data:${item.mimeType};base64,${item.data}`,
                      alt: trf("图片 {0}", "Image {0}", position + 1),
                    })),
                    index,
                    origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                    focusTarget: event.currentTarget,
                  });
                }}
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={trf("图片 {0}", "Image {0}", index + 1)}
                  draggable={false}
                />
              </button>
            ))}
          </div>
        ) : null}
        {message.text ? (
          <div className="user-bubble">
            <UserText text={message.text} />
          </div>
        ) : null}
      </UserMessageFrame>
    );
  }

  return (
    <article className={`assistant-block${enterClass}`}>
      <AssistantMessageContent
        message={message}
        thinkingActive={thinkingActive}
        streaming={streaming}
        thinkingDisclosure
        showTools
        showText
        changes={changes}
        onOpenChanges={onOpenChanges}
        onReviewTurn={onReviewTurn}
        canManageChanges={canManageChanges}
        getQuestion={getQuestion}
        onReplyQuestion={onReplyQuestion}
        toolDisplay={toolDisplay}
        toolFold={toolFold}
      />
    </article>
  );
});

function AssistantMessageContent({
  message,
  thinkingActive,
  streaming = false,
  thinkingDisclosure = true,
  showTools,
  showVisualTools = showTools,
  showText,
  changes,
  onOpenChanges,
  onReviewTurn,
  canManageChanges,
  getQuestion,
  onReplyQuestion,
  toolDisplay,
  toolFold,
}: {
  message: UiMessage;
  thinkingActive: boolean;
  streaming?: boolean;
  thinkingDisclosure?: boolean;
  showTools: boolean;
  showVisualTools?: boolean;
  showText: boolean;
  changes: TurnChanges | null;
  onOpenChanges: () => void;
  onReviewTurn?: (request: TurnReviewRequest) => void;
  canManageChanges: boolean;
  getQuestion: QuestionLookup;
  onReplyQuestion: QuestionReplyHandler;
  toolDisplay?: ToolDisplay;
  toolFold?: ToolFold;
}) {
  const preTextTools = message.tools.filter((tool) => tool.name !== visualToolName);
  const visualTools = showVisualTools ? message.tools.filter((tool) => tool.name === visualToolName) : [];
  const tools = showTools && preTextTools.length > 0 ? (
    <ToolList
      tools={preTextTools}
      getQuestion={getQuestion}
      onReplyQuestion={onReplyQuestion}
      display={toolDisplay}
      fold={toolFold}
    />
  ) : null;
  return (
    <>
      {message.thinking ? (
        thinkingDisclosure ? (
          <ThinkingGroup
            messageId={message.id}
            model={message.model}
            modelName={message.modelName}
            text={message.thinking}
            active={thinkingActive}
            live={streaming && (!message.text || message.tools.some((tool) => tool.status === "running"))}
            showActivityIndicator={toolDisplay === "compact"}
            tools={preTextTools}
            forceOpen={preTextTools.some((tool) => getQuestion(tool.id) !== null)}
          >
            {tools}
          </ThinkingGroup>
        ) : (
          <>
            <div className="stream-prose-block thinking-text process-thinking-text">
              <Markdown text={message.thinking} streaming={thinkingActive} fade="thinking" />
            </div>
            {tools}
          </>
        )
      ) : tools}
      {showText && message.text ? (
        <div className="agent-reply-prose">
          <AssistantMarkdown messageId={message.id} text={message.text} streaming={streaming} />
        </div>
      ) : null}
      {visualTools.map((tool) => (
        <VisualToolCard key={tool.id} tool={tool} />
      ))}
      {changes ? <TurnChangesCard turnId={message.id} changes={changes} onOpenChanges={onOpenChanges} onReviewTurn={onReviewTurn} canManageChanges={canManageChanges} /> : null}
    </>
  );
}

/** 位置关系折叠:整轮拍平成序列后合并相邻工具;思考、可见正文和交互卡片都会打断。 */
function ToolSequence(props: Omit<Parameters<typeof ModelToolSequence>[0], "coherent">) {
  const enabled = groupsByReply(useThinkingGroupMode());
  const sections = useMemo(() => partitionThinkingGroups(props.messages, enabled), [props.messages, enabled]);
  return <>{sections.map(section => (
    <ModelToolSequence {...props} key={section.id} messages={section.messages} coherent={section.coherent}
      activeAssistantId={section.messages.some(message => message.id === props.activeAssistantId) ? props.activeAssistantId : undefined} />
  ))}</>;
}

function ModelToolSequence({
  messages,
  activeAssistantId,
  entering,
  includeText,
  includeTool,
  toolDisplay,
  getQuestion,
  onReplyQuestion,
  coherent,
}: {
  messages: UiMessage[];
  coherent: boolean;
  activeAssistantId?: string;
  entering?: Set<string>;
  includeText?: (message: UiMessage) => boolean;
  includeTool?: (tool: ToolTrace, message: UiMessage) => boolean;
  toolDisplay: ToolDisplay;
  getQuestion: QuestionLookup;
  onReplyQuestion: QuestionReplyHandler;
}) {
  const groupMode = useThinkingGroupMode();
  const codexModern = groupMode === "codex-modern";
  const codex = groupMode === "codex" || codexModern;
  const items = useMemo(() => buildTurnItems(messages, { includeText, includeTool }), [messages, includeText, includeTool]);
  const nodes = useMemo(() => coherent ? [] : groupProcessItems(items, toolDisplay), [coherent, items, toolDisplay]);
  const coherentNodes = useMemo(() => coherent ? groupCoherentItems(items) : [], [coherent, items]);
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const compact = toolDisplay === "compact";

  const withEnter = (key: string, messageId: string, content: ReactNode): ReactNode =>
    entering?.has(messageId)
      ? <div key={key} className="message-enter">{content}</div>
      : <Fragment key={key}>{content}</Fragment>;

  const renderTool = (node: Extract<ProcessNode, { type: "tool" | "run" }>): ReactNode => {
    if (node.type === "run") {
      return withEnter(node.id, node.messageId, compact ? <CompactToolGroup tools={node.tools} sequenceId={node.id} /> : <ToolRunGroup tools={node.tools} />);
    }
    return withEnter(
      node.id,
      node.messageId,
      compact && toolCompactKind(node.tool.name) ? (
        <CompactToolLine tool={node.tool} />
      ) : (
        <ToolCard tool={node.tool} getQuestion={getQuestion} onReplyQuestion={onReplyQuestion} compact={compact} />
      ),
    );
  };

  const renderToolList = (nodes: Extract<ProcessNode, { type: "tool" | "run" }>[]): ReactNode => (
    <div key={`tools:${nodes[0]!.id}`} className={compact ? "tool-card-list is-compact" : "tool-card-list"}>
      {nodes.map((node) => renderTool(node))}
    </div>
  );
  const nodeTools = (nodes: Extract<ProcessNode, { type: "tool" | "run" }>[]) =>
    nodes.flatMap((node) => node.type === "run" ? node.tools : [node.tool]);

  const output: ReactNode[] = [];
  let buffer: Extract<ProcessNode, { type: "tool" | "run" }>[] = [];
  const flushTools = () => {
    if (buffer.length === 0) return;
    output.push(renderToolList(buffer));
    buffer = [];
  };

  // 连贯模式:正文是唯一的分界,两段正文之间的思考和工具按到达顺序合成一组。
  const renderCoherentGroup = (node: Extract<CoherentNode, { type: "group" }>, last: boolean): ReactNode => {
    const tools = node.entries.flatMap((entry) => entry.type === "tool" ? [entry.tool] : []);
    const activeMessage = activeAssistantId ? messageById.get(activeAssistantId) : undefined;
    const live = Boolean(activeAssistantId && (tools.some((tool) => tool.status === "running") || (last && !activeMessage?.text)));
    // Codex 风格:总结只出现在进行中的标题上,没有工具的分组结束后不再保留。
    if (codex && !live && !hasCoherentTools(node.entries)) return null;
    const latestId = latestThoughtId(node.entries);
    const content: ReactNode[] = [];
    let run: Extract<ProcessNode, { type: "tool" }>[] = [];
    const flushRun = () => {
      if (run.length === 0) return;
      content.push(renderToolList(run));
      run = [];
    };
    for (const entry of node.entries) {
      if (entry.type === "tool") {
        run.push(entry);
        continue;
      }
      if (codex) continue;
      flushRun();
      const message = messageById.get(entry.messageId);
      content.push(
        <CoherentThought
          key={entry.id}
          messageId={entry.messageId}
          text={entry.text}
          active={entry.messageId === activeAssistantId && Boolean(message && !message.text && message.tools.length === 0)}
          expanded={live && entry.id === latestId}
        />,
      );
    }
    flushRun();
    // 步骤很少的分组没必要折叠,思考和工具直接平铺。
    if (!codex && isFlatCoherentGroup(node.entries)) {
      return withEnter(node.id, node.messageId, <div className="coherent-flat">{content}</div>);
    }
    return withEnter(
      node.id,
      node.messageId,
      <CoherentGroup
        entries={node.entries}
        live={live}
        showActivityIndicator={compact}
        forceOpen={tools.some((tool) => getQuestion(tool.id) !== null)}
        codex={codex}
        codexModern={codexModern}
      >
        {content}
      </CoherentGroup>,
    );
  };
  coherentNodes.forEach((node, index) => {
    output.push(node.type === "group" ? renderCoherentGroup(node, index === coherentNodes.length - 1) : node.type === "visual" ? withEnter(
      node.id,
      node.messageId,
      <VisualToolCard tool={node.tool} />,
    ) : withEnter(
      node.id,
      node.messageId,
      <div className="agent-reply-prose"><AssistantMarkdown messageId={node.messageId} text={node.text} streaming={node.messageId === activeAssistantId} /></div>,
    ));
  });

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.type === "tool" || node.type === "run") {
      buffer.push(node);
      continue;
    }
    flushTools();
    if (node.type === "thinking") {
      const message = messageById.get(node.messageId);
      const active = node.messageId === activeAssistantId && Boolean(message && !message.text && message.tools.length === 0);
      // groupProcessItems 已把跨过正文的后续工具移到标题思考之后。
      const grouped: Extract<ProcessNode, { type: "tool" | "run" }>[] = [];
      while (index + 1 < nodes.length) {
        const next = nodes[index + 1]!;
        if (next.type !== "tool" && next.type !== "run") break;
        grouped.push(next);
        index += 1;
      }
      const activeMessage = activeAssistantId ? messageById.get(activeAssistantId) : undefined;
      const tools = nodeTools(grouped);
      const ownsActiveMessage = node.messageId === activeAssistantId || grouped.some((item) => item.messageId === activeAssistantId);
      const live = Boolean(activeAssistantId && (tools.some((tool) => tool.status === "running")
        || (!activeMessage?.text && ownsActiveMessage)));
      output.push(withEnter(
        node.id,
        node.messageId,
        <ThinkingGroup
          messageId={node.messageId}
          model={message?.model}
          modelName={message?.modelName}
          text={node.text}
          active={active}
          live={live}
          showActivityIndicator={compact}
          tools={tools}
          forceOpen={tools.some((tool) => getQuestion(tool.id) !== null)}
        >
          {grouped.length > 0 ? renderToolList(grouped) : null}
        </ThinkingGroup>,
      ));
    } else {
      output.push(
        withEnter(
          node.id,
          node.messageId,
          <div className="agent-reply-prose"><AssistantMarkdown messageId={node.messageId} text={node.text} streaming={node.messageId === activeAssistantId} /></div>,
        ),
      );
    }
  }
  flushTools();
  return <>{output}</>;
}

const CompletedAssistantTurn = memo(function CompletedAssistantTurn({
  turnId,
  messages,
  finalReplies,
  elapsed,
  changes,
  onOpenChanges,
  onReviewTurn,
  canManageChanges,
  getQuestion,
  onReplyQuestion,
  toolDisplay,
  toolFold,
  branchTurn,
  replyTime,
  onBranch,
  onCheckpoints,
  onDistillMemory,
  distillDisabled,
  acceptance,
  onOpenAcceptance,
  deferred,
}: {
  turnId?: string;
  messages: UiMessage[];
  finalReplies: UiMessage[];
  elapsed: string | null;
  changes: TurnChanges | null;
  onOpenChanges: () => void;
  onReviewTurn?: (request: TurnReviewRequest) => void;
  canManageChanges: boolean;
  getQuestion: QuestionLookup;
  onReplyQuestion: QuestionReplyHandler;
  toolDisplay?: ToolDisplay;
  toolFold?: ToolFold;
  branchTurn: number | null;
  replyTime: number | null;
  onBranch: (turnIndex: number) => void;
  onCheckpoints?: (turnIndex?: number) => void;
  onDistillMemory?: (turnIndex: number | null) => void;
  distillDisabled?: boolean;
  acceptance: AcceptanceRequest | null;
  onOpenAcceptance?: (request: AcceptanceRequest) => void;
  deferred: boolean;
}) {
  const thinkingGroupMode = useThinkingGroupMode();
  const [expanded, setExpanded] = useToolExpanded(foldSequenceId(messages[0]?.id ? `turn:${messages[0].id}` : undefined), toolDisplay === "compact");
  const details = useToolProcessDetails();
  const toolsDuration = useToolsDuration(messages.flatMap(message => message.tools));
  const startedAt = messages.find(message => message.turnStartedAt !== undefined)?.turnStartedAt;
  const completedAt = messages[messages.length - 1]?.turnCompletedAt;
  const turnDuration = details && toolDisplay === "compact" ? readToolDuration({ startedAt, completedAt }) ?? toolsDuration : null;
  const stopped = messages[messages.length - 1]?.turnStopped === true;
  // 用户停止时报告墙钟时间(“多少秒后停止”),不用工具耗时之和。
  const displayedElapsed = turnDuration === null || stopped ? elapsed : formatWholeSeconds(turnDuration);
  const quotaWindows = useTurnQuota(startedAt);
  const processId = useId();
  const isFinalReply = (message: UiMessage) => finalReplies.some((reply) => reply.id === message.id);
  const visibleMessages = webChatMessages(messages);
  const hasProcess = visibleMessages.some(message => message.thinking || (!isFinalReply(message) && message.text)
    || message.tools.some(tool => tool.name !== visualToolName || !isFinalReply(message)));
  const triggerContent = (
    <>
      <span>{!displayedElapsed ? tr("查看过程", "View process") : stopped ? trf("你在 {0}后停止了", "You stopped after {0}", displayedElapsed) : trf("用时 {0}", "Took {0}", displayedElapsed)}</span>
      <TurnQuotaPill windows={quotaWindows} />
      {hasProcess ? (
        <Icon name="chevron-right" size={12} className="time-spent-trigger-arrow" />
      ) : null}
    </>
  );

  return (
    // 完成时是把已展示的消息换成折叠布局，不是新消息，不能重播入场淡入。
    <article className={`assistant-block assistant-turn${deferred ? " turn-deferred" : ""}`} data-turn-id={turnId}>
      {hasProcess || displayedElapsed ? (
      <div className={`time-spent-collapsible${expanded ? " expanded" : ""}`}>
        {hasProcess ? (
          <button
            className="time-spent-trigger assistant-turn-trigger"
            type="button"
            aria-expanded={expanded}
            aria-controls={processId}
            onClick={() => setExpanded((value) => !value)}
          >
            {triggerContent}
          </button>
        ) : (
          <span className="time-spent-trigger assistant-turn-trigger">{triggerContent}</span>
        )}
        <div id={processId} className="time-spent-body" aria-hidden={!expanded} inert={!expanded}>
          <div className="time-spent-body-inner">
            <LazyMount open={expanded}>{() => <>
            {toolFold === "position" || (groupsByReply(thinkingGroupMode) && messages.some(supportsThinkingGroups)) ? (
              <article className="assistant-block assistant-turn-process-item">
                <ToolSequence
                  messages={visibleMessages}
                  includeText={(message) => !isFinalReply(message)}
                  includeTool={(tool, message) => !(tool.name === visualToolName && isFinalReply(message))}
                  toolDisplay={toolDisplay ?? "card"}
                  getQuestion={getQuestion}
                  onReplyQuestion={onReplyQuestion}
                />
              </article>
            ) : (
              attachFollowerTools(visibleMessages).map(({ message }) => (
                <article className="assistant-block assistant-turn-process-item" key={message.id}>
                  <AssistantMessageContent
                    message={message}
                    thinkingActive={false}
                    thinkingDisclosure
                    showTools
                    showVisualTools={!isFinalReply(message)}
                    showText={!isFinalReply(message)}
                    changes={null}
                    onOpenChanges={onOpenChanges}
                    onReviewTurn={onReviewTurn}
                    canManageChanges={canManageChanges}
                    getQuestion={getQuestion}
                    onReplyQuestion={onReplyQuestion}
                    toolDisplay={toolDisplay}
                    toolFold={toolFold}
                  />
                </article>
              ))
            )}
            </>}</LazyMount>
          </div>
        </div>
      </div>
      ) : null}
      {finalReplies.map((reply) => {
        const visuals = reply.tools.filter((tool) => tool.name === visualToolName);
        return (
          <Fragment key={reply.id}>
            {reply.text ? (
              <div className="agent-reply-prose">
                <AssistantMarkdown messageId={reply.id} text={reply.text} />
              </div>
            ) : null}
            {visuals.map((tool) => (
              <VisualToolCard key={tool.id} tool={tool} />
            ))}
          </Fragment>
        );
      })}
      <PlanPreviewList planIds={collectPlanIds(messages)} />
      <ReplyActions
        text={joinReplyText(finalReplies)}
        speechId={lastTextReplyId(finalReplies)}
        replyless={!lastTextReplyId(finalReplies)}
        timestamp={replyTime}
        branchTurn={branchTurn}
        branchDisabled={branchTurn === null}
        onBranch={onBranch}
        onCheckpoints={onCheckpoints}
        onDistillMemory={onDistillMemory}
        distillDisabled={distillDisabled}
        acceptance={acceptance}
        onOpenAcceptance={onOpenAcceptance}
      />
      {changes ? <TurnChangesCard turnId={messages[messages.length - 1].id} changes={changes} onOpenChanges={onOpenChanges} onReviewTurn={onReviewTurn} canManageChanges={canManageChanges} /> : null}
    </article>
  );
});

/** 回复下方的操作行:左侧复制与分支,右侧显示回复完成的时间点。 */
function ReplyActions({
  text,
  speechId,
  replyless = false,
  timestamp,
  branchTurn,
  branchDisabled,
  onBranch,
  onCheckpoints,
  onDistillMemory,
  distillDisabled = false,
  acceptance,
  onOpenAcceptance,
}: {
  text: string;
  /** 朗读用的回复 id；没有最终回复时为 null。 */
  speechId: string | null;
  /** 本轮没有最终回复文本时，只保留验收入口。 */
  replyless?: boolean;
  timestamp: number | null;
  branchTurn: number | null;
  branchDisabled: boolean;
  onBranch: (turnIndex: number) => void;
  onCheckpoints?: (turnIndex?: number) => void;
  onDistillMemory?: (turnIndex: number | null) => void;
  distillDisabled?: boolean;
  acceptance?: AcceptanceRequest | null;
  onOpenAcceptance?: (request: AcceptanceRequest) => void;
}) {
  const [copied, setCopied] = useState(false);
  const speech = useSpeechState();
  const playback = useSpeechPlayback();
  const speaking = speechId !== null && playback?.id === speechId ? playback : null;
  // 这条回复被卸载（切换对话、重新生成）时不再继续朗读。
  const playbackIdRef = useRef<string | null>(null);
  playbackIdRef.current = playback?.id ?? null;
  useEffect(() => () => { if (speechId !== null && speechId === playbackIdRef.current) stopSpeaking(); }, [speechId]);
  const toggleSpeech = () => {
    if (speechId === null) return;
    if (speaking) { stopSpeaking(); return; }
    void speakReply(speechId, text).then(error => { if (error) showToast(error, { kind: "error" }); });
  };
  const speechIcon = speaking?.status === "loading" ? "clock" : speaking ? "stop-square" : "speaker";
  const time = formatReplyTime(timestamp);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="reply-actions">
      {!replyless ? <>
      <button
        className="reply-action"
        type="button"
        title={copied ? tr("已复制", "Copied") : tr("复制回复", "Copy reply")}
        aria-label={copied ? tr("已复制", "Copied") : tr("复制回复", "Copy reply")}
        onClick={copy}
      >
        {copied ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}
      </button>
      {speech.configured && speechId !== null ? (
        <button
          className="reply-action"
          type="button"
          data-speaking={speaking ? "true" : undefined}
          title={speaking ? tr("停止朗读", "Stop reading") : tr("朗读最终回复", "Read the final reply aloud")}
          aria-label={speaking ? tr("停止朗读", "Stop reading") : tr("朗读", "Read aloud")}
          aria-pressed={speaking ? true : undefined}
          onClick={toggleSpeech}
        >
          <Icon name={speechIcon} size={14} />
        </button>
      ) : null}
      <button
        className="reply-action"
        type="button"
        disabled={branchDisabled || branchTurn === null}
        title={tr("保留这条回复及之前的对话，在新聊天里继续", "Keep this reply and the conversation before it, then continue in a new chat")}
        aria-label={tr("分支到新聊天", "Branch to new chat")}
        onClick={() => {
          if (branchTurn !== null) onBranch(branchTurn);
        }}
      >
        <Icon name="branch" size={14} />
      </button>
      {onCheckpoints && branchTurn !== null ? (
        <button
          className="reply-action"
          type="button"
          title={tr("回到这一轮结束时，或从这里分叉并恢复文件", "Return to the end of this turn, or fork from here with its files")}
          aria-label={tr("检查点", "Checkpoint")}
          aria-haspopup="dialog"
          onClick={() => onCheckpoints(branchTurn)}
        >
          <Icon name="history" size={14} />
        </button>
      ) : null}
      </>: null}
      {onDistillMemory ? (
        <button
          className="reply-action reply-action-distill"
          type="button"
          disabled={distillDisabled}
          title={tr("抽取本次发现的隐含约束，经 Diff 预览后追加到项目 MEMORY.md", "Extract implicit constraints discovered in this chat and append to project MEMORY.md")}
          aria-label={tr("提炼规范到项目记忆", "Distill to project memory")}
          aria-haspopup="dialog"
          onClick={() => onDistillMemory(branchTurn)}
        >
          <Icon name="memory-update" size={14} />
        </button>
      ) : null}
      {acceptance ? (
        <button
          className="reply-action reply-action-acceptance"
          type="button"
          title={tr("验收", "Acceptance")}
          aria-label={tr("验收", "Acceptance")}
          disabled={!onOpenAcceptance}
          onClick={() => onOpenAcceptance?.(acceptance)}
        >
          <Icon name="acceptance" size={14} />
        </button>
      ) : null}
      {time && timestamp !== null ? (
        <time className="reply-time" dateTime={new Date(timestamp).toISOString()} title={formatReplyTimeTitle(timestamp)}>
          {time}
        </time>
      ) : null}
    </div>
  );
}

function formatReplyTime(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const locale = activeIntlLocale();
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatReplyTimeTitle(timestamp: number): string {
  return new Date(timestamp).toLocaleString(activeIntlLocale());
}

function TurnChangeFileLabel({ path }: { path: string }) {
  const nameStart = path.lastIndexOf("/") + 1;
  return <>
    <FileTypeIcon path={path} fallback={<Icon name="file" size={14} />} />
    <span className="turn-changes-path-text" dir="rtl">
      <bdi dir="ltr">
        {nameStart > 0 && <span className="turn-changes-directory">{path.slice(0, nameStart)}</span>}
        <bdi>{path.slice(nameStart)}</bdi>
      </bdi>
    </span>
  </>;
}

/** 本轮完成后展示文件统计；审查读取保存的工具差异，不受后续工作区改动影响。 */
function TurnChangesCard({ turnId, changes, onOpenChanges, onReviewTurn, canManageChanges }: {
  turnId: string;
  changes: TurnChanges;
  onOpenChanges: () => void;
  onReviewTurn?: (request: TurnReviewRequest) => void;
  canManageChanges: boolean;
}) {
  const preview = useFilePreview();
  const [showAll, setShowAll] = useState(false);
  const files = showAll ? changes.files : changes.files.slice(0, 3);
  const remaining = changes.files.length - 3;

  return (
    <section className="turn-changes" aria-label={tr("本轮文件变更统计", "File changes in this turn")}>
      <header className="turn-changes-header">
        <span className="turn-changes-icon" aria-hidden="true"><Icon name="file-diff" size={18} /></span>
        <div className="turn-changes-summary">
          <strong>{trf("已编辑 {0} 个文件", "Edited {0} files", changes.files.length)}</strong>
          <span className="turn-changes-total">
            <span className="turn-changes-added">+{changes.added}</span>
            <span className="turn-changes-removed">−{changes.removed}</span>
          </span>
        </div>
        <div className="turn-changes-actions">
          <button
            type="button"
            className="turn-changes-undo"
            title={tr("打开工作区变更，在那里选择文件并确认撤销；此处不会直接还原", "Opens Workspace Changes, where you choose files and confirm. Nothing is reverted from here")}
            disabled={!canManageChanges}
            onClick={onOpenChanges}
          >
            {tr("撤销", "Undo")} <Icon name="undo" size={14} />
          </button>
          <button
            type="button"
            className="turn-changes-review"
            disabled={!onReviewTurn}
            onClick={() => onReviewTurn?.({ turnId, changes })}
          >
            {tr("审查", "Review")}
          </button>
        </div>
      </header>
      <div className="turn-changes-body">
        {files.map((file) => (
          <div className="turn-changes-file" key={file.path}>
            {preview ? (
              <button className="turn-changes-path" type="button" title={`${tr("预览", "Preview")} ${file.path}`} onClick={() => preview.openFile(file.path)}>
                <TurnChangeFileLabel path={file.path} />
              </button>
            ) : (
              <span className="turn-changes-path" title={file.path}><TurnChangeFileLabel path={file.path} /></span>
            )}
            <span className="turn-changes-file-stat" aria-label={trf("增加 {0} 行，删除 {1} 行", "{0} lines added, {1} removed", file.added, file.removed)}>
              <span className="turn-changes-added">+{file.added}</span>
              <span className="turn-changes-removed">−{file.removed}</span>
            </span>
          </div>
        ))}
        {remaining > 0 ? (
          <button className="turn-changes-more" type="button" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
            {showAll ? tr("收起文件", "Show fewer files") : trf("再显示 {0} 个文件", "Show {0} more files", remaining)}
            <Icon name="chevron-down" size={12} className={showAll ? "is-up" : ""} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

