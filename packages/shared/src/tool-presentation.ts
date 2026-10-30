import type { BackgroundShellStatus } from "./index";

/** 可安全跨 IPC、用于工具结果展示的 JSON；不包含执行能力。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface PresentationBase {
  version: 1;
  source: "result" | "legacy" | "request";
  truncated?: boolean;
}

export type ToolPresentation = PresentationBase & (
  | { kind: "shell"; operation: "start" | "read" | "kill"; shell: { id: string; command?: string; cwd?: string; status?: string; exitCode?: number | null; startedAt?: number; endedAt?: number | null }; output?: string; killed?: boolean }
  | { kind: "memory"; operation: "read" | "saved" | "cleared" | "unchanged" | "update"; entries: Array<{ scope: string; path?: string; revision?: string; bytes?: number; exists?: boolean; content?: string; status?: string; error?: string }> }
  | { kind: "schedule"; operation: "create" | "list" | "update" | "delete"; tasks: JsonValue[]; runs: JsonValue[]; deletedId?: string }
  | { kind: "discovery"; query?: string; limit?: number; tools: Array<{ name: string; description?: string }> }
  | { kind: "resource"; operation: "list" | "templates" | "read"; server?: string; uri?: string; value: JsonValue; images?: { mimeType: string; data: string }[]; fullOutputPath?: string }
  | { kind: "goal"; goal?: JsonValue; validation?: JsonValue; requested?: JsonValue }
  | { kind: "json"; value: JsonValue }
  | { kind: "notice"; code: "browser-reset" }
);

const maxChars = 80_000;
const maxDepth = 12;
const maxNodes = 1_000;
const marker = "[Truncated]";
const markerLength = JSON.stringify(marker).length;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const maxImageBytes = 2 * 1024 * 1024;
const maxBase64Chars = Math.ceil(maxImageBytes / 3) * 4;
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const shellStatuses: Record<BackgroundShellStatus, true> = { running: true, exited: true, failed: true, killed: true, timed_out: true };

class InvalidJson extends Error {}
class JsonBudget extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/** 不执行 getter；访问器不是可发送的 JSON 数据。 */
function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new InvalidJson();
  return descriptor.value;
}

/**
 * 限定序列化体积、深度和节点数，复制为不带原型的数据。
 * 到达容器预算后立即停止读取后续元素；不扫描巨数组，不执行 getter/toJSON。
 * 对象中的 undefined 字段按 JSON.stringify 语义省略；根值/数组元素仍拒绝。
 * 其他非 JSON 值、循环和不可信对象原型安全回退为 undefined。
 */
