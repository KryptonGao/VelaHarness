export interface FrontmatterEntry {
  key: string;
  /** 标量为字符串,`- item` 列表为字符串数组。 */
  value: string | string[];
}

export interface SplitFrontmatter {
  entries: FrontmatterEntry[];
  body: string;
}

const keyLinePattern = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(?:[ \t]+(.*))?$/;
const looksLikeYamlLine = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*[ \t]*:(?:[ \t]|$)|[ \t]+\S|-[ \t]|#|\s*$)/;

/**
 * 把 Markdown 头部的 YAML frontmatter(如 SKILL.md 的 name / description)拆出来。
 * 只有整块每一行都符合 YAML 形状才剥离,避免把正文里的 `---` 分隔线误当作 frontmatter。
 */
export function splitFrontmatter(markdown: string): SplitFrontmatter {
  const none: SplitFrontmatter = { entries: [], body: markdown };
  const text = markdown.replace(/^\uFEFF/, "");
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) return none;

  const rest = text.slice(open[0].length);
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!close) return none;

  const block = rest.slice(0, close.index);
  const lines = block.split(/\r?\n/);
  if (!lines.every((line) => looksLikeYamlLine.test(line))) return none;

  const entries = parseEntries(lines);
  if (entries.length === 0) return none;

  // 调用方统一基于 body 计算标题锚点,行号与渲染内容一致。
  const body = rest.slice(close.index + close[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
  return { entries, body };
}

function parseEntries(lines: string[]): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const match = keyLinePattern.exec(line);
    if (!match) {
      index += 1;
      continue;
    }
    const key = match[1] ?? "";
    const inline = (match[2] ?? "").trim();
    index += 1;

    // 收集这个 key 下缩进(或同级 `- `)的后续行。
    const continuation: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (next.trim() === "" || /^[ \t]+/.test(next) || /^-[ \t]/.test(next)) {
        continuation.push(next);
        index += 1;
        continue;
      }
      break;
    }
    while (continuation.length > 0 && continuation[continuation.length - 1]?.trim() === "") continuation.pop();

    entries.push({ key, value: resolveValue(inline, continuation) });
  }

  return entries;
}

function resolveValue(inline: string, continuation: string[]): string | string[] {
  const blockStyle = /^([|>])[+-]?\d*$/.exec(inline);
  if (blockStyle) {
    const rows = dedent(continuation);
    return blockStyle[1] === "|" ? rows.join("\n") : foldLines(rows);
  }

  const listItems = continuation
    .map((row) => /^[ \t]*-[ \t]+(.*)$/.exec(row)?.[1])
    .filter((item): item is string => item != null);
  if (inline === "" && listItems.length > 0) return listItems.map((item) => unquote(item.trim()));

  if (inline.startsWith("[") && inline.endsWith("]") && continuation.length === 0) {
    const items = splitFlowSequence(inline.slice(1, -1));
    if (items) return items;
  }

  const parts = [inline, ...continuation.map((row) => row.trim())].filter((part) => part !== "");
  return unquote(parts.join(" "));
}

function dedent(rows: string[]): string[] {
  const indents = rows.filter((row) => row.trim()).map((row) => /^[ \t]*/.exec(row)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return rows.map((row) => row.slice(min));
}

function foldLines(rows: string[]): string {
  return rows
    .join("\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n").join(" ").trim())
    .join("\n\n");
}

function splitFlowSequence(inner: string): string[] | null {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of inner) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (quote) return null;
  items.push(current);
  const cleaned = items.map((item) => unquote(item.trim())).filter((item) => item !== "");
  return cleaned.length > 0 ? cleaned : null;
}

function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\(["\\nt/])/g, (_all, ch: string) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch));
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}
