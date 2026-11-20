import type { ToolTrace } from "@vela/shared";
import type { UiMessage } from "../hooks/useSession";

export interface TurnFileChange {
  path: string;
  added: number;
  removed: number;
  diffs: string[];
  /** 对应 diffs 的真实工具 ID，用于验收定位。 */
  diffToolIds?: string[];
  /** 工作区同一文件的索引与未暂存差异。 */
  diffScopes?: ("index" | "worktree")[];
  /** diffs 的格式;默认是工具保存的带行号记录,工作区 Git 变更用 unified。 */
  format?: "tool" | "unified";
}

export interface TurnChanges {
  files: TurnFileChange[];
  added: number;
  removed: number;
}

export interface TurnReviewRequest {
  /** Live reviews use the stable turn ID until the final assistant message is known. */
  live?: boolean;
  turnId: string;
  changes: TurnChanges;
}

function displayPath(path: string, workspaceRoot: string | null): string {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const root = workspaceRoot?.replaceAll("\\", "/").replace(/\/+$/, "");
  return root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}

function diffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (/^\+(?!\+\+)\s*\d+ /.test(line)) added += 1;
    else if (/^-(?!--)\s*\d+ /.test(line)) removed += 1;
  }
  return { added, removed };
}

function isCompletedFileEdit(tool: ToolTrace): boolean {
  return tool.status === "done" && (tool.name === "edit" || tool.name === "write");
}

export function summarizeTurnChanges(tools: ToolTrace[], workspaceRoot: string | null): TurnChanges | null {
  const files = new Map<string, TurnFileChange>();
  for (const tool of tools) {
    if (!isCompletedFileEdit(tool)) continue;
    const path = tool.activity?.path && displayPath(tool.activity.path, workspaceRoot);
    if (!path) continue;
    const file = files.get(path) ?? { path, added: 0, removed: 0, diffs: [] };
    const diff = tool.activity?.diff;
    if (diff) {
      const stat = diffLines(diff);
      file.added += stat.added;
      file.removed += stat.removed;
      file.diffs.push(diff);
    }
    files.set(path, file);
  }
  if (files.size === 0) return null;
  const values = [...files.values()];
  return {
    files: values,
    added: values.reduce((sum, file) => sum + file.added, 0),
    removed: values.reduce((sum, file) => sum + file.removed, 0),
  };
}

/** Text deltas and tool previews should not reparse saved diffs or refresh an open review. */
export function createLiveChangesSelector() {
  let previous: ToolTrace[] = [];
  let root: string | null = null;
  let changes: TurnChanges | null = null;
  return (assistants: UiMessage[], workspaceRoot: string | null) => {
    const edits = assistants.flatMap(message => message.tools.filter(isCompletedFileEdit));
    if (root !== workspaceRoot || edits.length !== previous.length || edits.some((edit, i) => edit !== previous[i])) {
      previous = edits;
      root = workspaceRoot;
      changes = summarizeTurnChanges(edits, root);
    }
    return changes;
  };
}

/** 一轮可能有多条 assistant 消息；卡片只挂在该轮最后一条回复之后。 */
export function changesByFinalMessage(
  messages: UiMessage[],
  streaming: boolean,
  workspaceRoot: string | null,
): Map<string, TurnChanges> {
  const cards = new Map<string, TurnChanges>();
  let tools: ToolTrace[] = [];
  let lastAssistant: UiMessage | null = null;
  const finishTurn = () => {
    if (lastAssistant) {
      const changes = summarizeTurnChanges(tools, workspaceRoot);
      if (changes) cards.set(lastAssistant.id, changes);
    }
    tools = [];
    lastAssistant = null;
  };
  for (const message of messages) {
    if (message.role === "user") finishTurn();
    else {
      lastAssistant = message;
      tools.push(...message.tools);
    }
  }
  if (!streaming) finishTurn();
  return cards;
}
