import { stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { WorkspaceRecent, WorkspaceState, WorkspaceUpdateInput } from "@vela/shared";

const maxRecents = 10;
const maxNameLength = 80;
/** 与 @vela/shared 的 maxWorkspaceFolders 保持一致(本包的测试环境不能以值引入 shared)。 */
const maxWorkspaceFolders = 10;

interface WorkspaceStore {
  current: string | null;
  recents: WorkspaceRecent[];
}

export class WorkspaceManager {
  private state: WorkspaceState = { current: null, folders: [], recents: [] };
  private readonly listeners = new Set<(state: WorkspaceState) => void>();

  constructor(private readonly storePath: string) {}

  async init(initialPath?: string | null): Promise<WorkspaceState> {
    const stored = await this.readStore();
    const recents = stored.recents
      .filter((recent) => typeof recent?.path === "string" && recent.path.length > 0)
      .map((recent) => ({ ...recent, folders: cleanFolders(recent.folders, recent.path) }))
      .slice(0, maxRecents);
    const candidate = initialPath ?? stored.current;
    let current: string | null = null;
    if (candidate && (await isDirectory(candidate))) {
      current = candidate;
      touchRecent(recents, candidate);
    }
    this.state = { current, folders: [], recents };
    this.syncFolders();
    await this.persist();
    return this.getState();
  }

  getState(): WorkspaceState {
    return {
      current: this.state.current,
      folders: [...this.state.folders],
      recents: this.state.recents.map((recent) => ({ ...recent, folders: [...(recent.folders ?? [])] })),
    };
  }

  /**
   * path 所在工作区里的其他文件夹。path 是主要文件夹时就是附加文件夹;
   * path 是某个附加文件夹(例如改主要之前创建的会话目录)时,是其余成员(含主要文件夹)。
   */
  foldersOf(path: string): string[] {
    const primary = this.state.recents.find((recent) => recent.path === path);
    if (primary) return [...(primary.folders ?? [])];
    const member = this.state.recents.find((recent) => recent.folders?.includes(path));
    return member ? [member.path, ...(member.folders ?? []).filter((folder) => folder !== path)] : [];
  }

  subscribe(listener: (state: WorkspaceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async select(path: string): Promise<WorkspaceState> {
    const normalized = normalizePath(path);
    if (!normalized) throw new Error("工作区路径不正确");
    if (!(await isDirectory(normalized))) throw new Error("目录不存在或不可访问");
    this.state.current = normalized;
    touchRecent(this.state.recents, normalized);
    this.syncFolders();
    await this.persist();
    this.notify();
    return this.getState();
  }

  async close(): Promise<WorkspaceState> {
    this.state.current = null;
    this.syncFolders();
    await this.persist();
    this.notify();
    return this.getState();
  }

  async removeRecent(path: string): Promise<WorkspaceState> {
    const normalized = normalizePath(path);
    this.state.recents = this.state.recents.filter((recent) => recent.path !== normalized);
    this.syncFolders();
    await this.persist();
    this.notify();
    return this.getState();
  }

  /**
   * 编辑一个工作区:改显示名、增删文件夹、指定主要文件夹(folders[0])。
   * 工作区以主要文件夹为身份,所以主要文件夹变化时记录整体改挂到新路径下;
   * 若它正是当前工作区,当前工作区随之切到新的主要文件夹。
   */
  async update(input: WorkspaceUpdateInput): Promise<WorkspaceState> {
    const target = normalizePath(input.path);
    if (!target) throw new Error("工作区路径不正确");
    const folders = cleanFolders(input.folders, "", Infinity);
    if (folders.length === 0) throw new Error("工作区至少需要一个文件夹");
    if (folders.length > maxWorkspaceFolders + 1) throw new Error("工作区的文件夹数量已达上限");
    for (const folder of folders) {
      if (!(await isDirectory(folder))) throw new Error("目录不存在或不可访问");
    }
    const [primary, ...extras] = folders;
    const index = this.state.recents.findIndex((recent) => recent.path === target || recent.folders?.includes(target));
    const previous = index >= 0 ? this.state.recents[index] : null;
    const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim().slice(0, maxNameLength) : "";
    const entry: WorkspaceRecent = {
      path: primary,
      name: folderName(primary),
      lastUsedAt: previous?.lastUsedAt ?? Date.now(),
      folders: extras,
      ...(name && name !== folderName(primary) ? { displayName: name } : {}),
    };
    const next = this.state.recents.filter((recent) => recent !== previous && recent.path !== primary);
    next.splice(Math.min(Math.max(index, 0), next.length), 0, entry);
    this.state.recents = next.slice(0, maxRecents);
    if (previous && this.state.current === previous.path) this.state.current = primary;
    return this.commitFolders();
  }

  private async commitFolders(): Promise<WorkspaceState> {
    this.syncFolders();
    await this.persist();
    this.notify();
    return this.getState();
  }

  /** 当前工作区的附加文件夹始终取自它在最近列表中的记录。 */
  private syncFolders(): void {
    const entry = this.state.recents.find((recent) => recent.path === this.state.current);
    this.state.folders = [...(entry?.folders ?? [])];
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }

  private async readStore(): Promise<WorkspaceStore> {
    try {
      const raw = JSON.parse(await readFile(this.storePath, "utf8")) as Partial<WorkspaceStore>;
      return {
        current: typeof raw.current === "string" ? raw.current : null,
        recents: Array.isArray(raw.recents) ? raw.recents : [],
      };
    } catch {
      return { current: null, recents: [] };
    }
  }

  private async persist(): Promise<void> {
    const payload: WorkspaceStore = {
      current: this.state.current,
      recents: this.state.recents.slice(0, maxRecents),
    };
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function normalizePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > 1024) return null;
  return trimmed.replace(/\/+$/, "") || "/";
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function folderName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** 去掉空值、重复项和与主要文件夹相同的路径。 */
function cleanFolders(raw: unknown, primary: string, limit = maxWorkspaceFolders): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(primary ? [primary] : []);
  const folders: string[] = [];
  for (const item of raw) {
    const normalized = typeof item === "string" ? normalizePath(item) : null;
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    folders.push(normalized);
  }
  return folders.slice(0, limit);
}

function touchRecent(recents: WorkspaceRecent[], path: string): void {
  const previous = recents.find((recent) => recent.path === path);
  const next = recents.filter((recent) => recent.path !== path);
  next.unshift({
    path,
    name: folderName(path),
    lastUsedAt: Date.now(),
    folders: previous?.folders ?? [],
    ...(previous?.displayName ? { displayName: previous.displayName } : {}),
  });
  recents.length = 0;
  recents.push(...next.slice(0, maxRecents));
}
