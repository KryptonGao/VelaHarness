/**
 * 记忆的共享契约：作用域、目标身份、revision、错误码与加载状态。
 * 文件是唯一内容来源；这里只定义类型，读写由 @vela/agent 的 MemoryService 负责。
 */

import { isAppLocale, type AppLocale } from "./i18n";

/** 全局记忆跨项目复用；项目记忆绑定会话自己的工作区。 */
export const memoryScopes = ["global", "project"] as const;

export type MemoryScope = (typeof memoryScopes)[number];

/** 单个记忆文件的 UTF-8 字节上限；超限不截断，跳过加载并保留现场。 */
export const memoryFileMaxBytes = 16 * 1024;

/** 目标文件不存在时的版本指纹；必须与空文件的指纹不同。 */
export const memoryAbsentRevision = "absent";

/** 内容指纹。它标识一次读取看到的版本，用于保存和删除时的冲突检查。 */
export type MemoryRevision = string;

/** 记忆目标身份。项目目标必须给出会话工作区的绝对路径，不接受任意文件路径。 */
export interface MemoryTarget {
  scope: MemoryScope;
  /** 项目记忆为工作区绝对路径；全局记忆为 null。 */
  workspace: string | null;
}

export interface MemoryDocument {
  scope: MemoryScope;
  /** 项目记忆为工作区真实路径；全局记忆为 null。 */
  workspace: string | null;
  path: string;
  exists: boolean;
  content: string;
  revision: MemoryRevision;
}

export const memoryErrorCodes = [
  "invalid-target",
  "invalid-content",
  "content-too-large",
  "invalid-encoding",
  "unsafe-path",
  "not-a-file",
  "unavailable",
  "conflict",
  "busy",
  "io-error",
] as const;

export type MemoryErrorCode = (typeof memoryErrorCodes)[number];

/** 一次执行中每个来源的加载状态。 */
export type MemoryLoadStatus = "loaded" | "missing" | "failed";

/** 单个来源的加载结果；加载失败不抛出，由调用方决定如何提示。 */
export interface MemorySourceLoad {
  scope: MemoryScope;
  workspace: string | null;
  path: string | null;
  status: MemoryLoadStatus;
  content: string;
  revision: MemoryRevision | null;
  bytes: number;
  error: MemoryErrorCode | null;
  message: string | null;
}

/**
 * 加载状态的可见子集：不含正文，可以安全地进入界面状态、事件和日志。
 * 正文只存在于当次请求的提示词里，不会复制到持久化状态。
 */
export interface MemoryLoadReport {
  scope: MemoryScope;
  workspace: string | null;
  path: string | null;
  status: MemoryLoadStatus;
  bytes: number;
  error: MemoryErrorCode | null;
  message: string | null;
}

export function memoryLoadReport(load: MemorySourceLoad): MemoryLoadReport {
  return {
    scope: load.scope,
    workspace: load.workspace,
    path: load.path,
    status: load.status,
    bytes: load.bytes,
    error: load.error,
    message: load.message,
  };
}

// ---------- 设置页管理入口 ----------

/** 记忆管理入口的目标；项目目标用已登记的工作区路径标识，主进程负责校验。 */
export interface MemoryTargetInput {
  scope: MemoryScope;
  /** 项目记忆的工作区绝对路径；全局记忆为 null 或缺省。 */
  workspace?: string | null;
}

export interface MemoryListInput {
  /** 当前会话；主进程用它推导默认项目，不直接信任 renderer 传来的工作区身份。 */
  conversationId?: string | null;
}

export interface MemorySaveInput extends MemoryTargetInput {
  content: string;
  /** 读取时拿到的 revision；冲突时保留原文件并返回 conflict。 */
  expectedRevision: MemoryRevision;
}

export interface MemoryRemoveInput extends MemoryTargetInput {
  expectedRevision: MemoryRevision;
}

/** 已登记的工作区；available 为 false 表示目录已失效，仍保留在列表里。 */
export interface MemoryProject {
  workspace: string;
  name: string;
  available: boolean;
}

/** “全部记忆”列表里的一项；只含元数据，选中后再读取正文。 */
export interface MemoryCatalogEntry {
  scope: MemoryScope;
  workspace: string | null;
  /** 项目名（工作区目录名）；全局记忆为空字符串。 */
  name: string;
  path: string;
  exists: boolean;
  status: MemoryLoadStatus;
  bytes: number;
  revision: MemoryRevision | null;
  error: MemoryErrorCode | null;
  message: string | null;
}

