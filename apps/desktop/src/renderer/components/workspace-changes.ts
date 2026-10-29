import type { GitChangeScope, GitCommitFileChange, GitFileChange } from "@vela/shared";
import type { UiMessage } from "../hooks/useSession";
import { summarizeTurnChanges, type TurnChanges, type TurnFileChange } from "./turn-changes";

export type ChangesCategory = "last-turn" | "uncommitted" | "unstaged" | "staged" | "committed" | "branch";
export const emptyChanges: TurnChanges = { files: [], added: 0, removed: 0 };

function total(files: TurnFileChange[]): TurnChanges {
  return { files, added: files.reduce((sum, file) => sum + file.added, 0), removed: files.reduce((sum, file) => sum + file.removed, 0) };
}

/** 当前轮仍在执行时取上一完整轮;没有编辑的完整轮也不能回退到更早的编辑。 */
export function lastTurnChanges(messages: UiMessage[], streaming: boolean, root: string | null): TurnChanges {
  let end = messages.length;
  if (streaming) {
    const user = messages.findLastIndex(message => message.role === "user");
    end = user < 0 ? 0 : user;
  }
  const completed = messages.slice(0, end);
  const start = completed.findLastIndex(message => message.role === "user");
  return summarizeTurnChanges(completed.slice(start + 1).flatMap(message => message.tools), root) ?? emptyChanges;
}

/** 未提交包含索引和工作区两部分;同一文件只占一行,两段差异都保留。 */
export async function loadWorkspaceChanges(
  files: GitFileChange[], category: "uncommitted" | "unstaged" | "staged",
  fileDiff: (path: string, scope: GitChangeScope) => Promise<string>,
): Promise<TurnChanges> {
  const selected = files.filter(file => category === "uncommitted" || (category === "staged" ? file.indexStatus !== null : file.worktreeStatus !== null));
  const loaded: TurnFileChange[] = new Array(selected.length);
  let next = 0;
  const worker = async () => {
    while (next < selected.length) {
      const index = next++;
      const file = selected[index];
      const scopes: GitChangeScope[] = [];
      if (category !== "unstaged" && file.indexStatus !== null) scopes.push("index");
      if (category !== "staged" && file.worktreeStatus !== null) scopes.push("worktree");
      const diffs: string[] = [];
      for (const scope of scopes) diffs.push(await fileDiff(file.path, scope));
      loaded[index] = {
        path: file.path,
        added: scopes.reduce((sum, scope) => sum + (scope === "index" ? file.indexAddedLines : file.worktreeAddedLines), 0),
        removed: scopes.reduce((sum, scope) => sum + (scope === "index" ? file.indexDeletedLines : file.worktreeDeletedLines), 0),
        diffs, diffScopes: scopes, format: "unified",
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker));
  return total(loaded);
}

/** Git 的引号路径包含 UTF-8 八进制字节,不能用普通 JSON 反转义。 */
function decodePath(path: string): string {
  if (!path.startsWith('"')) return path;
  const bytes: number[] = [];
  const escapes: Record<string, string> = { t: "\t", n: "\n", r: "\r", b: "\b", f: "\f", v: "\v", a: "\x07" };
  const text = path.slice(1, -1);
  for (let i = 0; i < text.length;) {
    if (text[i] === "\\") {
      const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1));
      if (octal) { bytes.push(parseInt(octal[0], 8)); i += octal[0].length + 1; continue; }
      bytes.push(...new TextEncoder().encode(escapes[text[i + 1]] ?? text[i + 1]));
      i += 2;
    } else {
      const char = String.fromCodePoint(text.codePointAt(i)!);
      bytes.push(...new TextEncoder().encode(char));
      i += char.length;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function historicalChanges(files: GitCommitFileChange[], diff: string): TurnChanges {
  const patches = new Map<string, string>();
  for (const part of diff.split(/(?=^diff --git )/m)) {
    const header = /^diff --git (?:"(?:\\.|[^"])*"|a\/.*?) ("(?:\\.|[^"])*"|b\/.*)$/m.exec(part);
    if (header) patches.set(decodePath(header[1]).replace(/^b\//, ""), part);
  }
  return total(files.map(file => ({ path: file.path, added: file.addedLines, removed: file.deletedLines, diffs: [patches.get(file.path) ?? ""], format: "unified" })));
}
