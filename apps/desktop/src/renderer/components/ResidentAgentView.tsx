import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  mayContainUi,
  residentLimits,
  residentModes,
  residentWakeId,
  type ModelCatalog,
  type ProactiveRulesState,
  type ResidentAgentApi,
  type ResidentMode,
  type ResidentSettings,
  type ResidentStatus,
  type ResidentSubmitFailure,
  type ResidentWakeCard,
  type ResidentWakeEvent,
} from "@vela/shared";
import { activeIntlLocale, tr, trf } from "../locale";
import { showToast } from "../toast";
import type { MessageStore } from "../hooks/message-store";
import { useMessages } from "../hooks/useMessages";
import type { UiMessage } from "../hooks/useSession";
import { AssistantMarkdown } from "./intelligent-ui/AssistantMarkdown";
import { UiHostProvider, type UiHost } from "./intelligent-ui/UiRuntime";
import { stableUiMessageId } from "./intelligent-ui/ui-state-store";
import { Markdown } from "./Markdown";
import { UserMessageFrame } from "./UserMessageFrame";
import { ProactiveRulesPanel } from "./ProactiveRulesPanel";
import { ResidentSettingsPanel } from "./ResidentSettingsPanel";
import { modeDescription, modeLabel, stateLabel, statusSummary, taskErrorText, taskSourceLabel, taskStatusLabel, wakeSkipReasonLabel } from "./resident-agent-model";
import { useSlidingTabIndicator } from "./useSlidingTabIndicator";
import { Icon } from "./icons";

type Tab = "chat" | "tasks" | "rules" | "settings";

const submitFailure: Record<ResidentSubmitFailure, () => string> = {
  disabled: () => tr("Resident Agent 已关闭，请先在设置里选择「待命」。", "Resident Agent is off. Choose Standby first."),
  paused: () => tr("后台自动任务已暂停，恢复后才能提交。", "Background tasks are paused. Resume them first."),
  invalid: () => tr("请输入内容。", "Enter something first."),
  unknown_workspace: () => tr("这个工作区没有登记，不能创建任务。", "That workspace isn't registered."),
  queue_full: () => tr("后台任务队列已满，请稍后再试。", "The task queue is full. Try again shortly."),
  failed: () => tr("提交失败。", "Couldn't submit that."),
};

const toolLabels: Record<string, () => string> = {
  list_workspaces: () => tr("查询工作区", "Listed workspaces"),
  list_background_tasks: () => tr("查询后台任务", "Checked background tasks"),
  list_inbox_items: () => tr("查询收件箱", "Checked the Inbox"),
  delegate_workspace_task: () => tr("创建后台任务", "Created a background task"),
  read_task_result: () => tr("读取任务结果", "Read task result"),
  send_to_task: () => tr("继续后台任务", "Continued a background task"),
  ask_user_question: () => tr("向你提问", "Asked you a question"),
};

