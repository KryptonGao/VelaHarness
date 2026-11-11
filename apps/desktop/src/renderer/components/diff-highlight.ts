/**
 * 差异高亮的共享逻辑:按文件语言分别对旧/新两侧整体分词,再把 token 贴回每一行。
 * 单个差异过大时跳过高亮,只渲染纯文本,避免一次创建过多 DOM。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createLineTokenizer, highlightSnippet, languageForPath, type ThemedToken } from "./preview/highlighter";
import type { IncrementalTokenizer } from "./preview/incremental-tokenizer";

const maxHighlightChars = 400_000;
const fontStyleMask = { italic: 1, bold: 2 } as const;

export type TokenLines = ThemedToken[][];

export interface HighlightedDiff {
  old: TokenLines | null;
  new: TokenLines | null;
}

/** 流式增长的差异最多隔这么久整体重新分词一次。 */
export const STREAMING_HIGHLIGHT_INTERVAL_MS = 300;

interface HighlightInput {
  path: string | null | undefined;
  oldLines: string[];
  newLines: string[];
  oldText: string;
  newText: string;
}

/** 一份差异两侧各自的增量分词器,随语言存在;语言变了就重建。 */
interface SideTokenizers {
  lang: string;
  old: Promise<IncrementalTokenizer | null>;
  next: Promise<IncrementalTokenizer | null>;
}

/**
 * 旧/新两侧各自分词;语言不支持或内容过大时返回 null。
 * 差异在末尾增长时,每一侧只对新增的行分词,没变的行沿用原来的 token 数组;
 * 分段进行并在段间让出主线程,长文本不会一次卡住界面。
 */
async function highlightDiff({ path, oldLines, newLines, oldText, newText }: HighlightInput, tokenizers: { current: SideTokenizers | null }): Promise<HighlightedDiff | null> {
  const lang = languageForPath(path ?? "");
  if (!lang) return null;
  if (oldText.length + newText.length > maxHighlightChars) return null;
  const wrap = markupFragmentWrapper(lang, `${oldText}\n${newText}`);
  if (wrap) {
    // 补了标签头的片段每次都要整体处理,不走增量。
    const highlightSide = (text: string): Promise<TokenLines | null> => highlightSnippet(lang, wrap + text).then((lines) => lines?.slice(1) ?? null);
    const [old, next] = await Promise.all([
      oldLines.length > 0 ? highlightSide(oldText) : Promise.resolve(null),
      newLines.length > 0 ? highlightSide(newText) : Promise.resolve(null),
    ]);
    const alignedOld = alignTokens(old, oldLines.length);
    const alignedNew = alignTokens(next, newLines.length);
    return alignedOld || alignedNew ? { old: alignedOld, new: alignedNew } : null;
  }
  if (tokenizers.current?.lang !== lang) {
    tokenizers.current = { lang, old: createLineTokenizer(lang), next: createLineTokenizer(lang) };
  }
  const sides = tokenizers.current;
  const [old, next] = await Promise.all([
    oldLines.length > 0 ? sides.old.then((tokenizer) => tokenizer?.tokenize(oldLines) ?? null) : Promise.resolve(null),
    newLines.length > 0 ? sides.next.then((tokenizer) => tokenizer?.tokenize(newLines) ?? null) : Promise.resolve(null),
  ]);
  const alignedOld = alignTokens(old, oldLines.length);
  const alignedNew = alignTokens(next, newLines.length);
  return alignedOld || alignedNew ? { old: alignedOld, new: alignedNew } : null;
}

/**
 * 高亮一段差异的旧/新两侧;语言不支持、内容过大或行数对不齐时对应侧为 null,
 * 调用方退回纯文本渲染。
 *
 * throttleMs > 0 用于流式增长的差异:每次增量都整体重新分词会占满主线程,所以最多每 throttleMs 做一次,
 * 期间保留上一次的结果(调用方按行文本校验后再使用,新增或变化的行先显示纯文本)。
 */
