import type { ToolTrace } from "@vela/shared";
import { describeBashCommand } from "./bash-intent";
import { markWordChanges, type WordRange } from "./diff-words";

/** 可折叠进紧凑摘要的工具种类,与 ToolCard 的 ToolKind 对齐(不含 other)。 */
export type CompactKind = "bash" | "read" | "edit" | "write";

export function toolCompactKind(name: string): CompactKind | null {
  if (name === "bash" || name === "read" || name === "edit" || name === "write") return name;
  return null;
}

/** 读取技能说明文件(SKILL.md)的调用:展示成「已读取技能」,不当作普通文件读取。 */
export function isSkillRead(tool: Pick<ToolTrace, "name" | "activity">): boolean {
  if (tool.name !== "read") return false;
  const path = tool.activity?.path?.trim().replaceAll("\\", "/");
  return path?.split("/").pop()?.toLowerCase() === "skill.md";
}

/** 技能名取 SKILL.md 所在目录名,如 ~/.vela/skills/ui-ux-pro-max/SKILL.md → ui-ux-pro-max。 */
export function skillNameOf(tool: Pick<ToolTrace, "activity">): string {
  const parts = tool.activity?.path?.trim().replaceAll("\\", "/").split("/").filter(Boolean) ?? [];
  return parts.length >= 2 ? parts[parts.length - 2]! : "";
}

/** 摘要里的一段动作统计,如「已编辑 2 个文件」。 */
export interface CompactSummaryPart {
  kind: CompactKind;
  count: number;
}

/** 把一组工具按首次出现的种类聚合计数,忽略计划、提问等不可折叠工具。 */
export function compactSummaryParts(tools: ToolTrace[]): CompactSummaryPart[] {
  const order: CompactKind[] = [];
  const counts = new Map<CompactKind, number>();
  const seenFiles = new Set<string>();
  for (const tool of tools) {
    const kind = toolCompactKind(tool.name);
    if (!kind) continue;
    if (kind !== "bash") {
      const path = tool.activity?.path?.trim().replaceAll("\\", "/");
      if (path) {
        const key = `${kind}:${path}`;
        if (seenFiles.has(key)) continue;
        seenFiles.add(key);
      }
    }
    if (!counts.has(kind)) order.push(kind);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return order.map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));
}

/** 摘要文案用的种类:bash 里的 ls / grep 单独成「列目录」「搜索」,cat 并入「读取文件」。 */
export type CompactLabelKind = CompactKind | "list" | "search" | "skill";

export interface CompactLabelPart {
  kind: CompactLabelKind;
  count: number;
}

/** 与 compactSummaryParts 相同,但按 bash 命令的含义拆分;无法归类的 bash 仍算「运行命令」。 */
export function compactLabelParts(tools: ToolTrace[]): CompactLabelPart[] {
  const order: CompactLabelKind[] = [];
  const counts = new Map<CompactLabelKind, number>();
  const seenFiles = new Set<string>();
  const add = (kind: CompactLabelKind, by = 1) => {
    if (!counts.has(kind)) order.push(kind);
    counts.set(kind, (counts.get(kind) ?? 0) + by);
  };
  for (const tool of tools) {
    const kind = toolCompactKind(tool.name);
    if (!kind) continue;
    if (kind === "bash") {
      const intent = describeBashCommand(tool.activity?.command);
      if (!intent || intent.kind === "script") {
        add("bash");
      } else if (intent.kind === "list") {
        add("list");
      } else if (intent.kind === "read") {
        const fresh = intent.targets.filter((target) => !seenFiles.has(`read:${target}`));
        for (const target of fresh) seenFiles.add(`read:${target}`);
        if (fresh.length > 0) add("read", fresh.length);
      } else {
        add("search");
      }
      continue;
    }
    const path = tool.activity?.path?.trim().replaceAll("\\", "/");
    if (path) {
      const key = `${kind}:${path}`;
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
    }
    add(isSkillRead(tool) ? "skill" : kind);
  }
  return order.map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));
}

export interface DiffStat {
  added: number;
  removed: number;
}

