import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tr, trf } from "../locale";
import type { WorkbenchTab } from "./WorkbenchPanel";
import type { WorkbenchDropEdge } from "./workbench-layout";
import { ArrowRightIcon, CloseIcon, MoreIcon, PlusIcon } from "./icons";

export function WorkbenchTabStrip({ tabs, splitEnabled, draggingId, selected, split, maximized, renderLabel, tabButtonId, tabPanelId,
  onActivate, onClose, onNewTab, onCollapse, onMerge, onMaximize, onPlace, onEqualize, onSplit, onTabPointerDown,
}: {
  tabs: WorkbenchTab[]; splitEnabled: boolean; draggingId: string | null; selected: string; split: boolean; maximized: boolean;
  renderLabel: (tab: WorkbenchTab) => ReactNode; tabButtonId: (tab: WorkbenchTab) => string; tabPanelId: (tab: WorkbenchTab) => string;
  onActivate: (tab: WorkbenchTab) => void; onClose: (tab: WorkbenchTab) => void; onNewTab: () => void; onCollapse?: () => void;
  onMerge: () => void; onMaximize: () => void; onPlace: () => void; onEqualize: () => void;
  onSplit: (tab: WorkbenchTab, edge: WorkbenchDropEdge) => void;
  onTabPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, tab: WorkbenchTab) => void;
}) {
  const listRef = useRef<HTMLElement>(null), barRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const hovered = useRef(false), previousCount = useRef(tabs.length);
  const [tabWidth, setTabWidth] = useState(0), [pinned, setPinned] = useState<number | null>(null);
  const [positions, setPositions] = useState<Record<string, { left: number; top: number; clipped: boolean }>>({});
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const menuId = useId(), menuRef = useRef<HTMLDivElement>(null), menuButton = useRef<HTMLButtonElement>(null);
  const measure = useCallback((count: number, pin: number | null) => {
    if (pin !== null) return pin;
    const list = listRef.current;
    if (!list || !count) return 0;
    // 向下取整:窗格宽度常是小数像素,四舍五入会让最后一个标签多出零点几像素、被误判为裁切。
    return Math.max(72, Math.min(220, Math.floor((list.getBoundingClientRect().width - (parseFloat(getComputedStyle(list).columnGap) || 0) * (count - 1)) / count)));
  }, []);
  useLayoutEffect(() => { setTabWidth(measure(tabs.length, pinned)); }, [tabs.length, pinned, measure]);
  useEffect(() => {
    const before = previousCount.current; previousCount.current = tabs.length;
    if (hovered.current && tabs.length > before) setPinned(measure(tabs.length, null));
  }, [tabs.length, measure]);
  useLayoutEffect(() => {
    const list = listRef.current, bar = barRef.current;
    if (!list || !bar) return;
    const reveal = () => {
      const button = buttons.current.get(selected); if (!button) return;
      const a = list.getBoundingClientRect(), b = button.getBoundingClientRect();
      if (b.left < a.left) list.scrollLeft -= a.left - b.left;
      else if (b.right > a.right) list.scrollLeft += b.right - a.right;
    };
    const update = () => {
      const a = list.getBoundingClientRect(), b = bar.getBoundingClientRect();
      const next: typeof positions = {};
      for (const tab of tabs) {
        const rect = buttons.current.get(tab.id)?.getBoundingClientRect(); if (!rect) continue;
        const left = Math.max(rect.left, a.left), right = Math.min(rect.right, a.right);
        if (right - left < 24) continue;
        next[tab.id] = { left: right - b.left - 24, top: rect.top - b.top + (rect.height - 24) / 2, clipped: rect.right > a.right + 1 };
      }
      setPositions(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    reveal(); update();
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const max = list.scrollWidth - list.clientWidth;
      if (max <= 0) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const next = Math.max(0, Math.min(max, list.scrollLeft + delta));
      if (next === list.scrollLeft) return;
      event.preventDefault(); list.scrollLeft = next;
    };
    list.addEventListener("scroll", schedule, { passive: true }); list.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(() => { reveal(); schedule(); setTabWidth(measure(tabs.length, pinned)); });
    observer.observe(list); observer.observe(bar); buttons.current.forEach(b => observer.observe(b));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); list.removeEventListener("scroll", schedule); list.removeEventListener("wheel", onWheel); };
  }, [tabs, selected, pinned, measure]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !menuButton.current?.contains(event.target as Node)) setMenu(null);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setMenu(null); menuButton.current?.focus(); } };
    const resize = () => setMenu(null);
    // 菜单固定在按钮旁:标签栏自动滚动到选中标签、菜单自身滚动都不会让它错位,不应把它关掉。
    const scroll = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (listRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key, true);
    window.addEventListener("resize", resize); window.addEventListener("scroll", scroll, true);
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key, true); window.removeEventListener("resize", resize); window.removeEventListener("scroll", scroll, true); };
  }, [menu]);
  const activate = (tab: WorkbenchTab) => { onActivate(tab); requestAnimationFrame(() => buttons.current.get(tab.id)?.focus()); };
  return <div className="workbench-tabbar" ref={barRef}
    onPointerEnter={event => { if (event.pointerType !== "touch") { hovered.current = true; setPinned(current => current ?? tabWidth); } }}
    onPointerLeave={() => { hovered.current = false; setPinned(null); }}>
    <nav className="workbench-tablist" role="tablist" ref={listRef} aria-label={tr("工作面板标签", "Workbench tabs")}>
      {tabs.map(tab => <button key={tab.id} ref={node => { if (node) buttons.current.set(tab.id, node); else buttons.current.delete(tab.id); }}
        id={tabButtonId(tab)} className="workbench-tab" type="button" role="tab" draggable={false} data-dragging={tab.id === draggingId || undefined}
        aria-selected={tab.id === selected} aria-controls={tabPanelId(tab)} tabIndex={tab.id === selected ? 0 : -1}
        title={tab.title ?? tab.label} style={tabWidth ? { width: tabWidth } : undefined}
        onClick={() => onActivate(tab)} onPointerDown={event => onTabPointerDown(event, tab)} onDragStart={event => event.preventDefault()}
        onKeyDown={event => {
          const edges: Record<string, WorkbenchDropEdge> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };
          if (splitEnabled && event.altKey && event.shiftKey && edges[event.key]) { event.preventDefault(); onSplit(tab, edges[event.key]); return; }
          const index = tabs.findIndex(t => t.id === tab.id);
          const target = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length]
            : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : undefined;
          if (target) { event.preventDefault(); activate(target); }
        }}>{renderLabel(tab)}</button>)}
    </nav>
    <div className="workbench-tab-close-layer">{tabs.map(tab => {
      const p = positions[tab.id]; if (!p) return null;
      return <button key={tab.id} type="button" className={`workbench-tab-close${p.clipped ? " is-clipped" : ""}`}
        style={{ left: p.left, top: p.top }} aria-label={trf("关闭 {0}", "Close {0}", tab.label)} title={tr("关闭标签", "Close tab")}
        onClick={() => onClose(tab)}><CloseIcon size={12} /></button>;
    })}</div>
    <button className="workbench-new-tab" type="button" aria-label={tr("新建标签页", "New tab")} title={tr("新建标签页", "New tab")} onClick={onNewTab}><PlusIcon size={14} /></button>
    {split && <button className="workbench-group-action is-secondary" type="button" aria-label={maximized ? tr("还原窗口", "Restore pane") : tr("放大窗口", "Maximize pane")}
      title={maximized ? tr("还原窗口", "Restore pane") : tr("放大窗口", "Maximize pane")} aria-pressed={maximized} onClick={onMaximize}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d={maximized ? "M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5" : "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"} />
      </svg></button>}
    {splitEnabled && <button ref={menuButton} className="workbench-group-action" type="button" aria-label={tr("窗口操作", "Pane actions")} title={tr("窗口操作", "Pane actions")}
      aria-haspopup="menu" aria-expanded={!!menu} aria-controls={menu ? menuId : undefined} onClick={event => {
        if (menu) { setMenu(null); return; }
        const r = event.currentTarget.getBoundingClientRect();
        setMenu({ left: Math.max(8, Math.min(innerWidth - 228, r.right - 220)), top: Math.max(8, Math.min(innerHeight - 190, r.bottom + 5)) });
      }}><MoreIcon size={13} /></button>}
    {split && <button className="workbench-group-action is-secondary" type="button" aria-label={tr("关闭窗口，保留标签", "Close pane and keep tabs")}
      title={tr("关闭窗口，保留标签", "Close pane and keep tabs")} onClick={onMerge}><CloseIcon size={12} /></button>}
    {onCollapse && <button className="workbench-collapse" type="button" aria-expanded="true" aria-label={tr("折叠工作面板", "Collapse workbench")}
      title={tr("折叠工作面板", "Collapse workbench")} onClick={onCollapse}><ArrowRightIcon size={14} /></button>}
    {splitEnabled && menu && createPortal(<div ref={menuRef} id={menuId} className="workbench-pane-menu" role="menu" style={menu}>
      <button type="button" role="menuitem" onClick={() => { setMenu(null); onPlace(); }}>{tr("移动当前标签", "Move current tab")}</button>
      {split && <><button type="button" role="menuitem" onClick={() => { setMenu(null); onMaximize(); }}>{maximized ? tr("还原窗口", "Restore pane") : tr("放大窗口", "Maximize pane")}</button>
        <button type="button" role="menuitem" onClick={() => { setMenu(null); onEqualize(); }}>{tr("均分窗口尺寸", "Equalize pane sizes")}</button>
        <button type="button" role="menuitem" onClick={() => { setMenu(null); onMerge(); }}>{tr("关闭窗口，保留标签", "Close pane and keep tabs")}</button></>}
    </div>, document.body)}
  </div>;
}
