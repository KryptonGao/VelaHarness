import { BrowserWindow, ipcMain } from "electron";
import { raceDisabledMessage, RaceIpc } from "@vela/shared";
import { RaceService } from "./race-service";

export class RaceHost {
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly service: RaceService, private readonly isEnabled: () => boolean) {}

  hasRunningWork(): boolean { return this.service.hasRunningWork(); }

  private getService(): RaceService {
    if (!this.isEnabled()) throw new Error(raceDisabledMessage);
    // Recovery runs once. Re-enabling must keep any lanes already running in this process.
    if (!this.unsubscribe) {
      this.service.init();
      this.unsubscribe = this.service.subscribe(() => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(RaceIpc.state);
        }
      });
    }
    return this.service;
  }

  register(): void {
    ipcMain.handle(RaceIpc.preflight, (_event, workspace) => this.getService().preflight(workspace));
    ipcMain.handle(RaceIpc.list, () => this.getService().list());
    ipcMain.handle(RaceIpc.start, (_event, draft) => this.getService().start(draft));
    ipcMain.handle(RaceIpc.stopLane, (_event, raceId, laneId) => this.getService().stopLane(raceId, laneId));
    ipcMain.handle(RaceIpc.adopt, (_event, raceId, laneId) => this.getService().adopt(raceId, laneId));
    ipcMain.handle(RaceIpc.discard, (_event, raceId) => this.getService().discard(raceId));
  }

  dispose(): void {
    for (const channel of Object.values(RaceIpc)) if (channel !== RaceIpc.state) ipcMain.removeHandler(channel);
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      this.service.stop();
    }
  }
}
