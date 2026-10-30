import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type TouchEvent, type WheelEvent } from "react";
import { ActivityIndicator } from "./ActivityIndicator";
import { EditFileIcon, ReadFileIcon, TerminalIcon, ThinkingIcon, ToolIcon } from "./icons";
import { Markdown } from "./Markdown";
import { usePacedText } from "../hooks/usePacedText";
import { nextStreamFollow, releasesStreamFollow } from "./chat-scroll";
import { localizeError, tr, trf, useAppLocale } from "../locale";
import { thinkingSummaryLayout } from "../thinking-summary";
import { splitThinkingTitle, type ThinkingTitle } from "../thinking-title";
import { totalDiffStat, type DiffStat } from "./tool-compact";
import { coherentActions, countFailedTools, type CoherentAction, type CoherentEntry } from "./tool-sequence";
import type { ToolTrace } from "@vela/shared";
import { ThinkingSummaryContext } from "./ThinkingSummaryContext";
import { ScrollFadeShell } from "./ScrollFadeShell";
import { thinkingEdges } from "./thinking-edges";
import { defaultThinkingGroupHeight, defaultToolDetailHeight, expandedThinkingGroupHeight } from "../thinking-group-height";

/** 分组展开详情时高度封顶的下限。 */
const GROUP_LOCK_MIN_HEIGHT = 220;

/** 思考总结一次性整段到达,这里按回复正文同款的节奏逐步展示;打开历史记录时的总结直接显示。 */
function PacedSummary({ text, animate, id, trailing }: { text: string; animate: boolean; id?: string; trailing: ReactNode }) {
  const { text: paced, resumed } = usePacedText(text, true, id, animate);
  return <Markdown text={paced} streaming={paced.length < text.length} resumed={resumed} fade="reply" trailing={trailing} />;
}