export interface MemoryCatalog {
  /** Agent 记忆总开关；不影响设置页管理或删除文件。 */
  enabled: boolean;
  global: MemoryCatalogEntry;
  projects: MemoryCatalogEntry[];
  /** 已登记的工作区，供“项目记忆”选择器使用。 */
  workspaces: MemoryProject[];
  /** 当前会话的实际项目；无项目时为空。 */
  currentProject: string | null;
}

/** 可预期的记忆操作失败；IPC 用结果返回，不作为异常抛出。 */
export interface MemoryFailure {
  code: MemoryErrorCode;
  message: string;
  path: string | null;
}

export type MemoryResult<T> = { ok: true; value: T } | { ok: false; error: MemoryFailure };

/** 设置页记忆管理接口；正文由 read 单独返回，列表只含元数据。 */
export interface MemoryApi {
  setEnabled(input: { enabled: boolean }): Promise<MemoryResult<{ enabled: boolean }>>;
  list(input?: MemoryListInput): Promise<MemoryResult<MemoryCatalog>>;
  read(input: MemoryTargetInput): Promise<MemoryResult<MemoryDocument>>;
  save(input: MemorySaveInput): Promise<MemoryResult<MemoryDocument>>;
  remove(input: MemoryRemoveInput): Promise<MemoryResult<null>>;
}

// ---------- 对话经验提炼到项目记忆 ----------

export const memoryDistillCategories = ["command", "gotcha", "dependency", "convention"] as const;
export type MemoryDistillCategory = (typeof memoryDistillCategories)[number];

export interface MemoryDistillRequest {
  conversationId: string;
  locale: AppLocale;
  /** 渲染层生成的请求 id，用来取消。 */
  requestId: string;
  /** 可选：只提炼到该可见用户轮次（1-based）为止的对话内容。 */
  upToTurn?: number;
}

export interface MemoryDistillDraft {
  conversationId: string;
  /** 项目记忆所属工作区路径，提交保存时传给 memory.save。 */
  workspace: string;
  /** 目标项目 MEMORY.md 的真实路径。 */
  path: string;
  exists: boolean;
  /** 读取时的文件内容与版本，保存时用于 Diff 预览与冲突检测。 */
  baseContent: string;
  baseRevision: MemoryRevision;
  /** 提炼出的待追加 Markdown 片段；为空串表示没有值得沉淀的新规范。 */
  addition: string;
  /** 模型对本次提炼要点的简短概括。 */
  summary: string;
  source: "model";
}

export function parseMemoryDistillRequest(raw: unknown): MemoryDistillRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("记忆提炼参数不正确");
  const input = raw as Record<string, unknown>;
  if (typeof input.conversationId !== "string" || !input.conversationId.trim() || input.conversationId.length > 200) {
    throw new Error("记忆提炼的会话标识不正确");
  }
  if (!isAppLocale(input.locale)) throw new Error("记忆提炼语言不正确");
  if (typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100) {
    throw new Error("记忆提炼请求标识不正确");
  }
  let upToTurn: number | undefined;
  if (input.upToTurn !== undefined) {
    if (typeof input.upToTurn !== "number" || !Number.isSafeInteger(input.upToTurn) || input.upToTurn < 1) {
      throw new Error("记忆提炼轮次参数不正确");
    }
    upToTurn = input.upToTurn;
  }
  return {
    conversationId: input.conversationId,
    locale: input.locale,
    requestId: input.requestId,
    ...(upToTurn !== undefined ? { upToTurn } : {}),
  };
}

/**
 * 把提炼出的 Markdown 片段安全追加到原有 MEMORY.md 末尾：
 * 保留已有内容和结构不变，只在需要时补一个空行分隔。
 */
export function appendMemoryContent(baseContent: string, addition: string): string {
  const snippet = addition.trim();
  if (!snippet) return baseContent;
  if (baseContent.trim().length === 0) return `${snippet}\n`;
  const trimmedTail = baseContent.replace(/\n+$/, "");
  return `${trimmedTail}\n\n${snippet}\n`;
}

type DiffOp = { kind: "ctx" | "del" | "add"; text: string; oldLine: number; newLine: number };

function splitDiffLines(text: string): string[] {
  if (!text) return [];
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  return normalized.split("\n");
}

