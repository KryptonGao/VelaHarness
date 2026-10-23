import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type TransitionEvent } from "react";
import { useMotionPresence } from "../hooks/useMotionPresence";

const POPOVER_VIEWPORT_MARGIN = 8;

/**
 * 弹层相对锚点向上或向下展开,窗口放不下时把最大高度收缩到锚点与窗口边缘之间,
 * 内部列表自己滚动,不再被窗口边界截断。
 */
function fitPopoverToViewport(popover: HTMLElement): void {
  const anchor = popover.offsetParent;
  if (!(anchor instanceof HTMLElement)) return;
  const anchorRect = anchor.getBoundingClientRect();
  // 向上展开时弹层整体位于锚点上沿之上(offsetTop 为负),否则在下方。
  const opensUp = popover.offsetTop + popover.offsetHeight <= anchor.offsetHeight / 2;
  const gap = opensUp ? -(popover.offsetTop + popover.offsetHeight) : popover.offsetTop - anchor.offsetHeight;
  const room = opensUp
    ? anchorRect.top - gap - POPOVER_VIEWPORT_MARGIN
    : window.innerHeight - anchorRect.bottom - gap - POPOVER_VIEWPORT_MARGIN;
  const current = parseFloat(getComputedStyle(popover).maxHeight);
  popover.style.maxHeight = `${Math.max(120, Number.isFinite(current) ? Math.min(current, room) : room)}px`;
}

/** One lifetime for menus, including composite children and native top-layer popovers. */
export function PopoverPresence({ present, children }: { present: boolean; children: ReactNode }) {
  const presence = useMotionPresence(present, 110);
  const frozen = useRef(children);
  const root = useRef<HTMLDivElement>(null);
  if (present) frozen.current = children;
  useLayoutEffect(() => {
    if (!present || !presence.mounted) return;
    root.current?.querySelectorAll<HTMLElement>(":scope > .dock-popover").forEach(fitPopoverToViewport);
  }, [present, presence.mounted]);
  if (!presence.mounted) return null;

  return <div ref={root} className={`popover-presence${presence.closing ? " is-closing" : ""}`}
    inert={presence.closing} aria-hidden={presence.closing || undefined}
    onTransitionEnd={(event) => {
      if (event.propertyName === "opacity" && event.target instanceof HTMLElement &&
        event.target.matches(".dock-popover, .skill-menu, .context-usage-popover")) presence.finishExit();
    }}>
    {present ? children : frozen.current}
  </div>;
}

export function ScreenPresence({ present, children, className }: {
  present: boolean; children: ReactNode; className: string;
}) {
  const presence = useMotionPresence(present, 140);
  const frozen = useRef(children);
  if (present) frozen.current = children;
  if (!presence.mounted) return null;
  return <div className={`app-screen ${className}${presence.closing ? " is-closing" : ""}`}
    inert={presence.closing} aria-hidden={presence.closing || undefined}
    onTransitionEnd={(event) => {
      if (event.target === event.currentTarget && event.propertyName === "opacity") presence.finishExit();
    }}>
    {present ? children : frozen.current}
  </div>;
}

/** Keep inactive tab state mounted, but hide its box once the crossfade finishes. */
export function WorkbenchTabPanel({ hidden = false, swapKey, children, ...props }:
  HTMLAttributes<HTMLDivElement> & { swapKey?: string }) {
  const presence = useMotionPresence(!hidden, 120);
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef({ hidden, swapKey });
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { hidden, swapKey };
    // File tabs share one preview instance; animate its content without remounting the editor.
    if (hidden || old.hidden || old.swapKey === swapKey || presence.reducedMotion) return;
    const animation = ref.current?.animate([
      { opacity: 0, transform: "translateY(2px)" },
      { opacity: 1, transform: "none" },
    ], { duration: 120, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    return () => animation?.cancel();
  }, [hidden, swapKey, presence.reducedMotion]);
  function onTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && event.propertyName === "opacity") presence.finishExit();
  }
  return <div {...props} ref={ref} hidden={!presence.mounted}
    className={`workbench-tabpanel${hidden ? " is-inactive" : ""}`}
    inert={hidden} aria-hidden={hidden || undefined} onTransitionEnd={onTransitionEnd}>
    {children}
  </div>;
}
