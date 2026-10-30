import { QuestionContext } from "./QuestionContext";
import { LazyMount } from "./LazyMount";
import { VersionControlView } from "./version-control/VersionControlView";
import { TraceView } from "./trace/TraceView";
import { UsageView } from "./usage/UsageView";
import { isAgentBusy, type AppState, type AskUserQuestionRequest, type InteractionMode } from "@vela/shared";
import { Fragment, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAgentWorkspace } from "./AgentPanel";
import { modKeyLabel } from "../platform";
import { ArrowLeftIcon, BranchIcon, CheckIcon, CopyIcon, HistoryIcon, PlusIcon, StackIcon } from "./icons";
import { trackEnteredMessages, type EnterTrack } from "./message-motion";
import type { useModels } from "../hooks/useModels";
import type { ProjectApi } from "../hooks/useProject";
import type { SendButtonIcon, ToolDisplay, ToolFold } from "../hooks/usePreferences";
import type { UiMessage } from "../hooks/useSession";
import { RepoCard } from "./RepoCard";
import { Composer } from "./Composer";
import { TaskBudgetBanner } from "./TaskBudgetBanner";
import { ConflictBanner } from "./ConflictBanner";
import { TaskCostForecastHint } from "./TaskCostForecastHint";
import { RunViewDock } from "./RunViewDock";
import { JumpOrb } from "./JumpOrb";
import type { OrbActivity } from "./jump-orb";
import { ContextTab } from "./ContextTab";
import { NewChatGreeting, NewChatPrompts, VelaMark } from "./NewChatHome";
import { TaskBudgetTab } from "./TaskBudgetTab";
import { useContentArrival } from "./BatchMotion";
import { Markdown } from "./Markdown";
import { AssistantMarkdown } from "./intelligent-ui/AssistantMarkdown";
import { ConversationLinkContext } from "./ConversationLinkContext";
import { SelectionActions } from "./SelectionActions";
import { SideChatLauncherContext } from "./selection-actions";
import { replyStore, useReplyCards } from "../browser/reply-store";
import { OpenInAppButton } from "./OpenInAppButton";
import { CoherentGroup, CoherentThought, ThinkingGroup } from "./Thinking";
import { useThinkingGroupMode } from "./ThinkingGroupModeContext";
import { ThinkingSummaryContext } from "./ThinkingSummaryContext";
import type { ThinkingSummariesApi } from "../hooks/useThinkingSummaries";
import { ToolCard, ToolList, CompactToolGroup, CompactToolLine, ToolRunGroup, type QuestionLookup } from "./ToolCard";
import { toolCompactKind } from "./tool-compact";
import { attachFollowerTools, buildTurnItems, groupCoherentItems, groupProcessItems, isFlatCoherentGroup, latestThoughtId, type CoherentNode, type ProcessNode } from "./tool-sequence";
import { formatDuration, readToolDuration } from "./tool-duration";
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
import { acceptanceCounts, outcomeByFinalMessage, type AcceptanceRequest } from "./acceptance";
import { summarizeTurnChanges, type TurnChanges, type TurnReviewRequest } from "./turn-changes";
import { chatLaneDefaultMaxWidth, planChatLane, planInfoCardLane } from "../chat-lane";
import { ConversationViewTabs, conversationPanelId, conversationTabId, isEmptyConversationView, type ConversationViewKey } from "./ConversationViewTabs";
import type { QuestionReplyHandler } from "./QuestionCard";
import { RecommendedActionsCard } from "./RecommendedActionsCard";
import { latestRecommendedActions } from "./recommended-actions";
import { RecipeChatCard } from "./RecipeChatContext";
import { ChatActionsMenu } from "./ChatActionsMenu";
import { UserMessageFrame } from "./UserMessageFrame";
import { ImageViewer, type ImageViewerRequest } from "./ImageViewer";
import { localizeError, tr, trf, activeIntlLocale } from "../locale";

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
  return replies.map((reply) => reply.text.trim()).join("\n\n");
}

function formatElapsedTime(startedAt: number | undefined, completedAt: number | undefined): string | null {
  if (startedAt === undefined || completedAt === undefined) return null;
  const totalSeconds = Math.max(0, Math.floor((completedAt - startedAt) / 1000));
  if (totalSeconds < 1) return tr("不到 1 秒", "<1 sec");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return trf("{0}小时{1}分{2}秒", "{0}h {1}m {2}s", hours, minutes, seconds);
  if (minutes > 0) return trf("{0}分{1}秒", "{0}m {1}s", minutes, seconds);
  return trf("{0}秒", "{0}s", seconds);
}

