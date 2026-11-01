import { join } from "node:path";
import { ipcMain, session, shell } from "electron";
import {
  createLogger,
  isCleanableStorageCategory,
  isStorageCategoryId,
  StorageIpc,
  type CleanableStorageCategory,
  type StorageCategoryId,
  type StorageCleanResult,
  type StorageOverview,
} from "@vela/shared";
import {
  cleanLogs, cleanTraces, cleanUpdateStaging, deleteTrace, isConversationId, readDisk, scanStorage,
  type CleanOutcome,
} from "./storage-scan";

const log = createLogger("storage");

export interface StorageHostOptions {
  home: string;
  userData: string;
  titleOf: (conversationId: string) => string | null;
  traceInUse: (conversationId: string) => boolean;
  /** 有更新正在下载或等待安装时，不能动更新缓存。 */
  updateBusy: () => boolean;
}

export class StorageHost {
  private busy = false;

  constructor(private readonly options: StorageHostOptions) {}

  register(): void {
    ipcMain.handle(StorageIpc.disk, () => readDisk(this.options.home));
    ipcMain.handle(StorageIpc.overview, () => this.overview());
    ipcMain.handle(StorageIpc.clean, (_event, raw: unknown) => {
      if (!isCleanableStorageCategory(raw)) throw new Error("不能清理这个类别");
      return this.clean(raw);
    });
    ipcMain.handle(StorageIpc.deleteTrace, (_event, raw: unknown) => {
      if (typeof raw !== "string" || !isConversationId(raw)) throw new Error("对话标识不正确");
      return this.exclusive(() => deleteTrace(this.options.home, raw, this.options.traceInUse));
    });
    ipcMain.handle(StorageIpc.reveal, async (_event, raw: unknown) => {
      if (!isStorageCategoryId(raw)) throw new Error("存储类别不正确");
      const error = await shell.openPath(this.folderOf(raw));
      if (error) throw new Error(error);
    });
  }

  dispose(): void {
    for (const channel of Object.values(StorageIpc)) ipcMain.removeHandler(channel);
  }

  overview(): Promise<StorageOverview> {
    return scanStorage(this.options);
  }

  clean(category: CleanableStorageCategory): Promise<StorageCleanResult> {
    return this.exclusive(() => {
      switch (category) {
        case "traces": return cleanTraces(this.options.home, this.options.traceInUse);
        case "logs": return cleanLogs(this.options.home);
        case "updates": return this.options.updateBusy()
          ? Promise.reject(new Error("有更新正在下载或等待安装，现在不能清理更新缓存"))
          : cleanUpdateStaging(this.options.home);
        case "cache": return this.clearCache();
      }
    });
  }

  private folderOf(category: StorageCategoryId): string {
    const { home, userData } = this.options;
    switch (category) {
      case "conversations": return join(home, "sessions");
      case "cache": return userData;
      case "other": return home;
      default: return join(home, category);
    }
  }

  private async clearCache(): Promise<CleanOutcome> {
    const before = await scanStorage(this.options);
    const defaults = session.defaultSession;
    await defaults.clearCache();
    await defaults.clearCodeCaches({});
    const after = await scanStorage(this.options);
    const bytes = (overview: StorageOverview) => overview.categories.find(category => category.id === "cache")?.bytes ?? 0;
    const files = (overview: StorageOverview) => overview.categories.find(category => category.id === "cache")?.files ?? 0;
    return { freedBytes: Math.max(0, bytes(before) - bytes(after)), removedFiles: Math.max(0, files(before) - files(after)), skipped: 0 };
  }

  /** 同一时间只做一件清理，避免两次点击互相删对方正在统计的文件。 */
  private async exclusive(action: () => Promise<CleanOutcome>): Promise<StorageCleanResult> {
    if (this.busy) throw new Error("正在清理，请稍候");
    this.busy = true;
    try {
      const outcome = await action();
      log.info("storage cleaned", { ...outcome });
      return { ...outcome, overview: await this.overview() };
    } finally {
      this.busy = false;
    }
  }
}
