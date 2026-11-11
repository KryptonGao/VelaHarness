/**
 * 增量分词:流式增长的文本只追加新行,所以只对新增的行分词,已经分过的行原样沿用(包括 token 数组的引用,
 * 渲染层据此跳过没变的行)。长文本按小段分词,段与段之间让出事件循环,不会一次占满主线程。
 * 与具体分词器无关:调用方给出「从某个语法状态继续分词一段文本」的函数。
 */
import type { ThemedToken } from "shiki/core";

export type TokenLines = ThemedToken[][];

/** 分词一段文本;state 是上一段结束时的语法状态(第一段为 undefined)。失败时返回 null。 */
export type TokenizeSlice<State> = (text: string, state: State | undefined) => { tokens: TokenLines; state: State } | null;

export interface IncrementalTokenizer {
  /**
   * 返回 lines 每一行的 token。lines 是上一次输入的延长时只处理新增的部分;
   * 期间又有新的调用、或分词失败时返回 null,已完成的部分保留给下一次调用。
   */
  tokenize(lines: string[]): Promise<TokenLines | null>;
}

/** 每段分词的行数;一段在主线程上同步完成。 */
const SLICE_LINES = 40;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export function createIncrementalTokenizer<State>(
  tokenizeSlice: TokenizeSlice<State>,
  yieldToUi: () => Promise<void> = yieldToEventLoop,
): IncrementalTokenizer {
  // 已分词的输入前缀、它的 token,以及「前 n 行分完后」的语法状态。三者始终同步更新。
  let lines: string[] = [];
  let tokens: TokenLines = [];
  const checkpoints = new Map<number, State>();
  let generation = 0;

  const reset = (): void => {
    lines = [];
    tokens = [];
    checkpoints.clear();
  };

  return {
    async tokenize(input) {
      const current = ++generation;
      let common = 0;
      while (common < lines.length && common < input.length && lines[common] === input[common]) common += 1;
      // 从共同前缀内最靠后的检查点继续;最后一行可能只是写到一半,所以它单独成段,下次能从它之前恢复。
      let start = 0;
      for (let count = common; count > 0; count -= 1) {
        if (checkpoints.has(count)) {
          start = count;
          break;
        }
      }
      lines = lines.slice(0, start);
      tokens = tokens.slice(0, start);
      for (const count of [...checkpoints.keys()]) if (count > start) checkpoints.delete(count);

      let position = start;
      while (position < input.length) {
        const end = position >= input.length - 1 ? input.length : Math.min(position + SLICE_LINES, input.length - 1);
        const slice = input.slice(position, end);
        const result = tokenizeSlice(slice.join("\n"), checkpoints.get(position));
        if (!result || result.tokens.length !== slice.length) {
          reset();
          return null;
        }
        for (const line of slice) lines.push(line);
        for (const line of result.tokens) tokens.push(line);
        checkpoints.set(end, result.state);
        position = end;
        if (position < input.length) {
          await yieldToUi();
          if (current !== generation) return null;
        }
      }
      return tokens.slice();
    },
  };
}
