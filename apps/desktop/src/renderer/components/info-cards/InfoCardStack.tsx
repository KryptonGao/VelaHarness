import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
} from "react";
import { writtenFiles } from "./info-cards-data";
import { useStoredState } from "../../hooks/useStoredState";
import { tr, trf } from "../../locale";
import { useAgentWorkspace } from "../AgentPanel";
import { ChevronDownIcon, PlusIcon } from "../icons";
import { infoCardDefinitions, type InfoCardContext } from "./InfoCardContents";
import {
  defaultLayout, dropIndexAtTop, hiddenCards, hideCard, isStoredInfoCardLayout, placeAt, renderedCards,
  reorderRendered, sanitizeLayout, showCard, stepRendered, toggleCollapsed,
  type InfoCardId, type InfoCardLayout,
} from "./info-cards-layout";

export type InfoCardStackProps = Omit<InfoCardContext, "outputs" | "agents" | "onOpenAgent"> & {
  /** 打开一个文件预览；没有预览上下文时由调用方回退到系统打开。 */
  onOpenFile: (path: string) => void;
};

interface DragState {
  id: InfoCardId;
  pointerId: number;
  grip: HTMLElement;
  startY: number;
  lastY: number;
  /** 按下时指针距离卡片顶端的偏移。 */
  grab: number;
  /** 卡片之间的纵向间距，按下时量一次，拖动期间不再变。 */
  gap: number;
  active: boolean;
  raf: number;
}

const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 列表里卡片之间的纵向间距（来自 flex gap）。 */
function cardGap(list: HTMLElement | null): number {
  if (!list) return 0;
  const rowGap = Number.parseFloat(getComputedStyle(list).rowGap);
  return Number.isFinite(rowGap) ? rowGap : 0;
}

function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[7, 12, 17].flatMap((x) => [9, 15].map((y) => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.7" />))}
    </svg>
  );
}

function HideIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

