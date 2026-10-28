import { useEffect, useRef, useState } from "react";
import { annotationInViewport, elementSummary, maxAnnotationText, maxElementAnnotations, type AnnotationRect, type BrowserTabAnnotation, type BrowserUiCommand } from "@vela/shared";
import type { RendererBrowserTab } from "../../browser/useBrowserTabs";
import { replyStore, useAnnotationTracking, useReplyCards, useReplyFocus } from "../../browser/reply-store";
import { tr, trf } from "../../locale";
import { isElementReply } from "../selection-actions";

const popoverWidth = 300;
const popoverHeight = 168;
const edge = 8;

/**
 * 元素批注的覆盖层：编号气泡、元素选框和写批注的浮层。
 * 由应用自己绘制在 `<webview>` 上方，不进页面 DOM，也不进 Agent 截图；浮层以外不拦截任何输入。
 */
export function BrowserAnnotationLayer({ tab, width, height, offsetX, command }: {
  tab: RendererBrowserTab; width: number; height: number;
  /** 拖动分隔条期间网页内部尺寸冻结，靠右对齐，标记需要跟着平移。 */
  offsetX: number;
  command: (command: BrowserUiCommand) => void;
}) {
  const key = tab.conversationId ?? "";
  const cards = useReplyCards(key);
  const tracking = useAnnotationTracking();
  const focus = useReplyFocus();
  const annotation: BrowserTabAnnotation | undefined = tab.annotation;
  const [flash, setFlash] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState(false);
  const elements = cards.filter(isElementReply);
  const mine = elements.filter((card) => card.tabId === tab.id);
  const pick = annotation?.pick ?? null;

  // 点输入框上方的批注卡片：定位并闪烁页面里对应的元素。
  useEffect(() => {
    // 只响应刚发出的定位请求；之后再切回这个标签页不再闪烁。
    if (!focus || focus.tabId !== tab.id || Date.now() - focus.at > 3_000) return;
    setFlash(focus.id);
    const timer = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(timer);
  }, [focus, tab.id]);

  // 没有选中元素时，在应用里按 Esc 退出批注模式（页面获得焦点时由主进程处理）。
  useEffect(() => {
    if (!annotation?.mode || pick) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) command({ type: "annotate-mode", tabId: tab.id, enabled: false });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [annotation?.mode, pick, tab.id, command]);

  useEffect(() => { setLimitNotice(false); }, [pick?.id]);

  const project = (rect: AnnotationRect, viewport: { width: number; height: number }): AnnotationRect => {
    const scale = offsetX ? 1 : viewport.width > 0 ? width / viewport.width : 1;
    const vertical = offsetX ? 1 : viewport.height > 0 ? height / viewport.height : 1;
    return { x: rect.x * scale + offsetX, y: rect.y * vertical, width: rect.width * scale, height: rect.height * vertical };
  };

  const pickBox = pick?.rect ? project(pick.rect, pick.viewport) : null;
  const tracked = mine.length > 0;
  // 有批注时让主进程跟踪元素位置；覆盖层不显示（面板收起、切走标签页）时停止。
  useEffect(() => {
    if (!tracked) return;
    command({ type: "annotate-track", tabId: tab.id, active: true });
    return () => command({ type: "annotate-track", tabId: tab.id, active: false });
  }, [tracked, tab.id, command]);

  return <div className="browser-annotation-layer">
    {mine.map((card) => {
      const track = tracking.get(card.id);
      if (!track || track.status !== "ok" || !track.rect || !annotationInViewport(track.rect, track.viewport)) return null;
      const box = project(track.rect, track.viewport);
      const number = elements.findIndex((item) => item.id === card.id) + 1;
      return <div key={card.id} className={`annotation-box${flash === card.id ? " is-flash" : ""}`}
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }} data-annotation={card.id}>
        <span className="annotation-badge">{number}</span>
      </div>;
    })}
    {pickBox && <div className="annotation-box is-pick" style={{ left: pickBox.x, top: pickBox.y, width: pickBox.width, height: pickBox.height }}>
      <span className="annotation-badge">{elements.length + 1}</span>
    </div>}
    {pick && <PickPopover key={pick.id} pick={pick} width={width} height={height} project={project} limitNotice={limitNotice}
      onCancel={() => command({ type: "annotate-cancel", tabId: tab.id })}
      onRefine={(direction) => command({ type: "annotate-refine", tabId: tab.id, pickId: pick.id, direction })}
      onSubmit={(text) => {
        if (!replyStore.canAddElement(key)) { setLimitNotice(true); return; }
        const id = crypto.randomUUID();
        const state = tab.controller.store.getSnapshot();
        // 先有卡片再通知主进程：主进程里出现的批注一定能在卡片里找到对应。
        replyStore.addElement(key, {
          id, kind: "element", text, tabId: tab.id,
          data: { pageUrl: state.url, pageTitle: state.title, element: pick.element, rect: pick.rect, viewport: pick.viewport },
        });
        command({ type: "annotate-commit", tabId: tab.id, pickId: pick.id, annotationId: id });
      }} />}
    {annotation?.mode && !pick && <div className="annotation-hint" role="status">
      {annotation.notice ? tr("无法选中这个元素，请换一个再试", "Couldn’t select that element. Try another one")
        : tr("点击页面元素写批注 · Esc 退出", "Click an element to annotate it · Esc to exit")}
    </div>}
  </div>;
}