/** 统计一条展示 diff 的增删行数;行首是 +、- 或空格,+++/--- 是文件头不算。 */
export function diffStat(diff: string | undefined): DiffStat | null {
  if (!diff) return null;
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

/** 展示 diff 的一行;gap 是省略的上下文,不占两侧内容索引。 */
export interface DisplayDiffRow {
  kind: "add" | "del" | "ctx" | "gap";
  /** 新增/上下文显示编辑后行号，删除显示原始行号；未知位置或 gap 为空串。 */
  gutter: string;
  text: string;
  /** 该行在旧文件中的索引;不存在时为 -1。 */
  oldIndex: number;
  /** 该行在新文件中的索引;不存在时为 -1。 */
  newIndex: number;
  /** 与配对的删除/新增行相比,这一行里真正改动的字符区间。 */
  marks?: WordRange[];
}

export interface ParsedDisplayDiff {
  rows: DisplayDiffRow[];
  /** 旧/新两侧按行拼接的内容,供 shiki 整体分词后把 token 贴回对应行。 */
  oldLines: string[];
  newLines: string[];
}

/** 行首是 +、- 或空格,随后是行号和内容。 */
const displayDiffLine = /^([+\- ]) *(\d+) (.*)$/;

/** 解析 edit / write 的展示 diff(形如 `+ 12 new line`);省略的上下文是一行 `...`。 */
export function parseDisplayDiff(diff: string): ParsedDisplayDiff {
  const rows: DisplayDiffRow[] = [];
  const oldLines: string[] = [];
  const newLines: string[] = [];
  if (!diff) return { rows, oldLines, newLines };

  const lines = diff.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let offset = 0;
  let canInfer = true;

  const pushAdd = (text: string, gutter = "") => {
    rows.push({ kind: "add", gutter, text, oldIndex: -1, newIndex: newLines.length });
    newLines.push(text);
  };
  const pushDel = (text: string, gutter = "") => {
    rows.push({ kind: "del", gutter, text, oldIndex: oldLines.length, newIndex: -1 });
    oldLines.push(text);
  };
  const pushCtx = (text: string, gutter = "") => {
    rows.push({ kind: "ctx", gutter, text, oldIndex: oldLines.length, newIndex: newLines.length });
    oldLines.push(text);
    newLines.push(text);
  };

  for (const line of lines) {
    if (line.trim() === "..." || line.trim() === "…") {
      rows.push({ kind: "gap", gutter: "", text: "…", oldIndex: -1, newIndex: -1 });
      continue;
    }
    if (line.startsWith("…") || line.startsWith("@@")) {
      rows.push({ kind: "gap", gutter: "", text: line, oldIndex: -1, newIndex: -1 });
      canInfer = false;
      continue;
    }
    const matched = displayDiffLine.exec(line);
    if (matched) {
      const text = matched[3] ?? "";
      const gutter = matched[2] ?? "";
      if (matched[1] === "+") {
        pushAdd(text, gutter);
        offset += 1;
      } else if (matched[1] === "-") {
        pushDel(text, gutter);
        offset -= 1;
      } else {
        // Saved context numbers refer to the old file; omitted unchanged regions keep the offset.
        const number = Number(gutter) + offset;
        pushCtx(text, canInfer && Number.isSafeInteger(number) && number > 0 ? String(number) : "");
      }
      continue;
    }
    // Unknown or truncated records may hide edits, so subsequent context positions are uncertain.
    canInfer = false;
    if (line.startsWith("+") && !line.startsWith("+++")) pushAdd(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) pushDel(line.slice(1));
    else if (line.startsWith(" ")) pushCtx(line.slice(1));
    else pushCtx(line);
  }

  markWordChanges(rows);
  return { rows, oldLines, newLines };
}

/** 改动区之外最多保留的上下文行数;工具生成 diff 时给的上下文是固定的,这里是展示上的上限。 */
const maxContextLines = 4;

/** 按改动规模自适应首尾上下文:改动越小留得越少(只改一两行不必再带一大片没动的代码),改动大了再放宽,最多 4 行。 */
export function adaptiveContextLines(changedRows: number): number {
  return Math.max(2, Math.min(maxContextLines, Math.ceil(changedRows / 2) + 1));
}

/** 长上下文只显示靠近两侧改动的行,并以细分隔带代表折叠内容;改动区首尾的上下文按改动规模自适应裁剪。 */
export function collapseDiffContext(rows: DisplayDiffRow[]): DisplayDiffRow[] {
  const output: DisplayDiffRow[] = [];
  const changedTotal = rows.reduce((sum, row) => sum + (row.kind === "add" || row.kind === "del" ? 1 : 0), 0);
  const edgeContext = adaptiveContextLines(changedTotal);
  const changedAfter = new Array<boolean>(rows.length + 1).fill(false);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    changedAfter[index] = changedAfter[index + 1]! || row?.kind === "add" || row?.kind === "del";
  }
  let index = 0;
  let hasChangeBefore = false;
  while (index < rows.length) {
    const row = rows[index];
    if (row?.kind !== "ctx" && row?.kind !== "gap") {
      output.push(row!);
      if (row?.kind === "add" || row?.kind === "del") hasChangeBefore = true;
      index += 1;
      continue;
    }

    // 工具自带的「…」省略标记也算这一段上下文,否则两处改动之间会出现孤立的几行夹在两条分隔带中间。
    const start = index;
    while (index < rows.length && (rows[index]?.kind === "ctx" || rows[index]?.kind === "gap")) index += 1;
    const run = rows.slice(start, index);
    const context = run.filter((item) => item.kind === "ctx");
    const hasChangeAfter = changedAfter[index] ?? false;
    if (context.length > 0 && (run.length > 3 || run.length > context.length) && hasChangeBefore && hasChangeAfter) {
      output.push(context[0]!);
      output.push({ kind: "gap", gutter: "", text: "", oldIndex: -1, newIndex: -1 });
      if (context.length > 1) output.push(context[context.length - 1]!);
    } else {
      // 省略标记只在两处改动之间有意义;停在首尾的(没有改动在它另一侧)只会在改动区外多出一条分隔带。
      const kept = run.filter((item) => item.kind !== "gap" || (hasChangeBefore && hasChangeAfter));
      if (changedTotal === 0 || (hasChangeBefore && hasChangeAfter)) output.push(...kept);
      // 首段只留紧挨着第一处改动的几行,尾段只留紧随最后一处改动的几行。
      else if (!hasChangeBefore) output.push(...kept.slice(-edgeContext));
      else output.push(...kept.slice(0, edgeContext));
    }
  }
  return output;
}

/** 汇总一组工具的 diff 增删行数,全部为空时返回 null。 */
export function totalDiffStat(tools: ToolTrace[]): DiffStat | null {
  let added = 0;
  let removed = 0;
  for (const tool of tools) {
    const stat = diffStat(tool.activity?.diff);
    if (stat) {
      added += stat.added;
      removed += stat.removed;
    }
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

/** 把文件路径拆成文件名和目录;没有目录部分时 dir 为空。 */
export function splitPath(path: string): { name: string; dir: string } {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return { name: path, dir: "" };
  return { name: normalized.slice(index + 1), dir: normalized.slice(0, index) };
}
