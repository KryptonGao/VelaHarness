import type { AgentControlAction, AgentInfo, BackgroundShellItem, ExecutionPlan, PlanExecutionContextStrategy, Race } from "@vela/shared";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ProjectApi } from "../hooks/useProject";
import type { SidebarResize } from "../hooks/useSidebarResize";
import type { ToolDisplay, ToolFold } from "../hooks/usePreferences";
import type { MessageStore } from "../hooks/message-store";
import type { UiMessage } from "../hooks/useSession";
import { useMotionPresence } from "../hooks/useMotionPresence";
import { WorkbenchTabPanel } from "./MotionPresence";
import { tr, trf } from "../locale";
import { AgentPane } from "./AgentPane";
import { AgentStatusMark } from "./AgentPanel";
import { AgentAvatar } from "./AgentAvatar";
import { WorkspaceChangesView } from "./WorkspaceChangesView";
import { AcceptancePanel } from "./AcceptancePanel";
import { RacePanel } from "./RacePanel";
import { BackgroundTasksPanel } from "./BackgroundTasksPanel";
import type { AcceptanceRequest } from "./acceptance";
import { TurnReviewView } from "./TurnReviewView";
import type { TurnReviewRequest } from "./turn-changes";
import { FileTypeIcon } from "./FileTypeIcon";
import { FileBrowserView } from "./preview/FileBrowserView";
import { FilePreviewView } from "./preview/FilePreviewView";
import { FilePreviewScope, useFilePreview } from "./preview/FilePreviewContext";
import { PlanDocumentPane } from "./PlanPanel";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { StartView, type StartTabAction } from "./StartView";
import { TerminalView } from "./TerminalView";
import { TerminalCloseDialog } from "./TerminalCloseDialog";
import { BrowserPanel, BrowserTabIcon, BrowserTabLabel } from "./browser/BrowserPanel";
import type { BrowserController } from "../browser/browser-controller";
import { BranchIcon, ChatIcon, FileIcon, FolderIcon, PlanIcon, PlusIcon, SparkIcon, TerminalIcon } from "./icons";
import { WorkbenchTabStrip } from "./WorkbenchTabStrip";
import { collapseWorkbenchLayout, dropWorkbenchTab, emptyWorkbenchLayout, mergeWorkbenchPane, reconcileWorkbenchLayout, resizeWorkbenchDivider,
  selectWorkbenchTab, workbenchDropTarget, workbenchFits, workbenchGeometry, workbenchPaneOrder, workbenchRatioBounds, WORKBENCH_GAP, WORKBENCH_HEADER_HEIGHT,
  type WorkbenchDivider, type WorkbenchDropEdge, type WorkbenchLayout, type WorkbenchRect } from "./workbench-layout";

export type WorkbenchTab =
  | { id: string; kind: "chat"; label: string; title?: string; conversationId: string }
  | { id: string; kind: "side-chat"; label: string; title?: string }
  | { id: string; kind: "plan"; label: string; title?: string }
  | { id: string; kind: "file"; label: string; title: string; path: string }
  | { id: string; kind: "changes"; label: string; title?: string }
  | { id: string; kind: "turn-review"; label: string; title?: string; review: TurnReviewRequest; target?: { path: string; requestKey: number; diffToolId?: string } }
  | { id: string; kind: "acceptance"; label: string; title?: string; acceptance: AcceptanceRequest }
  | { id: string; kind: "race"; label: string; title?: string }
  | { id: string; kind: "background"; label: string; title?: string }
  | { id: string; kind: "agent"; label: string; title: string; agent: AgentInfo }
  | { id: string; kind: "start"; label: string; title?: string }
  | { id: string; kind: "files"; label: string; title?: string }
  | { id: string; kind: "browser"; label: string; title?: string; controller: BrowserController }
  | { id: string; kind: "terminal"; label: string; title?: string; sessionId: string };