/** 思考进行中默认展开,思考结束(出现新工具、开始回复或回合结束)时自动折叠;任意长度都能手动开合。 */
export function Thinking({
  text,
  messageId,
  active,
  showActivityIndicator,
  titled,
  live = false,
  failedCount = 0,
  stat = null,
  forceOpen = false,
  coherent = false,
  leadingIcon,
  children,
}: {
  text: string;
  messageId?: string;
  active: boolean;
  showActivityIndicator: boolean;
  /** CoT 总结模式:首行作标题,折叠时只剩标题,展开后是去掉首行的思考内容和挂在下面的 children(工具调用)。 */
  titled?: ThinkingTitle | null;
  /** 分组还在进行(最新一段思考,工具仍在追加);结束时自动折叠。 */
  live?: boolean;
  /** 组内失败的工具数,折叠时在标题后用红点提示。 */
  failedCount?: number;
  /** 组内所有编辑的增删行数总计,显示在标题右边,与标题左对齐连在一起。 */
  stat?: DiffStat | null;
  /** 组内有等待用户回答的卡片时,保持展开。 */
  forceOpen?: boolean;
  /** 连贯模式:标题是整组的汇总而不是某段思考的标题,前面不放思考图标,内容全部由 children 提供。 */
  coherent?: boolean;
  /** 连贯模式标题左边的灰色图标,随汇总的首个动作变化。 */
  leadingIcon?: ReactNode;
  children?: ReactNode;
}) {
  const summaries = useContext(ThinkingSummaryContext);
  const locale = useAppLocale();
  // 分组模式下标题已经是总结,不再另行请求总结;展开状态跟随整个分组而不只是思考文字的流式输出。
  const expandSignal = titled ? live : active;
  const summaryAvailable = !titled && !active && summaries?.enabled && messageId !== undefined;
  const summary = summaryAvailable ? summaries.get(messageId, text) : undefined;
  // 总结是在这个组件存在期间才出来的(而不是挂载时就有),才逐步展示。
  const summaryArrived = useRef(false);
  if (!summary || summary.status !== "done") summaryArrived.current = true;
  const bodyId = useId();
  const summarize = () => {
    if (summaryAvailable) summaries.request(messageId, text);
  };
  const [open, setOpen] = useState(expandSignal);
  const [revealed, setRevealed] = useState(expandSignal);
  const [fadeEdges, setFadeEdges] = useState({ top: 0, bottom: 0 });
  const [viewportHeight, setViewportHeight] = useState(280);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevActive = useRef(expandSignal);
  // 只有当用户停在底部时才跟随新增的思考内容;向上阅读后保持当前位置。
  const follow = useRef({ pinned: expandSignal, lastScrollTop: 0 });
  const touchY = useRef(0);
  const layout = thinkingSummaryLayout(summaries?.style ?? "inline", summary, open);

  const syncFadeEdges = () => {
    const element = scrollRef.current;
    if (!element) return;
    setViewportHeight(element.clientHeight);
    const next = thinkingEdges(element.scrollTop, element.scrollHeight, element.clientHeight);
    setFadeEdges((current) =>
      current.top === next.top && current.bottom === next.bottom ? current : next,
    );
  };

  const scrollToEnd = () => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScroll = element.scrollHeight - element.clientHeight;
    if (maxScroll - element.scrollTop >= 1) element.scrollTop = maxScroll;
    // 记录程序化滚动后的位置,避免随后触发的 scroll 事件被误判为用户滚离底部。
    follow.current.lastScrollTop = element.scrollTop;
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (element) {
      const scrollTop = element.scrollTop;
      follow.current.pinned = nextStreamFollow({
        following: follow.current.pinned,
        scrollTop,
        previousScrollTop: follow.current.lastScrollTop,
        distanceFromBottom: element.scrollHeight - scrollTop - element.clientHeight,
      });
      follow.current.lastScrollTop = scrollTop;
    }
    syncFadeEdges();
  };

  // 在滚动真正发生前就解除跟随,避免输出恰好插入时把视口又拉回底部。
  const releaseFollow = (towardEarlier: boolean) => {
    const element = scrollRef.current;
    if (element && releasesStreamFollow(element.scrollTop, towardEarlier)) follow.current.pinned = false;
  };

  // 分组里展开某个工具的详情(命令输出、diff)时,整块高度不跟着增长:按展开前的高度封顶,详情在里面滚动。
  // 太矮的分组至少给 GROUP_LOCK_MIN_HEIGHT,否则详情只剩一条缝。
  const lockGroupHeight = (event: MouseEvent<HTMLDivElement>) => {
    if (!titled || document.documentElement.dataset.thinkingGroupGrow === "true") return;
    const toggle = (event.target as Element).closest("[aria-expanded]");
    if (!toggle || !event.currentTarget.contains(toggle)) return;
    const element = event.currentTarget;
    const cap = Number.parseFloat(getComputedStyle(element).maxHeight);
    const height = Math.max(element.offsetHeight, GROUP_LOCK_MIN_HEIGHT);
    element.style.maxHeight = `${Number.isFinite(cap) ? Math.min(height, cap) : height}px`;
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    releaseFollow(event.deltaY < 0);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchY.current = event.touches[0]?.clientY ?? touchY.current;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const y = event.touches[0]?.clientY;
    if (y == null) return;
    releaseFollow(y > touchY.current + 2);
    touchY.current = y;
  };

  useLayoutEffect(() => {
    if (prevActive.current && !expandSignal) setOpen(false);
    prevActive.current = expandSignal;
  }, [expandSignal]);

  // 分组收起后放开高度封顶,下次展开重新按内容计算。
  useLayoutEffect(() => {
    if (!open && scrollRef.current) scrollRef.current.style.maxHeight = "";
  }, [open]);

  useEffect(() => {
    if (!forceOpen) return;
    setRevealed(true);
    setOpen(true);
  }, [forceOpen]);

  // 新增思考内容后,如果用户仍在底部就继续贴底。
  useLayoutEffect(() => {
    if (!open || !revealed || !follow.current.pinned) return;
    scrollToEnd();
    syncFadeEdges();
  }, [text, open, revealed]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    const contentElement = contentRef.current;
    if (!open || !revealed || !scrollElement || !contentElement) {
      setFadeEdges({ top: 0, bottom: 0 });
      return;
    }

    // 流式追加、Markdown 异步渲染或展开动画都会改变高度,贴底时持续跟随到底部。
    const sync = () => {
      if (follow.current.pinned) scrollToEnd();
      syncFadeEdges();
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(scrollElement);
    observer.observe(contentElement);
    return () => observer.disconnect();
  }, [open, revealed]);

  const isGroup = Boolean(titled);
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!isGroup || !open || !revealed || !viewport) return;
    const root = document.documentElement;
    let baseHeight = viewport.clientHeight;
    let growing = false;
    let previousMaxHeight = viewport.style.maxHeight;
    const observed = new Set<Element>();
    // 只联动命令、编辑和写入详情,不受文件预览、普通读取等开合影响。
    const selector = ["bash", "edit", "write"].map((kind) =>
      `.tool-kind-${kind} .tool-details-scroll > .thinking-scroll-viewport, .tool-kind-${kind} .compact-diff-scroll-shell > .thinking-scroll-viewport`,
    ).join(", ");
    const resize = new ResizeObserver(() => sync());
    const sync = () => {
      if (root.dataset.thinkingGroupGrow !== "true") {
        viewport.style.removeProperty("--thinking-group-expanded-height");
        if (growing) viewport.style.maxHeight = previousMaxHeight;
        growing = false;
        baseHeight = viewport.clientHeight;
        return;
      }
      if (!growing) {
        // 切换开关前可能已经展开了详情,不能沿用挂载时较矮的基线。
        baseHeight = Math.max(baseHeight, viewport.clientHeight);
        previousMaxHeight = viewport.style.maxHeight;
        growing = true;
      }
      // 清除旧模式在点击时写入的封顶值;关闭开关时恢复它。
      viewport.style.maxHeight = "";
      const details = Array.from(viewport.querySelectorAll<HTMLElement>(selector));
      const contents = new Set(details.flatMap((detail) => detail.firstElementChild ? [detail.firstElementChild] : []));
      for (const node of observed) if (!contents.has(node)) { resize.unobserve(node); observed.delete(node); }
      for (const node of contents) if (!observed.has(node)) { resize.observe(node); observed.add(node); }
      const heights = details.filter((detail) => !detail.closest("[inert]")).map((detail) => detail.scrollHeight);
      if (!heights.length) {
        viewport.style.removeProperty("--thinking-group-expanded-height");
        baseHeight = viewport.clientHeight;
        return;
      }
      const styles = getComputedStyle(root);
      const groupLimit = Number.parseFloat(styles.getPropertyValue("--thinking-group-height")) || defaultThinkingGroupHeight;
      const detailLimit = Number.parseFloat(styles.getPropertyValue("--tool-detail-height")) || defaultToolDetailHeight;
      const height = expandedThinkingGroupHeight(baseHeight, heights, groupLimit, detailLimit);
      viewport.style.setProperty("--thinking-group-expanded-height", `${height}px`);
    };
    const mutations = new MutationObserver(sync);
    mutations.observe(viewport, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert"] });
    const preferences = new MutationObserver(sync);
    preferences.observe(root, { attributes: true, attributeFilter: ["data-thinking-group-grow", "style"] });
    resize.observe(viewport);
    sync();
    return () => {
      resize.disconnect();
      mutations.disconnect();
      preferences.disconnect();
      viewport.style.removeProperty("--thinking-group-expanded-height");
    };
  }, [isGroup, open, revealed]);

  const toggle = () => {
    // 展开过就保留 Markdown 挂载,收起时才有平滑的高度过渡。
    setRevealed(true);
    setOpen((value) => !value);
  };
  const showActivity = expandSignal && showActivityIndicator;

  const arrow = (
    <svg className="time-spent-trigger-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
  // 紧凑模式下前缀一个与工具行对齐的图标,其他模式由样式隐藏。
  const icon = <span className="thinking-icon" aria-hidden="true"><ThinkingIcon size={13} /></span>;
  const label = (
    <>
      {icon}
      <span>{tr("思考", "Thinking")}</span>
      {arrow}
    </>
  );
  const groupHeader = titled ? (
    <div className="thinking-header">
      <button className={`time-spent-trigger thinking-headline-trigger${showActivity ? " is-running" : ""}`} type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle} title={titled.title}>
        {coherent ? leadingIcon : icon}
        <span className="thinking-summary-excerpt">{titled.title}</span>
        {stat ? (
          <span className="tool-compact-stat thinking-group-stat">
            {stat.added > 0 ? <span className="tool-stat-add">+{stat.added}</span> : null}
            {stat.removed > 0 ? <span className="tool-stat-del">−{stat.removed}</span> : null}
          </span>
        ) : null}
        {failedCount > 0 && !open ? (
          <span className="thinking-group-failed" role="img" aria-label={trf("{0} 个工具失败", "{0} tools failed", failedCount)} title={trf("{0} 个工具失败", "{0} tools failed", failedCount)} />
        ) : null}
        {arrow}
        {showActivity ? <ActivityIndicator activity="thinking" /> : null}
      </button>
    </div>
  ) : null;
  // 总结作为标题时,它自己就是开合按钮;正文样式时另起一块,用末尾的图标收起思考。
  const headline = layout === "headline" && summary?.status === "done" ? (
    <div className="thinking-header">
      <button className="time-spent-trigger thinking-headline-trigger" type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle} title={summary.text}>
        {icon}
        <span className="thinking-summary-excerpt summary-arrival">{summary.text}</span>
        {arrow}
      </button>
    </div>
  ) : null;
  // 图标由 Markdown 排进最后一个段落行尾,避免右侧预留空隙导致上一行提前换行。
  const proseToggle = useMemo(() => (
    <button
      className={`thinking-prose-toggle${open ? " expanded" : ""}`}
      type="button"
      aria-expanded={open}
      aria-controls={bodyId}
      title={open ? tr("收起思考内容", "Hide the thinking") : tr("展开思考内容", "Show the thinking")}
      aria-label={open ? tr("收起思考内容", "Hide the thinking") : tr("展开思考内容", "Show the thinking")}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  ), [open, bodyId, locale]);
  const prose = layout === "prose" && summary?.status === "done" ? (
    <div
      className={`thinking-prose-summary agent-reply-prose${summaryArrived.current ? "" : " summary-arrival"}`}
      onClick={(event) => {
        // 划选总结文字时不触发展开;单击整段文字等同点击末尾图标。
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) return;
        // 总结里的链接和文件引用有自己的点击行为,不连带开合思考内容。
        if ((event.target as Element).closest("a, [role='button']")) return;
        toggle();
      }}
    >
      <PacedSummary text={summary.text} animate={summaryArrived.current} id={messageId ? `summary:${messageId}` : undefined} trailing={proseToggle} />
    </div>
  ) : null;
  return (
    <div className={`time-spent-collapsible thinking-block${open ? " expanded" : ""}${coherent ? " is-coherent" : ""}`}>
      {groupHeader ?? headline ?? prose ?? (
        <div className="thinking-header">
          <button className={`time-spent-trigger${showActivity ? " is-running" : ""}`} type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            {label}
            {showActivity ? <ActivityIndicator activity="thinking" /> : null}
          </button>
          {/* 折叠时只在“思考”右侧露出一行总结;展开后完整总结移到标题下方,这里不再重复。 */}
          {summaryAvailable && (!open || !summary || summary.status === "error") ? (
            <div className="thinking-summary-inline">
              {!open && summary?.status === "done" ? (
                <button className="thinking-summary-preview" type="button" onClick={toggle} title={summary.text} aria-expanded={open} aria-controls={bodyId}>
                  <span className="thinking-summary-excerpt summary-arrival">{summary.text}</span>
                </button>
              ) : null}
              {!open && summary?.status === "pending" ? (
                <span className="thinking-summary-status" role="status"><ActivityIndicator activity="thinking" label={tr("正在总结", "Summarizing")} />{tr("正在总结…", "Summarizing…")}</span>
              ) : null}
              {!summary || summary.status === "error" ? (
                <>
                  {summary ? <span className="thinking-summary-failed" role="status" title={localizeError(summary.error)}>{tr("总结失败", "Summary failed")}</span> : null}
                  <button className="thinking-summary-action" type="button" onClick={summarize} title={tr("使用设置中的思考总结模型生成总结", "Summarize with the thinking summary model configured in settings")}>
                    {summary ? tr("重试", "Retry") : tr("总结", "Summarize")}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <div id={bodyId} className="time-spent-body" aria-hidden={!open} inert={!open ? true : undefined}>
        <div className="time-spent-body-inner">
          {summary && layout !== "prose" ? (
            <aside className="thinking-summary-panel" aria-label={tr("思考总结", "Thinking summary")} aria-busy={summary.status === "pending"}>
              <span className="thinking-summary-label">{tr("总结", "Summary")}</span>
              {summary.status === "done" ? <p key="done" className="summary-arrival">{summary.text}</p> : summary.status === "pending" ? (
                <p className="thinking-summary-status">{tr("正在生成总结…", "Generating a summary…")}</p>
              ) : <p className="thinking-summary-failed">{localizeError(summary.error)}</p>}
            </aside>
          ) : null}
          <ScrollFadeShell edges={fadeEdges} height={viewportHeight} className={titled ? "thinking-group-shell" : undefined}>
            <div
              className="thinking-scroll-viewport"
              ref={scrollRef}
              onScroll={handleScroll}
              onClickCapture={lockGroupHeight}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              role="region"
              aria-label={tr("思考内容，可在区域内滚动", "Thinking content, scrollable")}
              tabIndex={0}
            >
              {titled ? (
                // 引导线在滚动内容里面,随内容一起被上下漸进模糊。
                <div className="thinking-group-rail" ref={contentRef} style={{ "--thinking-group-live-height": `${viewportHeight}px` } as CSSProperties}>
                  {titled.body ? (
                    <div className="stream-prose-block thinking-text">
                      {revealed ? <Markdown text={titled.body} streaming={active} fade="thinking" /> : null}
                    </div>
                  ) : null}
                  {revealed ? children : null}
                </div>
              ) : (
                <div className="stream-prose-block thinking-text" ref={contentRef}>
                  {revealed ? <Markdown text={text} streaming={active} fade="thinking" /> : null}
                </div>
              )}
            </div>
          </ScrollFadeShell>
        </div>
      </div>
    </div>
  );
}

/**
 * 思考加上它带出的工具调用。首行是加粗标题(OpenAI CoT 总结)时,工具挂在这段思考下面一起折叠;
 * 否则保持原样:“思考”之后紧跟工具。两种形态的节点位置一致,标题行流式到齐时不会重挂载。
 */
export function ThinkingGroup({
  text,
  messageId,
  active,
  live,
  showActivityIndicator,
  tools,
  forceOpen,
  children,
}: {
  text: string;
  messageId?: string;
  active: boolean;
  live: boolean;
  showActivityIndicator: boolean;
  /** 分组里的全部工具,用来汇总失败数和代码增删行数。 */
  tools?: readonly ToolTrace[];
  forceOpen?: boolean;
  children?: ReactNode;
}) {
  const titled = splitThinkingTitle(text, active);
  const failedCount = tools ? countFailedTools(tools) : 0;
  const stat = tools ? totalDiffStat([...tools]) : null;
  return (
    <>
      <Thinking
        messageId={messageId}
        text={text}
        active={active}
        showActivityIndicator={showActivityIndicator}
        titled={titled}
        live={live}
        failedCount={failedCount}
        stat={stat}
        forceOpen={forceOpen}
      >
        {titled ? children : null}
      </Thinking>
      {titled ? null : children}
    </>
  );
}

const actionLabels: Record<CoherentAction, () => string> = {
  edit: () => tr("编辑了文件", "edited files"),
  read: () => tr("读取了文件", "read files"),
  bash: () => tr("运行了命令", "ran commands"),
  tools: () => tr("使用了工具", "used tools"),
};

/** 英文逐项以逗号相接,韩文以空格相接,日文以顿号相接;中文直接连写。 */
function actionSeparator(locale: ReturnType<typeof useAppLocale>): string {
  if (locale === "en") return ", ";
  if (locale === "ko") return " ";
  return locale === "ja" ? "、" : "";
}

const actionIcons: Record<CoherentAction, ReactNode> = {
  edit: <EditFileIcon size={14} />,
  read: <ReadFileIcon size={14} />,
  bash: <TerminalIcon size={14} />,
  tools: <ToolIcon size={14} />,
};

/**
 * 连贯模式折叠标题:进行中是最新一段总结的标题,结束后汇总组内的编辑、读取、运行;
 * 没有工具时只写「思考」。
 */
function coherentTitle(entries: readonly CoherentEntry[], live: boolean, locale: ReturnType<typeof useAppLocale>): string {
  const fallback = tr("思考", "Thinking");
  if (live) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!;
      if (entry.type === "thinking") return splitThinkingTitle(entry.text, false)?.title ?? fallback;
    }
    return fallback;
  }
  const actions = coherentActions(entries);
  if (actions.length === 0) return fallback;
  const sentence = actions.map((action) => actionLabels[action]()).join(actionSeparator(locale));
  return locale === "en" ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : sentence;
}

/**
 * 连贯模式分组:两段回复之间的全部思考和工具合成一组,折叠时标题汇总这一组做了什么。
 * 组内内容(CoherentThought 与工具列表)由 children 按到达顺序提供。
 */
export function CoherentGroup({
  entries,
  live,
  showActivityIndicator,
  forceOpen,
  children,
}: {
  entries: readonly CoherentEntry[];
  live: boolean;
  showActivityIndicator: boolean;
  forceOpen?: boolean;
  children?: ReactNode;
}) {
  const locale = useAppLocale();
  // 进行中标题是最新思考的标题,配思考图标;结束后图标跟着汇总的第一个动作。
  const firstAction = live ? undefined : coherentActions(entries)[0];
  return (
    <Thinking
      text=""
      active={false}
      showActivityIndicator={showActivityIndicator}
      titled={{ title: coherentTitle(entries, live, locale), body: "" }}
      leadingIcon={
        <span className="coherent-group-icon" aria-hidden="true">
          {firstAction ? actionIcons[firstAction] : <ThinkingIcon size={14} />}
        </span>
      }
      live={live}
      forceOpen={forceOpen}
      coherent
    >
      {children}
    </Thinking>
  );
}

/**
 * 连贯模式组内的一次思考总结:加粗首行作标题,正文缩进在下面,可单独开合。
 * expanded 是默认状态:分组进行中只有最新一段展开,更早的和分组结束后的都折叠;手动开合过就不再跟随。
 */
export function CoherentThought({ text, active, expanded }: { text: string; active: boolean; expanded: boolean }) {
  useAppLocale();
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? expanded;
  const bodyId = useId();
  const titled = splitThinkingTitle(text, active);
  // 流式中标题行还没收齐时只显示「思考」,避免半截标题闪一下。
  const pending = !titled && active && /^\s*(\*\*|#)/.test(text) && !text.trimStart().includes("\n");
  const title = titled?.title ?? tr("思考", "Thinking");
  const body = titled ? titled.body : pending ? "" : text.trim();
  return (
    <div className={`coherent-thought${open ? " open" : ""}`}>
      <button className="coherent-thought-trigger" type="button" aria-expanded={open} aria-controls={bodyId} disabled={!body} onClick={() => setManual(!open)} title={title}>
        <span className="thinking-icon" aria-hidden="true"><ThinkingIcon size={13} /></span>
        <span className="coherent-thought-title">{title}</span>
        {body ? (
          <svg className="coherent-thought-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        ) : null}
      </button>
      {body ? (
        <div id={bodyId} className="coherent-thought-body" aria-hidden={!open} inert={!open ? true : undefined}>
          <div className="coherent-thought-body-inner">
            <div className="stream-prose-block thinking-text">
              <Markdown text={body} streaming={active} fade="thinking" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
