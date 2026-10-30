import type { AskUserQuestionRequest, ExecutionItemStatus, ToolActivity, ToolPlanItem, ToolTrace } from "@vela/shared";
import { isAgentToolName, unescapeMarkdown } from "@vela/shared";
import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TransitionEvent } from "react";
import { QuestionContext } from "./QuestionContext";
import { LazyMount } from "./LazyMount";
import { ContentSwap } from "./BatchMotion";
import { ActivityIndicator } from "./ActivityIndicator";
import { Markdown } from "./Markdown";
import { McpToolDetails } from "./McpToolDetails";
import { ToolResultDetails } from "./ToolResultDetails";
import { completeResultJson, needsRawResultFallback } from "./tool-result-model";
import { ScrollFade } from "./ScrollFade";
import {
  AgentStatusMark,
  agentKindLabel,
  agentStatusLabel,
  findAgentInfo,
  useAgentRoster,
  useAgentWorkspace,
} from "./AgentPanel";
import { useFilePreview } from "./preview/FilePreviewContext";
import type { ThemedToken } from "./preview/highlighter";
import { QuestionCard, type QuestionReplyHandler } from "./QuestionCard";
import { FileTypeIcon } from "./FileTypeIcon";
import { tokenStyle, useDiffHighlight, type HighlightedDiff } from "./diff-highlight";
import { ArrowRightIcon, CheckIcon, CircleIcon, EditFileIcon, ExternalIcon, EyeIcon, FilePlusIcon, FolderIcon, GlobeIcon, McpIcon, ReadFileIcon, SearchIcon, StackIcon, TerminalIcon, ToolIcon, WebFetchIcon, WebSearchIcon } from "./icons";
import {
  compactLabelParts,
  compactSummaryParts,
  diffStat,
  parseDisplayDiff,
  splitPath,
  totalDiffStat,
  toolCompactKind,
  type CompactLabelPart,
  type DisplayDiffRow,
} from "./tool-compact";
import { bashIntentDisplay } from "./bash-intent-label";
import { shouldFoldRun } from "./tool-sequence";
import { firstCodeLine, lastBrowserUrl, splitBrowserBody, summarizeBrowserCode, type BrowserStep } from "./browser-call";
import { foldRowId, foldSequenceId } from "./tool-fold-state";
import { DurationLabel, ToolDurationLabel, useToolExpanded, useToolProcessDetails, useToolsDuration } from "./ToolProcessContext";
import type { ToolDisplay, ToolFold } from "../hooks/usePreferences";
import { localizeError, tr, trf } from "../locale";
import { cardToolGroup } from "./tool-groups";
import { toolNameIcon } from "./tool-name-icon";

type ToolKind = "browser" | "bash" | "read" | "edit" | "write" | "other";

const kindLabels: Record<ToolKind, string> = {
  browser: "Browser REPL",
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  other: "Tool",
};

/** 按 toolCallId 查找待回答的问题;ask_user_question 卡片用。 */
export type QuestionLookup = (toolCallId: string) => AskUserQuestionRequest | null;

/**
 * 消息工具列表入口。连续的可折叠工具达到阈值(卡片 RUN_MIN 个,紧凑 >1 个)时折叠成一组(fold 为 none 时逐个展示),
 * 其余工具(计划、目标、提问等)照常逐张展示,并打断连续区间。
 */
export const ToolList = memo(function ToolList({
  tools,
  getQuestion,
  onReplyQuestion,
  display = "card",
  fold = "message",
  arrivalKey,
}: {
  tools: ToolTrace[];
  getQuestion?: QuestionLookup;
  onReplyQuestion?: QuestionReplyHandler;
  display?: ToolDisplay;
  fold?: ToolFold;
  /** 入场动画的标记；直接挂在列表上，保证列表仍是消息块的直接子节点。 */
  arrivalKey?: string;
}) {
  const segments = useMemo(() => splitToolRuns(tools), [tools]);
  const compact = display === "compact";
  return (
    <div className={compact ? "tool-card-list is-compact" : "tool-card-list"} data-arrival-key={arrivalKey}>
      {segments.map((segment) =>
        isStandaloneTool(segment[0].name) ? (
          segment.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              getQuestion={getQuestion}
              onReplyQuestion={onReplyQuestion}
              compact={compact}
            />
          ))
        ) : shouldFoldRun(segment.length, display, fold) ? (
          compact ? <CompactToolGroup key={segment[0].id} tools={segment} /> : <ToolRunGroup key={segment[0].id} tools={segment} />
        ) : compact ? (
          segment.map((tool) => <CompactToolLine key={tool.id} tool={tool} />)
        ) : (
          segment.map((tool) => (
            <ToolCard key={tool.id} tool={tool} getQuestion={getQuestion} onReplyQuestion={onReplyQuestion} />
          ))
        ),
      )}
    </div>
  );
});

/** 不参与折叠的工具;browser_repl_reset 只有一条确认说明，紧凑行没有展开入口，所以也走卡片。 */
function isStandaloneTool(name: string): boolean {
  return toolKind(name) === "other" || name === "browser_repl_reset";
}

/** 按连续的可折叠工具切段;非折叠类工具自成一段。 */
function splitToolRuns(tools: ToolTrace[]): ToolTrace[][] {
  const segments: ToolTrace[][] = [];
  let run: ToolTrace[] = [];
  for (const tool of tools) {
    if (isStandaloneTool(tool.name)) {
      if (run.length > 0) segments.push(run);
      run = [];
      segments.push([tool]);
    } else {
      run.push(tool);
    }
  }
  if (run.length > 0) segments.push(run);
  return segments;
}

interface ToolCardProps {
  tool: ToolTrace;
  getQuestion?: QuestionLookup;
  onReplyQuestion?: QuestionReplyHandler;
  compact?: boolean;
}

/** 入口分发:提问和子代理各自有卡片,其余走通用折叠卡片。 */
export const ToolCard = memo(function ToolCard(props: ToolCardProps) {
  useContext(QuestionContext);
  if (props.tool.activity?.mcp) return <GenericToolCard {...props} />;
  if (props.tool.name === "ask_user_question") {
    return (
      <QuestionCard
        tool={props.tool}
        request={props.getQuestion?.(props.tool.id) ?? null}
        onReply={props.onReplyQuestion ?? (() => undefined)}
        compact={props.compact}
      />
    );
  }
  if (isAgentToolName(props.tool.name)) return <AgentToolCard tool={props.tool} compact={props.compact} />;
  if (props.tool.name === "browser_repl") return <BrowserReplCard tool={props.tool} compact={props.compact} />;
  return <GenericToolCard {...props} />;
});

function useExpandSettle(open: boolean) {
  const [settled, setSettled] = useState(open);
  const initial = useRef(true);

  useEffect(() => {
    if (!open) {
      setSettled(false);
      initial.current = false;
      return;
    }
    if (initial.current) {
      initial.current = false;
      setSettled(true);
      return;
    }
    const timer = window.setTimeout(() => setSettled(true), 280);
    return () => window.clearTimeout(timer);
  }, [open]);

  function onTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== "grid-template-rows") return;
    if (open) setSettled(true);
  }

  return { settled: open && settled, onTransitionEnd };
}

