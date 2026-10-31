import { isAgentBusy, type AgentControlAction, type AgentInfo } from "@vela/shared";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useDismissable } from "../hooks/useDismissable";
import { useEntryArrival } from "../hooks/useEntryArrival";
import type { ToolDisplay, ToolFold } from "../hooks/usePreferences";
import { useFrameTask } from "../hooks/useFrameTask";
import { emptyMessages, type MessageStore } from "../hooks/message-store";
import { useMessages } from "../hooks/useMessages";
import type { UiMessage } from "../hooks/useSession";
import { tr, trf } from "../locale";
import { ActivityIndicator } from "./ActivityIndicator";
import { AgentAvatar } from "./AgentAvatar";
import {
  AgentControls, AgentRunStats, AgentStatusMark, agentKindLabel, agentStateText, formatTokenCount, useAgentClock,
} from "./AgentPanel";
import { Markdown } from "./Markdown";
import { AssistantMarkdown } from "./intelligent-ui/AssistantMarkdown";
import { CoherentGroup, CoherentThought, ThinkingGroup } from "./Thinking";
import { useThinkingGroupMode } from "./ThinkingGroupModeContext";
import { CompactToolGroup, CompactToolLine, ToolCard, ToolList, ToolRunGroup } from "./ToolCard";
import { toolCompactKind } from "./tool-compact";
import { attachFollowerTools, buildTurnItems, groupAgentStream, groupCoherentItems, groupProcessItems, isFlatCoherentGroup, latestThoughtId, type CoherentNode, type ProcessNode } from "./tool-sequence";
import { BranchIcon } from "./icons";
import { JumpOrb } from "./JumpOrb";
import type { OrbActivity } from "./jump-orb";
import { shouldShowJumpToLatest } from "./chat-scroll";

interface AgentPaneProps {
  agent: AgentInfo;
  agents: readonly AgentInfo[];
  messages?: UiMessage[];
  messageStore?: MessageStore;
  conversationId?: string | null;
  toolDisplay?: ToolDisplay;
  /** 工具折叠方式；与主对话保持一致，默认按 Assistant 消息分组。 */
  toolFold?: ToolFold;
  /** 隐藏时卸载内容与订阅，外壳保留滚动位置。 */
  visible?: boolean;
  onSwitch: (agentId: string) => void;
  /** 首次展示某个 agent 时回填历史消息。 */
  ensureMessages: (agentId: string) => void;
  /** 暂停、继续或取消某个子代理。 */
  onControl: (agentId: string, action: AgentControlAction) => void;
}

/**
 * 右侧 Agent Pane：展示选中子代理自己的完整运行流（消息、thinking、工具调用、
 * 状态与最终结论），主对话保持独立滚动互不影响。宽度由共享的拖拽条调整。
 */