function computeLineOps(oldLines: readonly string[], newLines: readonly string[]): DiffOp[] {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < prefix; i += 1) {
    ops.push({ kind: "ctx", text: oldLines[i]!, oldLine: i + 1, newLine: i + 1 });
  }

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);
  const m = oldMid.length;
  const n = newMid.length;

  if (m === 0 && n === 0) {
    return ops;
  }

  if (m === 0) {
    for (let j = 0; j < n; j += 1) {
      ops.push({ kind: "add", text: newMid[j]!, oldLine: prefix, newLine: prefix + j + 1 });
    }
  } else if (n === 0) {
    for (let i = 0; i < m; i += 1) {
      ops.push({ kind: "del", text: oldMid[i]!, oldLine: prefix + i + 1, newLine: prefix });
    }
  } else if (m * n <= 250_000) {
    const stride = n + 1;
    const dp = new Uint32Array((m + 1) * stride);
    for (let i = m - 1; i >= 0; i -= 1) {
      for (let j = n - 1; j >= 0; j -= 1) {
        dp[i * stride + j] = oldMid[i] === newMid[j]
          ? 1 + dp[(i + 1) * stride + (j + 1)]!
          : Math.max(dp[(i + 1) * stride + j]!, dp[i * stride + (j + 1)]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (oldMid[i] === newMid[j]) {
        ops.push({ kind: "ctx", text: oldMid[i]!, oldLine: prefix + i + 1, newLine: prefix + j + 1 });
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * stride + j]! >= dp[i * stride + (j + 1)]!) {
        ops.push({ kind: "del", text: oldMid[i]!, oldLine: prefix + i + 1, newLine: prefix + j });
        i += 1;
      } else {
        ops.push({ kind: "add", text: newMid[j]!, oldLine: prefix + i, newLine: prefix + j + 1 });
        j += 1;
      }
    }
    while (i < m) {
      ops.push({ kind: "del", text: oldMid[i]!, oldLine: prefix + i + 1, newLine: prefix + j });
      i += 1;
    }
    while (j < n) {
      ops.push({ kind: "add", text: newMid[j]!, oldLine: prefix + i, newLine: prefix + j + 1 });
      j += 1;
    }
  } else {
    for (let i = 0; i < m; i += 1) {
      ops.push({ kind: "del", text: oldMid[i]!, oldLine: prefix + i + 1, newLine: prefix });
    }
    for (let j = 0; j < n; j += 1) {
      ops.push({ kind: "add", text: newMid[j]!, oldLine: prefix + m, newLine: prefix + j + 1 });
    }
  }

  const oldTailStart = oldLines.length - suffix;
  const newTailStart = newLines.length - suffix;
  for (let k = 0; k < suffix; k += 1) {
    ops.push({ kind: "ctx", text: oldLines[oldTailStart + k]!, oldLine: oldTailStart + k + 1, newLine: newTailStart + k + 1 });
  }
  return ops;
}

/** 生成标准统一差异（供 DiffPane 预览 MEMORY.md 的变更）。 */
export function buildMemoryUnifiedDiff(filePath: string, oldText: string, newText: string, contextLines = 3): string {
  if (oldText === newText) return "";
  const oldLines = splitDiffLines(oldText);
  const newLines = splitDiffLines(newText);
  const ops = computeLineOps(oldLines, newLines);
  const changeIndices: number[] = [];
  for (let idx = 0; idx < ops.length; idx += 1) {
    if (ops[idx]!.kind !== "ctx") changeIndices.push(idx);
  }
  if (changeIndices.length === 0) return "";

  const ranges: Array<{ start: number; end: number }> = [];
  for (const idx of changeIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }

  const headerOld = oldLines.length === 0 ? "/dev/null" : `a/${filePath}`;
  const headerNew = newLines.length === 0 ? "/dev/null" : `b/${filePath}`;
  const out = [`--- ${headerOld}`, `+++ ${headerNew}`];

  for (const range of ranges) {
    const slice = ops.slice(range.start, range.end + 1);
    const oldCount = slice.filter((op) => op.kind !== "add").length;
    const newCount = slice.filter((op) => op.kind !== "del").length;
    const firstOldOp = slice.find((op) => op.kind !== "add") ?? slice[0]!;
    const firstNewOp = slice.find((op) => op.kind !== "del") ?? slice[0]!;
    const oldStart = firstOldOp.oldLine;
    const newStart = firstNewOp.newLine;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) {
      const prefix = op.kind === "add" ? "+" : op.kind === "del" ? "-" : " ";
      out.push(`${prefix}${op.text}`);
    }
  }
  return `${out.join("\n")}\n`;
}
