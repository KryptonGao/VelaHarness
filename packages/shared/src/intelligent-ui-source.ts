import {
  isForbiddenKey,
  uiLimits,
  type UiScalar,
  type UiSourceDefinition,
  type UiSourceMessage,
  type UiSourceRow,
  type UiSourceSnapshot,
  type UiToolCall,
} from "./intelligent-ui";

/**
 * 数据源解析（IUI-11）：把会话里真实的工具结果变成带 sourceId / fetchedAt / status 的只读快照。
 *
 * 纯函数，不读时间、不联网：当前时间由调用方传入。模型只能「指名」一次工具调用，
 * 数据值永远来自工具实际返回的正文，所以界面展示的内容可以追溯到一条真实的工具记录。
 */

/** 工具结果超过这个年龄就标「可能已过期」；刷新要用户确认，经 Agent 重新运行工具。 */
export const uiSourceStaleAfterMs = 10 * 60_000;

/** 与 tool-activity 截断时追加的提示保持一致：正文被截断时 JSON/CSV 都不可信。 */
const truncationMarker = "已截断";

interface MessageLike {
  tools?: ReadonlyArray<{ id: string; name: string; status: string; activity?: { command?: string; path?: string; body?: string } }>;
  turnCompletedAt?: number;
  timestamp?: number | null;
}

/** 取第 0..upTo（含）条消息里的工具调用，按时间顺序排列。 */
export function toolCallsFromMessages(messages: readonly MessageLike[], upTo: number): UiToolCall[] {
  const calls: UiToolCall[] = [];
  const end = Math.min(upTo, messages.length - 1);
  for (let index = 0; index <= end; index += 1) {
    const message = messages[index];
    const completedAt = message.turnCompletedAt ?? (typeof message.timestamp === "number" ? message.timestamp : null);
    for (const tool of message.tools ?? []) {
      const status = tool.status === "running" || tool.status === "error" ? tool.status : "done";
      calls.push({
        id: tool.id,
        name: tool.name,
        status,
        command: tool.activity?.command,
        path: tool.activity?.path,
        body: tool.activity?.body,
        completedAt,
      });
    }
  }
  return calls;
}

function snapshot(definition: UiSourceDefinition, patch: Partial<UiSourceSnapshot>): UiSourceSnapshot {
  return {
    name: definition.name,
    sourceId: null,
    tool: definition.tool,
    subject: null,
    status: "loading",
    fetchedAt: null,
    columns: [],
    rows: [],
    text: null,
    scalar: undefined,
    truncated: false,
    message: null,
    detail: null,
    ...patch,
  };
}

function matches(definition: UiSourceDefinition, call: UiToolCall): boolean {
  if (call.name !== definition.tool) return false;
  if (definition.call !== undefined && call.id !== definition.call) return false;
  if (definition.match) {
    const subject = `${call.command ?? ""}\n${call.path ?? ""}`.toLowerCase();
    if (!subject.includes(definition.match.toLowerCase())) return false;
  }
  return true;
}

export interface ResolveSourceOptions {
  now: number;
  /** 界面或回复还在流式生成：找不到调用时先显示加载中而不是失败。 */
  receiving?: boolean;
}

/** 按声明挑选最近一次匹配的工具调用并解析其结果。 */
export function resolveUiSource(definition: UiSourceDefinition, calls: readonly UiToolCall[], options: ResolveSourceOptions): UiSourceSnapshot {
  let found: UiToolCall | undefined;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (matches(definition, calls[index])) { found = calls[index]; break; }
  }
  if (!found) {
    return options.receiving
      ? snapshot(definition, { status: "loading" })
      : snapshot(definition, { status: "error", message: "not_found" });
  }
  const subject = (found.command ?? found.path ?? "").split("\n")[0].trim().slice(0, 160);
  const base = { sourceId: found.id, fetchedAt: found.completedAt, subject: subject || null };
  if (found.status === "running") return snapshot(definition, { ...base, status: "loading" });
  const body = found.body ?? "";
  if (found.status === "error") {
    return snapshot(definition, { ...base, status: "error", message: "tool_error", detail: body.replace(/\s+/g, " ").trim().slice(0, 200) || null });
  }
  const parsed = parseBody(definition, body);
  if (!parsed.ok) return snapshot(definition, { ...base, status: "error", message: parsed.message });
  const stale = found.completedAt !== null && options.now - found.completedAt > uiSourceStaleAfterMs;
  const empty = parsed.rows.length === 0 && parsed.scalar === undefined && !parsed.text;
  const status = empty ? "empty" : stale ? "stale" : "ok";
  return snapshot(definition, {
    ...base,
    status,
    columns: parsed.columns,
    rows: parsed.rows,
    text: parsed.text,
    scalar: parsed.scalar,
    truncated: parsed.truncated,
    message: empty ? "no_output" : null,
  });
}

type Parsed =
  | { ok: true; columns: string[]; rows: UiSourceRow[]; text: string | null; scalar: UiScalar | undefined; truncated: boolean }
  | { ok: false; message: UiSourceMessage };

