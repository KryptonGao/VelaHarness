import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { tr } from "../locale";
import { dismissToast, finishToastExit, getToasts, subscribeToasts, type Toast } from "../toast";
import { Icon } from "./icons";

function ToastRow({ item }: { item: Toast }) {
  const row = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(item.actions?.length || item.kind === "error" ? 8_000 : 4_500);
  useEffect(() => {
    if (item.closing || hovered || focused) return;
    const start = performance.now();
    const timer = window.setTimeout(() => dismissToast(item.id), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current -= performance.now() - start; };
  }, [item.id, item.closing, hovered, focused]);
  useLayoutEffect(() => {
    if (!item.closing) return;
    const fade = row.current?.getAnimations().find(animation => animation instanceof CSSTransition && animation.transitionProperty === "opacity");
    if (!fade) { finishToastExit(item.id); return; } // No transition under reduced motion.
    let mounted = true;
    const finish = () => { if (mounted) finishToastExit(item.id); };
    void fade.finished.then(finish, finish);
    return () => { mounted = false; };
  }, [item.id, item.closing]);
  return <div ref={row} className="window-toast" data-kind={item.kind ?? "info"} inert={item.closing} data-closing={item.closing || undefined}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
    <Icon name={item.icon ?? (item.kind === "error" ? "warning" : "info")} size={16} className="window-toast-icon" />
    <span className="window-toast-message" role={item.kind === "error" ? "alert" : "status"}>{item.message}</span>
    {item.actions?.map(action => <button key={action.label} type="button" className="window-toast-action" data-primary={action.primary || undefined}
      onClick={() => { if (dismissToast(item.id)) action.run(); }}>{action.label}</button>)}
    <button type="button" className="window-toast-close" aria-label={tr("关闭提醒", "Dismiss notification")} onClick={() => dismissToast(item.id)}><Icon name="close" size={12} /></button>
  </div>;
}

/** Mount only one host per window. Use the browser's top layer without opening a modal or stealing focus. */
export function ToastHost() {
  const items = useSyncExternalStore(subscribeToasts, getToasts);
  const host = useRef<HTMLDivElement>(null);
  const visible = items.length > 0;
  const [modal, setModal] = useState<HTMLDialogElement | null>(null);
  useLayoutEffect(() => {
    if (!visible) return;
    // A modal makes everything outside it inert, even other top-layer elements.
    const sync = () => setModal(Array.from(document.querySelectorAll<HTMLDialogElement>("dialog:modal")).at(-1) ?? null);
    sync();
    document.addEventListener("toggle", sync, true);
    // React may unmount a dialog before its queued close event bubbles to the document.
    modal?.addEventListener("close", sync);
    return () => { document.removeEventListener("toggle", sync, true); modal?.removeEventListener("close", sync); };
  }, [visible, modal]);
  useLayoutEffect(() => {
    if (visible) host.current?.showPopover();
  }, [visible, modal]);
  if (!visible) return null;
  return createPortal(<div ref={host} className="window-toast-stack" popover="manual" role="region" aria-label={tr("通知", "Notifications")}>
    {items.slice(0, 3).map(item => <ToastRow key={item.id} item={item} />)}
  </div>, modal?.isConnected ? modal : document.body);
}
