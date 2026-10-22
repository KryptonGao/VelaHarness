import type { AppLocale, MemoryLoadReport, SideChatEvent, ThinkingLevel } from "@vela/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { useModels } from "../hooks/useModels";
import { localizeError, tr, trf } from "../locale";
import { Markdown } from "./Markdown";
import { ModelControls } from "./ModelControls";
import { SendIcon, TrashIcon } from "./icons";
import {
  readSideChatChoice,
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
 * 每次发送时按当前主对话的工作区带入全局与项目记忆。历史只在这个标签里，关闭即丢弃。
 */
export function SideChatView({ conversationId, locale, visible, models, hiddenModels, defaultChoice }: {
  /** 当前主对话：决定带入哪个项目的记忆。 */
  conversationId: string | null;
  locale: AppLocale;
  visible: boolean;
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
  const [entries, setEntries] = useState<SideChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<{ memory: MemoryLoadReport[]; memoryEnabled: boolean } | null>(null);
  const requestRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const streaming = requestId !== null;

  useEffect(() => window.vela?.sideChat?.onEvent((event: SideChatEvent) => {
    if (event.requestId !== requestRef.current) return;
    if (event.type === "memory") {
      setContext({ memory: event.memory, memoryEnabled: event.memoryEnabled });
      return;
    }
    setEntries((current) => current.map((entry) =>
      entry.id === event.requestId ? { ...entry, text: entry.text + event.text } : entry));
  }), []);

  // 关闭标签时停掉还在进行的回复。
  useEffect(() => () => {
    if (requestRef.current) void window.vela?.sideChat?.cancel(requestRef.current).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
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
    setEntries([...history, { id, role: "assistant", text: "", pending: true }]);
    void api.send({
      requestId: id, conversationId, locale, messages: sideChatRequestMessages(history),
      ...(choice ? { model: { provider: choice.provider, id: choice.id } } : {}),
      thinkingLevel: modelInfo.level,
    }).then((result) => {
      setContext({ memory: result.memory, memoryEnabled: result.memoryEnabled });
      setEntries((current) => current.flatMap((entry) => {
        if (entry.id !== id) return [entry];
        const text = result.text || entry.text;
        // 停止前什么都没收到时不留空白回复。
        return text.trim() ? [{ ...entry, text, pending: false, stopped: result.aborted }] : [];
      }));
    }).catch((reason: unknown) => {
      setEntries((current) => current.filter((entry) => entry.id !== id || entry.text.trim()).map((entry) =>
        entry.id === id ? { ...entry, pending: false, stopped: true } : entry));
      setError(reason instanceof Error ? localizeError(reason.message) : tr("侧边聊天回复失败", "Side chat reply failed"));
    }).finally(() => {
      if (requestRef.current === id) requestRef.current = null;
      setRequestId((current) => current === id ? null : current);
    });
  }, [conversationId, locale, choice, modelInfo.level]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    run([...entries, { id: crypto.randomUUID(), role: "user", text }]);
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

  const clear = () => {
    if (streaming) return;
    setEntries([]);
    setError(null);
    inputRef.current?.focus();
  };

  const retryHistory = sideChatRetryHistory(entries);
  const memoryLabel = sideChatMemoryLabel(context);

  return (
    <div className="side-chat">
      <header className="side-chat-header">
        <div className="side-chat-heading">
          <span className="side-chat-title">{tr("侧边聊天", "Side chat")}</span>
          <span className="side-chat-meta">
            <span className="side-chat-chip">{tr("仅聊天 · 不使用工具", "Chat only · no tools")}</span>
            <span className="side-chat-chip" title={context?.memory.filter(item => item.path).map(item => item.path).join("\n") || undefined}>
              {memoryLabel}
            </span>
          </span>
        </div>
        <button type="button" className="side-chat-clear" onClick={clear} disabled={streaming || entries.length === 0}
          aria-label={tr("清空侧边聊天", "Clear side chat")} title={tr("清空侧边聊天", "Clear side chat")}>
          <TrashIcon size={14} />
        </button>
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
            <div className="user-bubble side-chat-bubble">{entry.text}</div>
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
            <button type="submit" className="send-action-blue-btn send" disabled={!draft.trim()}
              aria-label={tr("发送", "Send")} title={trf("发送 ({0})", "Send ({0})", "Enter")}>
              <SendIcon size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
