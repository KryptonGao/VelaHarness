import type { AppLocale, SideChatThread } from "@vela/shared";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { useModels } from "../hooks/useModels";
import type { SendButtonIcon } from "../hooks/usePreferences";
import { tr } from "../locale";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { CloseIcon, PlusIcon, SearchIcon, SparkIcon } from "./icons";
import type { SideChatInboxItem } from "./selection-actions";
import { SideChatView } from "./SideChatView";
import {
  forgetSideChatEntries,
  searchSideChats,
  sideChatPreview,
  sideChatTimeLabel,
  sideChatTitle,
  type SideChatModelChoice,
} from "./side-chat-model";

interface ChatProps {
  conversationId: string | null;
  locale: AppLocale;
  sendButtonIcon?: SendButtonIcon;
  models: ReturnType<typeof useModels>;
  hiddenModels: string[];
  defaultChoice: SideChatModelChoice | null;
}

/** 一段聊天：把按 ID 区分的回调固定下来，避免每次渲染都触发 SideChatView 里的副作用。 */
const ThreadChat = memo(function ThreadChat({ thread, workspace, visible, inbox, chat, onBack, onPersisted, onBusy, onDeleted, onInboxConsumed }: {
  thread: SideChatThread;
  workspace: string;
  visible: boolean;
  inbox: readonly SideChatInboxItem[] | undefined;
  chat: ChatProps;
  onBack: () => void;
  onPersisted: (thread: SideChatThread) => void;
  onBusy: (id: string, busy: boolean) => void;
  onDeleted: (id: string) => void;
  onInboxConsumed: (id: string, count: number) => void;
}) {
  const { id } = thread;
  const busy = useCallback((value: boolean) => onBusy(id, value), [onBusy, id]);
  const deleted = useCallback(() => onDeleted(id), [onDeleted, id]);
  const consumed = useCallback((count: number) => onInboxConsumed(id, count), [onInboxConsumed, id]);
  return (
    <div className="side-chat-pane" hidden={!visible}>
      <SideChatView {...chat} workspace={workspace} threadId={id} number={thread.number} initialEntries={thread.entries}
        visible={visible} inbox={inbox} onBack={onBack} onPersisted={onPersisted} onBusyChange={busy}
        onDeleted={deleted} onInboxConsumed={consumed} />
    </div>
  );
});

/**
 * 侧边聊天标签：先是本项目的聊天列表（可搜索、新建、删除），点进去才是对话，
 * 对话里可以返回列表。聊天按项目保存，同一项目的所有对话共用这份列表。
 */
