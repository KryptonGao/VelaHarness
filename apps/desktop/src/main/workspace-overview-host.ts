import { WorkspaceOverviewIpc, type WorkspaceOverviewSnapshot } from "@vela/shared";
import { collectWorkspaceOverview, resolveRevealPath } from "@vela/workspace";
import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { resolve } from "node:path";

export interface WorkspaceOverviewHostOptions {
  /** 已登记的工作区:总览只读取这些路径,不接受渲染层给出的任意目录。 */
  workspaces: () => readonly string[];
  /** Vela 受管 worktree 根目录。 */
  worktreeRoot: string;
}

/** 总览页的只读 IPC:按路径返回任一已登记工作区的 Git 概况。 */
export class WorkspaceOverviewHost {
  constructor(private readonly options: WorkspaceOverviewHostOptions) {}

  /** 只接受已登记工作区的路径。 */
  private registered(raw: unknown): string {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096 || raw.includes("\0")) throw new Error("无效的工作区路径");
    const target = resolve(raw);
    if (!this.options.workspaces().some(path => resolve(path) === target)) throw new Error("工作区未登记");
    return target;
  }

  async get(raw: unknown): Promise<WorkspaceOverviewSnapshot> {
    return collectWorkspaceOverview(this.registered(raw), { managedRoot: this.options.worktreeRoot });
  }

  /** 在文件管理器中定位文件,不读取内容。 */
  async reveal(workspace: unknown, path: unknown): Promise<void> {
    if (typeof path !== "string" || path.length > 4096) throw new Error("无效的文件路径");
    shell.showItemInFolder(await resolveRevealPath(this.registered(workspace), path));
  }

  register(): void {
    ipcMain.handle(WorkspaceOverviewIpc.get, (event: IpcMainInvokeEvent, workspace: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame) throw new Error("只允许 Vela 主页面读取工作区总览");
      return this.get(workspace);
    });
    ipcMain.handle(WorkspaceOverviewIpc.reveal, (event: IpcMainInvokeEvent, workspace: unknown, path: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame) throw new Error("只允许 Vela 主页面读取工作区总览");
      return this.reveal(workspace, path);
    });
  }

  dispose(): void {
    ipcMain.removeHandler(WorkspaceOverviewIpc.get);
    ipcMain.removeHandler(WorkspaceOverviewIpc.reveal);
  }
}