function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function formatTime(at: number | null): string {
  return at === null ? "" : new Date(at).toLocaleString(activeIntlLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ResidentMessage = memo(function ResidentMessage({ message, streaming, editDisabled, onResend }: {
  message: UiMessage;
  streaming: boolean;
  editDisabled: boolean;
  onResend: (text: string) => Promise<void>;
}) {
  if (message.role === "user") {
    return <UserMessageFrame text={message.text} timestamp={message.timestamp} disabled={editDisabled} onEdit={onResend}
      editNote={tr("重新发送会把修改后的内容作为一条新消息发给 Resident，不会撤回之前的对话。", "Resending sends the edited text to Resident as a new message. The earlier conversation stays as it is.")}
      savingLabel={tr("正在发送…", "Sending…")}>
      {message.text ? <div className="user-bubble"><Markdown text={message.text} /></div> : null}
    </UserMessageFrame>;
  }
  if (!message.text && message.tools.length === 0) return streaming ? <div className="assistant-block"><span className="resident-typing" role="status" aria-label={tr("正在回复", "Replying")} /></div> : null;
  return <article className="assistant-block">
    {message.tools.length > 0 ? <ul className="resident-tools" aria-label={tr("工具调用", "Tool calls")}>
      {message.tools.map(tool => <li key={tool.id} data-status={tool.status}>{(toolLabels[tool.name] ?? (() => tool.name))()}</li>)}
    </ul> : null}
    {message.text ? <div className="agent-reply-prose"><AssistantMarkdown messageId={message.id} text={message.text} streaming={streaming} /></div> : null}
    {message.text && !streaming ? <ResidentReplyActions text={message.text} timestamp={message.timestamp ?? null} /> : null}
  </article>;
});

/** 与主对话回复下方的操作行一致：左侧复制，右侧时间；Resident 没有分支和检查点。 */
function ResidentReplyActions({ text, timestamp }: { text: string; timestamp: number | null }) {
  const date = timestamp === null ? null : new Date(timestamp);
  const valid = date && Number.isFinite(date.getTime()) ? date : null;
  const label = tr("复制回复", "Copy reply");
  return <div className="reply-actions">
    <button className="reply-action" type="button" title={label} aria-label={label}
      onClick={() => { void navigator.clipboard.writeText(text).then(() => showToast(tr("已复制", "Copied")), () => undefined); }}>
      <Icon name="copy" size={14} />
    </button>
    {valid ? <time className="reply-time" dateTime={valid.toISOString()} title={valid.toLocaleString(activeIntlLocale())}>{formatTime(valid.getTime())}</time> : null}
  </div>;
}

function wakeEventLabel(event: ResidentWakeEvent): string {
  if (event.kind === "task") return taskStatusLabel(event.status);
  return event.kind === "approval_expired" ? tr("审批已过期", "Approval expired") : tr("失败事项", "Failure reported");
}

function ResidentEventCard({ card }: { card: ResidentWakeCard }) {
  const label = tr("后台事件", "Background events");
  return <article className="resident-event-card" aria-label={label}>
    <header>
      <Icon name="bell" size={16} />
      <strong>{label}</strong>
    </header>
    {card.events.length > 0 ? <ul>
      {card.events.map((event, index) => <li key={index}>
        {event.title ? <span>{event.title}</span> : null}
        <span className={event.title ? "resident-event-kind" : undefined}>{wakeEventLabel(event)}</span>
      </li>)}
    </ul> : null}
    {card.state === "running" ? <p className="resident-event-progress" role="status">{tr("正在处理事件…", "Reviewing events…")}</p> : null}
    {card.state === "failed" ? <p className="resident-event-progress" role="status">{tr("未能处理这些事件。", "Couldn't process these events.")}</p> : null}
  </article>;
}

type ChatRow = { message: UiMessage; card?: ResidentWakeCard };

function visibleChatRows(messages: readonly UiMessage[], cards: readonly ResidentWakeCard[]): ChatRow[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const rows: ChatRow[] = [];
  let wake: ResidentWakeCard | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      const id = residentWakeId(message.text);
      wake = id ? byId.get(id) : undefined;
      // Treat only Host-registered prompts as events, and consume each event ID once.
      if (id && wake) byId.delete(id);
      if (wake?.state !== "silent") rows.push({ message, ...(wake ? { card: wake } : {}) });
    } else if (!wake || wake.state === "replied") {
      // Don't flash a partial wake reply (including the NO_REPLY marker) while it streams.
      rows.push({ message });
    }
  }
  return rows;
}

