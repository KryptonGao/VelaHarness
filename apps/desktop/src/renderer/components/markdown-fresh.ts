/**
 * 流式输出时,把每一批新追加的文字包进 .md-fresh 行内元素,由 CSS 让它淡入;已经出现的文字不动。
 * cuts 是每一批新文字在块源码里的起点(升序),第一个 cut 之前的文字视为已经稳定。
 * 批次边界保持不变,所以已有元素在后续渲染里被复用,动画不会被重新触发。
 * 内联代码和代码块不是 text 节点,不受影响。
 */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown>; srcOffset?: number };
};

/** born 是这批文字出现的时间;元素被重建时,渲染端靠它从正确的进度接着播放动画。 */
function freshNode(children: MdNode[] | string, born: number | undefined): MdNode {
  return {
    type: "emphasis",
    children: typeof children === "string" ? [{ type: "text", value: children }] : children,
    data: { hName: "span", hProperties: { className: ["md-fresh"], ...(born === undefined ? {} : { dataBorn: born }) } },
  };
}

/** 文本节点在源码里的起止位置;转义和实体会让文本比源码短,这时按比例换算切点。 */
function sourceRange(node: MdNode): { start: number; end: number } | undefined {
  const length = node.value?.length ?? 0;
  const start = node.position?.start.offset ?? node.data?.srcOffset;
  if (start === undefined) return undefined;
  return { start, end: node.position?.end.offset ?? start + length };
}

export function splitFresh(node: MdNode, cuts: readonly number[], born: readonly number[] = []): MdNode[] {
  const value = node.value ?? "";
  const range = sourceRange(node);
  if (!range || !value || range.end <= cuts[0]) return [node];
  const span = Math.max(range.end - range.start, 1);
  const indexes = [0];
  for (const cut of cuts) {
    if (cut <= range.start || cut >= range.end) continue;
    const index = Math.round((cut - range.start) * value.length / span);
    if (index > indexes[indexes.length - 1] && index < value.length) indexes.push(index);
  }
  indexes.push(value.length);
  const out: MdNode[] = [];
  for (let i = 0; i < indexes.length - 1; i += 1) {
    const piece = value.slice(indexes[i], indexes[i + 1]);
    const offset = range.start + Math.round(indexes[i] * span / value.length);
    const batch = cuts.findLastIndex((cut) => cut <= offset);
    out.push(batch < 0 ? { type: "text", value: piece } : freshNode(piece, born[batch]));
  }
  return out;
}

function walk(node: MdNode, cuts: readonly number[], born: readonly number[]): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      next.push(...splitFresh(child, cuts, born));
    } else if (child.type === "inlineCode") {
      // 行内代码不能拆开,整个元素跟着它开头所在的那一批一起出现。
      const batch = cuts.findLastIndex((cut) => cut <= (child.position?.start.offset ?? -1));
      next.push(batch < 0 ? child : freshNode([child], born[batch]));
    } else {
      walk(child, cuts, born);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkFresh(cuts: readonly number[] = [], born: readonly number[] = []) {
  return (tree: MdNode) => {
    if (cuts.length > 0) walk(tree, cuts, born);
  };
}

const MAX_CUTS = 96;

export interface FreshCuts {
  length: number;
  cuts: number[];
  /** 与 cuts 一一对应的出现时间。 */
  born: number[];
}

/** 记录文本长度的增长:每次变长就多一个批次起点。fromStart 时已有文字也算新文字。 */
export function advanceFreshCuts(state: FreshCuts, textLength: number, now = performance.now()): FreshCuts {
  if (textLength < state.length) {
    const keep = state.cuts.filter((cut) => cut < textLength).length;
    state.cuts = state.cuts.slice(0, keep);
    state.born = state.born.slice(0, keep);
    state.length = textLength;
  } else if (textLength > state.length) {
    state.cuts = [...state.cuts, state.length].slice(-MAX_CUTS);
    state.born = [...state.born, now].slice(-MAX_CUTS);
    state.length = textLength;
  }
  return state;
}

const MARKERS = ["**", "~~"] as const;

/**
 * 流式时给还没闭合的行内语法(`**`、`~~`、反引号)虚拟补上收尾,让结构从开头就稳定。
 * 否则收尾标记到达时,前面已经淡入的文字会被整批重建(动画重播),开头的标记字符也会闪现后消失。
 * 刚打出开头、里面还没有内容的标记直接不显示。只在最后一段里补,补的内容都在末尾,不影响已有文字的位置。
 */
export function completeInline(text: string): string {
  const boundary = text.lastIndexOf("\n\n");
  const start = boundary < 0 ? 0 : boundary + 2;
  const segment = text.slice(start);
  // 代码围栏里的内容原样保留。
  if (/(^|\n)\s*(```|~~~)/.test(segment)) return text;
  const open: { marker: string; at: number }[] = [];
  let code: { run: number; at: number } | undefined;
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    if (code) {
      if (char !== "`") continue;
      let run = 1;
      while (segment[i + run] === "`") run += 1;
      if (run === code.run) code = undefined;
      i += run - 1;
      continue;
    }
    if (char === "\\") { i += 1; continue; }
    if (char === "`") {
      let run = 1;
      while (segment[i + run] === "`") run += 1;
      code = { run, at: i };
      i += run - 1;
      continue;
    }
    const marker = MARKERS.find((item) => segment.startsWith(item, i));
    if (!marker) continue;
    const top = open.findLast((item) => item.marker === marker);
    const next = segment[i + 2];
    const prev = segment[i - 1];
    if (top) {
      if (prev !== undefined && !/\s/.test(prev)) open.splice(open.indexOf(top), open.length);
    } else if (next === undefined || !/\s/.test(next)) {
      open.push({ marker, at: i });
    }
    i += 1;
  }
  let completed = segment;
  const pending = [...open.map((item) => ({ text: item.marker, at: item.at })), ...(code ? [{ text: "`".repeat(code.run), at: code.at }] : [])]
    .sort((a, b) => a.at - b.at);
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const item = pending[index];
    // 末尾的空白在闭合标记前不成立,先不显示它(它在行尾本来就看不见),下一个字到达时会回来。
    completed = completed.trimEnd();
    const content = completed.slice(item.at + item.text.length);
    completed = content.length === 0 ? completed.slice(0, item.at) : completed + item.text;
  }
  return text.slice(0, start) + completed;
}