export function SideChatPanel({ workspace, visible, inbox, onInboxConsumed, ...chat }: ChatProps & {
  /** 项目目录；没有项目为空字符串。 */
  workspace: string;
  visible: boolean;
  /** 从对话里选中文字送来的引用；取走后经 onInboxConsumed 通知。 */
  inbox?: readonly SideChatInboxItem[];
  onInboxConsumed: (count: number) => void;
}) {
  const [threads, setThreads] = useState<SideChatThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /** 本次打开过的聊天（含还没保存的新聊天），用来给视图提供标签编号和初始消息。 */
  const [known, setKnown] = useState<Record<string, SideChatThread>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [inboxByThread, setInboxByThread] = useState<Record<string, SideChatInboxItem[]>>({});
  const [query, setQuery] = useState("");
  const inboxSeen = useRef(new Set<string>());
  const knownRef = useRef(known);
  knownRef.current = known;
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void (window.vela?.sideChat?.listThreads?.(workspace) ?? Promise.resolve([])).catch(() => []).then((saved) => {
      if (!live) return;
      // 加载期间已经保存的聊天以内存里的为准。
      setThreads((current) => [...current, ...saved.filter((item) => !current.some((existing) => existing.id === item.id))]
        .sort((left, right) => right.updatedAt - left.updatedAt));
      setLoaded(true);
    });
    return () => { live = false; };
  }, [workspace]);

  const startChat = useCallback((items?: SideChatInboxItem[]) => {
    const number = Math.max(0, ...threadsRef.current.map((item) => item.number), ...Object.values(knownRef.current).map((item) => item.number)) + 1;
    const thread: SideChatThread = { id: crypto.randomUUID(), number, updatedAt: Date.now(), entries: [] };
    setKnown((current) => ({ ...current, [thread.id]: thread }));
    if (items?.length) setInboxByThread((current) => ({ ...current, [thread.id]: items }));
    setOpenId(thread.id);
  }, []);

  const openChat = useCallback((thread: SideChatThread) => {
    setKnown((current) => ({ ...current, [thread.id]: current[thread.id] ?? thread }));
    setOpenId(thread.id);
  }, []);

  // 选中文字送来的引用：正在某段聊天里就加进去，否则新开一段。
  useEffect(() => {
    if (!inbox || inbox.length === 0) return;
    onInboxConsumed(inbox.length);
    const fresh = inbox.filter((item) => !inboxSeen.current.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) inboxSeen.current.add(item.id);
    if (openId) setInboxByThread((current) => ({ ...current, [openId]: [...(current[openId] ?? []), ...fresh] }));
    else startChat(fresh);
  }, [inbox, openId, onInboxConsumed, startChat]);

  const persisted = useCallback((thread: SideChatThread) => {
    setThreads((current) => {
      const others = current.filter((item) => item.id !== thread.id);
      return thread.entries.length > 0 ? [thread, ...others].sort((left, right) => right.updatedAt - left.updatedAt) : others;
    });
  }, []);
  const setThreadBusy = useCallback((id: string, value: boolean) => {
    setBusy((current) => {
      if (current.has(id) === value) return current;
      const next = new Set(current);
      if (value) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const deleted = useCallback((id: string) => {
    setThreads((current) => current.filter((item) => item.id !== id));
    setBusy((current) => { if (!current.has(id)) return current; const next = new Set(current); next.delete(id); return next; });
    setOpenId((current) => current === id ? null : current);
  }, []);
  const consumed = useCallback((id: string, _count: number) => {
    setInboxByThread((current) => { if (!current[id]) return current; const { [id]: _removed, ...rest } = current; return rest; });
  }, []);
  const back = useCallback(() => setOpenId(null), []);
  const removeFromList = useCallback((id: string) => {
    forgetSideChatEntries(id);
    void window.vela?.sideChat?.removeThread?.(workspace, id).catch(() => undefined);
    deleted(id);
  }, [workspace, deleted]);

  const hits = useMemo(() => searchSideChats(threads, query), [threads, query]);
  const now = Date.now();
  // 打开的聊天和还在回复的聊天保持挂载，返回列表后回复照常接收。
  const mounted = [...new Set([...(openId ? [openId] : []), ...busy])].flatMap((id) => known[id] ? [known[id]!] : []);

  return (
    <>
      {mounted.map((thread) => (
        <ThreadChat key={thread.id} thread={thread} workspace={workspace} visible={visible && openId === thread.id}
          inbox={inboxByThread[thread.id]} chat={{ ...chat }} onBack={back} onPersisted={persisted}
          onBusy={setThreadBusy} onDeleted={deleted} onInboxConsumed={consumed} />
      ))}
      <div className="side-chat side-chat-home" hidden={openId !== null}>
        <header className="side-chat-home-header">
          <span className="side-chat-title">{tr("侧边聊天", "Side chat")}</span>
          <button type="button" className="side-chat-new" onClick={() => startChat()}>
            <PlusIcon size={13} />
            <span>{tr("新聊天", "New chat")}</span>
          </button>
        </header>
        <div className="side-chat-search">
          <SearchIcon size={13} />
          <input ref={searchRef} type="text" value={query} placeholder={tr("搜索聊天", "Search chats")}
            aria-label={tr("搜索聊天", "Search chats")} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} />
          {query ? (
            <button type="button" className="side-chat-search-clear" aria-label={tr("清除搜索", "Clear search")}
              onClick={() => { setQuery(""); searchRef.current?.focus(); }}>
              <CloseIcon size={10} />
            </button>
          ) : null}
        </div>
        {hits.length === 0 ? (
          <div className="side-chat-empty">
            {loaded && threads.length === 0 ? (
              <>
                <p>{tr("还没有侧边聊天", "No side chats yet")}</p>
                <p>{tr("随手问点什么，不打断主对话。聊天按项目保存，这个项目的所有对话共用。",
                  "Ask something on the side without interrupting the main chat. Chats are saved per project and shared by all its conversations.")}</p>
              </>
            ) : loaded ? <p>{tr("没有匹配的聊天", "No matching chats")}</p> : null}
          </div>
        ) : (
          <ul className="side-chat-threads">
            {hits.map(({ thread, snippet }) => {
              const replying = busy.has(thread.id);
              return (
                <li key={thread.id} className="side-chat-thread-row">
                  <button type="button" className="side-chat-thread" onClick={() => openChat(thread)}>
                    <span className="side-chat-avatar" aria-hidden="true"><SparkIcon size={15} /></span>
                    <span className="side-chat-thread-body">
                      <span className="side-chat-thread-top">
                        <span className="side-chat-thread-title">{sideChatTitle(thread.entries)}</span>
                        <span className="side-chat-thread-time">{sideChatTimeLabel(thread.updatedAt, now, chat.locale)}</span>
                      </span>
                      <span className={`side-chat-thread-preview${replying ? " is-replying" : ""}`}>
                        {replying ? tr("正在回复…", "Replying…") : snippet ? (
                          <>{snippet.before}<mark>{snippet.match}</mark>{snippet.after}</>
                        ) : sideChatPreview(thread.entries)}
                      </span>
                    </span>
                  </button>
                  <ConfirmDeleteButton className="side-chat-thread-delete" label={tr("删除聊天", "Delete chat")}
                    onConfirm={() => removeFromList(thread.id)} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
