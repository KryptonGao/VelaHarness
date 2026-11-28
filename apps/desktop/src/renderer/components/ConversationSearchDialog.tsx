import { displayConversationTitle } from "./conversation-title";
import {
  parseSearchQuery,
  snippetSegments,
  type ConversationSearchHit,
  type ConversationSearchKind,
  type ConversationSummary,
  type WorkspaceRecent,
} from "@vela/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { activeIntlLocale, tr } from "../locale";
import { useConversationSearch } from "../hooks/useConversationSearch";
import {
  defaultSearchScope,
  searchConversationTitles,
  searchProjects,
  workspaceName,
  type DatePreset,
  type SearchScope,
} from "./conversation-search";
import { conversationWorkspace, workspaceTitle } from "./workspace-names";

interface ConversationSearchDialogProps {
  id: string;
  conversations: ConversationSummary[];
  workspaces?: readonly WorkspaceRecent[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  /** Open the chat a message hit belongs to and scroll to the message. */
  onOpenHit: (hit: ConversationSearchHit, query: string) => void;
  onClose: () => void;
}

/** Chats matched by title; the rest of the list is message hits. */
const maxTitleMatches = 8;
const noHits: ConversationSearchHit[] = [];

type Item =
  | { key: string; kind: "chat"; conversation: ConversationSummary }
  | { key: string; kind: "hit"; hit: ConversationSearchHit };

export function ConversationSearchDialog({ id, conversations, workspaces, activeConversationId, onSelect, onOpenHit, onClose }: ConversationSearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>(defaultSearchScope);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const listId = useId();
  const chatsLabelId = useId();
  const messagesLabelId = useId();
  const untitledLabel = tr("新对话", "New chat");
  const searching = parseSearchQuery(query).length > 0;
  const titleMatches = useMemo(() => {
    const matches = searchConversationTitles(conversations, query, untitledLabel, scope);
    return searching ? matches.slice(0, maxTitleMatches) : matches;
  }, [conversations, query, untitledLabel, scope, searching]);
  const projects = useMemo(() => searchProjects(conversations), [conversations]);
  const messages = useConversationSearch(query, scope);
  const hits = searching ? messages.hits : noHits;
  const items = useMemo<Item[]>(() => [
    ...titleMatches.map(conversation => ({ key: `chat:${conversation.id}`, kind: "chat" as const, conversation })),
    ...hits.map(hit => ({ key: `hit:${hit.cursor}`, kind: "hit" as const, hit })),
  ], [titleMatches, hits]);
  const selectedIndex = Math.max(0, items.findIndex(item => item.key === selectedKey));
  const selected = items[selectedIndex];
  const optionId = (item: Item) => `${listId}-${item.key.replace(/[^\w-]/g, "_")}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest("[inert]")) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (selected) document.getElementById(optionId(selected))?.scrollIntoView({ block: "nearest" });
  }, [listId, selected?.key]);

  function activate(item: Item) {
    onClose();
    if (item.kind === "chat") onSelect(item.conversation.id);
    else onOpenHit(item.hit, query);
  }

  function updateScope(patch: Partial<SearchScope>) {
    setScope(current => ({ ...current, ...patch }));
    setSelectedKey(null);
  }

  const projectValue = scope.workspace === undefined ? "all" : scope.workspace === "" ? "none" : `path:${scope.workspace}`;
  const emptyLabel = searching ? tr("没有匹配的会话或消息", "No matching chats or messages") : tr("还没有会话", "No chats yet");
  const showEmpty = items.length === 0 && !messages.searching && (!searching || !messages.indexing);

  return createPortal(
    <dialog
      id={id}
      ref={dialogRef}
      className="conversation-search-dialog"
      aria-label={tr("搜索会话", "Search chats")}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === "Enter" || event.key === "Escape") event.preventDefault();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          // Arrow keys belong to the filter controls while one has focus.
          if (event.target !== inputRef.current && event.target instanceof HTMLElement && event.target.closest(".conversation-search-filters")) return;
          event.preventDefault();
          if (!items.length) return;
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setSelectedKey(items[(selectedIndex + delta + items.length) % items.length]!.key);
          inputRef.current?.focus();
        }
      }}
    >
      <form className="conversation-search-header" onSubmit={event => { event.preventDefault(); if (selected) activate(selected); }}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={tr("搜索会话标题、工作区和消息内容", "Search chat titles, workspaces and messages")}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={selected ? optionId(selected) : undefined}
          placeholder={tr("搜索会话和消息", "Search chats and messages")}
          value={query}
          onChange={event => { setQuery(event.target.value); setSelectedKey(null); }}
        />
        <button type="button" className="conversation-search-close" aria-label={tr("关闭搜索", "Close search")} title={tr("关闭搜索", "Close search")} onClick={onClose}>×</button>
      </form>
      <div className="conversation-search-filters" role="group" aria-label={tr("筛选", "Filters")}>
        <select
          aria-label={tr("项目", "Project")}
          value={projectValue}
          onChange={event => {
            const value = event.target.value;
            updateScope({ workspace: value === "all" ? undefined : value === "none" ? "" : value.slice(5) });
          }}
        >
          <option value="all">{tr("所有项目", "All projects")}</option>
          {projects.map(path => path === ""
            ? <option key="none" value="none">{tr("无项目", "No project")}</option>
            : <option key={path} value={`path:${path}`} title={path}>{workspaceTitle(workspaces, path)}</option>)}
        </select>
        <select
          aria-label={tr("日期", "Date")}
          value={scope.datePreset}
          onChange={event => updateScope({ datePreset: event.target.value as DatePreset })}
        >
          <option value="any">{tr("任意时间", "Any time")}</option>
          <option value="day">{tr("过去 24 小时", "Past 24 hours")}</option>
          <option value="week">{tr("过去 7 天", "Past 7 days")}</option>
          <option value="month">{tr("过去 30 天", "Past 30 days")}</option>
          <option value="quarter">{tr("过去 90 天", "Past 90 days")}</option>
          <option value="custom">{tr("自定义", "Custom")}</option>
        </select>
        {scope.datePreset === "custom" ? <>
          <input type="date" aria-label={tr("开始日期", "Start date")} value={scope.from} max={scope.to || undefined} onChange={event => updateScope({ from: event.target.value })} />
          <input type="date" aria-label={tr("结束日期", "End date")} value={scope.to} min={scope.from || undefined} onChange={event => updateScope({ to: event.target.value })} />
        </> : null}
        <button type="button" className="conversation-search-chip" aria-pressed={scope.includeTools} onClick={() => updateScope({ includeTools: !scope.includeTools })}>{tr("工具输出", "Tool output")}</button>
        <button type="button" className="conversation-search-chip" aria-pressed={scope.includeArchived} onClick={() => updateScope({ includeArchived: !scope.includeArchived })}>{tr("已归档", "Archived")}</button>
      </div>
      <div className="conversation-search-content">
        <div id={listId} role="listbox" aria-label={tr("搜索结果", "Search results")} className="conversation-search-results" aria-busy={messages.searching}>
          {titleMatches.length ? <div role="group" aria-labelledby={chatsLabelId}>
            <div id={chatsLabelId} className="conversation-search-section-label">{tr("会话", "Chats")}</div>
            {titleMatches.map(conversation => {
              const item: Item = { key: `chat:${conversation.id}`, kind: "chat", conversation };
              const title = displayConversationTitle(conversation.title, untitledLabel);
              const index = items.findIndex(entry => entry.key === item.key);
              return (
                <button
                  id={optionId(item)}
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={`conversation-search-result${index === selectedIndex ? " selected" : ""}`}
                  title={conversation.hasWorkspace === false ? title : `${title}\n${conversation.cwd}`}
                  onFocus={() => setSelectedKey(item.key)}
                  onClick={() => activate(item)}
                >
                  <span className="conversation-search-result-title">{title}</span>
                  {conversation.hasWorkspace !== false ? <span className="conversation-search-workspace">{workspaceName(conversationWorkspace(conversation))}</span> : null}
                  {conversation.archivedAt !== null ? <span className="conversation-search-current">{tr("已归档", "Archived")}</span> : null}
                  {conversation.id === activeConversationId ? <span className="conversation-search-current">{tr("当前", "Current")}</span> : null}
                </button>
              );
            })}
          </div> : null}
          {searching && (hits.length > 0 || messages.searching || messages.indexing || messages.failed) ? <div role="group" aria-labelledby={messagesLabelId}>
            <div id={messagesLabelId} className="conversation-search-section-label">{tr("消息", "Messages")}</div>
            {hits.map(hit => {
              const item: Item = { key: `hit:${hit.cursor}`, kind: "hit", hit };
              const index = items.findIndex(entry => entry.key === item.key);
              return <HitRow
                key={item.key}
                id={optionId(item)}
                hit={hit}
                workspaces={workspaces}
                selected={index === selectedIndex}
                onFocus={() => setSelectedKey(item.key)}
                onClick={() => activate(item)}
              />;
            })}
            {messages.hasMore ? <button type="button" className="conversation-search-more" onClick={messages.loadMore}>{tr("显示更多结果", "Show more results")}</button> : null}
            <div className="conversation-search-status" role="status">
              {messages.failed ? tr("搜索失败，请重试", "Search failed. Try again.")
                : messages.searching ? tr("正在搜索…", "Searching…")
                : messages.indexing ? tr("正在建立索引，结果可能不完整", "Still indexing, so results may be incomplete")
                : ""}
            </div>
          </div> : null}
        </div>
        {showEmpty ? <div className="conversation-search-empty" role="status">{emptyLabel}</div> : null}
      </div>
      <div className="conversation-search-footer">{tr("↑↓ 选择 · Enter 打开 · Esc 关闭", "↑↓ to select · Enter to open · Esc to close")}</div>
    </dialog>,
    document.body,
  );
}

function kindLabel(kind: ConversationSearchKind): string {
  if (kind === "user") return tr("你", "You");
  if (kind === "assistant") return tr("助手", "Assistant");
  return tr("工具", "Tool");
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(activeIntlLocale(), { year: sameYear ? undefined : "numeric", month: "short", day: "numeric" });
}

function HitRow({ id, hit, workspaces, selected, onFocus, onClick }: {
  id: string;
  hit: ConversationSearchHit;
  workspaces?: readonly WorkspaceRecent[];
  selected: boolean;
  onFocus: () => void;
  onClick: () => void;
}) {
  const title = displayConversationTitle(hit.title, tr("新对话", "New chat"));
  const project = hit.workspace ? workspaceTitle(workspaces, hit.workspace) : "";
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      className={`conversation-search-result conversation-search-hit${selected ? " selected" : ""}`}
      title={new Date(hit.timestamp).toLocaleString(activeIntlLocale())}
      onFocus={onFocus}
      onClick={onClick}
    >
      <span className="conversation-search-snippet">
        {snippetSegments(hit.snippet).map((segment, index) => segment.match ? <mark key={index}>{segment.text}</mark> : segment.text)}
      </span>
      <span className="conversation-search-hit-meta">
        <span>{kindLabel(hit.kind)}</span>
        <span className="conversation-search-hit-chat">{title}</span>
        {project ? <span className="conversation-search-hit-project">{project}</span> : null}
        {hit.archived ? <span className="conversation-search-current">{tr("已归档", "Archived")}</span> : null}
        <time dateTime={new Date(hit.timestamp).toISOString()}>{formatDate(hit.timestamp)}</time>
      </span>
    </button>
  );
}
