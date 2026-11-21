import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

type ResizeBounds = {
  height: number;
  max: number;
  bottom: number;
};

function resizeBounds(chat: HTMLElement): ResizeBounds {
  const rect = chat.getBoundingClientRect();
  const stage = chat.offsetParent as HTMLElement;
  const bounds = stage.getBoundingClientRect();
  const scroll = chat.querySelector<HTMLElement>(".chat-scroll-area")!;
  const height = scroll.getBoundingClientRect().height;
  const header = parseFloat(getComputedStyle(chat).getPropertyValue("--header-height"));
  return { height, max: Math.max(0, height + rect.top - bounds.top - header - 12), bottom: bounds.bottom - rect.bottom };
}

function updateResizeRange(chat: HTMLElement, handle: HTMLElement) {
  const bounds = resizeBounds(chat);
  const chromeHeight = chat.offsetHeight - bounds.height;
  handle.setAttribute("aria-valuemin", String(Math.round(chromeHeight)));
  handle.setAttribute("aria-valuemax", String(Math.round(chromeHeight + bounds.max)));
  handle.setAttribute("aria-valuenow", String(chat.offsetHeight));
}

export function useFloatingChatDrag(visible: boolean, streaming: boolean, setExpanded: (expanded: boolean) => void) {
  const chatRef = useRef<HTMLElement>(null);
  const resizeHandle = useRef<HTMLDivElement>(null);
  const stopGesture = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const chat = chatRef.current;
    if (!visible || !chat) return;
    // The transcript and input can both grow while the chat is parked near the top.
    const updateHeight = () => {
      if (!chat.offsetParent) return;
      chat.style.setProperty("--float-height", `${chat.offsetHeight}px`);
      if (resizeHandle.current) updateResizeRange(chat, resizeHandle.current);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(chat, { box: "border-box" });
    if (chat.offsetParent) observer.observe(chat.offsetParent);
    return () => {
      observer.disconnect();
      stopGesture.current?.();
    };
  }, [visible]);

  function trackPointer(event: ReactPointerEvent<HTMLElement>, move: (event: PointerEvent) => void) {
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const chat = chatRef.current!;
    function onMove(e: PointerEvent) { if (e.pointerId === pointerId) move(e); }
    function onEnd(e: PointerEvent) { if (e.pointerId === pointerId) stop(); }
    function stop() {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      window.removeEventListener("blur", stop);
      handle.removeEventListener("lostpointercapture", onEnd);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      delete chat.dataset.floatResizing;
      stopGesture.current = null;
    }
    handle.setPointerCapture(pointerId);
    stopGesture.current = stop;
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onEnd, true);
    window.addEventListener("pointercancel", onEnd, true);
    window.addEventListener("blur", stop);
    handle.addEventListener("lostpointercapture", onEnd);
  }

  function startMove(event: ReactPointerEvent<HTMLElement>) {
    if (!event.isPrimary || event.button !== 0 || stopGesture.current || (event.target as Element).closest("button")) return;
    const chat = chatRef.current!;
    const stage = chat.offsetParent!;
    const rect = chat.getBoundingClientRect();
    const x = rect.right - event.clientX, y = rect.bottom - event.clientY;
    trackPointer(event, e => {
      const bounds = stage.getBoundingClientRect();
      chat.style.setProperty("--float-right", `${bounds.right - e.clientX - x}px`);
      chat.style.setProperty("--float-bottom", `${bounds.bottom - e.clientY - y}px`);
    });
  }

  function applyResize(bounds: ResizeBounds, delta: number) {
    const chat = chatRef.current!;
    const height = Math.min(bounds.max, Math.max(streaming ? 32 : 0, bounds.height + delta));
    // Moving a docked float can leave its preferred bottom beyond the workspace.
    // Anchor this gesture to the actual bottom so resizing never moves the dock.
    chat.style.setProperty("--float-bottom", `${bounds.bottom}px`);
    if (height > 0) chat.style.setProperty("--float-transcript-height", `${height}px`);
    setExpanded(height > 0);
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || stopGesture.current) return;
    const chat = chatRef.current!;
    const bounds = resizeBounds(chat);
    const startY = event.clientY;
    trackPointer(event, e => {
      const delta = startY - e.clientY;
      if (!delta && !chat.hasAttribute("data-float-resizing")) return;
      chat.dataset.floatResizing = "";
      applyResize(bounds, delta);
    });
  }

  function resizeByKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.shiftKey ? 96 : 32;
    applyResize(resizeBounds(chatRef.current!), event.key === "ArrowUp" ? step : -step);
  }

  return {
    chatRef, resizeHandle,
    resizeEvents: {
      onPointerDown: startResize, onKeyDown: resizeByKey,
      onFocus: () => updateResizeRange(chatRef.current!, resizeHandle.current!),
    },
    headerEvents: { onPointerDown: startMove },
  };
}
