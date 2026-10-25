import type { ToolActivity } from "@vela/shared";

/** 流式生成参数时值得提前展示的工具：只有它们的参数会很长。 */
export function isStreamedFileTool(toolName: string): boolean {
  return toolName === "edit" || toolName === "write";
}

interface JsonString {
  text: string;
  /** 结尾引号已经出现；没出现说明模型还在写这个字符串。 */
  closed: boolean;
}

const simpleEscapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "/": "/", "\\": "\\", '"': '"' };

/** 读取从 start 开始的 JSON 字符串；末尾被截断的转义序列直接丢弃。 */
function readJsonString(raw: string, start: number): JsonString {
  let text = "";
  for (let index = start; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === '"') return { text, closed: true };
    if (char !== "\\") {
      text += char;
      continue;
    }
    const next = raw[index + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = raw.slice(index + 2, index + 6);
      if (hex.length < 4) break;
      const code = Number.parseInt(hex, 16);
      if (!Number.isNaN(code)) text += String.fromCharCode(code);
      index += 5;
      continue;
    }
    text += simpleEscapes[next] ?? next;
    index += 1;
  }
  return { text, closed: false };
}

/** 在未写完的 JSON 里找出所有 "key": "..." 的字符串值。值里的引号是转义的，不会被当成键。 */
function readJsonStringValues(raw: string, key: string): JsonString[] {
  const values: JsonString[] = [];
  const needle = `"${key}"`;
  let from = 0;
  for (;;) {
    const found = raw.indexOf(needle, from);
    if (found < 0) break;
    let cursor = found + needle.length;
    while (raw[cursor] === " " || raw[cursor] === "\n" || raw[cursor] === "\t" || raw[cursor] === "\r") cursor++;
    if (raw[cursor] !== ":") {
      from = found + needle.length;
      continue;
    }
    cursor++;
    while (raw[cursor] === " " || raw[cursor] === "\n" || raw[cursor] === "\t" || raw[cursor] === "\r") cursor++;
    if (raw[cursor] !== '"') {
      from = cursor;
      continue;
    }
    const value = readJsonString(raw, cursor + 1);
    values.push(value);
    if (!value.closed) break;
    from = cursor + 1 + value.text.length;
  }
  return values;
}

