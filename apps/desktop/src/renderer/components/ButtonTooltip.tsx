import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { findTooltipButton, parseTooltip, tooltipSource, type TooltipContent } from "../button-tooltip";

const SHOW_DELAY_MS = 1000;
const WARM_DELAY_MS = 500;
/** 提示显示过之后,这段时间内再悬停按钮只等 WARM_DELAY_MS。 */
const WARM_WINDOW_MS = 3000;
/** 提示显示时指针掠过按钮间的空隙,这段时间内不收起,方便直接切到下一个按钮。 */
const LEAVE_GRACE_MS = 400;
const GAP = 8;
const EDGE = 8;

interface Anchor extends TooltipContent {
  rect: DOMRect;
}

/**
 * 全局的按钮悬停提示:接管按钮的 title,用黑色小窗显示功能和快捷键。
 * 设置页、文件树、思考/工具折叠这类开关不弹(见 button-tooltip.ts)。
 */
export function ButtonTooltip() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let stashedTitle: string | null = null;
    let timer: number | undefined;
    let graceTimer: number | undefined;
    let visible = false;
    let lastShown = 0;

    const restoreTitle = () => {
      // React 若在悬停期间写回了新的 title,就不要用旧值覆盖。
      if (current && stashedTitle !== null && current.getAttribute("title") === null) current.setAttribute("title", stashedTitle);
      stashedTitle = null;
    };
    const hide = () => {
      window.clearTimeout(timer);
      window.clearTimeout(graceTimer);
      restoreTitle();
      current = null;
      visible = false;
      setAnchor(null);
      setPosition(null);
    };
    const show = (button: HTMLElement, source: string) => {
      // 已经显示时直接换内容和位置,不经过隐藏,避免闪一下。
      if (!visible) setPosition(null);
      visible = true;
      lastShown = Date.now();
      setAnchor({ ...parseTooltip(source), rect: button.getBoundingClientRect() });
    };
    const start = (button: HTMLElement, immediate = false) => {
      const source = tooltipSource(button);
      if (!source) return;
      restoreTitle();
      current = button;
      if (button.getAttribute("title") !== null) {
        stashedTitle = button.getAttribute("title");
        button.removeAttribute("title");
      }
      if (visible || immediate) { show(button, source); return; }
      const warm = Date.now() - lastShown < WARM_WINDOW_MS;
      timer = window.setTimeout(() => {
        if (current === button && button.isConnected) show(button, source);
      }, warm ? WARM_DELAY_MS : SHOW_DELAY_MS);
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const candidate = findTooltipButton(event.target instanceof Element ? (event.target as HTMLElement) : null);
      window.clearTimeout(graceTimer);
      if (candidate === current) return;
      // 带文字的按钮(tooltipSource 为空)和空白处一样处理。
      const button = candidate && tooltipSource(candidate) ? candidate : null;
      if (!button) {
        if (!visible) { window.clearTimeout(timer); restoreTitle(); current = null; return; }
        graceTimer = window.setTimeout(hide, LEAVE_GRACE_MS);
        return;
      }
      window.clearTimeout(timer);
      start(button);
    };
    // 指针穿过 Electron 拖拽区时页面收不到事件,relatedTarget 为空;和掠过空白一样走宽限期,不立刻收起。
    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget || !visible) return;
      window.clearTimeout(graceTimer);
      graceTimer = window.setTimeout(hide, LEAVE_GRACE_MS);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target?.matches(":focus-visible")) return;
      const button = findTooltipButton(target);
      if (!button || button === current) return;
      window.clearTimeout(timer);
      start(button, true);
    };
    const onDismiss = () => { if (current) hide(); };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onDismiss);
    document.addEventListener("pointerdown", onDismiss, true);
    document.addEventListener("keydown", onDismiss, true);
    document.addEventListener("scroll", onDismiss, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      hide();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onDismiss);
      document.removeEventListener("pointerdown", onDismiss, true);
      document.removeEventListener("keydown", onDismiss, true);
      document.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, []);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!anchor || !node) return;
    // 模态对话框在顶层,用 popover 才能盖在它上面。
    try { if (!node.matches(":popover-open")) node.showPopover(); } catch { /* 不支持 popover 时退回普通定位 */ }
    const { width, height } = node.getBoundingClientRect();
    const { rect } = anchor;
    const left = Math.max(EDGE, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - EDGE));
    const below = rect.bottom + GAP;
    const top = below + height > window.innerHeight - EDGE ? Math.max(EDGE, rect.top - GAP - height) : below;
    setPosition({ left, top });
  }, [anchor]);

  if (!anchor) return null;
  return (
    <div
      ref={ref}
      className="button-tooltip"
      popover="manual"
      role="tooltip"
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
    >
      <span className="button-tooltip-label">{anchor.label}</span>
      {anchor.keys.length ? (
        <span className="button-tooltip-keys">
          {anchor.keys.map((key, index) => <kbd key={`${key}${index}`}>{key}</kbd>)}
        </span>
      ) : null}
    </div>
  );
}
