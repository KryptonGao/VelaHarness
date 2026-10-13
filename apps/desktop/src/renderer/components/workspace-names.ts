import type { WorkspaceRecent } from "@vela/shared";

export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || path;
}

/** path 所属的工作区记录:它是主要文件夹或某个附加文件夹。 */
export function findWorkspace(recents: readonly WorkspaceRecent[] | undefined, path: string): WorkspaceRecent | null {
  const list = recents ?? [];
  return list.find((recent) => recent.path === path) ?? list.find((recent) => recent.folders?.includes(path)) ?? null;
}

/** 界面显示的工作区名:用户自定义名优先,否则取主要文件夹名(路径未登记时取 path 自身)。 */
export function workspaceTitle(recents: readonly WorkspaceRecent[] | undefined, path: string): string {
  const entry = findWorkspace(recents, path);
  return entry?.displayName ?? folderName(entry?.path ?? path);
}
