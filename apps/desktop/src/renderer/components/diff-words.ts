/**
 * 行内字词级差异:把相邻的删除行和新增行配对,标出这一行里真正改动的字词,
 * 作为整行底色之上更深的一层高亮。
 */

/** 字符偏移区间 [from, to)。 */
export type WordRange = readonly [from: number, to: number];

interface WordToken {
  text: string;
  start: number;
  space: boolean;
}

const tokenPattern = /[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu;
/** 单行分词数的上限,避免超长行拖慢最长公共子序列计算。 */
const maxTokens = 400;
/** 一组删除/新增行超过这个行数就不做配对。 */
const maxBlockRows = 120;
/** 每行删除只和随后几行新增比较。 */
const pairWindow = 4;
/** 两行共有字符低于这个比例时视为整行重写,不再标字词。 */
const minSimilarity = 0.5;

function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(tokenPattern)) {
    tokens.push({ text: match[0], start: match.index ?? 0, space: /^\s/u.test(match[0]) });
  }
  return tokens;
}

/** 把未匹配的 token 合并成区间;中间只隔一段空白的相邻区间并成一块,避免高亮被切碎。 */
function rangesOf(tokens: WordToken[], matched: boolean[]): WordRange[] {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  while (index < tokens.length) {
    if (matched[index]) {
      index += 1;
      continue;
    }
    const from = tokens[index]!.start;
    let to = from;
    while (index < tokens.length && !matched[index]) {
      to = tokens[index]!.start + tokens[index]!.text.length;
      index += 1;
    }
    const previous = ranges[ranges.length - 1];
    const gap = previous ? tokens.filter((token) => token.start >= previous[1] && token.start < from) : [];
    if (previous && gap.length > 0 && gap.every((token) => token.space)) previous[1] = to;
    else ranges.push([from, to]);
  }
  return ranges;
}

export interface WordDiff {
  oldRanges: WordRange[];
  newRanges: WordRange[];
  /** 两行共有的非空白字符占比,0 到 1。 */
  similarity: number;
}

/** 对两行文本做 token 级最长公共子序列比较;无法比较(过长)或没有差异时返回 null。 */
export function diffWords(oldText: string, newText: string): WordDiff | null {
  if (oldText === newText) return null;
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length > maxTokens || b.length > maxTokens) return null;
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i]!.text === b[j]!.text
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const oldMatched = new Array<boolean>(a.length).fill(false);
  const newMatched = new Array<boolean>(b.length).fill(false);
  let shared = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]!.text === b[j]!.text) {
      oldMatched[i] = true;
      newMatched[j] = true;
      if (!a[i]!.space) shared += a[i]!.text.length;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1;
    else j += 1;
  }
  const visible = (tokens: WordToken[]) => tokens.reduce((sum, token) => sum + (token.space ? 0 : token.text.length), 0);
  const total = visible(a) + visible(b);
  return {
    oldRanges: rangesOf(a, oldMatched),
    newRanges: rangesOf(b, newMatched),
    similarity: total === 0 ? 0 : (2 * shared) / total,
  };
}

interface MarkableRow {
  kind: string;
  text: string;
  marks?: WordRange[] | undefined;
}

function markBlock(removed: MarkableRow[], added: MarkableRow[]): void {
  if (removed.length === 0 || added.length === 0) return;
  if (removed.length + added.length > maxBlockRows) return;
  let cursor = 0;
  for (const row of removed) {
    let best: { diff: WordDiff; index: number } | null = null;
    for (let index = cursor; index < Math.min(added.length, cursor + pairWindow); index += 1) {
      const diff = diffWords(row.text, added[index]!.text);
      if (diff && (!best || diff.similarity > best.diff.similarity)) best = { diff, index };
    }
    if (!best || best.diff.similarity < minSimilarity) continue;
    if (best.diff.oldRanges.length > 0) row.marks = best.diff.oldRanges;
    if (best.diff.newRanges.length > 0) added[best.index]!.marks = best.diff.newRanges;
    cursor = best.index + 1;
  }
}

/** 给每组「连续删除行 + 紧随的连续新增行」里配上对的行标出字词级改动,结果写入各行的 marks。 */
export function markWordChanges(rows: MarkableRow[]): void {
  let index = 0;
  while (index < rows.length) {
    if (rows[index]!.kind !== "del") {
      index += 1;
      continue;
    }
    const removed: MarkableRow[] = [];
    while (index < rows.length && rows[index]!.kind === "del") removed.push(rows[index++]!);
    const added: MarkableRow[] = [];
    while (index < rows.length && rows[index]!.kind === "add") added.push(rows[index++]!);
    markBlock(removed, added);
  }
}

export function sameMarks(a: readonly WordRange[] | undefined, b: readonly WordRange[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((range, index) => range[0] === b[index]![0] && range[1] === b[index]![1]);
}
