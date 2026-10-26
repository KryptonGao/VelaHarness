import { useEffect, useRef, useState } from "react";

/** 流式期间展示速度的上下限(字符/秒);积压越多越快,但不超过上限。 */
export const PACE_MIN_CPS = 60;
export const PACE_MAX_CPS = 240;
/** 流式期间让积压在大约这么多秒内追平。 */
const CATCH_UP_SECONDS = 2;
/** 流结束后剩余内容最多再花这么多秒展示完。 */
export const PACE_DRAIN_SECONDS = 1.5;

/** 这一帧该展示到第几个字符(浮点)。流结束后不再受上限约束,尽快把剩余内容展示完。 */
export function pacedAdvance(shown: number, length: number, elapsedMs: number, streaming: boolean): number {
  const backlog = length - shown;
  if (backlog <= 0) return length;
  const rate = streaming
    ? Math.min(PACE_MAX_CPS, Math.max(PACE_MIN_CPS, backlog / CATCH_UP_SECONDS))
    : Math.max(PACE_MAX_CPS, backlog / PACE_DRAIN_SECONDS);
  return Math.min(length, shown + rate * elapsedMs / 1000);
}

/** 不把一个代理对拆开,避免半个表情或生僻字。 */
function safeCut(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  const code = text.charCodeAt(index - 1);
  return code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
}

/**
 * 回合结束时回复会换到另一处重新挂载(流式阶段和完成后的展示不是同一个组件)。
 * 按 key 记住展示进度,新挂载的组件从这里接着放,而不是把没放完的文字一下子全部展示。
 */
const resumable = new Map<string, { position: number; head: string }>();
const RESUMABLE_LIMIT = 64;
const HEAD = 24;

function remember(key: string | undefined, text: string, position: number): void {
  if (!key) return;
  if (position >= text.length) {
    resumable.delete(key);
    return;
  }
  resumable.delete(key);
  resumable.set(key, { position, head: text.slice(0, HEAD) });
  if (resumable.size > RESUMABLE_LIMIT) resumable.delete(resumable.keys().next().value as string);
}

function resumedPosition(key: string | undefined, text: string): number | undefined {
  const saved = key ? resumable.get(key) : undefined;
  return saved && saved.position < text.length && text.startsWith(saved.head) ? Math.floor(saved.position) : undefined;
}

export interface PacedText {
  text: string;
  /** 挂载时接着上一个组件没放完的进度,这些文字在这之前已经展示过。 */
  resumed: boolean;
}

/**
 * 模型输出太快时限制前端展示的速度:新到的文字先排队,按帧匀速放出。
 * 挂载时已有的文字(历史记录、切换到进行中的对话)直接显示,只对之后追加的文字限速;
 * fromStart 时连挂载时已有的文字也从头放。
 */
export function usePacedText(text: string, streaming: boolean, key?: string, fromStart = false): PacedText {
  const initial = useRef<{ position: number; resumed: boolean } | undefined>(undefined);
  if (!initial.current) {
    const resumedAt = resumedPosition(key, text);
    // fromStart:挂载时已有的文字也当作新到的,从头开始放(整段一次到达的内容,例如思考总结)。
    initial.current = { position: resumedAt ?? (fromStart ? 0 : text.length), resumed: resumedAt !== undefined };
  }
  const [shown, setShown] = useState(initial.current.position);
  const position = useRef(initial.current.position);
  const latest = useRef({ length: text.length, streaming });
  latest.current = { length: text.length, streaming };

  // 文字被整体替换得更短(重试、编辑)时直接跟上,不再排队。
  if (position.current > text.length) position.current = text.length;
  const visible = Math.min(shown, text.length);

  useEffect(() => {
    if (position.current >= text.length) return;
    let frame = 0;
    let timer = 0;
    let previous = performance.now();
    // 画面没有刷新(窗口被遮挡等)时 rAF 不会触发,用定时器兜底,避免文字一直不出现。
    const tick = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      const now = performance.now();
      const { length, streaming: live } = latest.current;
      position.current = pacedAdvance(position.current, length, Math.min(now - previous, 100), live);
      previous = now;
      remember(key, text, position.current);
      setShown(Math.floor(position.current));
      if (position.current < length) {
        frame = requestAnimationFrame(tick);
        timer = window.setTimeout(tick, 250);
      }
    };
    frame = requestAnimationFrame(tick);
    timer = window.setTimeout(tick, 250);
    // 页面在后台时 rAF 会暂停,切回来时不该再慢慢放。
    const flush = () => {
      if (!document.hidden) return;
      position.current = latest.current.length;
      setShown(position.current);
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [text.length, streaming, key]);

  return { text: visible >= text.length ? text : text.slice(0, safeCut(text, visible)), resumed: initial.current.resumed };
}