function ToolCollapse({
  open,
  onTransitionEnd,
  children,
}: {
  open: boolean;
  onTransitionEnd?: (event: TransitionEvent<HTMLDivElement>) => void;
  children: () => ReactNode;
}) {
  return (
    <div className="tool-collapse" onTransitionEnd={onTransitionEnd}>
      <div className="tool-collapse-inner" inert={open ? undefined : true}>
        <LazyMount open={open}>{children}</LazyMount>
      </div>
    </div>
  );
}

/**
 * 主对话里的子代理摘要卡：只展示路径、状态、任务和最终结论，
 * 完整运行流在右侧 Agent Pane；点击卡片直接打开对应 Pane。
 */
function AgentToolCard({ tool, compact = false }: { tool: ToolTrace; compact?: boolean }) {
  const [open, setOpen] = useToolExpanded(foldRowId(tool.id), compact);
  const { onTransitionEnd } = useExpandSettle(open);
  const { openAgent } = useAgentWorkspace();
  const roster = useAgentRoster();
  const activity = tool.activity ?? {};
  const live = findAgentInfo(roster, activity.agentId, activity.agentPath);
  const task = taskTitle(activity.body);
  const title = live?.path ?? activity.agentPath ?? task;
  const conclusion = live?.error ?? live?.finalText ?? null;
  const report = conclusion ?? (live ? "" : taskReport(activity.body));
  const label = agentKindLabel(live?.kind ?? activity.agent);
  const targetId = live?.id ?? activity.agentId ?? null;
  const canOpen = Boolean(targetId);
  const openInPane = (): void => {
    if (targetId) openAgent(targetId);
  };
  const toggle = (): void => setOpen((value) => !value);
  const summaryLabel = open ? tr("收起任务概况", "Collapse summary") : tr("展开任务概况", "Expand summary");
  const titleText = live ? `${live.path} · ${agentStatusLabel(live.status)}` : title;
  const summary = (
    <ScrollFade
      className="agent-summary-scroll"
      contentClassName="process-thinking-text agent-summary-text"
      ariaLabel={tr("子代理任务概况，可在区域内滚动", "Subagent summary, scrollable")}
    >
      {task && task !== title ? (
        <div className="agent-summary-task">
          <Markdown text={task} />
        </div>
      ) : null}
      {report ? (
        <div className={live?.error ? "agent-summary-error" : "agent-summary-report"}>
          <Markdown text={live?.error ? localizeError(live.error) : report} />
        </div>
      ) : null}
    </ScrollFade>
  );

  // 紧凑模式是一行：点名称去右侧 Pane，点其他任何地方开合概况。
  if (compact) {
    return (
      <div className={`tool-compact-item tool-kind-other agent-compact${open ? " open" : ""}`}>
        <div
          className="tool-compact-line agent-compact-line"
          onClick={(event) => {
            // 整行都是开合区域，只有名称按钮打开右侧 Pane。
            // 用 Element 而不是 HTMLElement：箭头是 SVG，事件目标可能是 SVGElement。
            const target = event.target;
            if (target instanceof Element && target.closest(".agent-compact-name")) return;
            toggle();
          }}
        >
          <button
            className="agent-compact-toggle is-lead"
            type="button"
            aria-expanded={open}
            title={summaryLabel}
            aria-label={summaryLabel}
          >
            <span className="tool-compact-icon" aria-hidden="true">
              {toolNameIcon(tool.name) ?? <ToolIcon size={13} />}
            </span>
            <span className="tool-compact-action">{label}</span>
          </button>
          <button
            className="agent-compact-name"
            type="button"
            disabled={!targetId}
            title={canOpen ? trf("在右侧查看 {0}", "Open {0} in pane", title) : titleText}
            onClick={openInPane}
          >
            {title}
          </button>
          <button
            className="agent-compact-toggle is-tail"
            type="button"
            aria-expanded={open}
            title={summaryLabel}
            aria-label={summaryLabel}
          >
            <svg className="tool-compact-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {live ? (
              <AgentStatusMark status={live.status} />
            ) : (
              <CompactStatus running={tool.status === "running"} failed={tool.status === "error"} />
            )}
          </button>
          {/* 耗时排在箭头之后靠右,箭头才不会被耗时的 auto 外边距推到右边。 */}
          <ToolDurationLabel tool={tool} />
        </div>
        <ToolCollapse open={open} onTransitionEnd={onTransitionEnd}>
        {() => <>
          <div className="tool-compact-out agent-compact-out">{summary}</div>
          </>}
      </ToolCollapse>
      </div>
    );
  }

  return (
    <article className={`tool-card tool-kind-other is-task is-${tool.status}${open ? " open" : ""}${canOpen ? " is-openable" : ""}`}>
      <div className="tool-card-top">
        <button
          className="tool-card-head"
          type="button"
          title={titleText}
          onClick={openInPane}
          disabled={!canOpen}
        >
          <span className="tool-card-icon" aria-hidden="true">
            {toolNameIcon(tool.name) ?? <ToolIcon size={13} />}
          </span>
          <span className="tool-kind-label">{label}</span>
          <span className="tool-card-main">
            <span className="tool-card-name grow">{title}</span>
          </span>
          {live ? <AgentStatusMark status={live.status} /> : <StatusMark status={tool.status} compact />}
        </button>
        <button
          className="tool-card-open"
          type="button"
          aria-expanded={open}
          title={summaryLabel}
          aria-label={summaryLabel}
          onClick={toggle}
        >
          <svg className="tool-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        {canOpen ? (
          <button
            className="tool-card-open"
            type="button"
            title={tr("在右侧打开运行", "Open run in pane")}
            aria-label={tr("在右侧打开运行", "Open run in pane")}
            onClick={openInPane}
          >
            <ExternalIcon size={12} />
          </button>
        ) : null}
      </div>
      <ToolCollapse open={open} onTransitionEnd={onTransitionEnd}>
        {() => <>
        <div className="tool-card-body agent-summary">
          {summary}
          {canOpen ? (
            <span className="agent-open-hint">
              {live && live.status === "running"
                ? tr("运行中 · 点击查看完整过程", "Running · click to watch")
                : tr("查看完整运行 ↗", "Open full run ↗")}
            </span>
          ) : null}
        </div>
        </>}
      </ToolCollapse>
    </article>
  );
}

function taskTitle(body: string | undefined): string {
  const line = body?.split("\n").find((item) => item.trim())?.replace(/\s+/g, " ").trim();
  return line || tr("子代理", "Subagent");
}

function taskReport(body: string | undefined): string {
  if (!body) return "";
  const split = body.indexOf("\n");
  if (split < 0) return "";
  return body.slice(split + 1).trim();
}

