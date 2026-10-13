/**
 * 多文件夹工作区的系统提示:告诉模型主要文件夹之外还有哪些文件夹可以读写。
 * 没有附加文件夹时返回 null,不增加任何提示词。
 */
export function workspaceFoldersInstructions(primary: string, folders: readonly string[]): string | null {
  const extra = folders.filter((folder) => folder && folder !== primary);
  if (extra.length === 0) return null;
  return [
    "This workspace contains several folders.",
    `Primary folder (working directory for commands and relative paths): ${primary}`,
    "Additional folders (use absolute paths when reading, searching or editing files in them; commands can run there with `cd` or a working-directory argument):",
    ...extra.map((folder) => `- ${folder}`),
    "Treat all listed folders as part of the same project. Prefer the primary folder when the user does not say which folder a task belongs to.",
  ].join("\n");
}
