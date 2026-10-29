import { useEffect, type RefObject } from "react";

const visibleMs = 1000;

/** 滚动时给容器加 is-scrolling,停止约 1 秒后移除;配合 .autohide-scrollbar 让滚动条只在滚动时显现。 */
export function useAutoHideScrollbar(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    let hideTimer: number | undefined;
    const show = () => {
      scroller.classList.add("is-scrolling");
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => scroller.classList.remove("is-scrolling"), visibleMs);
    };
    scroller.addEventListener("scroll", show, { passive: true });
    return () => {
      window.clearTimeout(hideTimer);
      scroller.classList.remove("is-scrolling");
      scroller.removeEventListener("scroll", show);
    };
  }, [ref]);
}

/**
 * 容器内任意带 .autohide-scrollbar 的滚动区域都适用：滚动时加 is-scrolling，停止约 1 秒后移除。
 * scroll 事件不冒泡，所以在根节点用捕获阶段监听；区域是动态出现的（切换视图、选中详情）也不用逐个绑定。
 */
export function useAutoHideScrollbarsWithin(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const timers = new Map<HTMLElement, number>();
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains("autohide-scrollbar")) return;
      target.classList.add("is-scrolling");
      window.clearTimeout(timers.get(target));
      timers.set(target, window.setTimeout(() => { target.classList.remove("is-scrolling"); timers.delete(target); }, visibleMs));
    };
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll, { capture: true });
      for (const [target, timer] of timers) { window.clearTimeout(timer); target.classList.remove("is-scrolling"); }
    };
  }, [ref]);
}