function GenericToolCard({ tool, compact = false }: ToolCardProps) {
  const [open, setOpen] = useToolExpanded(foldRowId(tool.id), compact);
  const preview = useFilePreview();
  const showTiming = useToolProcessDetails();
  const activity = tool.activity ?? {};
  const mcp = activity.mcp;
  const kind = mcp ? "other" : toolKind(tool.name);
  const subject = mcp ? { name: mcp.tool, dir: "" } : subjectOf(kind, activity, tool.name);
  const group = mcp ? null : cardToolGroup(tool.name);
  const planFirst = (tool.name === "update_todos" ? todoFocus(activity.plan) : activity.plan?.[0]) ?? null;
  const stat = diffStat(activity.diff) ?? streamingStat(activity);
  const lines = kind === "read" ? readLineCount(activity.body) : null;
  const previewPath = kind === "bash" || mcp ? null : activity.path?.trim() || null;
  const canPreview = Boolean(preview && previewPath);
  const webTool = !mcp && isWebTool(tool.name);
  const bashIntent = !mcp && kind === "bash" ? bashIntentDisplay(activity.command) : null;

  return (
    <article className={`tool-card tool-kind-${kind}${mcp ? " is-mcp" : ""}${webTool ? " is-web" : ""}${bashIntent ? " is-intent" : ""}${group ? ` tool-group-${group}` : ""} is-${tool.status}${open ? " open" : ""}`}>
      <div className="tool-card-top">
        <button
          className="tool-card-head"
          type="button"
          aria-expanded={open}
          title={mcp ? `${mcp.server} · ${mcp.tool}` : activity.command || activity.path || kindLabels[kind]}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="tool-card-icon" aria-hidden="true">
            {mcp ? <McpIcon size={13} /> : webTool ? <WebToolIcon name={tool.name} /> : <GroupIcon name={tool.name} fallback={<KindIcon kind={kind} command={activity.command} />} />}
          </span>
          <span className="tool-kind-label">{mcp ? "MCP" : bashIntent?.label ?? toolLabel(tool.name, kind)}</span>
          <span className="tool-card-main">
            <span className={`tool-card-name${subject.dir ? "" : " grow"}`}>
              {planFirst ? <PlanStatusIcon status={planFirst.status} className="plan-status-inline" /> : null}
              {subject.name}
            </span>
            {subject.dir ? <span className="tool-card-dir">{subject.dir}</span> : null}
          </span>
          {mcp ? <span className="tool-mcp-source" aria-label={trf("MCP 服务器：{0}", "MCP server: {0}", mcp.server)}>{mcp.server}</span> : null}
          {stat ? (
            <span className="tool-stat">
              {stat.added > 0 ? <span className="tool-stat-add">+{stat.added}</span> : null}
              {stat.removed > 0 ? <span className="tool-stat-del">−{stat.removed}</span> : null}
            </span>
          ) : lines !== null ? (
            <span className="tool-lines">{trf("{0} 行", "{0} lines", lines)}</span>
          ) : null}
          {compact ? null : <StatusMark status={tool.status} />}
          <svg className="tool-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {compact ? <ToolDurationLabel tool={tool} /> : null}
          {compact && !(tool.status === "error" && showTiming) ? <StatusMark status={tool.status} compact /> : null}
        </button>
        {canPreview ? (
          <button
            className="tool-card-open"
            type="button"
            title={tr("在侧栏预览", "Preview in sidebar")}
            aria-label={`${tr("预览", "Preview")} ${subject.name}`}
            onClick={() => preview?.openFile(previewPath ?? "")}
          >
            <EyeIcon size={12} />
          </button>
        ) : null}
      </div>
      <ToolCollapse open={open}>
        {() => <>
        <div className="tool-card-body">
          {mcp ? <McpToolDetails tool={tool} /> : <ScrollFade
            className="tool-details-scroll"
            ariaLabel={tr("工具详情，可在区域内滚动", "Tool details, scrollable")}
          >
            <ToolBody kind={kind} activity={activity} status={tool.status} toolName={tool.name} />
          </ScrollFade>}
        </div>
        </>}
      </ToolCollapse>
    </article>
  );
}

function browserStepLabel(step: BrowserStep): string {
  switch (step.kind) {
    case "open": return step.target ? trf("打开 {0}", "Open {0}", step.target) : tr("打开页面", "Open page");
    case "screenshot": return tr("截图", "Screenshot");
    case "click": return step.target ? trf("点击「{0}」", "Click “{0}”", step.target) : tr("点击", "Click");
    case "input": return tr("输入文字", "Type text");
    case "snapshot": return tr("读取页面", "Read page");
    case "inspect": return tr("检查页面", "Inspect page");
    case "connect": return tr("连接浏览器", "Connect browser");
    default: return tr("运行脚本", "Run script");
  }
}

/**
 * Browser REPL 专属样式:不再显示一行 `browser_repl`,而是把代码归纳成「打开 → 截图」这样的动作芯片,
 * 展开后是 REPL 代码、文字输出和带地址栏的截图缩略图。
 */