export function boundToolJson(input: unknown): { value: JsonValue; truncated: boolean } | undefined {
  let remaining = maxChars;
  let nodes = maxNodes;
  let truncated = false;
  const active = new WeakSet<object>();
  const charge = (length: number): void => {
    if (length > remaining) throw new JsonBudget();
    remaining -= length;
  };
  const cut = (): string => {
    if (nodes <= 0) throw new JsonBudget();
    nodes--;
    charge(markerLength);
    truncated = true;
    return marker;
  };
  const walk = (value: unknown, depth: number): JsonValue => {
    if (depth >= maxDepth || nodes <= 0) return cut();
    nodes--;
    if (value === null || typeof value === "boolean") {
      charge(value === null ? 4 : value ? 4 : 5);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new InvalidJson();
      charge(JSON.stringify(value).length);
      return value;
    }
    if (typeof value === "string") {
      // 不为巨字符串分配无限大的临时 JSON；每轮最多检查 80k 字符。
      const candidate = value.slice(0, maxChars);
      if (candidate.length === value.length && JSON.stringify(candidate).length <= remaining) {
        charge(JSON.stringify(candidate).length);
        return candidate;
      }
      let low = 0;
      let high = Math.min(candidate.length, remaining);
      if (JSON.stringify(marker).length > remaining) throw new JsonBudget();
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (JSON.stringify(candidate.slice(0, middle) + marker).length <= remaining) low = middle;
        else high = middle - 1;
      }
      const clipped = candidate.slice(0, low) + marker;
      charge(JSON.stringify(clipped).length);
      truncated = true;
      return clipped;
    }
    if (!value || typeof value !== "object" || active.has(value)) throw new InvalidJson();
    const array = Array.isArray(value);
    if (!array && !record(value)) throw new InvalidJson();
    active.add(value);
    // 预留结束括号与截断占位，保证输出 JSON 永远不超过预算。
    const reserve = array ? markerLength + 1 : 64;
    charge(2 + reserve);
    if (nodes <= 0) throw new JsonBudget();
    nodes--; // 为容器尾部的截断节点预留一项。
    const result: JsonValue[] | { [key: string]: JsonValue } = array ? [] : Object.create(null);
    let count = 0;
    let stopped = false;
    const stop = (): void => {
      truncated = true;
      stopped = true;
      if (Array.isArray(result)) {
        result.push(marker);
        remaining += reserve - markerLength - (count ? 1 : 0);
      } else {
        let key = "$truncated";
        let suffix = 0;
        while (Object.hasOwn(result, key)) key = `$truncated${++suffix}`;
        result[key] = marker;
        remaining += reserve - JSON.stringify(key).length - 1 - markerLength - (count ? 1 : 0);
      }
    };
    const add = (key: string): boolean => {
      if (nodes <= 0) { stop(); return false; }
      const item = own(value, key);
      if (!array && item === undefined) return true;
      const before = remaining;
      try {
        if (count) charge(1);
        if (!array) {
          if (key.length > remaining) throw new JsonBudget();
          charge(JSON.stringify(key).length + 1);
        }
        const child = walk(item, depth + 1);
        if (Array.isArray(result)) result.push(child);
        else result[key] = child;
        count++;
        return true;
      } catch (error) {
        if (!(error instanceof JsonBudget)) throw error;
        remaining = before;
        stop();
        return false;
      }
    };
    try {
      if (array) {
        const length = own(value, "length");
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) throw new InvalidJson();
        for (let index = 0; index < length; index++) if (!add(String(index))) break;
      } else {
        let enumerated = 0;
        for (const key in value) {
          if (enumerated++ >= maxNodes) { stop(); break; }
          if (!Object.hasOwn(value, key) || forbiddenKeys.has(key)) continue;
          if (!Object.getOwnPropertyDescriptor(value, key)?.enumerable) continue;
          if (!add(key)) break;
        }
      }
    } finally { active.delete(value); }
    if (!stopped) { remaining += reserve; nodes++; }
    return result;
  };
  try {
    const value = walk(input, 0);
    return { value, truncated };
  } catch (error) {
    if (error instanceof JsonBudget) return { value: marker, truncated: true };
    return undefined;
  }
}

function isObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function optional(value: Record<string, JsonValue>, keys: string[], type: "string" | "number" | "boolean", nullable = false): boolean {
  return keys.every(key => !Object.hasOwn(value, key) || (nullable && value[key] === null) || typeof value[key] === type);
}
function strings(value: Record<string, JsonValue>, keys: string[]): boolean { return optional(value, keys, "string"); }
function oneOf(value: unknown, options: readonly string[]): boolean { return typeof value === "string" && options.includes(value); }
function jsonRoot(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value)) || Array.isArray(value) || record(value);
}
function objectList(value: JsonValue | undefined, required: string, validate: (entry: Record<string, JsonValue>) => boolean, clipped: boolean): Record<string, JsonValue>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: Record<string, JsonValue>[] = [];
  for (const entry of value) {
    if (clipped && (entry === marker || (isObject(entry) && entry.$truncated === marker && typeof entry[required] !== "string"))) continue;
    if (!isObject(entry) || typeof entry[required] !== "string" || !entry[required] || !validate(entry)) return undefined;
    entries.push(entry);
  }
  return entries;
}