function Chat({ api, status, settings, messageStore }: {
  api: ResidentAgentApi;
  status: ResidentStatus;
  settings: ResidentSettings | null;
  messageStore: MessageStore;
}) {
  const messages = useMessages(messageStore, status.conversationId);
  const rows = useMemo(() => visibleChatRows(messages, status.wakeCards), [messages, status.wakeCards]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const blocked = status.mode === "disabled" ? "disabled" : status.paused ? "paused" : null;

  const uiOrdinals = useMemo(() => {
    const ordinals = new Map<string, string>();
    for (const message of messages) if (message.role === "assistant" && mayContainUi(message.text)) ordinals.set(message.id, stableUiMessageId(ordinals.size));
    return ordinals;
  }, [messages]);

  const submit = useCallback(async (value: string) => {
    const result = await api.submit({ text: value });
    if (!result.ok) throw new Error(result.message ?? submitFailure[result.reason]());
  }, [api]);

  const submitWithToast = useCallback(async (value: string): Promise<boolean> => {
    try { await submit(value); return true; }
    catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { kind: "error" });
      return false;
    }
  }, [submit]);

  const uiHost = useMemo<UiHost>(() => ({
    conversationId: status.conversationId,
    stableMessageId: id => uiOrdinals.get(id) ?? null,
    canSubmit: status.conversationId !== null && !blocked,
    agentBusy: status.residentBusy,
    // 界面只是把用户的选择当作一条普通消息发给 Resident，不携带任何权限。
    submit: async value => { await submitWithToast(value); },
    openLink: () => false,
  }), [status.conversationId, status.residentBusy, uiOrdinals, blocked, submitWithToast]);

  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [rows]);

  useLayoutEffect(() => {
    const list = listRef.current, dock = dockRef.current;
    if (!list || !dock) return;
    const measure = () => {
      list.style.setProperty("--resident-dock-height", `${dock.offsetHeight}px`);
      if (stick.current) list.scrollTop = list.scrollHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  const send = async () => {
    const value = text.trim();
    if (!value || sending || blocked) return;
    setSending(true);
    const ok = await submitWithToast(value);
    setSending(false);
    if (ok) { setText(""); stick.current = true; }
  };

  const lastIndex = messages.length - 1;
  return <div className="resident-chat">
    <div className="resident-messages autohide-scrollbar" ref={listRef} role="log" aria-label={tr("与 Resident Agent 的对话", "Conversation with Resident Agent")}
      onScroll={event => { const el = event.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      {rows.length === 0
        ? <p className="agent-inbox-empty">{tr("还没有对话。告诉它你想让后台处理什么，比如「检查一下 api 项目最近的失败测试」。", "No conversation yet. Tell it what to handle in the background, e.g. “check the failing tests in the api project”.")}</p>
        : <UiHostProvider value={uiHost}>
          {rows.map(({ message, card }) => card ? <ResidentEventCard key={message.id} card={card} />
            : <ResidentMessage key={message.id} message={message} streaming={status.residentBusy && message === messages[lastIndex]} editDisabled={status.residentBusy || Boolean(blocked)} onResend={submit} />)}
        </UiHostProvider>}
    </div>
    <div className="resident-composer-dock" ref={dockRef}>
      {blocked ? <p className="agent-inbox-muted resident-blocked" role="status">{submitFailure[blocked]()}</p> : null}
      <form className="resident-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="agent-inbox-sr" htmlFor="resident-input">{tr("给 Resident Agent 的消息", "Message for Resident Agent")}</label>
        <textarea id="resident-input" rows={1} value={text} maxLength={residentLimits.maxPrompt} disabled={Boolean(blocked)}
          placeholder={tr("和 Resident Agent 对话，或交给它一个任务", "Talk to Resident Agent or hand it a task")}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <button type="submit" className="send-action-blue-btn send" title={tr("发送 (Enter)", "Send (Enter)")} aria-label={tr("发送", "Send")}
          disabled={!text.trim() || sending || Boolean(blocked)}><Icon name="arrow-up" size={16} /></button>
      </form>
      {settings?.mode === "disabled" ? null : <p className="agent-inbox-muted resident-hint">{tr("Resident 不能读写文件或运行命令；需要动手时它会请你批准后在工作区里创建后台任务。", "Resident can't read files or run commands. When work is needed it asks you to approve a background task in a workspace.")}</p>}
    </div>
  </div>;
}

function Tasks({ api, status, onOpenConversation }: { api: ResidentAgentApi; status: ResidentStatus; onOpenConversation: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const tasks = useMemo(() => [...status.tasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, residentLimits.maxTasksShown), [status.tasks]);
  const cancel = async (id: string) => {
    setBusy(id);
    try { await api.cancelTask(id); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), { kind: "error" }); }
    finally { setBusy(null); }
  };
  if (!tasks.length) return <p className="agent-inbox-empty">{tr("还没有后台任务。", "No background tasks yet.")}</p>;
  return <div className="resident-tasks">
    <ul aria-label={tr("后台任务", "Background tasks")}>
      {tasks.map(task => <li key={task.id} className="resident-task" data-status={task.status}>
        <div className="resident-task-main">
          <strong>{task.title}</strong>
          <span className={`agent-inbox-status resident-task-${task.status}`}>{taskStatusLabel(task.status)}</span>
        </div>
        <div className="resident-task-meta">
          <span title={task.workspace}>{baseName(task.workspace)}</span>
          <span>{taskSourceLabel(task.source)}</span>
          <span>{formatTime(task.finishedAt ?? task.startedAt ?? task.createdAt)}</span>
        </div>
        {task.reason ? <p className="resident-task-reason">{trf("触发原因：{0}", "Why it ran: {0}", task.reason)}</p> : null}
        {task.error ? <p className="resident-task-error">{taskErrorText(task.error)}</p> : null}
        <div className="resident-task-actions">
          {task.conversationId ? <button type="button" onClick={() => onOpenConversation(task.conversationId!)}>{tr("打开对话", "Open conversation")}</button> : null}
          {task.status === "queued" || task.status === "running"
            ? <button type="button" disabled={busy === task.id} onClick={() => void cancel(task.id)}>{task.status === "queued" ? tr("移出队列", "Remove from queue") : tr("停止", "Stop")}</button> : null}
        </div>
      </li>)}
    </ul>
  </div>;
}

export function ResidentAgentView({ active, api, status, settings, rules, messageStore, ensureTranscript, onOpenConversation, onSettings, error, catalog = null, catalogError = null, initialTab = "chat" }: {
  active: boolean;
  api: ResidentAgentApi | null;
  status: ResidentStatus | null;
  settings: ResidentSettings | null;
  rules: ProactiveRulesState | null;
  messageStore: MessageStore;
  ensureTranscript: (conversationId: string) => void;
  onOpenConversation: (id: string) => void;
  onSettings: (settings: ResidentSettings) => void;
  error: string | null;
  catalog?: ModelCatalog | null;
  catalogError?: string | null;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const slider = useSlidingTabIndicator({ activeKey: tab });
  const [pending, setPending] = useState(false);
  const conversationId = status?.conversationId ?? null;
  useEffect(() => { if (conversationId) ensureTranscript(conversationId); }, [conversationId, ensureTranscript]);
  // AgentInboxPage stays mounted behind other app pages, so mounting alone isn't visibility.
  useEffect(() => {
    if (!active || !api || tab !== "chat") return;
    void api.setPageVisible(true).catch(() => {});
    return () => { void api.setPageVisible(false).catch(() => {}); };
  }, [active, api, tab]);

  if (!api) return <p className="agent-inbox-empty">{tr("当前环境不支持 Resident Agent。", "Resident Agent isn't available here.")}</p>;
  if (!status || !settings) return <p className="agent-inbox-empty" role="status">{error ?? tr("正在读取…", "Loading…")}</p>;

  const changeMode = async (mode: ResidentMode) => {
    if (mode === settings.mode || pending) return;
    setPending(true);
    try { onSettings(await api.updateSettings({ mode })); }
    catch (reason) { showToast(reason instanceof Error ? reason.message : String(reason), { kind: "error" }); }
    finally { setPending(false); }
  };
  const togglePause = async () => {
    setPending(true);
    try { await (status.paused ? api.resume() : api.pause()); onSettings(await api.getSettings()); }
    catch (reason) { showToast(reason instanceof Error ? reason.message : String(reason), { kind: "error" }); }
    finally { setPending(false); }
  };

  const tabs: Array<[Tab, string]> = [
    ["chat", tr("对话", "Chat")],
    ["tasks", status.tasks.length ? trf("任务（{0}）", "Tasks ({0})", status.tasks.length) : tr("任务", "Tasks")],
    ["rules", rules?.rules.length ? trf("主动规则（{0}）", "Rules ({0})", rules.rules.length) : tr("主动规则", "Rules")],
    ["settings", tr("设置", "Settings")],
  ];

  return <section className="resident-view" aria-label="Resident Agent">
    <header className="resident-head">
      <div className="resident-state">
        <span className={`resident-dot state-${status.state}`} aria-hidden="true" />
        <div>
          <h2>Resident Agent <span className="resident-state-label" role="status">{stateLabel(status.state)}</span></h2>
          <p>{statusSummary(status)}</p>
        </div>
      </div>
      <div className="resident-controls">
        <div className="resident-modes" role="radiogroup" aria-label={tr("运行模式", "Mode")}>
          {residentModes.map(mode => <button key={mode} type="button" role="radio" aria-checked={settings.mode === mode} disabled={pending}
            title={modeDescription(mode)} onClick={() => void changeMode(mode)}>{modeLabel(mode)}</button>)}
        </div>
        <button type="button" className="resident-pause" disabled={pending || settings.mode === "disabled"} aria-pressed={status.paused} onClick={() => void togglePause()}
          title={status.paused ? tr("恢复后台自动任务", "Resume background tasks") : tr("暂停全部后台自动任务；已在运行的不会被打断", "Pause all background tasks. Ones already running aren't interrupted")}>
          {status.paused ? <Icon name="play" size={12} /> : <Icon name="pause" size={12} />}
          <span>{status.paused ? tr("恢复", "Resume") : tr("暂停", "Pause")}</span>
        </button>
      </div>
      <p className="resident-mode-note">{modeDescription(settings.mode)}</p>
      {status.error || error ? <p className="agent-inbox-notice" role="alert">{status.error ?? error}</p> : null}
      <dl className="resident-facts">
        <dt>{tr("模型", "Model")}</dt><dd>{status.model ?? tr("使用当前默认模型", "Default model")}</dd>
        <dt>{tr("最近活动", "Last activity")}</dt><dd>{status.lastActivityAt ? formatTime(status.lastActivityAt) : tr("暂无", "None yet")}</dd>
        {settings.mode === "proactive" ? <><dt>{tr("今日主动运行", "Proactive runs today")}</dt><dd>{status.proactiveRunsToday} / {settings.limits.dailyProactiveRuns}</dd></> : null}
        <dt>{tr("今日事件唤醒", "Event wakes today")}</dt><dd>{status.wakesToday} / {settings.limits.maxWakesPerDay}</dd>
      </dl>
      {status.lastWakeSkip ? <p className="resident-mode-note" title={formatTime(status.lastWakeSkip.at)} role="status">
        {trf("上次未唤醒：{0}", "Last skipped wake: {0}", wakeSkipReasonLabel(status.lastWakeSkip.reason))}
      </p> : null}
    </header>
    <nav ref={slider.navRef} className="conversation-view-tabs resident-tabs" role="tablist" aria-label={tr("Resident Agent 分区", "Resident Agent sections")}
      onPointerMove={slider.onPointerMove} onPointerLeave={slider.onPointerLeave}>
      {tabs.map(([value, label]) => <button key={value} type="button" role="tab" id={`resident-tab-${value}`} data-tab-key={value} ref={slider.registerTab(value)}
        aria-selected={tab === value} aria-controls={`resident-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{label}</button>)}
      {slider.indicator}
    </nav>
    <div className="resident-panel autohide-scrollbar" role="tabpanel" id={`resident-panel-${tab}`} aria-labelledby={`resident-tab-${tab}`}>
      {tab === "chat" ? <Chat api={api} status={status} settings={settings} messageStore={messageStore} /> : null}
      {tab === "tasks" ? <Tasks api={api} status={status} onOpenConversation={onOpenConversation} /> : null}
      {tab === "rules" ? <ProactiveRulesPanel api={api} status={status} settings={settings} rules={rules} /> : null}
      {active && tab === "settings" ? <ResidentSettingsPanel api={api} settings={settings} onSettings={onSettings} catalog={catalog} catalogError={catalogError} /> : null}
    </div>
  </section>;
}