function BrowserReplCard({ tool, compact = false }: { tool: ToolTrace; compact?: boolean }) {
  const [open, setOpen] = useToolExpanded(foldRowId(tool.id), compact);
  const [zoomed, setZoomed] = useState<number | null>(null);
  const activity = tool.activity ?? {};
  const running = tool.status === "running";
  const failed = tool.status === "error";
  const steps = useMemo(() => summarizeBrowserCode(activity.command), [activity.command]);
  const { screenshots, output } = useMemo(() => splitBrowserBody(activity.body), [activity.body]);
  const structuredOutput = useMemo(() => activity.presentation?.kind === "json"
    ? { value: activity.presentation.value, truncated: activity.presentation.truncated }
    : completeResultJson(output), [activity.presentation, output]);
  const url = useMemo(() => lastBrowserUrl(activity.command), [activity.command]);
  const preview = firstCodeLine(activity.command);

  return (
    <article className={`browser-call${compact ? " is-compact" : ""} is-${tool.status}${open ? " open" : ""}`}>
      <button
        className="browser-call-head"
        type="button"
        aria-expanded={open}
        aria-label={open ? tr("收起浏览器调用", "Hide browser call") : tr("展开浏览器调用", "Show browser call")}
        title={preview || "Browser REPL"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="browser-call-badge" aria-hidden="true">
          <GlobeIcon size={13} />
        </span>
        <span className="browser-call-steps">
          {steps.map((step, index) => (
            <span className="browser-call-step-wrap" key={index}>
              {index > 0 ? <ArrowRightIcon size={10} /> : null}
              <span className={`browser-call-step is-${step.kind}`}>{browserStepLabel(step)}</span>
            </span>
          ))}
        </span>
        {screenshots.length > 0 ? (
          <span className="browser-call-shots" aria-label={trf("{0} 张截图", "{0} screenshots", screenshots.length)}>
            <EyeIcon size={11} />
            {screenshots.length}
          </span>
        ) : null}
        <svg className="tool-compact-chevron browser-call-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <ToolDurationLabel tool={tool} />
        {compact ? <CompactStatus running={running} failed={failed} /> : <StatusMark status={tool.status} />}
      </button>
      <ToolCollapse open={open}>
        {() => (
          <div className="browser-call-body">
            {activity.command ? (
              <ScrollFade className="tool-details-scroll" ariaLabel={tr("浏览器脚本，可在区域内滚动", "Browser script, scrollable")}>
                <pre className="browser-call-code"><span className="browser-call-prompt" aria-hidden="true">›</span>{activity.command}</pre>
              </ScrollFade>
            ) : null}
            {output || structuredOutput ? (
              <div className={`browser-call-output${failed ? " failed" : ""}`}>
                <ScrollFade className="tool-details-scroll" ariaLabel={tr("浏览器输出，可在区域内滚动", "Browser output, scrollable")}>
                  {structuredOutput && !failed ? <ToolResultDetails activity={{ ...activity, body: output || undefined, presentation: activity.presentation?.kind === "json" ? activity.presentation : { version: 1, source: "result", kind: "json", ...structuredOutput } }} status={tool.status} toolName={tool.name} /> : <ToolMarkdown text={output || tr("执行失败", "Execution failed")} className="browser-call-text" />}
                </ScrollFade>
              </div>
            ) : running ? (
              <div className="browser-call-wait">{tr("正在执行", "Running…")}</div>
            ) : !screenshots.length ? (
              <div className="browser-call-wait">{tr("无输出", "No output")}</div>
            ) : null}
            {screenshots.length > 0 ? (
              <div className="browser-call-frames">
                {screenshots.map((src, index) => (
                  <figure className={`browser-call-frame${zoomed === index ? " zoomed" : ""}`} key={index}>
                    <div className="browser-call-chrome" aria-hidden="true">
                      <span /><span /><span />
                      <em>{url ? url.replace(/^https?:\/\//, "") : "Browser"}</em>
                    </div>
                    <button
                      className="browser-call-shot"
                      type="button"
                      title={zoomed === index ? tr("缩小", "Shrink") : tr("放大", "Enlarge")}
                      onClick={() => setZoomed((value) => (value === index ? null : index))}
                    >
                      <img src={src} alt={tr("浏览器截图", "Browser screenshot")} />
                    </button>
                  </figure>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </ToolCollapse>
    </article>
  );
}

/** 一组连续工具的折叠卡片,展开后内部还是原来的 ToolCard。 */
export function ToolRunGroup({ tools }: { tools: ToolTrace[] }) {
  const [open, setOpen] = useState(false);
  // 折叠时跟踪最新一个还在跑(或最后一个)的工具,让标题行保持实时。
  const current =
    [...tools].reverse().find((tool) => tool.status === "running") ?? tools[tools.length - 1];
  const activity = current.activity ?? {};
  const kindCounts = new Map<ToolKind, number>();
  for (const tool of tools) {
    const kind = toolKind(tool.name);
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }
  const uniform = kindCounts.size === 1 ? [...kindCounts.keys()][0] : null;
  const failed = tools.filter((tool) => tool.status === "error").length;
  const stat = totalDiffStat(tools);
  const subject = subjectOf(toolKind(current.name), activity, current.name);
  const currentIntent = toolKind(current.name) === "bash" ? bashIntentDisplay(activity.command) : null;
  const subjectText = currentIntent
    ? [currentIntent.label, currentIntent.name, currentIntent.dir].filter(Boolean).join(" ")
    : subject.name;
  const detail = activity.command?.trim() || activity.path?.trim() || "";
  const breakdown = [...kindCounts].map(([kind, count]) => `${toolKindLabel(kind)} ×${count}`).join(" · ");

  return (
    <article
      className={`tool-run tool-kind-${uniform ?? "other"}${open ? " open" : ""}${
        current.status === "running" ? " is-running" : ""
      }`}
    >
      <button
        className="tool-run-head"
        type="button"
        aria-expanded={open}
        title={detail ? `${breakdown}\n${detail}` : breakdown}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tool-card-icon" aria-hidden="true">
          {uniform ? <KindIcon kind={uniform} command={uniform === "bash" && tools.every((tool) => bashIntentDisplay(tool.activity?.command)?.kind === currentIntent?.kind) ? activity.command : undefined} /> : <StackIcon />}
        </span>
        <span className="tool-kind-label">{uniform ? toolKindLabel(uniform) : tr("工具", "Tools")}</span>
        <span className="tool-run-count">×{tools.length}</span>
        <span className="tool-run-subject">{subjectText}</span>
        {failed > 0 ? <span className="tool-run-failed">{trf("{0} 失败", "{0} failed", failed)}</span> : null}
        {stat ? (
          <span className="tool-stat">
            {stat.added > 0 ? <span className="tool-stat-add">+{stat.added}</span> : null}
            {stat.removed > 0 ? <span className="tool-stat-del">−{stat.removed}</span> : null}
          </span>
        ) : null}
        <StatusMark status={current.status === "running" ? "running" : failed > 0 ? "error" : "done"} />
        <svg
          className="tool-run-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <ToolCollapse open={open}>
        {() => <>
        <div className="tool-run-body">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
        </>}
      </ToolCollapse>
    </article>
  );
}

/** 紧凑模式:同一段超过 1 个工具时折叠成一行摘要,点击展开逐行明细。 */
export function CompactToolGroup({ tools, sequenceId = tools[0]?.id }: { tools: ToolTrace[]; sequenceId?: string }) {
  const [open, setOpen] = useToolExpanded(foldSequenceId(sequenceId));
  const details = useToolProcessDetails();
  const duration = useToolsDuration(tools);
  const running = tools.some((tool) => tool.status === "running");
  const failed = tools.filter((tool) => tool.status === "error").length;
  const parts = compactSummaryParts(tools);
  const stat = totalDiffStat(tools);
  const uniform = parts.length === 1 ? parts[0].kind : null;
  const labelParts = compactLabelParts(tools);
  const label = labelParts.map((part) => compactPartLabel(part)).join(" · ");
  // bash 里混着列目录、搜索等不同含义时,每行仍要自己的动作词和图标。
  const mixedBash = uniform === "bash" && labelParts.length > 1;
  const fileTools = tools.filter((tool) => toolCompactKind(tool.name) === uniform && tool.activity?.path);
  const uniqueFileTools = fileTools.filter((tool, index) => (
    fileTools.findIndex((candidate) => candidate.activity?.path?.replaceAll("\\", "/") === tool.activity?.path?.replaceAll("\\", "/")) === index
  ));
  const samples = uniform === "bash"
    ? []
    : uniqueFileTools.map((tool) => splitPath(tool.activity?.path ?? "").name).slice(0, 2);
  const extraSamples = Math.max(0, uniqueFileTools.length - samples.length);
  const firstBash = uniform === "bash" ? subjectOf("bash", tools[0]?.activity ?? {}, "bash") : null;
  const sampleLabel = firstBash
    ? [firstBash.name, firstBash.dir].filter(Boolean).join(" ")
    : samples.length > 0
      ? `${samples.join(", ")}${extraSamples > 0 ? ` +${extraSamples}` : ""}`
      : "";
  const accessibleLabel = sampleLabel ? `${label} · ${sampleLabel}` : label;
  const fileDiffGroup = uniform === "edit" || uniform === "write";

  return (
    <div
      className={`tool-compact-group tool-kind-${uniform ?? "other"}${open ? " open" : ""}${
        running ? " is-running" : ""
      }`}
    >
      <button
        className="tool-compact-summary"
        type="button"
        aria-expanded={open}
        title={accessibleLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tool-compact-icon" aria-hidden="true">
          {uniform ? <KindIcon kind={uniform} command={uniform === "bash" ? tools[0]?.activity?.command : undefined} /> : <StackIcon size={13} />}
        </span>
        <span className="tool-compact-label">{label}</span>
        {sampleLabel && !(open && fileDiffGroup) ? <span className="tool-compact-sample">{sampleLabel}</span> : null}
        {failed > 0 ? <span className="tool-compact-failed">{trf("{0} 失败", "{0} failed", failed)}</span> : null}
        {stat && !(open && fileDiffGroup) ? (
          <span className="tool-compact-stat">
            {stat.added > 0 ? <span className="tool-stat-add">+{stat.added}</span> : null}
            {stat.removed > 0 ? <span className="tool-stat-del">−{stat.removed}</span> : null}
          </span>
        ) : null}
        <svg
          className="tool-compact-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {details ? (
          <span className="tool-compact-steps">
            {trf("{0} 步", "{0} steps", tools.length)}<DurationLabel duration={duration} />
          </span>
        ) : null}
        {running ? <ActivityIndicator /> : null}
      </button>
      <ToolCollapse open={open}>
        {() => <>
        <div className="tool-compact-lines">
          {tools.map((tool) => (
            <CompactToolLine key={tool.id} tool={tool} hideAction={Boolean(uniform) && !mixedBash} hideIcon={Boolean(uniform) && !mixedBash} />
          ))}
        </div>
        </>}
      </ToolCollapse>
    </div>
  );
}

function compactPartLabel({ kind, count }: CompactLabelPart): string {
  if (kind === "list") return trf("已列出 {0} 个目录", count === 1 ? "Listed {0} directory" : "Listed {0} directories", count);
  if (kind === "search") return trf("已搜索 {0} 次", count === 1 ? "Ran {0} search" : "Ran {0} searches", count);
  if (kind === "edit") return trf("已编辑 {0} 个文件", count === 1 ? "Edited {0} file" : "Edited {0} files", count);
  if (kind === "write") return trf("已创建 {0} 个文件", count === 1 ? "Created {0} file" : "Created {0} files", count);
  if (kind === "read") return trf("已读取 {0} 个文件", count === 1 ? "Read {0} file" : "Read {0} files", count);
  return trf("已运行 {0} 条命令", count === 1 ? "Ran {0} command" : "Ran {0} commands", count);
}

/** 紧凑模式的一行:文件类点击文件名在右侧预览,bash 点击整行内联展开输出。 */
export function CompactToolLine({
  tool,
  hideAction = false,
  hideIcon = false,
}: {
  tool: ToolTrace;
  hideAction?: boolean;
  hideIcon?: boolean;
}) {
  const preview = useFilePreview();
  const [open, setOpen] = useToolExpanded(foldRowId(tool.id));
  const kind = toolKind(tool.name);
  if (tool.name === "browser_repl") return <BrowserReplCard tool={tool} compact />;
  const activity = tool.activity ?? {};
  const subject = subjectOf(kind, activity, tool.name);
  const bashIntent = kind === "bash" ? bashIntentDisplay(activity.command) : null;
  const stat = diffStat(activity.diff) ?? streamingStat(activity);
  const running = tool.status === "running";
  const failed = tool.status === "error";
  const hasFileDetails = kind === "edit" || kind === "write";
  const hasCompactDiff = hasFileDetails && Boolean(activity.diff) && !failed;
  // 参数还在流式生成时自动展开 diff，让内容边写边出现；用户折叠过则尊重折叠。
  const streamingNow = running && Boolean(activity.streaming);
  const detailOpen = open || (streamingNow && hasCompactDiff);
  const isDiffPreview = hasCompactDiff && detailOpen;
  const previewPath = kind === "bash" ? null : activity.path?.trim() || null;
  const fileIconPath = kind === "bash" ? null : previewPath ?? subject.name;
  const canPreview = Boolean(preview && previewPath);

  if (kind === "bash") {
    return (
      <div className={`tool-compact-item tool-kind-bash${open ? " open" : ""}`}>
        <button
          className="tool-compact-line"
          type="button"
          aria-expanded={open}
          aria-label={open ? tr("收起命令和输出", "Hide command and output") : tr("展开命令和输出", "Show command and output")}
          title={activity.command?.trim() || subject.name}
          onClick={() => setOpen((value) => !value)}
        >
          {!hideIcon ? (
            <span className="tool-compact-icon" aria-hidden="true">
              <KindIcon kind={kind} command={activity.command} />
            </span>
          ) : null}
          {!hideAction ? <span className="tool-compact-action">{bashIntent?.action ?? tr("已运行", "Ran")}</span> : null}
          <span className="tool-compact-cmd">{subject.name}</span>
          {subject.dir ? <span className="tool-compact-dir">{subject.dir}</span> : null}
          <svg
            className="tool-compact-chevron"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <ToolDurationLabel tool={tool} />
          <CompactStatus running={running} failed={failed} />
        </button>
        <ToolCollapse open={open}>
        {() => <>
          <div className="tool-compact-out">
            <ScrollFade className="tool-details-scroll" ariaLabel={tr("命令和输出，可在区域内滚动", "Command and output, scrollable")}>
              {activity.presentation ? <ToolResultDetails activity={activity} status={tool.status} toolName={tool.name} /> : <BashView command={activity.command} output={activity.body} running={running} failed={failed} />}
            </ScrollFade>
          </div>
          </>}
      </ToolCollapse>
      </div>
    );
  }

  return (
    <div className={`tool-compact-item tool-kind-${kind}${hasFileDetails && detailOpen ? " open" : ""}`}>
      <div className="tool-compact-line">
        {!hideIcon ? (
          <span className="tool-compact-icon" aria-hidden="true">
            <KindIcon kind={kind} />
          </span>
        ) : null}
        {!hideAction ? (
          hasFileDetails ? (
            <button
              className="tool-compact-text-toggle tool-compact-action-toggle"
              type="button"
              aria-expanded={detailOpen}
              onClick={() => setOpen((value) => !value)}
            >
              <span className="tool-compact-action">{compactAction(kind, running && Boolean(activity.streaming))}</span>
            </button>
          ) : (
            <span className="tool-compact-action">{compactAction(kind, running && Boolean(activity.streaming))}</span>
          )
        ) : null}
        {fileIconPath ? <FileTypeIcon path={fileIconPath} /> : null}
        {canPreview ? (
          <button
            className="tool-compact-name"
            type="button"
            title={`${tr("预览", "Preview")} ${previewPath ?? ""}`}
            onClick={() => preview?.openFile(previewPath ?? "")}
          >
            {subject.name}
          </button>
        ) : (
          <span className="tool-compact-name is-static">{subject.name}</span>
        )}
        {hasFileDetails && subject.dir ? (
          <button
            className="tool-compact-text-toggle tool-compact-path-toggle"
            type="button"
            aria-expanded={detailOpen}
            title={subject.dir}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="tool-compact-dir">{subject.dir}</span>
          </button>
        ) : !hasFileDetails ? (
          <span className="tool-compact-dir">{subject.dir}</span>
        ) : null}
        {hasFileDetails ? (
          <button
            className="tool-compact-detail-toggle"
            type="button"
            aria-expanded={detailOpen}
            aria-label={open ? tr("收起文件差异", "Hide file diff") : tr("展开文件差异", "Show file diff")}
            title={open ? tr("收起差异", "Hide diff") : tr("查看差异", "View diff")}
            onClick={() => setOpen((value) => !value)}
          >
            <svg
              className="tool-compact-chevron"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : null}
        {stat && !isDiffPreview ? (
          <span className="tool-compact-stat">
            {stat.added > 0 ? <span className="tool-stat-add">+{stat.added}</span> : null}
            {stat.removed > 0 ? <span className="tool-stat-del">−{stat.removed}</span> : null}
          </span>
        ) : null}
        <ToolDurationLabel tool={tool} />
        <CompactStatus running={running} failed={failed} />
      </div>
      {hasFileDetails ? (
        <ToolCollapse open={detailOpen}>
        {() => <>
          <div className={`tool-compact-file-detail${isDiffPreview ? " has-diff-preview" : ""}`}>
            {hasCompactDiff && activity.diff ? (
              <CompactDiffCard
                fileName={subject.name}
                filePath={streamingNow ? undefined : previewPath ?? undefined}
                diff={activity.diff}
                note={activity.body}
                streaming={streamingNow}
              />
            ) : (
              <ScrollFade className="tool-details-scroll" ariaLabel={tr("工具详情，可在区域内滚动", "Tool details, scrollable")}>
                <ToolBody kind={kind} activity={activity} status={tool.status} toolName={tool.name} />
              </ScrollFade>
            )}
          </div>
          </>}
      </ToolCollapse>
      ) : null}
    </div>
  );
}

/** 参数还在流式生成时的行数：+新增 −删除，随内容增长，完成后由真实 diff 取代。 */
function streamingStat(activity: ToolActivity): { added: number; removed: number } | null {
  const streaming = activity.streaming;
  if (!streaming || (streaming.added === 0 && streaming.removed === 0)) return null;
  return streaming;
}

function compactAction(kind: ToolKind, streaming = false): string {
  if (streaming && kind === "write") return tr("正在创建", "Creating");
  if (streaming && kind === "edit") return tr("正在编辑", "Editing");
  if (kind === "write") return tr("已创建", "Created");
  if (kind === "edit") return tr("已编辑", "Edited");
  if (kind === "read") return tr("已读取", "Read");
  return tr("已运行", "Ran");
}

/** 紧凑行只标异常状态:运行中转圈、失败红叉,完成不占位置。 */
function CompactStatus({ running, failed: rawFailed }: { running: boolean; failed: boolean }) {
  // 计时开启时,失败红叉改由耗时标签显示在「·」与时间之间。
  const failed = rawFailed && !useToolProcessDetails();
  const key = running ? "running" : failed ? "error" : "done";
  return <ContentSwap inline hideWhenEmpty className={`tool-status-swap compact is-${key}`} motionKey={key}>
    {running || failed ? <CompactStatusContent running={running} failed={failed} /> : null}
  </ContentSwap>;
}

function CompactStatusContent({ running, failed }: { running: boolean; failed: boolean }) {
  if (running) return <ActivityIndicator />;
  if (failed) {
    return (
      <span className="tool-compact-error" role="img" aria-label={tr("失败", "Failed")}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return null;
}

function CopyIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CompactDiffCard({ fileName, filePath, diff, note, streaming = false }: { fileName: string; filePath?: string; diff: string; note?: string; streaming?: boolean }) {
  const [copied, setCopied] = useState(false);
  const stat = diffStat(diff);

  return (
    <section className="compact-diff-card" aria-label={trf("{0} 的文件差异", "{0} file diff", fileName)}>
      <header className="compact-diff-card-head">
        <span className="compact-diff-card-name" title={fileName}>{fileName}</span>
        {stat ? (
          <span className="compact-diff-card-stat">
            {stat.added > 0 ? <span className="tool-stat-add">+{stat.added}</span> : null}
            {stat.removed > 0 ? <span className="tool-stat-del">-{stat.removed}</span> : null}
          </span>
        ) : null}
        <button
          className="compact-diff-card-copy"
          type="button"
          aria-label={copied ? tr("已复制差异", "Diff copied") : tr("复制差异", "Copy diff")}
          title={copied ? tr("已复制", "Copied") : tr("复制差异", "Copy diff")}
          onClick={() => {
            void navigator.clipboard.writeText(diff).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </button>
      </header>
      {note ? <ToolMarkdown text={note} className="compact-diff-card-note" /> : null}
      <CompactDiffView diff={diff} path={filePath} followEnd={streaming} />
    </section>
  );
}

/** 紧凑 diff 保留改动附近的上下文,长段未改内容自动折叠。 */
function CompactDiffView({ diff, path, followEnd = false }: { diff: string; path?: string; followEnd?: boolean }) {
  return (
    <ScrollFade
      followEnd={followEnd}
      fade={false}
      className="compact-diff-scroll-shell"
      contentClassName="compact-diff-scroll-content"
      ariaLabel={tr("文件差异，可在区域内滚动", "File diff, scrollable")}
    >
      <DiffView diff={diff} path={path} compact focusFirstChange={!followEnd} />
    </ScrollFade>
  );
}

/** 执行项的图标标记：完成对勾、进行中箭头、待办空心圆。 */
function PlanStatusIcon({ status, className }: { status: ExecutionItemStatus; className?: string }) {
  return (
    <span
      className={`plan-status-icon is-${status}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {status === "completed" ? (
        <CheckIcon size={11} />
      ) : status === "in_progress" ? (
        <ArrowRightIcon size={11} />
      ) : (
        <CircleIcon size={11} />
      )}
    </span>
  );
}

/** update_plan 展开后的清单：左侧一条竖向引导线把各项状态串起来。 */
function PlanChecklist({ items }: { items: ToolPlanItem[] }) {
  return (
    <div className="plan-checklist" role="list">
      {items.map((item, index) => (
        <div className={`plan-checklist-item is-${item.status}`} role="listitem" key={`${index}-${item.text}`}>
          <PlanStatusIcon status={item.status} className="plan-checklist-icon" />
          <span className="plan-checklist-text">{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function ToolMarkdown({ text, className = "tool-note" }: { text: string; className?: string }) {
  return <div className={`tool-markdown ${className}`}><Markdown text={text} /></div>;
}

function ToolBody({
  kind,
  activity,
  status,
  toolName,
}: {
  kind: ToolKind;
  activity: ToolActivity;
  status: ToolTrace["status"];
  toolName?: string;
}) {
  if (activity.presentation) return <ToolResultDetails activity={activity} status={status} toolName={toolName} />;
  if (needsRawResultFallback(toolName, status, Boolean(activity.presentation))) return <section className="tool-result-details tool-result-fallback">
    <p className="tool-result-muted" role="status">{tr("无法完整解析此记录，显示原始响应", "This record could not be fully parsed. Showing the original response.")}</p>
    {activity.body ? <pre className={`tool-result-raw-text${status === "error" ? " tool-result-error" : ""}`} role={status === "error" ? "alert" : undefined} tabIndex={0}>{activity.body}</pre> : <p className="tool-result-muted">{tr("暂无响应内容", "No response yet")}</p>}
  </section>;
  if (kind === "browser") {
    const body = activity.body ?? "";
    const pattern = /!\[Browser screenshot\]\((data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)\)/g;
    const screenshots = [...body.matchAll(pattern)].map((match) => match[1]);
    const output = body.replace(pattern, "").trim();
    return <>
      {activity.command ? <pre className="tool-note">{activity.command}</pre> : null}
      {output ? <ToolMarkdown text={output} /> : null}
      {screenshots.map((src, index) => <img key={index} src={src} alt={tr("浏览器截图", "Browser screenshot")} style={{ maxWidth: "100%", height: "auto" }} />)}
    </>;
  }
  if (kind === "bash") {
    return (
      <BashView
        command={activity.command}
        output={activity.body}
        running={status === "running"}
        failed={status === "error"}
      />
    );
  }
  if (status === "error") {
    return <ToolMarkdown className="tool-error" text={activity.body ? localizeError(activity.body) : tr("执行失败", "Execution failed")} />;
  }
  if (activity.plan && activity.plan.length > 0) return <PlanChecklist items={activity.plan} />;
  if (kind === "read") return <ReadView body={activity.body} running={status === "running"} />;
  if (kind === "edit" || kind === "write") {
    return (
      <>
        {activity.body && activity.diff ? <ToolMarkdown text={activity.body} /> : null}
        {activity.diff ? (
          <DiffView diff={activity.diff} path={activity.path} />
        ) : activity.body ? (
          <ToolMarkdown text={activity.body} />
        ) : status === "running" ? (
          <p className="tool-wait">{kind === "edit" ? tr("正在修改", "Editing…") : tr("正在写入", "Writing…")}</p>
        ) : (
          <p className="tool-wait">{tr("没有差异", "No diff")}</p>
        )}
      </>
    );
  }
  if (activity.body && toolName && isWebTool(toolName)) return <ToolMarkdown text={webToolMarkdown(toolName, activity.body)} />;
  if (activity.body) return <ToolMarkdown text={activity.body} />;
  if (status === "running") return <p className="tool-wait">{tr("正在执行", "Running…")}</p>;
  return null;
}

const isWebTool = (name: string): boolean => name === "web_search" || name === "web_fetch";

function WebToolIcon({ name }: { name: string }): ReactNode {
  return name === "web_fetch" ? <WebFetchIcon size={13} /> : <WebSearchIcon size={13} />;
}

/**
 * 网页工具的结果文本是给模型看的：带「不可信内容」提示行和 <untrusted_web_content> 包裹。
 * 展示时去掉这些包装，把标题和来源整理成 Markdown，正文按 Markdown 渲染（并还原转义过的 Markdown）。
 */
function webToolMarkdown(name: string, body: string): string {
  const lines = body.split("\n");
  const head = lines[0] ?? "";
  const rest = lines.slice(1).join("\n").replace(/^\s*<untrusted_web_content>\n?/m, "").replace(/\n?<\/untrusted_web_content>/, "");
  if (name === "web_fetch") {
    const match = /^Fetched (\S+) via (.+?)\. Untrusted/.exec(head);
    if (!match) return unescapeMarkdown(body);
    const titleLine = /^Title: (.*)\n?/.exec(rest);
    const title = titleLine?.[1]?.trim();
    const content = (titleLine ? rest.slice(titleLine[0].length) : rest).trim();
    return `**${title || match[1]}**\n\n[${match[1]}](${match[1]}) · ${match[2]}\n\n---\n\n${unescapeMarkdown(content)}`;
  }
  const match = /^Web search results for "(.*)" via (.+?)\. Untrusted/.exec(head);
  if (!match) return body;
  return `**${match[1]}** · ${match[2]}\n\n---\n\n${rest.trim()}`;
}

export function BashView({
  command,
  output,
  running,
  failed,
}: {
  command?: string;
  output?: string;
  running: boolean;
  failed: boolean;
}) {
  return (
    <div className={`tool-terminal${failed ? " failed" : ""}`}>
      {command ? (
        <div className="tool-terminal-cmd">
          <span className="tool-terminal-prompt">$</span>
          <span>{command}</span>
        </div>
      ) : null}
      {output ? (
        <pre className="tool-terminal-out">{output}</pre>
      ) : (
        <div className="tool-terminal-wait">{running ? tr("运行中", "Running") : tr("无输出", "No output")}</div>
      )}
    </div>
  );
}

function ReadView({ body, running }: { body?: string; running: boolean }) {
  if (!body) return <p className="tool-wait">{running ? tr("正在读取", "Reading…") : tr("文件是空的", "File is empty")}</p>;
  if (body.startsWith("Read image file")) return <pre className="tool-note">{body}</pre>;
  const presented = presentRead(body);
  if (presented.lines.length === 0) return <p className="tool-wait">{tr("文件是空的", "File is empty")}</p>;
  return (
    <div className="tool-sheet">
      {presented.lines.map((line, index) => (
        <div className="tool-code-line" key={index}>
          <span className="tool-gutter">{presented.start + index}</span>
          <span className="tool-code-text">{line || " "}</span>
        </div>
      ))}
      {presented.notice ? <div className="tool-sheet-note">{presented.notice}</div> : null}
    </div>
  );
}

function DiffView({ diff, path, compact = false, focusFirstChange = false }: { diff: string; path?: string; compact?: boolean; focusFirstChange?: boolean }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseDisplayDiff(diff), [diff]);
  const rows = useMemo(() => (compact ? collapseDiffContext(parsed.rows) : parsed.rows), [parsed, compact]);
  const highlight = useDiffHighlight(path, parsed.oldLines, parsed.newLines);
  useLayoutEffect(() => {
    if (!compact || !focusFirstChange) return;
    const sheet = sheetRef.current;
    const viewport = sheet?.closest<HTMLElement>(".thinking-scroll-viewport");
    const changed = sheet?.querySelector<HTMLElement>(".tool-diff-line.add, .tool-diff-line.del");
    if (!viewport || !changed) return;
    // 首处增删放在第二个可见行；按视觉行高留上下文，避免长行换行把改动挤出视口。
    const style = getComputedStyle(changed);
    const lineHeight = Math.max(parseFloat(style.lineHeight) || 0, parseFloat(style.minHeight) || 0);
    viewport.scrollTop += changed.getBoundingClientRect().top - viewport.getBoundingClientRect().top - lineHeight;
  }, [compact, focusFirstChange]);
  if (rows.length === 0) return <p className="tool-wait">{tr("没有差异", "No diff")}</p>;
  return (
    <div ref={sheetRef} className={`tool-sheet${compact ? " tool-sheet-compact-diff" : ""}`}>
      {rows.map((row, index) => {
        if (row.kind === "gap") {
          return (
            <div className={`tool-diff-gap${compact ? " is-compact" : ""}`} key={index}>
              {compact ? null : row.text}
            </div>
          );
        }
        const tokens = rowTokens(row, highlight);
        return (
          <div className={`tool-code-line tool-diff-line ${row.kind}`} key={index}>
            <span className="tool-gutter">
              <span className="tool-sign">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}</span>
              {row.gutter}
            </span>
            <span className="tool-code-text">
              {tokens
                ? tokens.map((token, tokenIndex) => (
                    <span key={tokenIndex} style={tokenStyle(token)}>
                      {token.content}
                    </span>
                  ))
                : row.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 上下文行取新侧 token;两侧内容一致,缺哪侧用哪侧兜底。 */
function rowTokens(row: DisplayDiffRow, highlight: HighlightedDiff | null): ThemedToken[] | null {
  if (!highlight) return null;
  if (row.kind === "add") return highlight.new?.[row.newIndex] ?? null;
  if (row.kind === "del") return highlight.old?.[row.oldIndex] ?? null;
  if (row.kind === "ctx") return highlight.new?.[row.newIndex] ?? highlight.old?.[row.oldIndex] ?? null;
  return null;
}

/** 长上下文只显示靠近两侧改动的行,并以细分隔带代表折叠内容。 */
function collapseDiffContext(rows: DisplayDiffRow[]): DisplayDiffRow[] {
  const output: DisplayDiffRow[] = [];
  const changedAfter = new Array<boolean>(rows.length + 1).fill(false);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    changedAfter[index] = changedAfter[index + 1]! || row?.kind === "add" || row?.kind === "del";
  }
  let index = 0;
  let hasChangeBefore = false;
  while (index < rows.length) {
    const row = rows[index];
    if (row?.kind !== "ctx" && row?.kind !== "gap") {
      output.push(row!);
      if (row?.kind === "add" || row?.kind === "del") hasChangeBefore = true;
      index += 1;
      continue;
    }

    // 工具自带的「…」省略标记也算这一段上下文,否则两处改动之间会出现孤立的几行夹在两条分隔带中间。
    const start = index;
    while (index < rows.length && (rows[index]?.kind === "ctx" || rows[index]?.kind === "gap")) index += 1;
    const run = rows.slice(start, index);
    const context = run.filter((item) => item.kind === "ctx");
    const hasChangeAfter = changedAfter[index] ?? false;
    if (context.length > 0 && (run.length > 3 || run.length > context.length) && hasChangeBefore && hasChangeAfter) {
      output.push(context[0]!);
      output.push({ kind: "gap", gutter: "", text: "", oldIndex: -1, newIndex: -1 });
      if (context.length > 1) output.push(context[context.length - 1]!);
    } else {
      output.push(...run);
    }
  }
  return output;
}

/** 只标异常状态:运行中转圈、失败红叉;完成不显示,没有报错即成功。 */
function StatusMark({ status, compact = false }: { status: ToolTrace["status"]; compact?: boolean }) {
  return <ContentSwap inline hideWhenEmpty className={`tool-status-swap is-${status}`} motionKey={status}>
    {status === "running" || status === "error" ? <StatusMarkContent status={status} compact={compact} /> : null}
  </ContentSwap>;
}

function StatusMarkContent({ status, compact = false }: { status: ToolTrace["status"]; compact?: boolean }) {
  if (status === "running") {
    return compact ? <ActivityIndicator /> : <span className="tool-spinner" role="status" aria-label={tr("运行中", "Running")} />;
  }
  if (status === "error") {
    return (
      <span className="tool-status-mark error" role="img" aria-label={tr("失败", "Failed")}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return null;
}

function GroupIcon({ name, fallback }: { name: string; fallback: ReactNode }): ReactNode {
  return toolNameIcon(name) ?? fallback;
}

/** 没有路径或正文可显示时,按工具名给出一个短动作名,避免把原始工具名当标题。 */
function toolActionName(name: string): string | null {
  if (name === "create_scheduled_task") return tr("创建", "Create");
  if (name === "list_scheduled_tasks") return tr("查询", "List");
  if (name === "update_scheduled_task") return tr("修改", "Update");
  if (name === "delete_scheduled_task") return tr("删除", "Delete");
  if (name === "memory_read") return tr("读取", "Read");
  if (name === "memory_update") return tr("更新", "Update");
  return null;
}

function KindIcon({ kind, command }: { kind: ToolKind; command?: string }): ReactNode {
  if (kind === "other") return <ToolIcon size={13} />;
  if (kind === "bash") {
    const intent = bashIntentDisplay(command)?.kind;
    if (intent === "list") return <FolderIcon size={13} />;
    if (intent === "read") return <ReadFileIcon size={13} />;
    if (intent === "search" || intent === "find") return <SearchIcon size={13} />;
    return <TerminalIcon size={13} />;
  }
  if (kind === "read") return <ReadFileIcon size={13} />;
  if (kind === "edit") return <EditFileIcon size={13} />;
  if (kind === "write") return <FilePlusIcon size={13} />;
  return <TerminalIcon size={13} />;
}

function toolLabel(name: string, kind: ToolKind): string {
  if (name === "submit_plan") return tr("计划", "Plan");
  if (name === "update_plan") return tr("执行清单", "Execution");
  if (name === "update_todos") return tr("待办", "Todos");
  if (name === "submit_outcome") return tr("交付", "Outcome");
  if (name === "recommend_actions") return tr("推荐操作", "Recommended actions");
  if (cardToolGroup(name) === "schedule") return tr("定时任务", "Schedule");
  if (cardToolGroup(name) === "memory") return tr("记忆", "Memory");
  if (name === "record_goal_validation") return tr("验证", "Validation");
  if (name === "update_goal") return tr("目标", "Goal");
  if (name === "complete_step") return tr("步骤", "Step");
  if (name === "web_search") return tr("网页搜索", "Web search");
  if (name === "web_fetch") return tr("网页抓取", "Web fetch");
  if (name === "bash_output") return tr("后台输出", "Background output");
  if (name === "bash_kill") return tr("结束后台命令", "Stop background");
  return toolKindLabel(kind);
}

/** 待办清单的焦点项:优先进行中的一项,其次第一项未完成的,全部完成时取最后一项。 */
function todoFocus(plan: ToolActivity["plan"]): NonNullable<ToolActivity["plan"]>[number] | null {
  if (!plan?.length) return null;
  return (
    plan.find((item) => item.status === "in_progress") ??
    plan.find((item) => item.status === "pending") ??
    plan[plan.length - 1]!
  );
}

function toolKindLabel(kind: ToolKind): string {
  if (kind === "other") return tr("工具", "Tool");
  return kindLabels[kind];
}

function toolKind(name: string): ToolKind {
  if (name === "browser_repl" || name === "browser_repl_reset") return "browser";
  if (name === "bash" || name === "read" || name === "edit" || name === "write") return name;
  return "other";
}

function subjectOf(kind: ToolKind, activity: ToolActivity, name: string): { name: string; dir: string } {
  const presentation = activity.presentation;
  if (presentation?.kind === "shell") return { name: presentation.shell.command || presentation.shell.id, dir: "" };
  if (presentation?.kind === "discovery" && presentation.query) return { name: presentation.query, dir: "" };
  if (presentation?.kind === "resource") return { name: presentation.uri || presentation.server || name, dir: "" };
  if (presentation?.kind === "schedule" && presentation.tasks.length === 1) {
    const task = presentation.tasks[0];
    if (task && typeof task === "object" && !Array.isArray(task) && typeof task.title === "string") return { name: task.title, dir: "" };
  }
  if (kind === "bash") {
    const intent = bashIntentDisplay(activity.command);
    if (intent) return { name: intent.name, dir: intent.dir };
    const command = activity.command?.replace(/\s+/g, " ").trim();
    return { name: command || tr("命令", "Command"), dir: "" };
  }
  const path = activity.path?.trim();
  if (!path) {
    if (name === "update_plan" && activity.plan?.length) {
      return { name: activity.plan[0]!.text, dir: "" };
    }
    if (name === "update_todos" && activity.plan?.length) {
      return { name: todoFocus(activity.plan)!.text, dir: "" };
    }
    if (
      name === "submit_plan" ||
      name === "update_plan" ||
      name === "record_goal_validation" ||
      name === "update_goal" ||
      name === "complete_step" ||
      name === "submit_outcome" ||
      name === "recommend_actions"
    ) {
      const line = activity.body?.split("\n").find((item) => item.trim())?.trim();
      return { name: line || name, dir: "" };
    }
    return { name: toolActionName(name) ?? name, dir: "" };
  }
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return { name: path, dir: "" };
  return splitPath(path);
}

function readLineCount(body: string | undefined): number | null {
  if (!body || body.startsWith("Read image file")) return null;
  const presented = presentRead(body);
  return presented.lines.length;
}

interface PresentedRead {
  lines: string[];
  notice: string | null;
  start: number;
}

function presentRead(body: string): PresentedRead {
  const matched = body.match(
    /\n\n\[(Showing lines (\d+)-\d+ of \d+[\s\S]*?|\d+ more lines in file\. Use offset=\d+ to continue\.)\]$/,
  );
  if (!matched || matched.index === undefined) {
    return { lines: splitLines(body), notice: null, start: 1 };
  }
  const start = matched[2] ? Number(matched[2]) : 1;
  return { lines: splitLines(body.slice(0, matched.index)), notice: matched[1] ?? null, start };
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
