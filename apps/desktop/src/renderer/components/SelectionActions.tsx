import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { tr } from "../locale";
import { SparkIcon } from "./icons";
import { normalizeQuote } from "./selection-actions";

interface Anchor {
  text: string;
  /** 选区在视口中的位置；浮层相对它居中，放不下时翻到下方。 */
  rect: { left: number; right: number; top: number; bottom: number };
}

const gap = 8;
const edge = 8;

/** 选区必须完整落在容器内，且不在输入控件里。 */
function readAnchor(container: HTMLElement | null): Anchor | null {
  const selection = window.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const host = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (host?.closest("input, textarea, [contenteditable='true'], [data-selection-actions='off']")) return null;
  const text = normalizeQuote(selection.toString());
  if (!text) return null;
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  const first = rects[0];
  const last = rects[rects.length - 1];
  if (!first || !last) return null;
  return {
    text,
    rect: {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      top: first.top,
      bottom: last.bottom,
    },
  };
}

/**
 * 在对话里选中文字时出现的小浮层：「开启侧边聊天」和「回复」。
 * 回复把选中的文字作为引用交给输入框；侧边聊天把它带进一个新的侧边标签。
 */
export function SelectionActions({ containerRef, onReply, onSideChat }: {
  containerRef: RefObject<HTMLElement | null>;
  /** 回复写好后按回车：引用和回复内容一起交给输入框。 */
  onReply: (quote: string, text: string) => void;
  /** 没有提供侧边聊天入口时只显示回复。 */
  onSideChat: ((quote: string, draft?: string) => void) | null;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);

  const refresh = useCallback(() => setAnchor(readAnchor(containerRef.current)), [containerRef]);

  useEffect(() => {
    // 拖选过程中不显示，松开鼠标或用键盘调整选区之后再读取。
    const inside = (event: Event) => popover.current?.contains(event.target as Node) ?? false;
    const close = () => { setAnchor(null); setReplying(false); setReply(""); };
    const onPointerDown = (event: PointerEvent) => {
      pointerDown.current = true;
      if (!inside(event)) close();
    };
    const onPointerUp = (event: PointerEvent) => {
      pointerDown.current = false;
      if (inside(event)) return;
      window.requestAnimationFrame(refresh);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (inside(event)) return;
      if (event.shiftKey || event.key.startsWith("Arrow") || (event.key === "a" && (event.metaKey || event.ctrlKey))) refresh();
    };
    const onSelectionChange = () => {
      // 在回复框里打字会把文档选区移进输入框，那时不能收起。
      if (popover.current?.contains(document.activeElement)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) close();
    };
    const hide = (event: Event) => { if (!inside(event)) close(); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    // 滚动和缩放会让位置失效，直接收起，选区还在，再松手即可重新出现。
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, [refresh]);

  useEffect(() => {
    if (replying) replyInput.current?.focus();
  }, [replying]);

  useLayoutEffect(() => {
    const element = popover.current;
    if (!anchor || !element) { setPosition(null); return; }
    const { width, height } = element.getBoundingClientRect();
    const center = (anchor.rect.left + anchor.rect.right) / 2;
    const left = Math.min(Math.max(center - width / 2, edge), Math.max(edge, window.innerWidth - width - edge));
    const above = anchor.rect.top - gap - height;
    setPosition({ left, top: above >= edge ? above : Math.min(anchor.rect.bottom + gap, window.innerHeight - height - edge) });
  }, [anchor, replying, reply]);

  if (!anchor) return null;
  const finish = (action: (quote: string, text: string) => void) => {
    const text = reply.trim();
    window.getSelection()?.removeAllRanges();
    setAnchor(null);
    setReplying(false);
    setReply("");
    action(anchor.text, text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(onReply);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setReplying(false);
      setReply("");
    }
  };
  return (
    <div
      ref={popover}
      className={`selection-actions${replying ? " is-replying" : ""}`}
      role={replying ? "dialog" : "toolbar"}
      aria-label={replying ? tr("回复选中的文字", "Reply to the selected text") : tr("选中文字的操作", "Selected text actions")}
      style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: "hidden" }}
      // 点按钮不能让选区丢失，否则读不到要引用的文字；回复框里要保留默认行为才能点进去输入。
      onMouseDown={(event) => { if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }}
    >
      {replying ? (
        <>
          <div className="selection-reply-quote">
            <span className="reply-quote-bar" aria-hidden="true" />
            <p title={anchor.text}>{anchor.text}</p>
          </div>
          <div className="selection-reply-row">
            <textarea
              ref={replyInput}
              rows={1}
              value={reply}
              placeholder={tr("回复… Enter 放入输入框", "Reply… Enter to add it to the message box")}
              aria-label={tr("回复内容", "Reply")}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {onSideChat ? (
              <button type="button" className="selection-reply-side" title={tr("开启侧边聊天", "Start a side chat")}
                aria-label={tr("开启侧边聊天", "Start a side chat")}
                onClick={() => finish((quote, text) => onSideChat(quote, text || undefined))}>
                <SparkIcon size={15} />
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          {onSideChat ? (
            <>
              <button type="button" onClick={() => finish((quote) => onSideChat(quote))}>{tr("开启侧边聊天", "Start a side chat")}</button>
              <span className="selection-actions-divider" aria-hidden="true" />
            </>
          ) : null}
          <button type="button" onClick={() => setReplying(true)}>{tr("回复", "Reply")}</button>
        </>
      )}
    </div>
  );
}
