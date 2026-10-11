import { app, ipcMain, shell } from "electron";
import { ReleaseNotesIpc } from "@vela/shared";
import { loadReleaseNotes } from "./release-notes-loader";

const releasesUrl = "https://github.com/KryptonGao/VelaHarness/releases";

/** 引导与「更新后首次打开」读取的发布说明：直接取自安装包，不联网。 */
export class ReleaseNotesHost {
  constructor(private readonly file: string) {}

  register(): void {
    ipcMain.handle(ReleaseNotesIpc.get, (_event, locale: unknown) => loadReleaseNotes(this.file, locale, app.getVersion()));
    // 只在安装版自动弹出；开发版和 Electron 冒烟测试不是打包产物，不让弹层盖住界面。
    ipcMain.handle(ReleaseNotesIpc.shouldAnnounce, () => app.isPackaged || process.env.VELA_SHOW_WHATS_NEW === "1");
    ipcMain.handle(ReleaseNotesIpc.openPage, () => shell.openExternal(`${releasesUrl}/tag/v${app.getVersion()}`));
  }

  dispose(): void {
    for (const channel of Object.values(ReleaseNotesIpc)) ipcMain.removeHandler(channel);
  }
}