function PickPopover({ pick, width, height, project, limitNotice, onCancel, onRefine, onSubmit }: {
  pick: NonNullable<BrowserTabAnnotation["pick"]>; width: number; height: number;
  project: (rect: AnnotationRect, viewport: { width: number; height: number }) => AnnotationRect;
  limitNotice: boolean; onCancel: () => void; onRefine: (direction: "parent" | "child") => void; onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const box = pick.rect ? project(pick.rect, pick.viewport) : null;
  const left = Math.max(edge, Math.min((box?.x ?? (width - popoverWidth) / 2), width - popoverWidth - edge));
  const below = box ? box.y + box.height + edge : edge;
  const top = box && below + popoverHeight > height ? Math.max(edge, box.y - popoverHeight - edge) : below;
  return <div className="annotation-popover" role="dialog" aria-label={tr("元素批注", "Element annotation")}
    style={{ left, top: Math.min(top, Math.max(edge, height - popoverHeight - edge)), width: Math.min(popoverWidth, width - edge * 2) }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
      else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault(); onRefine(event.key === "ArrowUp" ? "parent" : "child");
      } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit(text.trim()); }
    }}>
    <div className="annotation-popover-head">
      <code title={pick.element.selector}>{elementSummary(pick.element)}</code>
      <span className="annotation-popover-levels">
        <button type="button" disabled={!pick.canParent} onClick={() => onRefine("parent")}
          title={tr("选中父级元素（Alt+↑）", "Select parent element (Alt+↑)")} aria-label={tr("选中父级元素", "Select parent element")}>↑</button>
        <button type="button" disabled={!pick.canChild} onClick={() => onRefine("child")}
          title={tr("选中子级元素（Alt+↓）", "Select child element (Alt+↓)")} aria-label={tr("选中子级元素", "Select child element")}>↓</button>
      </span>
    </div>
    <textarea ref={input} rows={3} value={text} maxLength={maxAnnotationText}
      placeholder={tr("写下对这个元素的批注，可以留空", "Write a note about this element (optional)")}
      aria-label={tr("批注内容", "Annotation text")} onChange={(event) => setText(event.target.value)} />
    {limitNotice && <p className="annotation-popover-note" role="alert">{trf("一条消息最多引用 {0} 条批注，请先发送", "A message can reference up to {0} annotations. Send it first", maxElementAnnotations)}</p>}
    <div className="annotation-popover-actions">
      <span>{tr("Enter 添加 · Esc 取消", "Enter to add · Esc to cancel")}</span>
      <button type="button" onClick={onCancel}>{tr("取消", "Cancel")}</button>
      <button type="button" className="is-primary" onClick={() => onSubmit(text.trim())}>{tr("添加批注", "Add note")}</button>
    </div>
  </div>;
}