type AgentFollow = { pinned: boolean; scrollTop: number };
function agentPaneEqual(prev: AgentPaneProps, next: AgentPaneProps): boolean {
  // 隐藏的面板只在身份(agent / 会话)变化时才需要重算 scope;其余 props 随 agents 流式刷新,不必理会。
  // 重新显示时 visible 变化会触发完整渲染,拿到最新 props。
  if (prev.visible === false && next.visible === false) {
    return prev.agent.id === next.agent.id && prev.conversationId === next.conversationId;
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof AgentPaneProps>;
  for (const key of keys) if (!Object.is(prev[key], next[key])) return false;
  return true;
}

export const AgentPane = memo(function AgentPane(props: AgentPaneProps) {
  const follow = useRef<AgentFollow>({ pinned: true, scrollTop: 0 });
  const scope = JSON.stringify([props.conversationId, props.agent.id]);
  const previousScope = useRef(scope);
  if (previousScope.current !== scope) {
    previousScope.current = scope;
    follow.current = { pinned: true, scrollTop: 0 };
  }
  if (props.visible === false) return null;
  return <VisibleAgentPane {...props} follow={follow} />;
}, agentPaneEqual);

function VisibleAgentPane({
  agent, agents, messages: providedMessages, messageStore, conversationId = null,
  toolDisplay, toolFold = "message", onSwitch, ensureMessages, onControl, follow,
}: AgentPaneProps & { follow: MutableRefObject<AgentFollow> }) {
  const storedMessages = useMessages(messageStore, conversationId, agent.id);
  const messages = messageStore ? storedMessages : providedMessages ?? emptyMessages;
  const coherent = useThinkingGroupMode() === "coherent";
  const positional = toolFold === "position" || coherent;
  // 按位置折叠或连贯模式时由 AgentProcessSequence 自己归组;否则把没有思考的后续几轮的工具并进前一段标题思考。
  const units = useMemo(() => positional ? null : attachFollowerTools(messages), [messages, positional]);
  const memberIdsOf = useMemo(() => new Map(units?.map((unit) => [unit.message.id, unit.memberIds])), [units]);
  const streamBlocks = useMemo(
    () => groupAgentStream(units ? units.map((unit) => unit.message) : messages, positional ? "position" : toolFold),
    [units, messages, positional, toolFold],
  );
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]!.id : null;
  const agentId = agent.id;
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = agent.status === "running";
  const now = useAgentClock([agent]);
  const arrivalKeys = useMemo(() => {
    const keys: string[] = [];
    for (const message of messages) {
      keys.push(message.id);
      if (message.thinking) keys.push(`${message.id}:thinking`);
      if (message.tools.length) keys.push(`${message.id}:tools`);
      if (message.text) keys.push(`${message.id}:text`);
    }
    return keys;
  }, [messages]);

  useEffect(() => {
    ensureMessages(agentId);
  }, [agentId, ensureMessages]);

  // 回到最新按钮的圆球状态与主对话一致:有 bash 在跑 = 运行命令;还没写出正文 = 思考;其余显示箭头。
  const activeAssistant = streaming ? [...messages].reverse().find((message) => message.role === "assistant") : undefined;
  const runningBash = activeAssistant?.tools.find((tool) => (tool.name === "bash" || tool.name === "edit" || tool.name === "write") && tool.status === "running");
  const jumpActivity: OrbActivity | undefined = !activeAssistant
    ? undefined
    : runningBash ? "command" : !activeAssistant.text ? "thinking" : undefined;
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const syncJumpToLatest = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setShowJumpToLatest(shouldShowJumpToLatest({
      following: follow.current.pinned,
      distanceFromBottom: node.scrollHeight - node.scrollTop - node.clientHeight,
    }));
  }, [follow]);
  const jumpToLatest = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    follow.current.pinned = true;
    node.scrollTop = node.scrollHeight;
    setShowJumpToLatest(false);
  };

  // Restore before painting; save on unmount so tab switching keeps the viewport.
  const scheduleFollow = useFrameTask(() => {
    const node = scrollRef.current;
    if (node && follow.current.pinned) node.scrollTop = node.scrollHeight;
    syncJumpToLatest();
  });
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = follow.current.pinned ? node.scrollHeight
      : Math.min(follow.current.scrollTop, Math.max(0, node.scrollHeight - node.clientHeight));
    const observer = new ResizeObserver(scheduleFollow);
    const observeContent = () => { for (const child of node.children) observer.observe(child); };
    observeContent();
    const mutations = new MutationObserver(observeContent);
    mutations.observe(node, { childList: true });
    observer.observe(node);
    return () => {
      follow.current.scrollTop = node.scrollTop;
      observer.disconnect();
      mutations.disconnect();
    };
  }, [follow, scheduleFollow]);

  useLayoutEffect(scheduleFollow, [scheduleFollow, messages]);

  const onScroll = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    follow.current.pinned = distance <= 32;
    follow.current.scrollTop = node.scrollTop;
    syncJumpToLatest();
  };

  const arrivalRef = useEntryArrival(agentId, arrivalKeys, 0, false);
  return (
    <section
      ref={arrivalRef}
      className="agent-pane"
      aria-label={`${tr("子代理", "Subagent")} ${agent.path}`}
    >
      <header className="agent-pane-header">
        <div className="agent-pane-title">
          <AgentAvatar agentId={agent.id} />
          <AgentStatusMark status={agent.status} />
          <AgentBreadcrumb agent={agent} agents={agents} onSwitch={onSwitch} />
          <span className="agent-kind">{agentKindLabel(agent.kind)}</span>
          <span className={`agent-state is-${agent.status}`}>{agentStateText(agent)}</span>
        </div>
        <div className="agent-pane-actions">
          <AgentRunStats agent={agent} now={now} />
          <AgentControls agent={agent} onControl={onControl} />
          <AgentRosterMenu agents={agents} activeId={agentId} onSelect={onSwitch} onControl={onControl} />
        </div>
      </header>
      <div className="agent-pane-scroll" ref={scrollRef} onScroll={onScroll}>
        {agent.historyIncomplete ? (
          <p className="agent-history-notice">
            {tr("此历史会话仅保留任务、工具步骤摘要和最终结论；思考与完整工具输出未保存。",
              "This historical session retains only the task, tool summaries, and final result. Thinking and full tool output were not saved.")}
          </p>
        ) : null}
        {messages.length === 0 ? (
          agent.finalText ? (
            <div className="agent-stream">
              <article className="assistant-block">
                <div className="agent-reply-prose">
                  <AssistantMarkdown messageId={`${agentId}:final`} text={agent.finalText} />
                </div>
              </article>
            </div>
          ) : (
            <div className="agent-pane-empty">
              {streaming ? (
                <>
                  <ActivityIndicator activity="thinking" />
                  <p>{tr("子代理正在启动…", "Subagent is starting…")}</p>
                </>
              ) : (
                <p>{tr("没有可展示的运行记录。", "No run output to show.")}</p>
              )}
            </div>
          )
        ) : (
          <div className="agent-stream">
            {streamBlocks.map((block) => block.messages.length === 1 && !(coherent && block.role === "assistant") ? (
              <AgentStreamMessage
                key={`${agentId}:${block.id}`}
                message={block.messages[0]!}
                streaming={streaming && lastMessageId !== null && (memberIdsOf.get(block.messages[0]!.id)?.includes(lastMessageId) ?? block.messages[0]!.id === lastMessageId)}
                toolDisplay={toolDisplay}
                toolFold={toolFold}
              />
            ) : (
              <AgentProcessSequence
                key={`${agentId}:${block.id}`}
                messages={block.messages}
                streamingId={streaming ? lastMessageId : null}
                toolDisplay={toolDisplay}
              />
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="chat-jump-latest"
        data-visible={showJumpToLatest ? "true" : "false"}
        data-activity={jumpActivity}
        tabIndex={showJumpToLatest ? 0 : -1}
        aria-hidden={!showJumpToLatest}
        onClick={jumpToLatest}
        aria-label={tr("回到最新", "Jump to latest")}
        title={tr("回到最新", "Jump to latest")}
      >
        <JumpOrb activity={jumpActivity} commandKey={runningBash?.id} running={showJumpToLatest} />
      </button>
    </section>
  );
}

/** 面包屑按树路径逐段展示，点任意祖先可直接切过去。 */
function AgentBreadcrumb({
  agent,
  agents,
  onSwitch,
}: {
  agent: AgentInfo;
  agents: readonly AgentInfo[];
  onSwitch: (agentId: string) => void;
}) {
  const parts = agent.path.split("/").filter(Boolean);
  const nodes: ReactNode[] = [];
  let accumulated = "";
  parts.forEach((part, index) => {
    accumulated += `/${part}`;
    const target = index === 0
      ? null
      : agents.find((item) => item.kind !== "root" && item.path === accumulated) ?? null;
    nodes.push(
      <span className="agent-breadcrumb-sep" key={`sep-${accumulated}`} aria-hidden="true">
        /
      </span>,
    );
    nodes.push(
      target ? (
        <button
          key={accumulated}
          className="agent-breadcrumb-segment is-link"
          type="button"
          title={trf("切换到 {0}", "Switch to {0}", accumulated)}
          onClick={() => onSwitch(target.id)}
        >
          {part}
        </button>
      ) : (
        <span
          key={accumulated}
          className={`agent-breadcrumb-segment${index === parts.length - 1 ? " is-current" : ""}`}
        >
          {part}
        </span>
      ),
    );
  });
  return (
    <nav className="agent-breadcrumb" aria-label={tr("agent 路径", "Agent path")}>
      {nodes}
    </nav>
  );
}

/** SubAgents 面板：每个子代理的状态、token、耗时，以及单独的暂停 / 继续 / 取消。 */
function AgentRosterMenu({
  agents,
  activeId,
  onSelect,
  onControl,
}: {
  agents: readonly AgentInfo[];
  activeId: string;
  onSelect: (agentId: string) => void;
  onControl: (agentId: string, action: AgentControlAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const items = useMemo(
    () => agents.filter((item) => item.kind !== "root").sort((a, b) => a.createdAt - b.createdAt),
    [agents],
  );
  const now = useAgentClock(open ? items : []);
  if (items.length === 0) return null;
  const active = items.filter((item) => isAgentBusy(item.status)).length;
  const totalTokens = items.reduce((sum, item) => sum + item.usage.total, 0);
  return (
    <div className="agent-roster-menu-anchor" ref={ref}>
      <button
        className={`view-icon-btn${open ? " active" : ""}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={tr("子代理面板", "Subagents panel")}
        aria-label={tr("子代理面板", "Subagents panel")}
        onClick={() => setOpen((value) => !value)}
      >
        <BranchIcon size={13} />
      </button>
      {open ? (
        <div className="agent-roster-menu" role="listbox" aria-label={tr("子代理列表", "Subagent list")}>
          <div className="agent-roster-summary">
            <span>{trf("{0} 个子代理 · {1} 个进行中", "{0} subagents · {1} active", items.length, active)}</span>
            <span className="agent-run-stat" title={tr("所有子代理累计 token", "Total tokens across all subagents")}>
              {formatTokenCount(totalTokens)} tok
            </span>
          </div>
          {items.map((item) => (
            <div
              key={item.id}
              className={`agent-roster-row${item.id === activeId ? " is-active" : ""}`}
              style={{ paddingLeft: 10 + Math.max(0, item.depth - 1) * 14 }}
            >
              <button
                className="agent-roster-menu-item"
                type="button"
                role="option"
                aria-selected={item.id === activeId}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                <AgentAvatar agentId={item.id} />
                <AgentStatusMark status={item.status} />
                <span className="agent-roster-menu-path">{item.path}</span>
                <span className="agent-roster-menu-meta">{agentKindLabel(item.kind)}</span>
              </button>
              <div className="agent-roster-row-detail">
                <span className={`agent-state is-${item.status}`}>{agentStateText(item)}</span>
                <AgentRunStats agent={item} now={now} />
                <AgentControls agent={item} onControl={onControl} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const AgentStreamMessage = memo(function AgentStreamMessage({
  message,
  streaming,
  toolDisplay,
  toolFold,
}: {
  message: UiMessage;
  streaming: boolean;
  toolDisplay?: ToolDisplay;
  toolFold?: ToolFold;
}) {
  if (message.role === "user") {
    return (
      <article className="agent-stream-message is-user" data-arrival-key={message.id}>
        <div className="agent-stream-user">
          {message.text ? <Markdown text={message.text} /> : null}
        </div>
      </article>
    );
  }
  const thinkingActive = streaming && !message.text;
  const tools = message.tools.length > 0 ? (
    <ToolList tools={message.tools} display={toolDisplay} fold={toolFold} arrivalKey={`${message.id}:tools`} />
  ) : null;
  return (
    <article className="assistant-block" data-arrival-key={message.id}>
      {message.thinking ? (
        <div data-arrival-key={`${message.id}:thinking`}>
          <ThinkingGroup
            messageId={message.id}
            text={message.thinking}
            active={thinkingActive}
            live={streaming && (!message.text || message.tools.some((tool) => tool.status === "running"))}
            showActivityIndicator={toolDisplay === "compact"}
            tools={message.tools}
          >
            {tools}
          </ThinkingGroup>
        </div>
      ) : tools}
      {message.text ? (
        <div className="agent-reply-prose" data-arrival-key={`${message.id}:text`}>
          <AssistantMarkdown messageId={message.id} text={message.text} streaming={streaming} />
        </div>
      ) : null}
    </article>
  );
});

/**
 * 折叠方式为「按位置关系」时,相邻助理消息拍平成一条过程流,
 * 相邻工具跨消息合并成一组;思考、可见正文和不可折叠的工具都会打断分组。
 */
const AgentProcessSequence = memo(function AgentProcessSequence({
  messages,
  streamingId,
  toolDisplay,
}: {
  messages: UiMessage[];
  streamingId: string | null;
  toolDisplay?: ToolDisplay;
}) {
  const display = toolDisplay ?? "card";
  const compact = display === "compact";
  const coherent = useThinkingGroupMode() === "coherent";
  const items = useMemo(() => buildTurnItems(messages), [messages]);
  const nodes = useMemo(() => coherent ? [] : groupProcessItems(items, display), [coherent, items, display]);
  const coherentNodes = useMemo(() => coherent ? groupCoherentItems(items) : [], [coherent, items]);
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  type ToolNode = Extract<ProcessNode, { type: "tool" | "run" }>;
  const renderToolList = (nodes: ToolNode[]): ReactNode => (
    <div
      key={`tools:${nodes[0]!.id}`}
      className={compact ? "tool-card-list is-compact" : "tool-card-list"}
      data-arrival-key={`${nodes[0]!.messageId}:tools`}
    >
      {nodes.map((node) => node.type === "run" ? (
        compact
          ? <CompactToolGroup key={node.id} tools={node.tools} sequenceId={node.id} />
          : <ToolRunGroup key={node.id} tools={node.tools} />
      ) : compact && toolCompactKind(node.tool.name) ? (
        <CompactToolLine key={node.id} tool={node.tool} />
      ) : (
        <ToolCard key={node.id} tool={node.tool} compact={compact} />
      ))}
    </div>
  );
  const output: ReactNode[] = [];
  let buffer: ToolNode[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    output.push(renderToolList(buffer));
    buffer = [];
  };
  // 连贯模式:正文是唯一的分界,两段正文之间的思考和工具按到达顺序合成一组。
  const renderCoherentGroup = (node: Extract<CoherentNode, { type: "group" }>, last: boolean): ReactNode => {
    const tools = node.entries.flatMap((entry) => entry.type === "tool" ? [entry.tool] : []);
    const activeMessage = streamingId ? messageById.get(streamingId) : undefined;
    const live = Boolean(streamingId && (tools.some((tool) => tool.status === "running") || (last && !activeMessage?.text)));
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
          active={entry.messageId === streamingId && Boolean(message && !message.text && message.tools.length === 0)}
          expanded={live && entry.id === latestId}
        />,
      );
    }
    flushRun();
    // 步骤很少的分组没必要折叠,思考和工具直接平铺。
    if (isFlatCoherentGroup(node.entries)) {
      return <div key={`group:${node.id}`} className="coherent-flat" data-arrival-key={`${node.messageId}:thinking`}>{content}</div>;
    }
    return (
      <div key={`group:${node.id}`} data-arrival-key={`${node.messageId}:thinking`}>
        <CoherentGroup entries={node.entries} live={live} showActivityIndicator={compact}>
          {content}
        </CoherentGroup>
      </div>
    );
  };
  coherentNodes.forEach((node, index) => {
    output.push(node.type === "group" ? renderCoherentGroup(node, index === coherentNodes.length - 1) : (
      <div key={`text:${node.id}`} className="agent-reply-prose" data-arrival-key={`${node.messageId}:text`}>
        <AssistantMarkdown messageId={node.messageId} text={node.text} streaming={node.messageId === streamingId} />
      </div>
    ));
  });
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.type === "tool" || node.type === "run") {
      buffer.push(node);
      continue;
    }
    flush();
    if (node.type === "thinking") {
      const message = messageById.get(node.messageId);
      const active = node.messageId === streamingId && Boolean(message && !message.text && message.tools.length === 0);
      // groupProcessItems 已把跨过正文的后续工具移到标题思考之后。
      const grouped: ToolNode[] = [];
      while (index + 1 < nodes.length) {
        const next = nodes[index + 1]!;
        if (next.type !== "tool" && next.type !== "run") break;
        grouped.push(next);
        index += 1;
      }
      const activeMessage = streamingId ? messageById.get(streamingId) : undefined;
      const tools = grouped.flatMap((item) => item.type === "run" ? item.tools : [item.tool]);
      const ownsActiveMessage = node.messageId === streamingId || grouped.some((item) => item.messageId === streamingId);
      const live = Boolean(streamingId && (tools.some((tool) => tool.status === "running")
        || (!activeMessage?.text && ownsActiveMessage)));
      output.push(
        <div key={`thinking:${node.id}`} data-arrival-key={`${node.messageId}:thinking`}>
          <ThinkingGroup
            messageId={node.messageId}
            text={node.text}
            active={active}
            live={live}
            showActivityIndicator={compact}
            tools={tools}
          >
            {grouped.length > 0 ? renderToolList(grouped) : null}
          </ThinkingGroup>
        </div>,
      );
    } else {
      output.push(
        <div key={`text:${node.id}`} className="agent-reply-prose" data-arrival-key={`${node.messageId}:text`}>
          <AssistantMarkdown messageId={node.messageId} text={node.text} streaming={node.messageId === streamingId} />
        </div>,
      );
    }
  }
  flush();
  return (
    <article className="assistant-block" data-arrival-key={messages[0]!.id}>
      {output}
    </article>
  );
});
