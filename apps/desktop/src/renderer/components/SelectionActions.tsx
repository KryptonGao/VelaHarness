import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { tr } from "../locale";
import { normalizeQuote } from "./selection-actions";
import { Icon } from "./icons";

type ReadCodeLocation = (range: Range) => string | null;

interface Anchor {
  quote: string;
  /** 选区在视口中的位置；浮层相对它居中，放不下时翻到下方。 */
  rect: { left: number; right: number; top: number; bottom: number };
}

const gap = 8;
const edge = 8;

/** 选区必须完整落在容器内，且不在输入控件里。 */
function readAnchor(container: HTMLElement | null, readCodeLocation?: ReadCodeLocation): Anchor | null {
  const selection = window.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const host = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (host?.closest("input, textarea, [contenteditable='true'], [data-selection-actions='off']")) return null;
  const quote = readCodeLocation ? readCodeLocation(range) : normalizeQuote(selection.toString());
  if (!quote) return null;
  const rect = range.getBoundingClientRect();
  return rect.width || rect.height ? { quote, rect } : null;
}

/** The same selection popup collects replies in chat and line comments in file previews. */
export function SelectionActions({ containerRef, onReply, onSideChat, readCodeLocation }: {
  containerRef: RefObject<HTMLElement | null>;
  /** 回复写好后按回车：引用和回复内容一起交给输入框。 */
  onReply: (quote: string, text: string) => void;
  /** 没有提供侧边聊天入口时只显示回复。 */
  onSideChat?: ((quote: string, draft?: string) => void) | null;
  readCodeLocation?: ReadCodeLocation;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => setAnchor(readAnchor(containerRef.current, readCodeLocation)), [containerRef, readCodeLocation]);
  const code = Boolean(readCodeLocation);

  useEffect(() => {
    // 拖选过程中不显示，松开鼠标或用键盘调整选区之后再读取。
    let selecting = false;
    const inside = (event: Event) => event.target instanceof Node && popover.current?.contains(event.target);
    const close = () => { setAnchor(null); setReplying(false); setReply(""); };
    const onPointerDown = (event: PointerEvent) => {
      selecting = true;
      if (!inside(event)) close();
    };
    const onPointerUp = (event: PointerEvent) => {
      selecting = false;
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
      else if (code && !selecting) refresh();
    };
    const hide = (event: Event) => {
      if (inside(event) || (code && popover.current?.contains(document.activeElement))) return;
      if (code && event.type === "scroll" && event.target instanceof Element && !event.target.contains(containerRef.current)) return;
      close();
    };
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
  }, [refresh, code, containerRef]);

  useEffect(() => {
    if (replying) replyInput.current?.focus();
  }, [replying]);

  useLayoutEffect(() => {
    const element = popover.current;
    if (!anchor || !element) { setPosition(null); return; }
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const center = (anchor.rect.left + anchor.rect.right) / 2;
      const left = Math.min(Math.max(center - width / 2, edge), Math.max(edge, window.innerWidth - width - edge));
      const above = anchor.rect.top - gap - height;
      const top = above >= edge ? above : anchor.rect.bottom + gap;
      setPosition({ left, top: Math.max(edge, Math.min(top, window.innerHeight - height - edge)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, replying, reply]);

  if (!anchor) return null;
  const finish = (action: typeof onReply) => {
    const text = reply.trim();
    if (code && !text) return;
    window.getSelection()?.removeAllRanges();
    setAnchor(null);
    setReplying(false);
    setReply("");
    action(anchor.quote, text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(onReply);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (code) setAnchor(null);
      setReplying(false);
      setReply("");
    }
  };
  const actionLabel = code ? tr("评论", "Comment") : tr("回复", "Reply");
  const popoverContent = (
    <div
      ref={popover}
      className={`selection-actions${replying ? " is-replying" : ""}`}
      role={replying ? "dialog" : "toolbar"}
      aria-label={code ? tr("代码评论", "Code comment") : replying ? tr("回复选中的文字", "Reply to the selected text") : tr("选中文字的操作", "Selected text actions")}
      style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: "hidden" }}
      // 点按钮不能让选区丢失，否则读不到要引用的文字；回复框里要保留默认行为才能点进去输入。
      onMouseDown={(event) => { if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }}
    >
      {replying ? (
        <>
          {code ? (
            <div className="selection-reply-location">{anchor.quote}</div>
          ) : (
            <div className="selection-reply-quote">
              <span className="reply-quote-bar" aria-hidden="true" />
              <p title={anchor.quote}>{anchor.quote}</p>
            </div>
          )}
          <div className="selection-reply-row">
            <textarea
              ref={replyInput}
              rows={1}
              value={reply}
              placeholder={code ? tr("写下评论…", "Write a comment…") : tr("回复… Enter 放入输入框", "Reply… Enter to add it to the message box")}
              aria-label={code ? tr("评论内容", "Comment body") : tr("回复内容", "Reply")}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {code && (
              <button type="button" className="selection-reply-insert" disabled={!reply.trim()} onClick={() => finish(onReply)}>
                {tr("插入聊天框", "Add to chat")}
              </button>
            )}
            {onSideChat ? (
              <button type="button" className="selection-reply-side" title={tr("开启侧边聊天", "Start a side chat")}
                aria-label={tr("开启侧边聊天", "Start a side chat")}
                onClick={() => finish((quote, text) => onSideChat(quote, text || undefined))}>
                <Icon name="sparkles" size={16} />
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
          <button type="button" onClick={() => setReplying(true)}>{actionLabel}</button>
        </>
      )}
    </div>
  );
  // Workbench panes are clipped and can be transformed. Position their popup in viewport coordinates.
  return code ? createPortal(popoverContent, document.body) : popoverContent;
}