function lineCount(text: string): number {
  if (!text) return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 流式 diff 只保留最近这些行：流式期间每 100ms 整段重发一次，不能随文件变长而变慢。 */
const maxStreamedDiffLines = 400;

/** 展示用 diff 行：`+ 12 text`，与 edit / write 完成后的格式一致，渲染层同一套解析。 */
function diffLines(sign: "+" | "-", lines: string[], firstLine = 1): string[] {
  const width = String(firstLine + lines.length - 1).length;
  return lines.map((line, index) => `${sign}${String(firstLine + index).padStart(width, " ")} ${line}`);
}

function streamedDiff(toolName: string, raw: string): string {
  let rows: string[];
  if (toolName === "write") {
    rows = readJsonStringValues(raw, "content").flatMap((value) => diffLines("+", splitLines(value.text)));
  } else {
    // edit 只有片段没有整份文件，行号按每处替换内部从 1 开始；不同替换之间用省略行隔开。
    const olds = readJsonStringValues(raw, "oldText");
    const news = readJsonStringValues(raw, "newText");
    rows = [];
    for (let index = 0; index < Math.max(olds.length, news.length); index++) {
      if (rows.length > 0) rows.push("…");
      rows.push(...diffLines("-", splitLines(olds[index]?.text ?? "")), ...diffLines("+", splitLines(news[index]?.text ?? "")));
    }
  }
  if (rows.length <= maxStreamedDiffLines) return rows.join("\n");
  return ["… 前面的内容已省略，完整差异会在写入后显示", ...rows.slice(-maxStreamedDiffLines)].join("\n");
}

/**
 * 从还没写完的 edit / write 参数 JSON 里估出文件路径、行数和展示 diff。
 * write 的 content 是新增行；edit 的 oldText / newText 分别是删除行和新增行，
 * 最终 diff 会合并相同的上下文，所以这里只是实时进度，不是最终结果。
 */
export function streamedFileActivity(toolName: string, raw: string): ToolActivity {
  const paths = [...readJsonStringValues(raw, "path"), ...readJsonStringValues(raw, "file_path")];
  const path = paths.find((value) => value.closed && value.text.trim())?.text;
  let added = 0;
  let removed = 0;
  if (toolName === "write") {
    for (const value of readJsonStringValues(raw, "content")) added += lineCount(value.text);
  } else {
    for (const value of readJsonStringValues(raw, "newText")) added += lineCount(value.text);
    for (const value of readJsonStringValues(raw, "oldText")) removed += lineCount(value.text);
  }
  const diff = streamedDiff(toolName, raw);
  return { ...(path ? { path } : {}), ...(diff ? { diff } : {}), streaming: { added, removed } };
}

export interface ToolStreamUpdate {
  toolCallId: string;
  toolName: string;
  activity: ToolActivity;
  /** 这个调用第一次被报告：渲染层据此新建一张运行中的卡片。 */
  first: boolean;
}

interface PendingCall {
  toolName: string;
  raw: string;
  reported: boolean;
  lastEmitAt: number;
  /** toolcall_end 已到：参数完整，接下来会真正执行。 */
  complete: boolean;
}

/** 两次进度事件之间的最短间隔；模型每个 token 都发 delta，逐个转发会淹没渲染层。参数很长时放慢。 */
const emitIntervalMs = 100;
const slowEmitIntervalMs = 250;
const slowAfterChars = 20_000;

/**
 * 跟踪 assistant 消息里 edit / write 调用的流式参数。
 * 只产出展示用的进度，从不执行任何东西：真正的写入仍然等 SDK 拿到完整参数后走 tool_execution_*。
 */
export class ToolStreamTracker {
  private readonly calls = new Map<string, PendingCall>();
  /** contentIndex -> toolCallId；toolcall_start 时部分模型还没给出 id，后面的 delta 再补。 */
  private readonly byIndex = new Map<number, string>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 处理 SDK 的 message_update.assistantMessageEvent；与文件工具无关的事件返回 null。 */
  update(event: {
    type: string;
    contentIndex?: number;
    delta?: string;
    toolCall?: { id: string; name: string; arguments: unknown };
    partial?: { content?: ReadonlyArray<{ type: string; id?: string; name?: string }> };
  }): ToolStreamUpdate | null {
    if (event.type !== "toolcall_start" && event.type !== "toolcall_delta" && event.type !== "toolcall_end") return null;
    const index = event.contentIndex ?? -1;
    const block = event.partial?.content?.[index];
    const toolName = event.toolCall?.name || (block?.type === "toolCall" ? block.name : undefined) || "";
    const toolCallId = event.toolCall?.id || (block?.type === "toolCall" ? block.id : undefined) || this.byIndex.get(index) || "";
    if (!isStreamedFileTool(toolName) || !toolCallId) return null;
    this.byIndex.set(index, toolCallId);

    let call = this.calls.get(toolCallId);
    if (!call) {
      call = { toolName, raw: "", reported: false, lastEmitAt: 0, complete: false };
      this.calls.set(toolCallId, call);
    }
    if (event.type === "toolcall_delta") call.raw += event.delta ?? "";
    if (event.type === "toolcall_end") {
      call.complete = true;
      // 没有走 delta 的提供商只在结尾给完整参数。
      if (!call.raw && event.toolCall) call.raw = JSON.stringify(event.toolCall.arguments ?? {});
    }

    const at = this.now();
    const due = !call.reported || event.type === "toolcall_end" || at - call.lastEmitAt >= (call.raw.length > slowAfterChars ? slowEmitIntervalMs : emitIntervalMs);
    if (!due) return null;
    const first = !call.reported;
    call.reported = true;
    call.lastEmitAt = at;
    return { toolCallId, toolName, activity: streamedFileActivity(toolName, call.raw), first };
  }

  /** 工具真正开始执行：进度阶段结束。 */
  executed(toolCallId: string): void {
    this.calls.delete(toolCallId);
  }

  /**
   * 一条 assistant 消息结束：返回不会再执行的调用（参数没写完，或消息被中断/出错），
   * 渲染层要把它们收尾，否则卡片会一直转圈。
   */
  settle(aborted: boolean): Array<{ toolCallId: string; toolName: string; path?: string }> {
    const abandoned: Array<{ toolCallId: string; toolName: string; path?: string }> = [];
    for (const [toolCallId, call] of this.calls) {
      if (call.complete && !aborted) continue;
      abandoned.push({ toolCallId, toolName: call.toolName, path: streamedFileActivity(call.toolName, call.raw).path });
      this.calls.delete(toolCallId);
    }
    this.byIndex.clear();
    return abandoned;
  }
}