/**
 * 运行中的轮次在最终回复出现前显示“已处理 xx”。回复完成后这一行会被
 * CompletedAssistantTurn 的“用时 xx”触发器接替,位置与分界线保持不变。
 */
function TurnProgressHeader({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const elapsed = formatElapsedTime(startedAt, now);
  if (!elapsed) return null;
  return (
    // 每秒更新的计时不进入 role="log" 的朗读范围。
    <span className="time-spent-trigger assistant-turn-trigger" aria-live="off">
      {trf("已处理 {0}", "Worked {0}", elapsed)}
    </span>
  );
}

export interface ChatViewProps {
  /** 工作面板内复用消息与输入框，省去窗口级操作。 */
  embedded?: boolean;
  messages: UiMessage[];
  state: AppState | null;
  sendError: string | null;
  platform: string;
  leftCollapsed: boolean;
  onToggleLeft: () => void;
  onRenameConversation?: (id: string) => void;
  floatingInfo?: boolean;
  /** 悬浮信息布局下，用可排序的信息卡片栈代替单张环境卡片。 */
  infoCards?: boolean;
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
  thinkingSummaries?: ThinkingSummariesApi;
  /** 在输入框模型列表中隐藏的模型，key 为 `provider/id`。 */
  hiddenModels?: string[];
  sendButtonIcon?: SendButtonIcon;
  /** 输入预测：回复结束后在空输入框里以灰色显示预测内容。 */
  predictionEnabled?: boolean;
  /** 预测使用的模型；null 表示跟随当前对话模型。 */
  predictionModel?: import("@vela/shared").ThinkingSummaryModel | null;
  /** 推荐操作：回复结束后在消息流末尾显示模型给出的后续操作卡片。 */
  recommendedActionsEnabled?: boolean;
  onSend: (text: string, images?: import("@vela/shared").ImageAttachment[], deliverAs?: import("@vela/shared").RuntimeInstructionMode) => Promise<void | boolean>;
  /** 撤销一条还没被模型消费的排队/调整指令。 */
  onRemoveInstruction: (instructionId: string) => Promise<void>;
  onEdit?: (turnIndex: number, text: string, images?: import("@vela/shared").ImageAttachment[]) => Promise<void>;
  onAbort: () => Promise<void>;
  onMode: (mode: import("@vela/shared").InteractionMode) => void;
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
  onExpandWorkbench?: () => void;
  onOpenWebLink?: (url: string) => boolean;
  onNewTab: () => void;
  onOpenChanges: () => void;
  onReviewTurn?: (request: TurnReviewRequest) => void;
  onOpenAcceptance?: (request: AcceptanceRequest) => void;
  planDraft?: import("../plan-draft").PlanDraft | null;
  onOpenPlan?: (planId: string) => void;
}

export function ChatView({
  embedded = false,
  messages,
  state,
  sendError,
  platform,
  leftCollapsed,
  onToggleLeft,
  onRenameConversation,
  rightCollapsed,
  onToggleRight,
  floatingInfo = false,
  infoCards = false,
  onResumeGoal,
  environmentCollapsed = false,
  changesActive = false,
  project,
  toolDisplay = "card",
  toolFold = "message",
  runView = false,
  thinkingSummaries,
  hiddenModels = [],
  sendButtonIcon = "paper-plane",
  predictionEnabled = false,
  predictionModel = null,
  recommendedActionsEnabled = true,
  onSend,
  onRemoveInstruction,
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
  onExpandWorkbench,
  onOpenWebLink,
  onNewTab,
  onOpenChanges,
  onReviewTurn,
  onOpenAcceptance,
  planDraft = null,
  onOpenPlan,
}: ChatViewProps) {
  const thinkingGroupMode = useThinkingGroupMode();
  const filePreview = useFilePreview();
  const openOutputFile = useCallback((path: string) => {
    if (filePreview) filePreview.openFile(path);
    else void project.openFile(path);
  }, [filePreview, project]);
  const tabIdPrefix = useId();
  const [views, setViews] = useState<Record<string, ConversationViewKey>>({});
  const [vcMounted, setVcMounted] = useState(false);
  const [imageView, setImageView] = useState<ImageViewerRequest | null>(null);
  const startSideChat = useContext(SideChatLauncherContext);
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
  const savedView = views[viewKey] ?? "chat";
  const emptyConversation = messages.length === 0;
  const view = (savedView === "versionControl" && !hasWorkspace) || isEmptyConversationView(savedView, emptyConversation) ? "chat" : savedView;
  const setView = (next: ConversationViewKey) => {
    if (next === "versionControl" && !hasWorkspace) return;
    if (next === "versionControl") setVcMounted(true);
    setViews(current => ({ ...current, [viewKey]: next }));
  };
  const pendingInteraction = Boolean(project.approval) || messages.some(message => message.tools.some(tool => getQuestion(tool.id)));
  const session = state?.session;
  const streaming = session?.status === "streaming";
  // 末条是已结束的助手回复时，它的 id 就是这一轮预测的依据；其余情况不预测。
  const lastMessage = messages[messages.length - 1];
  const predictionKey = lastMessage?.role === "assistant" && !streaming && lastMessage.text.trim() ? `${lastMessage.id}:${lastMessage.text.length}` : null;
  const [dismissedRecommendations, setDismissedRecommendations] = useState<ReadonlySet<string>>(() => new Set());
  const turnRecommendation = useMemo(() => latestRecommendedActions(messages), [messages]);
  const recommendation = recommendedActionsEnabled && session?.status === "ready" && !pendingInteraction &&
    turnRecommendation && !dismissedRecommendations.has(turnRecommendation.id)
    ? turnRecommendation
    : null;
  const activeAssistantId = streaming
    ? [...messages].reverse().find((message) => message.role === "assistant")?.id
    : undefined;
  // 回到最新按钮的圆球状态:有 bash 在跑 = 运行命令;助手还没写出正文 = 思考;其余显示箭头。
  const activeAssistant = activeAssistantId ? messages.find((message) => message.id === activeAssistantId) : undefined;
  const runningBash = activeAssistant?.tools.find((tool) => (tool.name === "bash" || tool.name === "edit" || tool.name === "write") && tool.status === "running");
  const jumpActivity: OrbActivity | undefined = !activeAssistant
    ? undefined
    : runningBash
      ? "command"
      : !activeAssistant.text
        ? "thinking"
        : undefined;
  const title = session?.title || tr("新对话", "New chat");
  // 空对话用「首页」布局:问候、输入框、预设整体居中,而不是输入框贴底。
  const homeLayout = !embedded && messages.length === 0;
  const hasProjectWorkspace = Boolean(project.workspace?.current);
  const modelMissing = session?.status === "ready" && !session.modelReady;
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
      const clearance = `${Math.ceil(height + 36)}px`;
      if (root.style.getPropertyValue("--composer-clearance") !== clearance) root.style.setProperty("--composer-clearance", clearance);
    }
    if (followRef.current.pinned) scrollFollowToEnd(scroller, followRef.current);
    syncJumpToLatest();
  };
  const scheduleLayout = useCallback(() => layoutRef.current(), []);

  const jumpToLatest = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    followRef.current.pinned = true;
    scrollFollowToEnd(scroller, followRef.current);
    setShowJumpToLatest(false);
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const dock = dockRef.current;
    const root = scroller?.parentElement;
    if (!scroller || !dock || !root) return;

    let scrollbarHideTimer: number | undefined;
    const showScrollbar = () => {
      scroller.classList.add("is-scrolling");
      window.clearTimeout(scrollbarHideTimer);
      scrollbarHideTimer = window.setTimeout(() => {
        scroller.classList.remove("is-scrolling");
      }, 800);
    };

    const onScroll = () => {
      showScrollbar();
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

    const releaseIfScrollingUp = (towardEarlier: boolean) => {
      if (releasesStreamFollow(scroller.scrollTop, towardEarlier)) {
        followRef.current.pinned = false;
        syncJumpToLatest();
      }
    };
    const onWheel = (event: WheelEvent) => releaseIfScrollingUp(event.deltaY < 0);

    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => {
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
    return () => {
      window.clearTimeout(scrollbarHideTimer);
      scroller.classList.remove("is-scrolling");
      observer.disconnect();
      contentObserver.disconnect();
      contentMutations.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      root.style.removeProperty("--composer-clearance");
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
  // 信息卡片按避让后的文字宽度决定显隐;旧环境卡片保留 10% 收窄预算。
  // 隐藏后仍测量卡片未变换的布局位置,避免隐藏释放空间后又立即显示。
  useLayoutEffect(() => {
    const pane = scrollerRef.current?.parentElement;
    if (!floatingInfo || (environmentCollapsed && !infoCards) || !pane) return;

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
        cardLeft: isStack ? paneLeft + card.offsetLeft + paddingLeft : card.getBoundingClientRect().left,
        laneLimitLeft: paneLeft,
      };
      return isStack
        ? planInfoCardLane({ ...input, cardWidth: card.clientWidth - paddingLeft - paddingRight })
        : { ...planChatLane(input), concealed: false };
    };

    const apply = () => {
      const plan = measure();
      if (!plan) return;
      const scroller = scrollerRef.current;
      if (scroller) pane.style.setProperty("--chat-scrollbar-width", `${scroller.offsetWidth - scroller.clientWidth}px`);
      setInfoCardsConcealed(plan.concealed);
      pane.style.setProperty("--chat-lane-shift", `${environmentCollapsed ? 0 : plan.shift}px`);
      pane.style.setProperty("--chat-lane-shrink", `${environmentCollapsed ? 0 : plan.shrink}px`);
    };

    // 栈可能在数据到达后才挂载,或在所有卡片都不可用时卸载。
    const observer = new ResizeObserver(apply);
    const observeCard = () => {
      observer.disconnect();
      observer.observe(pane);
      const card = pane.querySelector<HTMLElement>(".floating-environment, .info-card-stack");
      if (card) observer.observe(card);
      else {
        setInfoCardsConcealed(true);
        pane.style.setProperty("--chat-lane-shift", "0px");
        pane.style.setProperty("--chat-lane-shrink", "0px");
      }
      apply();
    };
    observeCard();
    const children = new MutationObserver(observeCard);
    children.observe(pane, { childList: true });
    return () => {
      children.disconnect();
      observer.disconnect();
      pane.style.removeProperty("--chat-scrollbar-width");
      pane.style.removeProperty("--chat-lane-shift");
      pane.style.removeProperty("--chat-lane-shrink");
    };
  }, [floatingInfo, infoCards, environmentCollapsed, messageSurfaceKey]);

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
  const { agents: roster, activeAgentId, openAgent } = useAgentWorkspace();
  const subagents = useMemo(() => roster.filter((agent) => agent.kind !== "root"), [roster]);
  const runningSubagents = subagents.filter((agent) => agent.status === "running").length;
  const openMostRelevantAgent = (): void => {
    const target = [...subagents].sort(
      (a, b) => Number(b.status === "running") - Number(a.status === "running") || b.updatedAt - a.updatedAt,
    )[0];
    if (target) openAgent(target.id);
  };
  const previousTurns = useRef<MessageTurn[]>([]);
  const turns = useMemo(() => groupMessagesIntoTurns(messages, previousTurns.current), [messages]);
  useLayoutEffect(() => { previousTurns.current = turns; }, [turns]);
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

  return (
    <QuestionContext.Provider value={question}>
    <ThinkingSummaryContext.Provider value={thinkingSummaries ?? null}>
    <main className={`main-chat-view${embedded ? " panel-chat-view" : ""}`} data-tool-display={toolDisplay} tabIndex={-1}>
      <header className="main-chat-header">
        <div className="chat-title-group">
          {!embedded && leftCollapsed ? (
            <button
              className="view-icon-btn"
              type="button"
              title={`${tr("展开侧边栏", "Expand sidebar")} (${mod}B)`}
              aria-label={tr("展开侧边栏", "Expand sidebar")}
              onClick={onToggleLeft}
            >
              <SidebarIcon />
            </button>
          ) : null}
          {state?.activeConversationId && onRenameConversation ? (
            <button
              className="chat-active-title chat-title-rename"
              type="button"
              title={tr("重命名对话", "Rename chat")} data-tooltip
              aria-label={`${tr("重命名对话", "Rename chat")} “${title}”`}
              onClick={() => onRenameConversation(state.activeConversationId!)}
            ><span>{title}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6L16 3Z" /><path d="m14 5 5 5" /></svg></button>
          ) : <span className="chat-active-title" title={title}>{title}</span>}
        </div>
        <div className="chat-header-actions">
          {!embedded && project.workspace?.current ? (
            <span className="chat-project-context" title={project.workspace.current}>
              <span className="chat-project-name">{project.workspace.current.split(/[\\/]/).filter(Boolean).pop()}</span>
              {project.git?.branch ? <span className="chat-project-branch">{project.git.branch}</span> : null}
            </span>
          ) : null}
          {!embedded ? <OpenInAppButton path={project.workspace?.current ?? null} /> : null}
          {subagents.length > 0 ? (
            <button
              className={`chat-agents-button${activeAgentId ? " active" : ""}`}
              type="button"
              title={tr("查看子代理运行", "View subagent runs")}
              aria-label={tr("查看子代理运行", "View subagent runs")}
              onClick={openMostRelevantAgent}
            >
              <StackIcon size={13} />
              <span>
                {runningSubagents > 0
                  ? trf("{0} 运行中", "{0} running", runningSubagents)
                  : trf("{0} 个子代理", "{0} subagents", subagents.length)}
              </span>
            </button>
          ) : null}
          {onExpandWorkbench && <button className="view-icon-btn workbench-expand" type="button"
            title={tr("展开工作面板", "Expand workbench")}
            aria-label={tr("展开工作面板", "Expand workbench")} aria-expanded={false}
            onClick={onExpandWorkbench}>
            <ArrowLeftIcon size={15} />
          </button>}
          {showNewTab ? (
            <button
              className="view-icon-btn"
              type="button"
              title={`${tr("新建标签页", "New tab")} (${mod}T)`}
              aria-label={tr("新建标签页", "New tab")}
              onClick={onNewTab}
            >
              <PlusIcon size={15} />
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
              <HistoryIcon size={15} />
            </button>
          ) : null}
          <ChatActionsMenu key={state?.activeConversationId ?? "empty"} messages={messages} streaming={Boolean(streaming)} />
          {!embedded && !emptyConversation ? <button
            className="icon-btn-ghost"
            type="button"
            title={`${rightLabel} (${mod}J)`}
            aria-label={rightLabel}
            aria-pressed={!rightCollapsed}
            onClick={onToggleRight}
          >
            {floatingInfo ? (infoCards ? <InfoCardsIcon /> : <EnvironmentInfoIcon />) : <PanelIcon />}
          </button> : null}
        </div>
      </header>

      <ConversationViewTabs idPrefix={tabIdPrefix} view={view} showVersionControl={hasWorkspace && !embedded} emptyConversation={emptyConversation} onChange={setView} />
      {view === "trace" || view === "usage" || view === "context" || view === "budget" ? (
        <div className="conversation-view-panel" role="tabpanel" id={conversationPanelId(tabIdPrefix, view)} aria-labelledby={conversationTabId(tabIdPrefix, view)}>
          {view === "trace" ? <TraceView key={viewKey} state={state} onConversation={() => setView("chat")} onAbort={onAbort} pendingInteraction={pendingInteraction} /> : null}
          {view === "usage" ? <UsageView key={viewKey} conversationId={state?.activeConversationId ?? null} providers={models.catalog?.providers ?? []} /> : null}
          {view === "context" ? <ContextTab key={viewKey} conversationId={state?.activeConversationId ?? null} context={state?.context} /> : null}
          {view === "budget" ? <TaskBudgetTab key={viewKey} conversationId={state?.activeConversationId ?? null} budget={session?.taskBudget} /> : null}
        </div>
      ) : null}
      {hasWorkspace && vcMounted ? <VersionControlView
        project={project}
        session={session ?? null}
        hidden={view !== "versionControl"}
        pendingInteraction={pendingInteraction}
        onOpenConversation={() => setView("chat")}
        onAbort={onAbort}
        onOpenFile={(absolutePath) => void project.openFile(absolutePath)}
      /> : null}
      <div className="chat-conversation-pane" role="tabpanel" id={conversationPanelId(tabIdPrefix, "chat")} aria-labelledby={conversationTabId(tabIdPrefix, "chat")} data-home={homeLayout ? "true" : undefined} data-prompts={homeLayout && hasProjectWorkspace && !modelMissing ? "true" : undefined} hidden={view !== "chat"} inert={view !== "chat" ? true : undefined}>
      {homeLayout ? <VelaMark /> : null}
      {floatingInfo && infoCards && !emptyConversation ? (
        <InfoCardStack concealed={environmentCollapsed || infoCardsConcealed} state={state} project={project} messages={messages} planDraft={planDraft}
          changesActive={changesActive} onOpenChanges={onOpenChanges} onOpenPlan={onOpenPlan}
          onResumeGoal={onResumeGoal} onOpenFile={openOutputFile} />
      ) : null}
      {floatingInfo && !infoCards && !environmentCollapsed && !emptyConversation ? (
        <div className="floating-environment">
          <RepoCard project={project} onOpenChanges={onOpenChanges} activeChanges={changesActive}
            plan={planReferenceModel(session?.proposedPlan ?? null, planDraft, session?.executionPlan ?? null)}
            onOpenPlan={onOpenPlan}
            onToggle={onToggleRight} />
        </div>
      ) : null}
      <ConversationLinkContext.Provider value={onOpenWebLink ?? null}>
      <div className="chat-scroll-area" ref={scrollerRef}>
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
            workspace={project.workspace?.current ?? null}
            modelMissing={modelMissing}
            mode={session?.mode ?? "agent"}
          />
        ) : (
          turns.map((turn, index) => {
            const finalReplies = selectFinalReplies(turn.assistants);
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
                  />
                ) : null}
                {canCollapse && finalReply && lastAssistant ? (
                  <CompletedAssistantTurn
                    key={lastAssistant.id}
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
                  />
                ) : turn.assistants.length > 0 ? (
                  <div className="assistant-live-turn">
                    {liveStartedAt !== undefined ? <TurnProgressHeader startedAt={liveStartedAt} /> : null}
                    {toolFold === "position" || thinkingGroupMode === "coherent" ? (
                      <article className="assistant-block">
                        <ToolSequence
                          messages={turn.assistants}
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
                      attachFollowerTools(turn.assistants).map(({ message, memberIds }) => (
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
                    {finalReply ? (
                      <ReplyActions
                        text={joinReplyText(finalReplies)}
                        timestamp={finalReply.timestamp ?? null}
                        branchTurn={branchTurn}
                        branchDisabled={session?.status !== "ready"}
                        onBranch={onBranch}
                        onCheckpoints={onOpenCheckpoints}
                      />
                    ) : null}
                  </div>
                ) : null}
                {acceptance ? <AcceptanceCard request={acceptance} onOpen={onOpenAcceptance} /> : null}
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
        {runView && streaming && view === "chat" && messages.length > 0 ? <RunViewDock messages={messages} /> : null}
        </div>
      </div>

      </ConversationLinkContext.Provider>
      <SelectionActions containerRef={scrollerRef} onSideChat={startSideChat}
        onReply={(quote, text) => replyStore.addText(replyKey, quote, text)} />
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
      <ConflictBanner conversationId={state?.activeConversationId} />
      <TaskCostForecastHint session={session} />
      <Composer
        embedded={embedded}
        sandboxMode={session?.sandboxMode}
        ref={dockRef}
        disabled={session?.status !== "ready" && session?.status !== "streaming"}
        streaming={Boolean(streaming)}
        platform={platform}
        instructions={state?.session.pendingInstructions ?? []}
        showSetupControls={!embedded && messages.length === 0 && !streaming && (state?.context.turnCount ?? 0) === 0}
        model={session?.model}
        modelProvider={session?.modelProvider ?? null}
        modelId={session?.modelId ?? null}
        modelReady={session?.modelReady ?? false}
        thinkingLevel={session?.thinkingLevel ?? "medium"}
        thinkingLevels={session?.thinkingLevels ?? ["off"]}
        hiddenModels={hiddenModels}
        sendButtonIcon={sendButtonIcon}
        predictionEnabled={predictionEnabled}
        predictionModel={predictionModel}
        predictionKey={predictionKey}
        conversationId={state?.activeConversationId ?? null}
        models={models}
        mode={session?.mode ?? "agent"}
        sendError={sendError}
        usage={state?.context ?? null}
        contextPopover={floatingInfo}
        project={project}
        onSend={onSend}
        replies={replies}
        onRemoveReply={(id) => replyStore.remove(replyKey, id)}
        onFocusReply={(id) => replyStore.requestFocus(id)}
        onBeginReplies={() => replyStore.beginSend(replyKey)}
        onSettleReplies={(sent, kept) => replyStore.settleSend(replyKey, sent, kept)}
        onRemoveInstruction={onRemoveInstruction}
        onAbort={onAbort}
        onMode={onMode}
      />
      {homeLayout && hasProjectWorkspace && !modelMissing ? <NewChatPrompts hasGit={Boolean(project.git?.repo)} /> : null}
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
  workspace,
  modelMissing,
  mode,
}: {
  workspace: string | null;
  modelMissing: boolean;
  mode: InteractionMode;
}) {
  const hint = modelMissing
    ? tr("还没有可用的模型。点输入框右下角的模型按钮登录提供方，或添加一个兼容接口。", "No models are available yet. Use the model button at the bottom right to sign in to a provider or add a compatible API.")
    : workspace
      ? tr(modeHints[mode][0], modeHints[mode][1])
      : tr("点输入框上方的工作区晶片，选择要处理的项目。", "Pick a project with the workspace chip above the input.");
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
}: {
  message: UiMessage;
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
}) {
  const enterClass = entering ? " message-enter" : "";
  if (message.role === "user") {
    const images = message.images ?? [];
    return (
      <UserMessageFrame text={message.text} timestamp={message.timestamp} disabled={editDisabled} className={enterClass} onEdit={onEdit}>
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
  const tools = showTools && message.tools.length > 0 ? (
    <ToolList
      tools={message.tools}
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
            text={message.thinking}
            active={thinkingActive}
            live={streaming && (!message.text || message.tools.some((tool) => tool.status === "running"))}
            showActivityIndicator={toolDisplay === "compact"}
            tools={message.tools}
            forceOpen={message.tools.some((tool) => getQuestion(tool.id) !== null)}
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
      {changes ? <TurnChangesCard turnId={message.id} changes={changes} onOpenChanges={onOpenChanges} onReviewTurn={onReviewTurn} canManageChanges={canManageChanges} /> : null}
    </>
  );
}

/** 位置关系折叠:整轮拍平成序列后合并相邻工具;思考、可见正文和交互卡片都会打断。 */
function ToolSequence({
  messages,
  activeAssistantId,
  entering,
  includeText,
  toolDisplay,
  getQuestion,
  onReplyQuestion,
}: {
  messages: UiMessage[];
  activeAssistantId?: string;
  entering?: Set<string>;
  includeText?: (message: UiMessage) => boolean;
  toolDisplay: ToolDisplay;
  getQuestion: QuestionLookup;
  onReplyQuestion: QuestionReplyHandler;
}) {
  const coherent = useThinkingGroupMode() === "coherent";
  const items = useMemo(() => buildTurnItems(messages, { includeText }), [messages, includeText]);
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
      flushRun();
      const message = messageById.get(entry.messageId);
      content.push(
        <CoherentThought
          key={entry.id}
          text={entry.text}
          active={entry.messageId === activeAssistantId && Boolean(message && !message.text && message.tools.length === 0)}
          expanded={live && entry.id === latestId}
        />,
      );
    }
    flushRun();
    // 步骤很少的分组没必要折叠,思考和工具直接平铺。
    if (isFlatCoherentGroup(node.entries)) {
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
      >
        {content}
      </CoherentGroup>,
    );
  };
  coherentNodes.forEach((node, index) => {
    output.push(node.type === "group" ? renderCoherentGroup(node, index === coherentNodes.length - 1) : withEnter(
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
}: {
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
}) {
  const thinkingGroupMode = useThinkingGroupMode();
  const [expanded, setExpanded] = useToolExpanded(foldSequenceId(messages[0]?.id ? `turn:${messages[0].id}` : undefined), toolDisplay === "compact");
  const details = useToolProcessDetails();
  const toolsDuration = useToolsDuration(messages.flatMap(message => message.tools));
  const startedAt = messages.find(message => message.turnStartedAt !== undefined)?.turnStartedAt;
  const completedAt = messages[messages.length - 1]?.turnCompletedAt;
  const turnDuration = details && toolDisplay === "compact" ? readToolDuration({ startedAt, completedAt }) ?? toolsDuration : null;
  const displayedElapsed = turnDuration === null ? elapsed : formatDuration(turnDuration);
  const processId = useId();
  const isFinalReply = (message: UiMessage) => finalReplies.some((reply) => reply.id === message.id);
  const hasProcess = messages.some((message) => (
    !isFinalReply(message) && Boolean(message.text || message.thinking || message.tools.length > 0)
  )) || finalReplies.some((message) => Boolean(message.thinking || message.tools.length > 0));
  const triggerContent = (
    <>
      <span>{displayedElapsed ? trf("用时 {0}", "Took {0}", displayedElapsed) : tr("查看过程", "View process")}</span>
      {hasProcess ? (
        <svg className="time-spent-trigger-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      ) : null}
    </>
  );

  return (
    // 完成时是把已展示的消息换成折叠布局，不是新消息，不能重播入场淡入。
    <article className="assistant-block assistant-turn">
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
            {toolFold === "position" || thinkingGroupMode === "coherent" ? (
              <article className="assistant-block assistant-turn-process-item">
                <ToolSequence
                  messages={messages}
                  includeText={(message) => !isFinalReply(message)}
                  toolDisplay={toolDisplay ?? "card"}
                  getQuestion={getQuestion}
                  onReplyQuestion={onReplyQuestion}
                />
              </article>
            ) : (
              attachFollowerTools(messages).map(({ message }) => (
                <article className="assistant-block assistant-turn-process-item" key={message.id}>
                  <AssistantMessageContent
                    message={message}
                    thinkingActive={false}
                    thinkingDisclosure
                    showTools
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
      {finalReplies.map((reply) => (
        <div className="agent-reply-prose" key={reply.id}>
          <AssistantMarkdown messageId={reply.id} text={reply.text} />
        </div>
      ))}
      <PlanPreviewList planIds={collectPlanIds(messages)} />
      <ReplyActions
        text={joinReplyText(finalReplies)}
        timestamp={replyTime}
        branchTurn={branchTurn}
        branchDisabled={branchTurn === null}
        onBranch={onBranch}
        onCheckpoints={onCheckpoints}
      />
      {changes ? <TurnChangesCard turnId={messages[messages.length - 1].id} changes={changes} onOpenChanges={onOpenChanges} onReviewTurn={onReviewTurn} canManageChanges={canManageChanges} /> : null}
    </article>
  );
});

/** 回复下方的操作行:左侧复制与分支,右侧显示回复完成的时间点。 */
function ReplyActions({
  text,
  timestamp,
  branchTurn,
  branchDisabled,
  onBranch,
  onCheckpoints,
}: {
  text: string;
  timestamp: number | null;
  branchTurn: number | null;
  branchDisabled: boolean;
  onBranch: (turnIndex: number) => void;
  onCheckpoints?: (turnIndex?: number) => void;
}) {
  const [copied, setCopied] = useState(false);
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
      <button
        className="reply-action"
        type="button"
        title={copied ? tr("已复制", "Copied") : tr("复制回复", "Copy reply")}
        aria-label={copied ? tr("已复制", "Copied") : tr("复制回复", "Copy reply")}
        onClick={copy}
      >
        {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        <span>{copied ? tr("已复制", "Copied") : tr("复制", "Copy")}</span>
      </button>
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
        <BranchIcon size={13} />
        <span>{tr("分支到新聊天", "Branch to new chat")}</span>
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
          <HistoryIcon size={13} />
          <span>{tr("检查点", "Checkpoint")}</span>
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
        <span className="turn-changes-icon" aria-hidden="true"><FileChangeIcon /></span>
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
            {tr("在变更中撤销…", "Revert in Changes…")} <UndoIcon />
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
                {file.path}
              </button>
            ) : (
              <span className="turn-changes-path" title={file.path}>{file.path}</span>
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
            <ChevronIcon up={showAll} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FileChangeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2.5" width="18" height="19" rx="3" />
      <path d="M8 8h8M8 16h8M12 5v6" />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg className={up ? "is-up" : ""} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-2" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function EnvironmentInfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5.5" cy="6.5" r="2.5" />
      <circle cx="5.5" cy="17.5" r="2.5" />
      <path d="M12 6.5h9M12 17.5h9" />
    </svg>
  );
}

/** 信息卡片模式：圆角卡片里两行「点 + 线」。 */
function InfoCardsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="3.5" />
      <path d="M7.5 10h.01M7.5 14h.01" strokeWidth="2.4" />
      <path d="M11.5 10h5M11.5 14h5" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

/** 完成状态来自 agent，只有没有待确认且证据通过的需求计入通过。 */
function AcceptanceCard({ request, onOpen }: { request: AcceptanceRequest; onOpen?: (request: AcceptanceRequest) => void }) {
  const { passed, pending } = acceptanceCounts(request.outcome);
  return <button type="button" className="acceptance-card" disabled={!onOpen} onClick={() => onOpen?.(request)}>
    <strong>{tr("验收", "Acceptance")}</strong>
    <span>{trf("通过 {0} · 待确认 {1}", "Passed {0} · To confirm {1}", passed, pending)}</span>
  </button>;
}