/** 卡片模式的右侧信息卡片：浮在对话上，可拖动排序、折叠、隐藏。 */
export function InfoCardStack(props: InfoCardStackProps) {
  const { agents: roster, openAgent } = useAgentWorkspace();
  const [stored, setStored] = useStoredState("vela.infoCards", defaultLayout(), isStoredInfoCardLayout);
  const layout = useMemo(() => sanitizeLayout(stored), [stored]);
  const update = useCallback((change: (layout: InfoCardLayout) => InfoCardLayout) => {
    setStored((current) => change(sanitizeLayout(current)));
  }, [setStored]);

  const cwd = props.state?.session.cwd;
  const outputs = useMemo(() => writtenFiles(props.messages, cwd), [props.messages, cwd]);
  const ctx = useMemo<InfoCardContext>(() => ({
    state: props.state, project: props.project, messages: props.messages, outputs, planDraft: props.planDraft,
    agents: roster, changesActive: props.changesActive, onOpenChanges: props.onOpenChanges,
    onOpenPlan: props.onOpenPlan, onResumeGoal: props.onResumeGoal, onOpenAgent: openAgent, onOpenFile: props.onOpenFile,
  }), [props.state, props.project, props.messages, outputs, props.planDraft, roster, props.changesActive,
    props.onOpenChanges, props.onOpenPlan, props.onResumeGoal, openAgent, props.onOpenFile]);

  const available = useMemo(
    () => new Set((Object.keys(infoCardDefinitions) as InfoCardId[]).filter((id) => infoCardDefinitions[id].available(ctx))),
    [ctx],
  );
  const rendered = useMemo(() => renderedCards(layout, available), [layout, available]);
  const hidden = useMemo(() => hiddenCards(layout, available), [layout, available]);

  // 拖动时先在本地排好顺序，松手才写回布局。
  const [dragOrder, setDragOrder] = useState<InfoCardId[] | null>(null);
  const [draggingId, setDraggingId] = useState<InfoCardId | null>(null);
  const [liftedId, setLiftedId] = useState<InfoCardId | null>(null);
  const [enteringId, setEnteringId] = useState<InfoCardId | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const shown = dragOrder ?? rendered;

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<InfoCardId, HTMLElement>());
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const drag = useRef<DragState | null>(null);
  const flipFrom = useRef<Map<InfoCardId, number> | null>(null);
  const settle = useRef<HTMLElement | null>(null);
  const liftedSnapshot = useRef<InfoCardLayout | null>(null);
  const uid = useId();

  const announce = useCallback((message: string) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  /** 在顺序即将变化前记下每张卡片的位置，渲染后据此做 FLIP 动画。 */
  const captureTops = useCallback(() => {
    flipFrom.current = new Map(shownRef.current.flatMap((id) => {
      const el = cardRefs.current.get(id);
      return el ? [[id, el.getBoundingClientRect().top] as const] : [];
    }));
  }, []);

  const position = useCallback(() => {
    const state = drag.current;
    const list = listRef.current;
    const el = state ? cardRefs.current.get(state.id) : undefined;
    if (!state?.active || !list || !el) return;
    const desired = state.lastY - state.grab - list.getBoundingClientRect().top;
    const others = shownRef.current.filter((id) => id !== state.id);
    // 落点按“被拖卡片让位后”的分界算：只看其他卡片的高度，卡片互换位置时分界不动，
    // 高卡片也不会因为自己的半高而必须拖到面板外面才能排到最上面。
    const heights = others.map((id) => cardRefs.current.get(id)?.offsetHeight ?? 0);
    const next = placeAt(others, state.id, dropIndexAtTop(desired, heights, state.gap));
    if (next.join() !== shownRef.current.join()) {
      captureTops();
      setDragOrder(next);
    }
    el.style.transform = `translateY(${desired - el.offsetTop}px) scale(1.012)`;
  }, [captureTops]);

  const orderKey = shown.join();
  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    if (from && !prefersReducedMotion()) {
      for (const id of shownRef.current) {
        const el = cardRefs.current.get(id);
        const before = from.get(id);
        if (!el || before === undefined || id === drag.current?.id) continue;
        const delta = before - el.getBoundingClientRect().top;
        if (!delta) continue;
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        el.getBoundingClientRect();
        el.style.transition = "";
        el.style.transform = "";
      }
    }
    position();
    // 键盘移动后，React 搬动节点可能让把手失焦。
    if (liftedId) {
      const el = cardRefs.current.get(liftedId);
      el?.querySelector<HTMLElement>("[data-grip]")?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }, [orderKey, position]); // eslint-disable-line react-hooks/exhaustive-deps

  // 松手后卡片从跟手的位置滑回自己的槽位；类名先于 transform 清除，过渡才会生效。
  useLayoutEffect(() => {
    if (draggingId !== null || !settle.current) return;
    settle.current.style.transform = "";
    settle.current = null;
  }, [draggingId]);

  useEffect(() => {
    if (enteringId === null) return;
    const timer = window.setTimeout(() => setEnteringId(null), 420);
    return () => window.clearTimeout(timer);
  }, [enteringId]);

  useEffect(() => { if (hidden.length === 0) setTrayOpen(false); }, [hidden.length]);

  // 拖动中途卸载（切换对话或布局）时收尾，避免遗留抓取状态。
  useEffect(() => () => {
    const state = drag.current;
    if (state) cancelAnimationFrame(state.raf);
    document.body.classList.remove("info-card-dragging");
  }, []);

  /* ---------- 指针拖动（仅右上角把手） ---------- */
  const beginDrag = (state: DragState) => {
    state.active = true;
    setDraggingId(state.id);
    setDragOrder(renderedRef.current);
    document.body.classList.add("info-card-dragging");
    const tick = () => {
      const current = drag.current;
      const root = rootRef.current;
      if (!current?.active || !root) return;
      const box = root.getBoundingClientRect();
      const edge = 48;
      let delta = 0;
      if (current.lastY < box.top + edge) delta = -Math.ceil((box.top + edge - current.lastY) / 4);
      else if (current.lastY > box.bottom - edge) delta = Math.ceil((current.lastY - (box.bottom - edge)) / 4);
      if (delta) { root.scrollTop += delta; position(); }
      current.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const grip = (event.target as Element).closest<HTMLElement>("[data-grip]");
    const id = grip?.dataset.grip as InfoCardId | undefined;
    const el = id ? cardRefs.current.get(id) : undefined;
    if (!grip || !id || !el) return;
    drag.current = {
      id, pointerId: event.pointerId, grip, startY: event.clientY, lastY: event.clientY,
      grab: event.clientY - el.getBoundingClientRect().top, gap: cardGap(listRef.current), active: false, raf: 0,
    };
    grip.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    state.lastY = event.clientY;
    if (!state.active) {
      if (Math.abs(event.clientY - state.startY) < 4) return;
      beginDrag(state);
    }
    position();
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    cancelAnimationFrame(state.raf);
    try { state.grip.releasePointerCapture(state.pointerId); } catch { /* 捕获可能已随元素卸载释放 */ }
    drag.current = null;
    if (!state.active) return;
    document.body.classList.remove("info-card-dragging");
    const final = shownRef.current;
    const before = renderedRef.current;
    settle.current = cardRefs.current.get(state.id) ?? null;
    update((current) => reorderRendered(current, before, final));
    setDragOrder(null);
    setDraggingId(null);
    announce(trf("{0} 已移到第 {1} 位", "{0} moved to position {1}", infoCardDefinitions[state.id].title(), final.indexOf(state.id) + 1));
  };

  /* ---------- 键盘排序 ---------- */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const grip = (event.target as Element).closest<HTMLElement>("[data-grip]");
    const id = grip?.dataset.grip as InfoCardId | undefined;
    if (!grip || !id) return;
    const name = infoCardDefinitions[id].title();
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (liftedId === null) {
        liftedSnapshot.current = layout;
        setLiftedId(id);
        announce(trf("已拿起 {0}。上下方向键移动，空格放下，Esc 取消。", "Picked up {0}. Use the up and down arrows to move, Space to drop, Escape to cancel.", name));
      } else {
        setLiftedId(null);
        liftedSnapshot.current = null;
        announce(trf("{0} 已放在第 {1} 位", "{0} dropped at position {1}", name, rendered.indexOf(id) + 1));
      }
    } else if (liftedId === id && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const next = stepRendered(rendered, id, event.key === "ArrowUp" ? -1 : 1);
      if (!next) return;
      captureTops();
      update((current) => reorderRendered(current, rendered, next));
      announce(trf("{0}，第 {1} 位，共 {2} 个", "{0}, position {1} of {2}", name, next.indexOf(id) + 1, next.length));
    } else if (liftedId === id && event.key === "Escape") {
      event.preventDefault();
      const snapshot = liftedSnapshot.current;
      setLiftedId(null);
      liftedSnapshot.current = null;
      if (snapshot) { captureTops(); setStored(snapshot); }
      announce(tr("已取消", "Cancelled"));
    }
  };

  /* ---------- 折叠 / 隐藏 / 找回 ---------- */
  const hide = (id: InfoCardId) => {
    captureTops();
    update((current) => hideCard(current, id));
    announce(trf("已隐藏 {0}", "Hid {0}", infoCardDefinitions[id].title()));
  };
  const restore = (id: InfoCardId) => {
    captureTops();
    update((current) => showCard(current, id));
    setEnteringId(id);
    announce(trf("已显示 {0}", "Showed {0}", infoCardDefinitions[id].title()));
  };
  const reset = () => {
    captureTops();
    setStored(defaultLayout());
    setTrayOpen(false);
    announce(tr("已恢复默认布局", "Restored the default layout"));
  };

  // 卡片栈只在横向压到输入框时才让出输入框的高度，够宽时整列高度都归卡片。
  // 栈可能晚于对话区才出现（数据到了才有卡片），所以在栈自己挂载时量，而不是由 ChatView 代量。
  const present = shown.length > 0 || hidden.length > 0;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const pane = root?.parentElement;
    if (!root || !pane) return;
    let frame = 0;
    const measure = () => {
      const composer = pane.querySelector<HTMLElement>(".floating-input-card");
      const overlaps = Boolean(composer) && composer!.getBoundingClientRect().right > root.getBoundingClientRect().left;
      root.style.setProperty("--info-stack-clearance", overlaps ? "var(--composer-clearance)" : "0px");
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    // 对话区尺寸变化后 ChatView 才会更新对话列的位移，所以晚一帧再量。
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    const composer = pane.querySelector<HTMLElement>(".floating-input-card");
    if (composer) observer.observe(composer);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [present]);

  if (!present) return null;

  return (
    <div className={`info-card-stack${shown.length === 0 ? " is-empty" : ""}`} ref={rootRef} role="region" aria-label={tr("信息卡片", "Info cards")}>
      <div className="info-card-list" ref={listRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onKeyDown={onKeyDown}>
        {shown.map((id) => {
          const definition = infoCardDefinitions[id];
          const collapsed = layout.collapsed.includes(id);
          const title = definition.title();
          const Icon = definition.Icon;
          const Body = definition.Body;
          const bodyId = `${uid}-${id}`;
          return (
            <section key={id} className="info-card" data-id={id}
              data-collapsed={collapsed || undefined} data-dragging={draggingId === id || undefined}
              data-lifted={liftedId === id || undefined} data-entering={enteringId === id || undefined}
              ref={(el) => { if (el) cardRefs.current.set(id, el); else cardRefs.current.delete(id); }}>
              <header className="info-card-head">
                <span className="info-card-ico" aria-hidden="true"><Icon size={15} /></span>
                <button type="button" className="info-card-title" aria-expanded={!collapsed} aria-controls={bodyId}
                  onClick={() => update((current) => toggleCollapsed(current, id))}>
                  <span>{title}</span>
                  <span className="info-card-chevron" aria-hidden="true"><ChevronDownIcon size={13} /></span>
                </button>
                <span className="info-card-meta">{definition.summary(ctx)}</span>
                <span className="info-card-tools">
                  <button type="button" className="info-card-icon-btn" title={tr("隐藏", "Hide")}
                    aria-label={`${tr("隐藏", "Hide")}: ${title}`} onClick={() => hide(id)}><HideIcon /></button>
                  <button type="button" className="info-card-icon-btn info-card-grip" data-grip={id}
                    title={tr("拖动排序", "Drag to reorder")} aria-pressed={liftedId === id}
                    aria-label={`${tr("拖动排序", "Drag to reorder")}: ${title}`}><GripIcon /></button>
                </span>
              </header>
              <div className="info-card-body" id={bodyId} inert={collapsed ? true : undefined}>
                <div className="info-card-inner"><div className="info-card-content"><Body ctx={ctx} /></div></div>
              </div>
            </section>
          );
        })}
      </div>
      {hidden.length > 0 ? (
        <>
          <button type="button" className="info-card-add" aria-expanded={trayOpen} onClick={() => setTrayOpen((open) => !open)}>
            <PlusIcon size={12} />
            <span>{tr("添加卡片", "Add card")} · {hidden.length}</span>
          </button>
          {trayOpen ? (
            <div className="info-card-tray">
              <div className="info-card-tray-title">{tr("已隐藏的卡片", "Hidden cards")}</div>
              <div className="info-card-tray-list">
                {hidden.map((id) => (
                  <button key={id} type="button" className="info-card-tray-chip" onClick={() => restore(id)}>
                    <PlusIcon size={11} />{infoCardDefinitions[id].title()}
                  </button>
                ))}
              </div>
              <button type="button" className="info-card-reset" onClick={reset}>{tr("恢复默认布局", "Restore default layout")}</button>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}
