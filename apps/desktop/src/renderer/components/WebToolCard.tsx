import type { ChatSearch } from "./web-chat-messages";
import { useContext, useMemo, useState } from "react";
import { tr } from "../locale";
import { ActivityIndicator } from "./ActivityIndicator";
import { BrowserPanelLinkContext } from "./ConversationLinkContext";
import { Icon } from "./icons";
import { foldRowId } from "./tool-fold-state";
import { useToolExpanded } from "./ToolProcessContext";

import { webResultPages, type WebResultPage } from "./web-result-pages";

function SiteBadge({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  // Only the hostname goes to the favicon service, never a page path, query or referrer.
  const eligible = /\.[a-z][a-z\d-]+$/i.test(host) && !/\.(?:local|localhost|internal|lan|home|arpa|test|invalid)$/i.test(host);
  return <span className="web-page-icon" aria-hidden="true">
    {eligible && !failed ? <img src={`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`}
      alt="" width={16} height={16} loading="lazy" decoding="async" draggable={false}
      referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : host[0]?.toUpperCase()}
  </span>;
}

export function WebToolCard({ tool, compact }: { tool: ChatSearch; compact?: boolean }) {
  const [open, setOpen] = useToolExpanded(foldRowId(tool.id), compact);
  const openPage = useContext(BrowserPanelLinkContext);
  const { pages, subject } = useMemo(() => {
    const byUrl = new Map<string, WebResultPage>();
    const queries = new Set<string>();
    for (const search of tool.searches ?? [tool]) {
      const { command, body = "" } = search.activity ?? {};
      if (command) queries.add(command);
      for (const page of webResultPages(false, body)) if (!byUrl.has(page.href)) byUrl.set(page.href, page);
    }
    return { pages: [...byUrl.values()], subject: [...queries].join(" · ") };
  }, [tool]);
  if (tool.status === "error") return null;
  const running = tool.status === "running";
  const label = running ? tr("正在搜索网页", "Searching the web") : tr("已搜索网页", "Searched the web");
  const message = !running && !pages.length ? tr("没有可显示的网页", "No pages to show") : undefined;
  const expandable = Boolean(pages.length || message);
  return <article className={open ? "web-call open" : "web-call"}>
    <button type="button" className="web-call-head" title={subject} disabled={!expandable}
      aria-expanded={expandable ? open : undefined} onClick={() => setOpen(value => !value)}>
      <Icon name="search" size={14} />
      <span className="web-call-label">{label}{subject ? tr("：", ":") : ""}</span>
      {subject && <span className="web-call-subject">{subject}</span>}
      {running && <ActivityIndicator />}
      {expandable && <Icon name="chevron-right" className="web-call-chevron" size={12} />}
    </button>
    {expandable && <div className="tool-collapse" inert={!open}>
      <div className="tool-collapse-inner"><div className="web-call-pages">
      {pages.map(page => <button type="button" className="web-page-chip" key={page.href}
        disabled={!openPage} onClick={() => openPage?.(page.href)} title={`${page.title}\n${page.href}`}>
        <SiteBadge host={page.host} />
        <span className="web-page-title">{page.title}</span>
      </button>)}
      {message && <span className="web-call-note">{message}</span>}
      </div></div>
    </div>}
  </article>;
}