/** MIME/base64 与解码后体积校验；图片预算独立于普通 JSON 的 80k 预算。 */
function parseImages(input: unknown): { images?: { mimeType: string; data: string }[]; truncated: boolean } {
  if (input === undefined) return { truncated: false };
  if (!Array.isArray(input)) throw new InvalidJson();
  const images: { mimeType: string; data: string }[] = [];
  let truncated = input.length > 3;
  for (let index = 0; index < Math.min(input.length, 3); index++) {
    const item = own(input, String(index));
    if (!record(item)) { truncated = true; continue; }
    const mimeType = own(item, "mimeType");
    const data = own(item, "data");
    if (typeof mimeType !== "string" || !imageTypes.has(mimeType) || typeof data !== "string" || !data.length || data.length > maxBase64Chars || data.length % 4 !== 0) {
      truncated = true; continue;
    }
    // 仅检查已限制长度的数据；padding 必须规范，不能混入 data: URL 或空白。
    if (/[^A-Za-z0-9+/=]/.test(data)) { truncated = true; continue; }
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    if (data.indexOf("=") !== (padding ? data.length - padding : -1)) { truncated = true; continue; }
    if (data.length / 4 * 3 - padding > maxImageBytes) { truncated = true; continue; }
    if (padding) {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const tail = alphabet.indexOf(data[data.length - padding - 1]!);
      if (tail < 0 || (padding === 2 ? tail % 16 : tail % 4) !== 0) { truncated = true; continue; }
    }
    images.push({ mimeType, data });
  }
  return { images, truncated };
}

const fields: Record<string, readonly string[]> = {
  shell: ["operation", "shell", "output", "killed"],
  memory: ["operation", "entries"],
  schedule: ["operation", "tasks", "runs", "deletedId"],
  discovery: ["limit", "tools", "query"],
  resource: ["operation", "server", "uri", "value", "fullOutputPath"],
  goal: ["goal", "validation", "requested"],
  json: ["value"],
  notice: ["code"],
};

