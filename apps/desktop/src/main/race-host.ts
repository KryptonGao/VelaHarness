import { BrowserWindow, ipcMain } from "electron";
import { RaceIpc } from "@vela/shared";
import { RaceService } from "./race-service";

export class RaceHost {
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly service: RaceService) {}

  register(): void {
    ipcMain.handle(RaceIpc.preflight, (_event, workspace) => this.service.preflight(workspace));
    ipcMain.handle(RaceIpc.list, () => this.service.list());
    ipcMain.handle(RaceIpc.start, (_event, draft) => this.service.start(draft));
    ipcMain.handle(RaceIpc.stopLane, (_event, raceId, laneId) => this.service.stopLane(raceId, laneId));
    ipcMain.handle(RaceIpc.adopt, (_event, raceId, laneId) => this.service.adopt(raceId, laneId));
    ipcMain.handle(RaceIpc.discard, (_event, raceId) => this.service.discard(raceId));
    this.unsubscribe = this.service.subscribe(() => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(RaceIpc.state);
      }
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const channel of Object.values(RaceIpc)) if (channel !== RaceIpc.state) ipcMain.removeHandler(channel);
  }
}
