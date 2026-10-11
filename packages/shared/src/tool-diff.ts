/** edit / write 工具展示用 diff 的行数统计；对话导出和交接包共用。 */
export function diffCounts(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (/^\+(?!\+\+)\s*\d+ /.test(line)) added += 1;
    else if (/^-(?!--)\s*\d+ /.test(line)) removed += 1;
  }
  return { added, removed };
}

/** 把工具里的路径规范成相对工作区的写法；工作区之外的路径保持原样。 */
export function relativePath(path: string, cwd: string): string {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const root = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  return root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}