/** 只接受已知版本和已校验类别，复制为有界数据；未知或损坏数据由调用方回退原文。 */
export function parseToolPresentation(input: unknown): ToolPresentation | undefined {
  try {
    if (!record(input) || own(input, "version") !== 1) return undefined;
    const kind = own(input, "kind");
    const source = own(input, "source");
    if (typeof kind !== "string" || !Object.hasOwn(fields, kind) || !oneOf(source, ["result", "legacy", "request"])) return undefined;
    const raw: Record<string, unknown> = Object.create(null);
    raw.version = 1;
    raw.kind = kind;
    raw.source = source;
    const inputTruncated = own(input, "truncated");
    if (inputTruncated !== undefined && typeof inputTruncated !== "boolean") return undefined;
    // 在 JSON 预算内预留最终截断标志的空间。
    raw.truncated = inputTruncated === true;
    for (const key of fields[kind]!) {
      const value = own(input, key);
      if (value !== undefined) raw[key] = value;
    }
    // 必需容器先检查原始形状；预算不能把原本损坏的类别修复成成功结果。
    if (kind === "schedule" && (!oneOf(raw.operation, ["create", "list", "update", "delete"]) || !Array.isArray(raw.tasks) || !Array.isArray(raw.runs)
      || (raw.deletedId !== undefined && typeof raw.deletedId !== "string"))) return undefined;
    if (kind === "discovery" && (!Array.isArray(raw.tools) || (raw.query !== undefined && typeof raw.query !== "string")
      || (raw.limit !== undefined && (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit <= 0)))) return undefined;
    if (kind === "resource" && (!oneOf(raw.operation, ["list", "templates", "read"])
      || ["server", "uri", "fullOutputPath"].some(key => raw[key] !== undefined && typeof raw[key] !== "string"))) return undefined;
    if ((kind === "resource" || kind === "json") && (!Object.hasOwn(raw, "value") || !jsonRoot(raw.value))) return undefined;
    if (kind === "shell") {
      if (!record(raw.shell)) return undefined;
      const status = own(raw.shell, "status");
      if (status !== undefined && (typeof status !== "string" || !Object.hasOwn(shellStatuses, status))) return undefined;
    }
    const bounded = boundToolJson(raw);
    if (!bounded || !isObject(bounded.value)) return undefined;
    const value = bounded.value;
    if (value.version !== 1 || value.kind !== kind || value.source !== source) return undefined;
    const clipped = inputTruncated === true || bounded.truncated;
    // 仅当本轮 bound 真正省略字段时补占位；不能仅凭调用方的 truncated 标志放宽校验。
    if (bounded.truncated) {
      if (kind === "schedule") {
        if (!Object.hasOwn(value, "tasks")) value.tasks = [];
        if (!Object.hasOwn(value, "runs")) value.runs = [];
      } else if (kind === "discovery" && !Object.hasOwn(value, "tools")) value.tools = [];
      else if ((kind === "resource" || kind === "json") && !Object.hasOwn(value, "value")) value.value = marker;
      // 根级占位由类型化容器和 truncated 标志代替，回收的体积也容纳补回的空字段。
      delete value.$truncated;
    }
    let valid = false;
    switch (kind) {
      case "shell": {
        const shell = value.shell;
        valid = oneOf(value.operation, ["start", "read", "kill"]) && isObject(shell) && typeof shell.id === "string" && Boolean(shell.id)
          && strings(shell, ["command", "cwd", "status"])
          && (!Object.hasOwn(shell, "status") || (typeof shell.status === "string" && Object.hasOwn(shellStatuses, shell.status)))
          && optional(shell, ["exitCode", "endedAt"], "number", true)
          && optional(shell, ["startedAt"], "number") && strings(value, ["output"]) && optional(value, ["killed"], "boolean");
        break;
      }
      case "memory": {
        const entries = objectList(value.entries, "scope", entry => strings(entry, ["path", "revision", "content", "status", "error"])
          && (!Object.hasOwn(entry, "status") || oneOf(entry.status, ["read", "failed"]))
          && optional(entry, ["bytes"], "number") && (!Object.hasOwn(entry, "bytes") || (entry.bytes as number) >= 0) && optional(entry, ["exists"], "boolean"), bounded.truncated);
        valid = oneOf(value.operation, ["read", "saved", "cleared", "unchanged", "update"]) && Boolean(entries);
        if (entries) value.entries = entries;
        break;
      }
      case "schedule": valid = oneOf(value.operation, ["create", "list", "update", "delete"]) && Array.isArray(value.tasks) && Array.isArray(value.runs) && strings(value, ["deletedId"]); break;
      case "discovery": {
        const tools = objectList(value.tools, "name", entry => strings(entry, ["description"]), bounded.truncated);
        valid = Boolean(tools) && strings(value, ["query"]) && optional(value, ["limit"], "number") && (!Object.hasOwn(value, "limit") || (Number.isInteger(value.limit) && (value.limit as number) > 0));
        if (tools) value.tools = tools;
        break;
      }
      case "resource": valid = oneOf(value.operation, ["list", "templates", "read"]) && Object.hasOwn(value, "value") && strings(value, ["server", "uri", "fullOutputPath"]); break;
      case "goal": valid = ["goal", "validation", "requested"].some(key => Object.hasOwn(value, key)); break;
      case "json": valid = Object.hasOwn(value, "value"); break;
      case "notice": valid = value.code === "browser-reset"; break;
    }
    if (!valid) return undefined;
    // 不透传未声明的嵌套身份/条目字段。
    if (kind === "shell" && isObject(value.shell)) {
      const shell = value.shell;
      const cleaned: Record<string, JsonValue> = Object.create(null);
      for (const key of ["id", "command", "cwd", "status", "exitCode", "startedAt", "endedAt"]) if (Object.hasOwn(shell, key)) cleaned[key] = shell[key]!;
      value.shell = cleaned;
    }
    if (kind === "memory" || kind === "discovery") {
      const key = kind === "memory" ? "entries" : "tools";
      const allowed = kind === "memory" ? ["scope", "path", "revision", "bytes", "exists", "content", "status", "error"] : ["name", "description"];
      value[key] = (value[key] as Record<string, JsonValue>[]).map(entry => {
        const cleaned: Record<string, JsonValue> = Object.create(null);
        for (const field of allowed) if (Object.hasOwn(entry, field)) cleaned[field] = entry[field]!;
        return cleaned;
      });
    }
    const output = value as unknown as ToolPresentation;
    if (clipped) output.truncated = true;
    else delete output.truncated;
    if (kind === "resource" && output.kind === "resource") {
      const parsed = parseImages(own(input, "images"));
      if (parsed.images) output.images = parsed.images;
      if (parsed.truncated) output.truncated = true;
    }
    return output;
  } catch { return undefined; }
}
