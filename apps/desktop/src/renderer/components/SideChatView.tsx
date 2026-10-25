import type { AppLocale, MemoryLoadReport, SideChatEvent, SideChatStoredEntry, SideChatThread, ThinkingLevel } from "@vela/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { useModels } from "../hooks/useModels";
import type { SendButtonIcon } from "../hooks/usePreferences";
import { localizeError, tr, trf } from "../locale";
import { Markdown } from "./Markdown";
import { ModelControls } from "./ModelControls";
import { composeQuotes, type SideChatInboxItem } from "./selection-actions";
import { ArrowLeftIcon, ArrowUpIcon, CloseIcon, SendIcon } from "./icons";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import {
  forgetSideChatEntries,
  isSideChatDeleted,
  recallSideChatEntries,
  readSideChatChoice,
  rememberSideChatEntries,
  sideChatEntriesFromStored,
  sideChatStoredEntries,
  sideChatTitle,
  sideChatMemoryLabel,
  sideChatModelInfo,
  sideChatRequestMessages,
  sideChatRetryHistory,
  writeSideChatChoice,
  type SideChatEntry,
  type SideChatModelChoice,
} from "./side-chat-model";

/**
 * 侧边聊天：工作面板里的轻量对话。只和模型对话，不调用任何工具；
 * 每次发送时按当前主对话的工作区带入全局与项目记忆。历史按项目保存在磁盘上：
 * 同一项目的所有对话共用，重启后仍在；由 SideChatPanel 的聊天列表进入，删除才会清除。
 */