export function useDiffHighlight(
  path: string | null | undefined,
  oldLines: string[],
  newLines: string[],
  throttleMs = 0,
): HighlightedDiff | null {
  const oldText = useMemo(() => oldLines.join("\n"), [oldLines]);
  const newText = useMemo(() => newLines.join("\n"), [newLines]);
  const [highlight, setHighlight] = useState<HighlightedDiff | null>(null);
  const throttled = throttleMs > 0;
  const latest = useRef<HighlightInput>({ path, oldLines, newLines, oldText, newText });
  latest.current = { path, oldLines, newLines, oldText, newText };
  const state = useRef<{ seq: number; lastStart: number; timer: number | undefined; done: HighlightInput | null }>({ seq: 0, lastStart: 0, timer: undefined, done: null });
  const tokenizers = useRef<SideTokenizers | null>(null);

  // 一次性的完整高亮:内容不再流式增长时,每次变化立即重新分词。
  useEffect(() => {
    if (throttled) return;
    const run = state.current;
    window.clearTimeout(run.timer);
    run.timer = undefined;
    const seq = ++run.seq;
    const input = latest.current;
    // 流式结束时内容没变,节流期间算出的结果已经对得上,不必清空再重算。
    const done = run.done;
    if (done && done.path === input.path && done.oldText === input.oldText && done.newText === input.newText) return;
    setHighlight(null);
    void highlightDiff(input, tokenizers).then((result) => {
      if (seq !== run.seq) return;
      run.done = input;
      setHighlight(result);
    });
  }, [throttled, path, oldText, newText, oldLines.length, newLines.length]);

  // 流式增长:已有定时器时它会读取最新内容,不重复排队,也不会被连续的增量一直推迟。
  useEffect(() => {
    if (!throttled) return;
    const run = state.current;
    if (run.timer !== undefined) return;
    const wait = Math.max(0, run.lastStart + throttleMs - performance.now());
    run.timer = window.setTimeout(() => {
      run.timer = undefined;
      run.lastStart = performance.now();
      const seq = ++run.seq;
      const input = latest.current;
      void highlightDiff(input, tokenizers).then((result) => {
        if (seq !== run.seq) return;
        run.done = input;
        setHighlight(result);
      });
    }, wait);
  }, [throttled, throttleMs, path, oldText, newText]);

  useEffect(() => () => {
    const run = state.current;
    window.clearTimeout(run.timer);
    run.timer = undefined;
    run.seq += 1;
  }, []);

  return highlight;
}

const markupTag = /<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>|<!--/;
const cssLike = /^\s*[\w-]+\s*:[^;{}]*;\s*$/m;
const cssSelector = /^\s*[^\s{][^{]*\{\s*$/m;
const jsHint = /[=(]|\b(?:const|let|var|function|return|if|for)\b/;

/**
 * HTML/Vue/Svelte 的差异常常只是 `<script>` 或 `<style>` 里的几行,片段本身没有标签,
 * 直接按标记语言分词会整段当成普通文本。无标签时补一个开标签头让内嵌语言生效,
 * 返回要加在每侧文本前面的头(带换行);调用方分词后丢掉第一行。
 */
function markupFragmentWrapper(lang: string, text: string): string | null {
  if (lang !== "html" && lang !== "vue" && lang !== "svelte") return null;
  if (markupTag.test(text)) return null;
  const css = cssSelector.test(text) && cssLike.test(text) && !jsHint.test(text.replace(/[\w-]+\s*:\s*[^;]*;/g, ""));
  return css ? "<style>\n" : "<script>\n";
}

/** shiki 对结尾换行可能多算一个空行;行数不匹配时退回纯文本。 */
export function alignTokens(lines: TokenLines | null, count: number): TokenLines | null {
  if (!lines) return null;
  if (lines.length === count) return lines;
  if (lines.length === count + 1 && isBlankLine(lines[count])) {
    return lines.slice(0, count);
  }
  return null;
}

function isBlankLine(tokens: ThemedToken[] | undefined): boolean {
  return Boolean(tokens && tokens.every((token) => token.content === ""));
}

/** shiki token 的样式:颜色用 CSS 变量,切主题时重新高亮才拿得到新值。 */
export function tokenStyle(token: ThemedToken): CSSProperties {
  const style: CSSProperties = {};
  if (token.color) style.color = token.color;
  if (token.fontStyle && token.fontStyle & fontStyleMask.italic) style.fontStyle = "italic";
  if (token.fontStyle && token.fontStyle & fontStyleMask.bold) style.fontWeight = 600;
  return style;
}
