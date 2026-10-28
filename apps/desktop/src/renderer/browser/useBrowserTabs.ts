import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserAgentCursor, BrowserPanelApi, BrowserTabAnnotation, BrowserUiCommand, BrowserWindowState } from "@vela/shared";
import { BrowserController } from "./browser-controller";
import { createLogger } from "../logger";
import { replyStore } from "./reply-store";

const log = createLogger("browser");

export interface RendererBrowserTab { id: string; conversationId: string | null; controller: BrowserController; width?: number; height?: number; agentCursor?: BrowserAgentCursor | null; annotation?: BrowserTabAnnotation }
const empty: BrowserWindowState = { tabs: [], selected: {}, activeConversationId: null, operating: [], focusRequest: null };
export function useBrowserTabs(conversationId: string | null = null) {
  const api: BrowserPanelApi | undefined = window.vela?.browser;
  const [state, setState] = useState(empty);
  const [allTabs, setTabs] = useState<RendererBrowserTab[]>([]);
  const controllers = useRef(new Map<string, BrowserController>());
  const latest = useRef(empty);
  // 已经请求主进程释放、还没从状态里消失的批注，避免重复请求。
  const releasing = useRef(new Set<string>());
  const command = useCallback((request: BrowserUiCommand) => {
    if (api) void api.command(request).catch((error: unknown) => log.error("browser command failed", error));
  }, [api]);
  /** 卡片没了（移除、发送完成）的批注，让主进程释放页面里的元素句柄。 */
  const reconcile = useCallback(() => {
    const keep = replyStore.liveElementIds();
    const stillThere = new Set<string>();
    for (const tab of latest.current.tabs) {
      const gone = (tab.annotation?.items ?? []).filter(item => { stillThere.add(item.id); return !keep.has(item.id) && !releasing.current.has(item.id); }).map(item => item.id);
      if (!gone.length) continue;
      for (const id of gone) releasing.current.add(id);
      command({ type: "annotate-remove", tabId: tab.id, annotationIds: gone });
    }
    for (const id of releasing.current) if (!stillThere.has(id)) releasing.current.delete(id);
  }, [command]);
  useEffect(() => replyStore.subscribe(reconcile), [reconcile]);
  useEffect(() => {
    if (!api) return;
    let live = true;
    let received = false;
    const project = (next: BrowserWindowState) => {
      if (!live) return;
      latest.current = next;
      setState(next);
      setTabs(next.tabs.map(tab => {
        let controller = controllers.current.get(tab.id);
        if (!controller) { controller = new BrowserController({ tabId: tab.id, command }); controllers.current.set(tab.id, controller); }
        controller.project(tab);
        return { ...tab, controller };
      }));
      for (const id of controllers.current.keys()) if (!next.tabs.some(tab => tab.id === id)) { controllers.current.delete(id); replyStore.dropTab(id); }
      for (const tab of next.tabs) replyStore.setTracking(tab.id, tab.annotation?.items ?? []);
      reconcile();
    };
    const unsubscribe = api.subscribe(next => { received = true; project(next); });
    void api.command({ type: "state" }).then(next => { if (!received) project(next); }).catch((error: unknown) => log.error("browser state request failed", error));
    return () => { live = false; unsubscribe(); };
  }, [api, command, reconcile]);
  // Commands share the IPC channel: activation is sent before subsequent user opens.
  useEffect(() => { command({ type: "activate", conversationId }); }, [command, conversationId]);
  const open = useCallback(async (id: string, url?: string) => {
    if (api) { await api.command({ type: "open", id, url }); return; }
    const controller = new BrowserController();
    if (url) { controller.setAddress(url); controller.navigate(); }
    setTabs(current => [...current, { id, conversationId, controller }]);
  }, [api, command, conversationId]);
  const close = useCallback((id: string) => {
    if (api) command({ type: "close", tabId: id });
    else setTabs(current => current.filter(tab => tab.id !== id));
  }, [api, command]);
  const select = useCallback((id: string) => command({ type: "select", tabId: id }), [command]);
  return { tabs: allTabs.filter(tab => tab.conversationId === conversationId), allTabs, open, close, select, command, state, hosted: !!api };
}