export function SideChatView({ workspace, threadId, number, initialEntries, onBack, onPersisted, onBusyChange, onDeleted, onInboxConsumed, conversationId, locale, visible, inbox, sendButtonIcon = "paper-plane", models, hiddenModels, defaultChoice }: {
  /** 这段侧边聊天所属的项目目录（没有项目为空字符串）。 */
  workspace: string;
  threadId: string;
  /** 标签编号，保存时一并写入。 */
  number: number;
  /** 从磁盘恢复的消息；标签之前显示过时以内存里最新的为准。 */
  initialEntries?: readonly SideChatStoredEntry[];
  /** 回到聊天列表。 */
  onBack: () => void;
  /** 每次保存后通知列表刷新；没有消息时表示这段聊天已不存在。 */
  onPersisted: (thread: SideChatThread) => void;
  /** 是否正在回复；回复中的聊天在返回列表后继续在后台接收。 */
  onBusyChange: (busy: boolean) => void;
  onDeleted: () => void;
  /** inbox 里的条目已经取走，调用方可以丢弃它们。 */
  onInboxConsumed: (count: number) => void;
  /** 当前主对话：决定带入哪个项目的记忆。 */
  conversationId: string | null;
  locale: AppLocale;
  visible: boolean;
  /** 从对话里选中文字送来的引用和已写好的问题；取走后经 onInboxConsumed 通知。 */
  inbox?: readonly SideChatInboxItem[];
  /** 与主输入框一致的发送按钮图标。 */
  sendButtonIcon?: SendButtonIcon;
  models: ReturnType<typeof useModels>;
  hiddenModels: string[];
  /** 没有记住的选择时，打开标签那一刻主对话的模型与推理强度。 */
  defaultChoice: SideChatModelChoice | null;
}) {
  const [choice, setChoice] = useState(() => readSideChatChoice(defaultChoice));
  const modelInfo = sideChatModelInfo(models.catalog, choice);
  const choose = (next: SideChatModelChoice) => {
    setChoice(next);
    writeSideChatChoice(next);
    return Promise.resolve();
  };
  const [entries, setEntries] = useState<SideChatEntry[]>(() => {
    // 切走时还在回复的标签已被取消，回来时那条回复按已停止显示。
    const recalled = recallSideChatEntries(threadId)?.flatMap((entry): SideChatEntry[] =>
      !entry.pending ? [entry] : entry.text.trim() ? [{ ...entry, pending: false, stopped: true }] : []);
    return recalled ?? sideChatEntriesFromStored(initialEntries ?? []);
  });
  const entriesRef = useRef(entries);
  /** 更新消息；标签卸载后（切换项目）进行中的回复收尾时仍写回内存和磁盘。 */
  const update = useCallback((change: (current: SideChatEntry[]) => SideChatEntry[]) => {
    entriesRef.current = change(entriesRef.current);
    rememberSideChatEntries(threadId, entriesRef.current);
    setEntries(entriesRef.current);
  }, [threadId]);
  const persist = useCallback(() => {
    if (isSideChatDeleted(threadId)) return;
    const thread: SideChatThread = { id: threadId, number, updatedAt: Date.now(), entries: sideChatStoredEntries(entriesRef.current) };
    void window.vela?.sideChat?.saveThread?.(workspace, thread).catch(() => undefined);
    onPersisted(thread);
  }, [workspace, threadId, number, onPersisted]);
  const [draft, setDraft] = useState("");
  const [quotes, setQuotes] = useState<string[]>([]);
  const inboxSeen = useRef(new Set<string>());
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<{ memory: MemoryLoadReport[]; memoryEnabled: boolean } | null>(null);
  const requestRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const streaming = requestId !== null;
  useEffect(() => { onBusyChange(streaming); }, [streaming, onBusyChange]);

  useEffect(() => window.vela?.sideChat?.onEvent((event: SideChatEvent) => {
    if (event.requestId !== requestRef.current) return;
    if (event.type === "memory") {
      setContext({ memory: event.memory, memoryEnabled: event.memoryEnabled });
      return;
    }
    update((current) => current.map((entry) =>
      entry.id === event.requestId ? { ...entry, text: entry.text + event.text } : entry));
  }), [update]);

  // 关闭标签时停掉还在进行的回复。
  useEffect(() => () => {
    if (requestRef.current) void window.vela?.sideChat?.cancel(requestRef.current).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!inbox || inbox.length === 0) return;
    onInboxConsumed(inbox.length);
    const fresh = inbox.filter((item) => !inboxSeen.current.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) inboxSeen.current.add(item.id);
    setQuotes((current) => [...current, ...fresh.map((item) => item.quote)]);
    const written = fresh.map((item) => item.draft?.trim()).filter(Boolean).join("\n");
    if (written) setDraft((current) => current.trim() ? `${current.trimEnd()}\n${written}` : written);
    inputRef.current?.focus();
  }, [inbox, onInboxConsumed]);

  useEffect(() => {
    const input = inputRef.current;
    if (!visible || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [visible]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [entries, error]);

  const run = useCallback((history: SideChatEntry[]) => {
    const api = window.vela?.sideChat;
    if (!api || requestRef.current) return;
    const id = crypto.randomUUID();
    requestRef.current = id;
    pinned.current = true;
    setRequestId(id);
    setError(null);
    update(() => [...history, { id, role: "assistant", text: "", pending: true }]);
    // 先保存用户消息，回复中途退出应用也不会丢。
    persist();
    void api.send({
      requestId: id, conversationId, locale, messages: sideChatRequestMessages(history),
      ...(choice ? { model: { provider: choice.provider, id: choice.id } } : {}),
      thinkingLevel: modelInfo.level,
    }).then((result) => {
      setContext({ memory: result.memory, memoryEnabled: result.memoryEnabled });
      update((current) => current.flatMap((entry) => {
        if (entry.id !== id) return [entry];
        const text = result.text || entry.text;
        // 停止前什么都没收到时不留空白回复。
        return text.trim() ? [{ ...entry, text, pending: false, stopped: result.aborted }] : [];
      }));
    }).catch((reason: unknown) => {
      update((current) => current.filter((entry) => entry.id !== id || entry.text.trim()).map((entry) =>
        entry.id === id ? { ...entry, pending: false, stopped: true } : entry));
      setError(reason instanceof Error ? localizeError(reason.message) : tr("侧边聊天回复失败", "Side chat reply failed"));
    }).finally(() => {
      persist();
      if (requestRef.current === id) requestRef.current = null;
      setRequestId((current) => current === id ? null : current);
    });
  }, [conversationId, locale, choice, modelInfo.level, update, persist]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    setQuotes([]);
    run([...entriesRef.current, { id: crypto.randomUUID(), role: "user", text, ...(quotes.length > 0 ? { quotes } : {}) }]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const stop = () => {
    if (requestId) void window.vela?.sideChat?.cancel(requestId).catch(() => undefined);
  };

  const remove = () => {
    stop();
    forgetSideChatEntries(threadId);
    void window.vela?.sideChat?.removeThread?.(workspace, threadId).catch(() => undefined);
    onDeleted();
  };

  const retryHistory = sideChatRetryHistory(entries);
  const memoryLabel = sideChatMemoryLabel(context);

  return (
    <div className="side-chat">
      <header className="side-chat-header">
        <button type="button" className="side-chat-icon-button" onClick={onBack}
          aria-label={tr("返回聊天列表", "Back to chats")} title={tr("返回聊天列表", "Back to chats")}>
          <ArrowLeftIcon size={14} />
        </button>
        <div className="side-chat-heading">
          <span className="side-chat-title" title={sideChatTitle(sideChatStoredEntries(entries))}>{sideChatTitle(sideChatStoredEntries(entries))}</span>
          <span className="side-chat-meta">
            <span className="side-chat-chip">{tr("仅聊天 · 不使用工具", "Chat only · no tools")}</span>
            <span className="side-chat-chip" title={context?.memory.filter(item => item.path).map(item => item.path).join("\n") || undefined}>
              {memoryLabel}
            </span>
          </span>
        </div>
        <ConfirmDeleteButton className="side-chat-icon-button" label={tr("删除聊天", "Delete chat")} onConfirm={remove} />
      </header>
      <div className="side-chat-list" ref={listRef} onScroll={(event) => {
        const list = event.currentTarget;
        pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      }} aria-live="polite">
        {entries.length === 0 ? (
          <div className="side-chat-empty">
            <p>{tr("随手问点什么，不打断主对话。", "Ask something on the side without interrupting the main chat.")}</p>
            <p>{tr("这里不会读写文件或运行命令，也看不到主对话；会带入你的全局记忆和当前项目的记忆。",
              "It can't read or edit files, run commands, or see the main chat. Your global memory and the current project's memory are included.")}</p>
          </div>
        ) : entries.map((entry) => entry.role === "user" ? (
          <div className="side-chat-user" key={entry.id}>
            <div className="user-bubble side-chat-bubble">
              {entry.quotes?.length ? <div className="side-chat-bubble-quotes"><Markdown text={composeQuotes(entry.quotes, "")} /></div> : null}
              {entry.text}
            </div>
          </div>
        ) : (
          <div className="side-chat-assistant" key={entry.id}>
            {entry.text ? <Markdown text={entry.text} streaming={entry.pending} />
              : <span className="side-chat-thinking">{tr("正在回复…", "Replying…")}</span>}
            {entry.stopped ? <span className="side-chat-stopped">{tr("已停止", "Stopped")}</span> : null}
          </div>
        ))}
        {error ? (
          <div className="side-chat-error" role="alert">
            <span>{error}</span>
            {retryHistory ? (
              <button type="button" onClick={() => run(retryHistory)}>
                {tr("重试", "Retry")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <form className="side-chat-composer" onSubmit={submit}>
        {quotes.length > 0 ? (
          <div className="reply-quote-row">
            {quotes.map((quote, index) => (
              <div className="reply-quote-card side-chat-quote-draft" key={index}>
                <span className="reply-quote-bar" aria-hidden="true" />
                <p className="reply-quote-text" title={quote}>{quote}</p>
                <span className="reply-quote-badge">{tr("引用", "Quote")}</span>
                <button type="button" className="reply-quote-remove" title={tr("移除引用", "Remove quote")}
                  aria-label={tr("移除引用", "Remove quote")}
                  onClick={() => { setQuotes((current) => current.filter((_, at) => at !== index)); inputRef.current?.focus(); }}>
                  <CloseIcon size={10} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          className="side-chat-input"
          value={draft}
          rows={2}
          placeholder={tr("问点什么… Enter 发送，Shift+Enter 换行", "Ask anything… Enter to send, Shift+Enter for a new line")}
          aria-label={tr("侧边聊天输入", "Side chat message")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="side-chat-controls">
          <ModelControls
            modelLabel={modelInfo.label}
            modelProvider={choice?.provider ?? null}
            modelId={choice?.id ?? null}
            thinkingLevel={modelInfo.level}
            thinkingLevels={modelInfo.levels}
            disabled={streaming}
            catalog={models.catalog}
            catalogError={models.catalogError}
            actionError={models.actionError}
            hiddenModels={hiddenModels}
            login={models.login}
            onSelect={(provider, id) => choose({ provider, id, thinkingLevel: choice?.thinkingLevel ?? modelInfo.level })}
            onThinking={(level: ThinkingLevel) => choice ? choose({ ...choice, thinkingLevel: level }) : Promise.resolve()}
            // 只登记模型并在侧边聊天里选中，不改动主对话的模型。
            onAdd={async (input) => {
              const failure = await models.register(input);
              if (!failure) await choose({ provider: input.providerId, id: input.modelId, thinkingLevel: modelInfo.level });
              return failure;
            }}
            onRemove={models.remove}
            onLogout={models.logout}
            onLogin={models.loginProvider}
            onReplyLogin={models.replyLogin}
            onCancelLogin={models.cancelLogin}
            onDismissLogin={models.dismissLogin}
          />
          {streaming ? (
            <button type="button" className="send-action-blue-btn stop" onClick={stop}
              aria-label={tr("停止回复", "Stop reply")} title={tr("停止回复", "Stop reply")}>
              <span className="stop-square" />
            </button>
          ) : (
            <button type="submit" className={`send-action-blue-btn send${sendButtonIcon === "arrow-up" ? " send-icon-arrow-up" : ""}`} disabled={!draft.trim()}
              aria-label={tr("发送", "Send")} title={trf("发送 ({0})", "Send ({0})", "Enter")}>
              {sendButtonIcon === "arrow-up" ? <ArrowUpIcon size={15} /> : <SendIcon />}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