function parseBody(definition: UiSourceDefinition, body: string): Parsed {
  if (body.length > uiLimits.sourceChars) return { ok: false, message: "too_large" };
  const cut = body.trimEnd().endsWith(truncationMarker) && body.includes("…");
  switch (definition.format) {
    case "text": {
      const text = cut ? body.replace(/\n?… [^\n]*$/, "") : body;
      return { ok: true, columns: [], rows: [], text: text.trim() ? text : null, scalar: undefined, truncated: cut };
    }
    case "lines": {
      const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean).filter(line => !(cut && line.startsWith("…")));
      const kept = lines.slice(0, uiLimits.sourceRows);
      const rows = kept.map((line, index): UiSourceRow => ({ line: index + 1, text: line.slice(0, uiLimits.sourceCell) }));
      return { ok: true, columns: rows.length ? ["line", "text"] : [], rows, text: null, scalar: undefined, truncated: cut || lines.length > kept.length };
    }
    case "csv": {
      if (cut) return { ok: false, message: "truncated" };
      return parseCsv(body);
    }
    case "json": {
      if (cut) return { ok: false, message: "truncated" };
      let value: unknown;
      try { value = JSON.parse(body); } catch { return { ok: false, message: "not_json" }; }
      const selected = walkPath(value, definition.path);
      if (selected === MISSING) return { ok: false, message: "bad_path" };
      return fromJson(selected);
    }
  }
}

const MISSING = Symbol("missing");

function walkPath(value: unknown, path: ReadonlyArray<string | number>): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (typeof segment !== "number" || !Number.isInteger(segment) || segment < 0 || segment >= current.length) return MISSING;
      current = current[segment];
    } else if (current !== null && typeof current === "object") {
      if (typeof segment !== "string" || isForbiddenKey(segment) || !Object.prototype.hasOwnProperty.call(current, segment)) return MISSING;
      current = (current as Record<string, unknown>)[segment];
    } else {
      return MISSING;
    }
  }
  return current;
}

function cell(value: unknown): UiScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, uiLimits.sourceCell);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every(item => item === null || typeof item !== "object")) {
    return value.map(item => String(item ?? "")).join(", ").slice(0, uiLimits.sourceCell);
  }
  return null;
}

function rowsOf(items: unknown[]): { columns: string[]; rows: UiSourceRow[]; truncated: boolean } {
  const columns: string[] = [];
  const seen = new Set<string>();
  const rows: UiSourceRow[] = [];
  for (const item of items.slice(0, uiLimits.sourceRows)) {
    const row: UiSourceRow = {};
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const [key, value] of Object.entries(item)) {
        if (isForbiddenKey(key)) continue;
        if (!seen.has(key)) {
          if (columns.length >= uiLimits.sourceColumns) continue;
          seen.add(key);
          columns.push(key);
        }
        row[key] = cell(value);
      }
    } else {
      if (!seen.has("value")) { seen.add("value"); columns.push("value"); }
      row.value = cell(item);
    }
    rows.push(row);
  }
  return { columns, rows, truncated: items.length > uiLimits.sourceRows };
}

function fromJson(value: unknown): Parsed {
  if (Array.isArray(value)) {
    const { columns, rows, truncated } = rowsOf(value);
    return { ok: true, columns, rows, text: null, scalar: undefined, truncated };
  }
  if (value !== null && typeof value === "object") {
    const { columns, rows } = rowsOf([value]);
    return { ok: true, columns, rows, text: null, scalar: undefined, truncated: false };
  }
  return { ok: true, columns: [], rows: [], text: null, scalar: value === null ? null : cell(value), truncated: false };
}

/** 小型 CSV 解析（RFC 4180 的常用子集：引号、转义引号、引号内换行）。第一行是表头。 */
export function parseCsv(text: string): Parsed {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let index = 0;
  const push = () => { record.push(field); field = ""; };
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") push();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      push();
      if (record.some(value => value !== "") || record.length > 1) records.push(record);
      record = [];
      if (records.length > uiLimits.sourceRows + 1) break;
    } else field += char;
    index += 1;
  }
  if (quoted) return { ok: false, message: "bad_csv" };
  if (field !== "" || record.length > 0) { push(); records.push(record); }
  if (records.length === 0) return { ok: true, columns: [], rows: [], text: null, scalar: undefined, truncated: false };
  const header = records[0].map(name => name.trim()).slice(0, uiLimits.sourceColumns);
  const columns = header.map((name, position) => (name && !isForbiddenKey(name) ? name : `column${position + 1}`));
  const unique = columns.map((name, position) => (columns.indexOf(name) === position ? name : `${name}_${position + 1}`));
  const body = records.slice(1, uiLimits.sourceRows + 1);
  const rows = body.map((values): UiSourceRow => {
    const row: UiSourceRow = {};
    unique.forEach((name, position) => {
      const raw = values[position] ?? "";
      const trimmed = raw.trim();
      row[name] = trimmed !== "" && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed) && Number.isFinite(Number(trimmed)) ? Number(trimmed) : raw.slice(0, uiLimits.sourceCell);
    });
    return row;
  });
  return { ok: true, columns: unique, rows, text: null, scalar: undefined, truncated: records.length - 1 > uiLimits.sourceRows };
}

/** 一句话说明数据来自哪次工具调用，用在「复制文字」和导出里。 */
export function describeSourceProvenance(snapshot: UiSourceSnapshot): string {
  const id = snapshot.sourceId ? snapshot.sourceId.slice(0, 12) : "–";
  const when = snapshot.fetchedAt !== null ? new Date(snapshot.fetchedAt).toISOString() : "unknown time";
  return `${snapshot.tool} (${id}) · ${when} · ${snapshot.status}`;
}