interface WorkbenchPanelProps {
  tabs: WorkbenchTab[];
  layoutKey?: string;
  /** 实验性分屏开关;关闭时只有一个窗口,标签不能拖动,已有分屏合并回单窗口。 */
  splitEnabled?: boolean;
  onVisibleTabsChange?: (ids: string[]) => void;
  collapsed?: boolean;
  browserOperating?: boolean;
  onCollapse?: () => void;
  activeTabId: string | null;
  contextOpen: boolean;
  leftOpen: boolean;
  resize: SidebarResize;
  project: ProjectApi;
  busy: boolean;
  streaming?: boolean;
  execution: ExecutionPlan | null;
  onRevise: () => void;
  onExecutePlan: (strategy: PlanExecutionContextStrategy) => void;
  initialDiffPath: string | null;
  initialDiffPathRequestKey: number;
  onShowDiff: (path: string) => void;
  onAcceptanceDiff?: (request: AcceptanceRequest, path: string, diffToolId?: string) => void;
  races?: readonly Race[];
  backgroundShells?: readonly BackgroundShellItem[];
  onOpenConversation?: (conversationId: string) => void;
  onOpenAcceptance?: (request: AcceptanceRequest) => void;
  agents: readonly AgentInfo[];
  getAgentMessages?: (agentId: string) => UiMessage[];
  messageStore?: MessageStore;
  conversationId?: string | null;
  toolDisplay?: ToolDisplay;
  toolFold?: ToolFold;
  ensureAgentMessages: (agentId: string) => void;
  onControlAgent: (agentId: string, action: AgentControlAction) => void;
  onOpenAgent: (agentId: string) => void;
  onNewTab: () => void;
  onStartAction: (tab: WorkbenchTab, action: StartTabAction) => void;
  pendingStartTabIds?: readonly string[];
  startErrors?: Record<string, string>;
  renderChat?: (tab: Extract<WorkbenchTab, { kind: "chat" }>) => ReactNode;
  renderSideChat?: (tab: Extract<WorkbenchTab, { kind: "side-chat" }>, visible: boolean) => ReactNode;
  gitAvailable: boolean;
  onActivateTab: (tab: WorkbenchTab) => void;
  onCloseTab: (tab: WorkbenchTab) => void;
  onTabCloseRequested?: (tab: WorkbenchTab) => void;
}
function safeId(value: string): string {
  return Array.from(value, character => /[a-zA-Z0-9_-]/.test(character) ? character : `_${character.codePointAt(0)!.toString(16)}_`).join("");
}
function TabIcon({ tab }: { tab: WorkbenchTab }) {
  if (tab.kind === "file") return <FileTypeIcon path={tab.path} />;
  if (tab.kind === "changes" || tab.kind === "turn-review" || tab.kind === "acceptance") return <FileIcon size={12} />;
  if (tab.kind === "race") return <BranchIcon size={12} />;
  if (tab.kind === "background" || tab.kind === "terminal") return <TerminalIcon size={12} />;
  if (tab.kind === "plan") return <PlanIcon size={12} />;
  if (tab.kind === "start") return <PlusIcon size={12} />;
  if (tab.kind === "files") return <FolderIcon size={12} />;
  if (tab.kind === "browser") return <BrowserTabIcon controller={tab.controller} />;
  if (tab.kind === "chat") return <ChatIcon size={12} />;
  if (tab.kind === "side-chat") return <SparkIcon size={12} />;
  return <><AgentAvatar agentId={tab.agent.id} size={18} /><AgentStatusMark status={tab.agent.status} /></>;
}
export function WorkbenchPanel(props: WorkbenchPanelProps) {
  const [pendingClose, setPendingClose] = useState<{ tabId: string; complete: () => void } | null>(null);
  const presence = useMotionPresence(props.tabs.length > 0 && !pendingClose, 160);
  const frozen = useRef(props);
  if (props.tabs.length > 0 && !pendingClose) frozen.current = props;
  useLayoutEffect(() => {
    if (!pendingClose) return;
    const interrupted = props.tabs.some(tab => tab.id !== pendingClose.tabId);
    if (presence.mounted && !interrupted) return;
    pendingClose.complete(); setPendingClose(null);
  }, [pendingClose, presence.mounted, props.tabs]);
  if (!presence.mounted) return null;
  return <WorkbenchPanelContent {...(presence.closing ? frozen.current : props)} closing={presence.closing} finishExit={presence.finishExit}
    onLastTabClose={(tab, complete) => setPendingClose({ tabId: tab.id, complete })} />;
}
const rectStyle = (r: WorkbenchRect): CSSProperties => ({ left: r.x, top: r.y, width: r.width, height: r.height });
function WorkbenchPanelContent(props: WorkbenchPanelProps & { closing: boolean; finishExit: () => void; onLastTabClose: (tab: WorkbenchTab, complete: () => void) => void }) {
  const { tabs, activeTabId, collapsed = false, contextOpen, leftOpen, resize, closing, finishExit, onLastTabClose,
    project, onShowDiff, onVisibleTabsChange } = props;
  const preview = useFilePreview();
  const panelRef = useRef<HTMLElement>(null), canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 700 });
  const [layouts, setLayouts] = useState<Record<string, WorkbenchLayout>>({});
  const scope = props.layoutKey ?? "workbench";
  const stored = layouts[scope] ?? emptyWorkbenchLayout();
  const splitEnabled = props.splitEnabled ?? false;
  const reconciled = reconcileWorkbenchLayout(stored, tabs.map(t => t.id));
  const synced = splitEnabled ? reconciled : collapseWorkbenchLayout(reconciled);
  const activeRef = useRef<{ scope: string; id: string | null }>({ scope: "", id: null });
  // 只响应外部真正切换的标签，不让另一个窗口的局部选择被全局激活值盖回去。
  const externalChanged = activeRef.current.scope !== scope || activeRef.current.id !== activeTabId;
  const layout = externalChanged && activeTabId ? selectWorkbenchTab(synced, activeTabId) : synced;
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const mutate = useCallback((change: (current: WorkbenchLayout) => WorkbenchLayout) => {
    setLayouts(current => {
      const before = layoutRef.current, next = change(before);
      layoutRef.current = next;
      return next === before && current[scope] === next ? current : { ...current, [scope]: next };
    });
  }, [scope]);
  useLayoutEffect(() => {
    // Browser Host 可能先给出待激活 ID，再异步投影该标签；真正出现后才能消费这次激活。
    if (!activeTabId || tabs.some(tab => tab.id === activeTabId)) activeRef.current = { scope, id: activeTabId };
    if (layouts[scope] !== layout) setLayouts(current => ({ ...current, [scope]: layout }));
  }, [scope, activeTabId, layout, layouts, tabs]);
  const [drag, setDrag] = useState<{ key: string; placing: boolean } | null>(null);
  const dragRef = useRef(drag); dragRef.current = drag;
  const [drop, setDrop] = useState<{ pane: string; edge: WorkbenchDropEdge; rect: WorkbenchRect; index?: number; marker?: WorkbenchRect } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const tabDragCleanup = useRef<(() => void) | null>(null);
  const clearDrag = useCallback(() => { tabDragCleanup.current?.(); dragRef.current = null; setDrag(null); setDrop(null); }, []);
  const resizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => { clearDrag(); return () => { tabDragCleanup.current?.(); resizeCleanup.current?.(); }; }, [scope, collapsed, clearDrag]);
  useEffect(() => {
    if (!drag) return;
    document.documentElement.dataset.workbenchDragging = "true";
    const stop = () => clearDrag();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stop(); } };
    document.addEventListener("dragend", stop); document.addEventListener("drop", stop);
    document.addEventListener("keydown", escape, true); window.addEventListener("blur", stop);
    return () => { delete document.documentElement.dataset.workbenchDragging; document.removeEventListener("dragend", stop);
      document.removeEventListener("drop", stop); document.removeEventListener("keydown", escape, true); window.removeEventListener("blur", stop); };
  }, [drag, clearDrag]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // 输入框、终端和输入法组合中的 Esc 属于它们自己(取消候选、vim 退出插入模式等),不拿来还原窗口。
      if (event.key === "Escape" && layoutRef.current.maximized) {
        const target = event.target instanceof Element ? event.target : null;
        if (event.defaultPrevented || event.isComposing || target?.closest("input, textarea, select, [contenteditable], .xterm")) return;
        mutate(current => ({ ...current, maximized: null })); return;
      }
      // macOS 上 Option+数字的 key 是 ¡™£¢,按物理键位 code 匹配才能在所有平台生效。
      const digit = /^Digit([1-4])$/.exec(event.code)?.[1];
      if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && digit) {
        const id = workbenchPaneOrder(layoutRef.current.root)[Number(digit) - 1];
        const pane = layoutRef.current.panes.find(p => p.id === id), tab = tabs.find(t => t.id === pane?.selected);
        if (tab) { event.preventDefault(); activateTab(tab); }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  useLayoutEffect(() => {
    const el = canvasRef.current; if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize(old => old.width === r.width && old.height === r.height ? old : { width: r.width, height: r.height });
      setDrop(null);
    };
    update(); const observer = new ResizeObserver(update); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (closing && panelRef.current) panelRef.current.style.setProperty("--workbench-exit-width", `${panelRef.current.getBoundingClientRect().width}px`);
  }, [closing]);
  const visibleIds = layout.panes.filter(p => !layout.maximized || p.id === layout.maximized).map(p => p.selected);
  const visibleKey = !collapsed && !closing ? visibleIds.join("\0") : "";
  useLayoutEffect(() => { onVisibleTabsChange?.(visibleKey ? visibleKey.split("\0") : []); }, [visibleKey, onVisibleTabsChange]);
  useEffect(() => () => onVisibleTabsChange?.([]), [onVisibleTabsChange]);
  const geometry = useMemo(() => workbenchGeometry(layout, size.width, size.height), [layout, size]);
  const id = useId(), baseId = `workbench-${safeId(id)}`;
  const tabPanelId = (tab: WorkbenchTab) => `${baseId}-panel-${safeId(tab.id)}`;
  const tabButtonId = (tab: WorkbenchTab) => `${baseId}-tab-${safeId(tab.id)}`;
  const full = { x: 0, y: 0, width: size.width, height: size.height };
  const paneRect = (paneId: string) => layout.maximized === paneId ? full : geometry.panes[paneId];
  const headerHeight = WORKBENCH_HEADER_HEIGHT;
  const ownerOf = (tabId: string) => layout.panes.find(p => p.tabs.includes(tabId));
  function activateTab(tab: WorkbenchTab) {
    mutate(current => selectWorkbenchTab(current, tab.id));
    if (tab.kind === "file") preview?.setActiveTab(tab.path);
    props.onActivateTab(tab);
  }
  function focusPane(paneId: string) {
    const pane = layoutRef.current.panes.find(p => p.id === paneId), tab = tabs.find(t => t.id === pane?.selected);
    if (tab && (layoutRef.current.focused !== paneId || activeTabId !== tab.id)) activateTab(tab);
  }
  const terminalCloseRequests = useRef(new Set<string>());
  const [terminalClosePrompt, setTerminalClosePrompt] = useState<{ scope: string; tab: Extract<WorkbenchTab, { kind: "terminal" }> } | null>(null);
  const terminalPromptVisible = terminalClosePrompt?.scope === scope && !closing && !collapsed && tabs.some(tab =>
    tab.kind === "terminal" && tab.id === terminalClosePrompt.tab.id && tab.sessionId === terminalClosePrompt.tab.sessionId);
  useLayoutEffect(() => {
    if (terminalClosePrompt && !terminalPromptVisible) setTerminalClosePrompt(null);
  }, [terminalClosePrompt, terminalPromptVisible]);
  const closeContext = useRef<{ scope: string; tabs: WorkbenchTab[]; close: (tab: WorkbenchTab) => void } | null>(null);
  useLayoutEffect(() => {
    closeContext.current = { scope, tabs, close: tab => {
      const current = tabs.find(candidate => candidate.id === tab.id);
      if (current?.kind === "terminal" && tab.kind === "terminal" && current.sessionId === tab.sessionId) finishClose(current);
    } };
    return () => { closeContext.current = null; };
  });
  function closeTab(tab: WorkbenchTab) {
    if (closing || collapsed) return;
    if (tab.kind !== "terminal") { finishClose(tab); return; }
    if (terminalCloseRequests.current.size || terminalClosePrompt) return;
    const api = window.vela;
    if (!api) return;
    terminalCloseRequests.current.add(tab.id);
    void api.getTerminalCloseStatus(tab.sessionId).then(status => {
      // Process inspection is asynchronous: never apply an old result to a different workspace or tab.
      const context = closeContext.current;
      if (context?.scope !== scope || !context.tabs.some(current => current.kind === "terminal" && current.id === tab.id && current.sessionId === tab.sessionId)) return;
      if (status === "idle") context.close(tab);
      else if (status === "busy") setTerminalClosePrompt({ scope, tab });
    }).catch(() => {
      // Failure to check must never terminate the command.
    }).finally(() => terminalCloseRequests.current.delete(tab.id));
  }
  function finishClose(tab: WorkbenchTab) {
    if (closing) return;
    props.onTabCloseRequested?.(tab);
    const owner = ownerOf(tab.id), index = owner?.tabs.indexOf(tab.id) ?? -1;
    const nextId = owner?.tabs[index + 1] ?? owner?.tabs[index - 1];
    const complete = () => { if (tab.kind === "file") preview?.closeTab(tab.path); props.onCloseTab(tab); };
    if (tabs.length === 1 && tab.kind !== "browser") onLastTabClose(tab, complete);
    else { complete(); if (owner?.selected === tab.id && nextId) { const next = tabs.find(t => t.id === nextId); if (next) activateTab(next); } }
  }
  const splitEdge = (edge: WorkbenchDropEdge) => edge === "left" || edge === "right" || edge === "top" || edge === "bottom";
  /** 拆分后会有窗口小于最小尺寸时视为不可用:不给预览,松手也不生效。 */
  function splitFits(next: WorkbenchLayout) {
    const r = canvasRef.current?.getBoundingClientRect();
    return !r || workbenchFits(next, r.width, r.height);
  }
  /** 指针在标签栏内的插入位置:落在第几个标签之前。 */
  function insertionAt(paneId: string, clientX: number): { index: number; x: number } | null {
    const bar = canvasRef.current?.querySelector(`[data-workbench-pane="${paneId}"]`); if (!bar) return null;
    const buttons = Array.from(bar.querySelectorAll<HTMLElement>(".workbench-tab")); if (!buttons.length) return null;
    const list = bar.querySelector(".workbench-tablist")?.getBoundingClientRect();
    let index = buttons.findIndex(b => { const r = b.getBoundingClientRect(); return clientX < r.left + r.width / 2; });
    if (index < 0) index = buttons.length;
    const edge = index < buttons.length ? buttons[index].getBoundingClientRect().left - 2 : buttons[index - 1].getBoundingClientRect().right + 2;
    return { index, x: list ? Math.max(list.left, Math.min(list.right, edge)) : edge };
  }
  function commitDrop(key: string, pane: string, edge: WorkbenchDropEdge, index?: number) {
    const current = layoutRef.current, next = dropWorkbenchTab(current, key, pane, edge, index);
    if (next !== current && splitEdge(edge) && !splitFits(next)) {
      clearDrag(); setAnnouncement(tr("空间不足，无法再拆分", "Not enough room to split")); return;
    }
    clearDrag(); if (next === current) return;
    mutate(() => next);
    const tab = tabs.find(t => t.id === key); if (tab) props.onActivateTab(tab);
    if (tab?.kind === "file") preview?.setActiveTab(tab.path);
    setAnnouncement(edge === "tabbar" ? (index !== undefined && current.panes.some(p => p.id === pane && p.tabs.includes(key)) ? tr("标签已重新排序", "Tab reordered") : tr("标签已合并", "Tab merged")) : edge === "center" ? tr("标签已互换", "Tabs swapped") : tr("标签已移至新的区域", "Tab moved to a new area"));
    requestAnimationFrame(() => document.getElementById(tab ? tabButtonId(tab) : "")?.focus());
  }
  function updateDrop(x: number, y: number) {
    const currentDrag = dragRef.current, r = canvasRef.current?.getBoundingClientRect();
    if (!currentDrag || !r) { setDrop(null); return null; }
    const current = layoutRef.current, target = workbenchDropTarget(current, r.width, r.height, x - r.left, y - r.top, ownerOf(currentDrag.key)?.id);
    const slot = target?.edge === "tabbar" ? insertionAt(target.pane, x) : null;
    const next = target ? dropWorkbenchTab(current, currentDrag.key, target.pane, target.edge, slot?.index) : current;
    if (!target || next === current || (splitEdge(target.edge) && !workbenchFits(next, r.width, r.height))) { setDrop(null); return null; }
    const newOwner = next.panes.find(p => p.tabs.includes(currentDrag.key))!;
    const paneBounds = target.edge === "tabbar"
      ? workbenchGeometry(current, r.width, r.height).panes[target.pane]
      : workbenchGeometry(next, r.width, r.height).panes[newOwner.id];
    const rect = target.edge === "tabbar" ? { ...paneBounds, height: Math.min(headerHeight, paneBounds.height) } : paneBounds;
    const marker = slot ? { x: slot.x - r.left - 1, y: paneBounds.y + (headerHeight - 28) / 2, width: 2, height: 28 } : undefined;
    const value = { ...target, rect, index: slot?.index, marker };
    setDrop(old => old?.pane === target.pane && old.edge === target.edge && old.index === value.index ? old : value);
    return value;
  }
  /** 不进入 Chromium/macOS 原生 HTML 拖拽循环；指针捕获保证跨 guest 和标签栏仍持续收到坐标。 */
  function startTabPointerDrag(event: React.PointerEvent<HTMLButtonElement>, tab: WorkbenchTab) {
    if (event.button !== 0 || closing || collapsed || !splitEnabled) return;
    clearDrag();
    const button = event.currentTarget, pointerId = event.pointerId, startX = event.clientX, startY = event.clientY;
    let started = false;
    button.setPointerCapture(pointerId);
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true); window.removeEventListener("blur", cancel);
      button.removeEventListener("lostpointercapture", cancel);
      tabDragCleanup.current = null;
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    };
    const cancel = () => clearDrag();
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
        started = true;
        const value = { key: tab.id, placing: false };
        dragRef.current = value; setDrag(value);
      }
      e.preventDefault(); updateDrop(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!started) { cleanup(); return; }
      // 移动标签后不要把本次 pointerup 合成的 click 误投到关闭按钮或新位置的标签上。
      const swallowClick = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation(); };
      window.addEventListener("click", swallowClick, true);
      window.setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
      const target = updateDrop(e.clientX, e.clientY);
      if (target) commitDrop(tab.id, target.pane, target.edge, target.index); else clearDrag();
    };
    tabDragCleanup.current = cleanup;
    window.addEventListener("pointermove", move, { capture: true, passive: false }); window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true); window.addEventListener("blur", cancel);
    button.addEventListener("lostpointercapture", cancel);
  }
  const dividerBounds = (divider: WorkbenchDivider) => workbenchRatioBounds(divider.axis === "x" ? divider.parent.width : divider.parent.height, divider.axis);
  function resizeDivider(event: React.PointerEvent<HTMLDivElement>, divider: WorkbenchDivider) {
    if (event.button !== 0) return;
    event.preventDefault(); clearDrag();
    const handle = event.currentTarget, start = divider.axis === "x" ? event.clientX : event.clientY;
    handle.setPointerCapture(event.pointerId); document.documentElement.dataset.resizing = "true"; document.documentElement.dataset.paneResizing = "true";
    document.body.style.cursor = divider.axis === "x" ? "col-resize" : "row-resize";
    const bounds = dividerBounds(divider);
    const move = (e: PointerEvent) => mutate(current => resizeWorkbenchDivider(current, divider.id, divider.ratio +
      ((divider.axis === "x" ? e.clientX : e.clientY) - start) / Math.max(1, (divider.axis === "x" ? divider.parent.width : divider.parent.height) - WORKBENCH_GAP), bounds));
    const stop = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", stop); handle.removeEventListener("pointercancel", stop);
      handle.removeEventListener("lostpointercapture", stop); if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointerup", stop, true); window.removeEventListener("pointercancel", stop, true); window.removeEventListener("blur", stop);
      delete document.documentElement.dataset.resizing; delete document.documentElement.dataset.paneResizing; document.body.style.cursor = ""; resizeCleanup.current = null; };
    resizeCleanup.current = stop;
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", stop); handle.addEventListener("pointercancel", stop); handle.addEventListener("lostpointercapture", stop);
    window.addEventListener("pointerup", stop, true); window.addEventListener("pointercancel", stop, true); window.addEventListener("blur", stop);
  }
  function renderTab(tab: WorkbenchTab, visible: boolean): ReactNode {
    switch (tab.kind) {
      case "chat": return props.renderChat?.(tab);
      case "side-chat": return props.renderSideChat?.(tab, visible && !collapsed);
      case "browser": return <BrowserPanel controller={tab.controller} tabId={tab.id} operating={props.browserOperating}
        onAbort={() => { if (props.conversationId) void window.vela?.abort(props.conversationId); }} />;
      case "file": return preview ? <FilePreviewScope path={tab.path} visible={visible && !collapsed}><FilePreviewView project={project} onShowDiff={onShowDiff} /></FilePreviewScope> : null;
      case "plan": return <PlanDocumentPane busy={props.busy} execution={props.execution} onRevise={props.onRevise} onExecutePlan={props.onExecutePlan} visible={visible} />;
      case "changes": return <WorkspaceChangesView project={project} messageStore={props.messageStore} conversationId={props.conversationId} streaming={props.streaming}
        initialPath={props.initialDiffPath} initialPathRequestKey={props.initialDiffPathRequestKey} visible={visible} onClose={() => closeTab(tab)} />;
      case "turn-review": return <TurnReviewView key={tab.review.turnId} review={tab.review} target={tab.target} visible={visible} onClose={() => closeTab(tab)} />;
      case "acceptance": return <AcceptancePanel key={tab.acceptance.turnId} request={tab.acceptance} onOpenDiff={(path, diffToolId) => props.onAcceptanceDiff?.(tab.acceptance, path, diffToolId)} />;
      case "race": return <RacePanel races={props.races ?? []} onOpenConversation={props.onOpenConversation ?? (() => {})} onOpenAcceptance={props.onOpenAcceptance ?? (() => {})} />;
      case "background": return <BackgroundTasksPanel conversationId={props.conversationId ?? null} shells={props.backgroundShells ?? []} />;
      case "files": return <FileBrowserView />;
      case "start": return <StartView gitAvailable={props.gitAvailable} onAction={action => props.onStartAction(tab, action)} pending={props.pendingStartTabIds?.includes(tab.id)} error={props.startErrors?.[tab.id]} />;
      case "terminal": return <TerminalView sessionId={tab.sessionId} visible={visible && !collapsed} />;
      case "agent": return <AgentPane agent={tab.agent} agents={props.agents} messages={props.getAgentMessages?.(tab.agent.id)} messageStore={props.messageStore}
        conversationId={props.conversationId} toolDisplay={props.toolDisplay} toolFold={props.toolFold} visible={visible} ensureMessages={props.ensureAgentMessages} onControl={props.onControlAgent}
        onSwitch={agentId => { const next = tabs.find(t => t.kind === "agent" && t.agent.id === agentId); if (next) activateTab(next); else props.onOpenAgent(agentId); }} />;
    }
  }
  const canvasBounds = canvasRef.current?.getBoundingClientRect();
  return <aside ref={panelRef} className={`workbench-panel${contextOpen ? " is-context-open" : ""}${closing ? " is-closing" : ""}${collapsed ? " is-collapsed" : ""}`}
    inert={closing || collapsed} aria-hidden={closing || collapsed || undefined} aria-label={tr("工作面板", "Workbench")}
    onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === "margin-right") finishExit(); }}>
    <SidebarResizeHandle target="workbench" resize={resize} contextOpen={contextOpen} leftOpen={leftOpen} />
    <div ref={canvasRef} className={`workbench-content workbench-canvas${layout.panes.length > 1 && !layout.maximized ? " is-split" : ""}`}>
      {workbenchPaneOrder(layout.root).map((paneId, index) => {
        const pane = layout.panes.find(p => p.id === paneId)!;
        const paneTabs = pane.tabs.map(id => tabs.find(t => t.id === id)).filter((t): t is WorkbenchTab => !!t);
        return <section key={paneId} className={`workbench-group${layout.focused === paneId ? " is-focused" : ""}`} data-workbench-pane={paneId} data-top-row={paneRect(paneId).y < 1}
          hidden={!!layout.maximized && layout.maximized !== paneId} style={rectStyle(paneRect(paneId))} aria-label={trf("窗口 {0}", "Pane {0}", index + 1)}>
          <WorkbenchTabStrip splitEnabled={splitEnabled} tabs={paneTabs} draggingId={drag && !drag.placing ? drag.key : null} selected={pane.selected} split={layout.panes.length > 1} maximized={layout.maximized === paneId}
            tabButtonId={tabButtonId} tabPanelId={tabPanelId} renderLabel={tab => <><TabIcon tab={tab} />{tab.kind === "browser" ? <BrowserTabLabel controller={tab.controller} /> : <span className="workbench-tab-label">{tab.label}</span>}</>}
            onActivate={activateTab} onClose={closeTab} onNewTab={() => { focusPane(paneId); props.onNewTab(); }} onCollapse={index === 0 ? props.onCollapse : undefined}
            onMaximize={() => mutate(current => ({ ...current, focused: paneId, maximized: current.maximized === paneId ? null : paneId }))}
            onMerge={() => { const next = mergeWorkbenchPane(layoutRef.current, paneId); mutate(() => next); const tab = tabs.find(t => t.id === next.panes.find(p => p.id === next.focused)?.selected); if (tab) props.onActivateTab(tab); }}
            onEqualize={() => mutate(current => geometry.dividers.reduce((result, divider) => resizeWorkbenchDivider(result, divider.id, 0.5, dividerBounds(divider)), current))}
            onPlace={() => { mutate(current => ({ ...current, maximized: null, focused: paneId })); setDrag({ key: pane.selected, placing: true }); setAnnouncement(tr("选择落点，Esc 取消", "Choose a drop location; Esc to cancel")); }}
            onSplit={(tab, edge) => commitDrop(tab.id, paneId, edge)}
            onTabPointerDown={startTabPointerDrag} />
        </section>;
      })}
      {/* 所有内容都是同一父节点下的稳定 key；拖动只改矩形，绝不跨父节点重新挂载。 */}
      {tabs.map(tab => {
        const owner = ownerOf(tab.id); if (!owner) return null;
        const r = paneRect(owner.id), visible = owner.selected === tab.id && (!layout.maximized || layout.maximized === owner.id);
        return <WorkbenchTabPanel key={tab.id} id={tabPanelId(tab)} role="tabpanel" aria-labelledby={tabButtonId(tab)} hidden={!visible}
          data-workbench-content-pane={owner.id} style={rectStyle({ ...r, y: r.y + headerHeight, height: Math.max(0, r.height - headerHeight) })}
          onPointerDownCapture={() => focusPane(owner.id)} onFocusCapture={() => focusPane(owner.id)}>{renderTab(tab, visible && !closing)}</WorkbenchTabPanel>;
      })}
      {!layout.maximized && geometry.dividers.map(divider => <div key={divider.id} className={`workbench-split-handle axis-${divider.axis}`} role="separator" tabIndex={0}
        aria-label={divider.axis === "x" ? tr("调整左右窗口比例", "Resize panes horizontally") : tr("调整上下窗口比例", "Resize panes vertically")}
        aria-orientation={divider.axis === "x" ? "vertical" : "horizontal"} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(divider.ratio * 100)}
        style={rectStyle(divider)} onPointerDown={event => resizeDivider(event, divider)} onDoubleClick={() => mutate(current => resizeWorkbenchDivider(current, divider.id, 0.5, dividerBounds(divider)))}
        onKeyDown={event => { const keys = divider.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
          if (keys.includes(event.key) || event.key === "Home") { event.preventDefault(); mutate(current => resizeWorkbenchDivider(current, divider.id, event.key === "Home" ? 0.5 : divider.ratio + (event.key === keys[0] ? -0.02 : 0.02), dividerBounds(divider))); } }} />)}
    </div>
    <span className="workbench-sr-status" role="status">{announcement}</span>
    {terminalPromptVisible && terminalClosePrompt && createPortal(<TerminalCloseDialog
      onCancel={() => setTerminalClosePrompt(null)} onConfirm={() => {
        setTerminalClosePrompt(null);
        if (closeContext.current?.scope === terminalClosePrompt.scope) closeContext.current.close(terminalClosePrompt.tab);
      }} />, document.body)}
    {drag && canvasBounds && !collapsed && createPortal(<div className="workbench-drag-surface" data-placing={drag.placing || undefined}
      style={{ left: canvasBounds.left, top: canvasBounds.top, width: canvasBounds.width, height: canvasBounds.height }}
      onPointerMove={event => { if (drag.placing) updateDrop(event.clientX, event.clientY); }} onPointerLeave={() => setDrop(null)}
      onClick={event => { if (!drag.placing) return; const target = updateDrop(event.clientX, event.clientY); if (target) commitDrop(drag.key, target.pane, target.edge, target.index); }}>
      {drop?.marker && <div className="workbench-drop-marker" aria-hidden="true" style={rectStyle(drop.marker)} />}
      {drop && <div className="workbench-drop-preview" data-edge={drop.edge} aria-hidden="true" style={rectStyle({ x: drop.rect.x + 5, y: drop.rect.y + 5, width: Math.max(0, drop.rect.width - 10), height: Math.max(0, drop.rect.height - 10) })} />}
    </div>, document.body)}
  </aside>;
}
