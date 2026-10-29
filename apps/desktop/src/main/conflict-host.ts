import { BrowserWindow, ipcMain } from "electron";
import { ConflictIpc } from "@vela/shared";
import { ConflictService } from "./conflict-service";

export class ConflictHost {
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly service: ConflictService) {}

  register(): void {
    ipcMain.handle(ConflictIpc.list, () => this.service.list());
    ipcMain.handle(ConflictIpc.moveToWorktree, (_event, conversationId: unknown) => this.service.moveToWorktree(conversationId));
    this.unsubscribe = this.service.subscribe(() => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(ConflictIpc.state);
      }
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const channel of Object.values(ConflictIpc)) if (channel !== ConflictIpc.state) ipcMain.removeHandler(channel);
  }
}
