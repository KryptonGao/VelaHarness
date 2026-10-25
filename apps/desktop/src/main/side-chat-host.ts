import { IpcChannel } from "@vela/shared";
import { ipcMain } from "electron";
import { parseSideChatThread, parseSideChatThreadId, parseSideChatWorkspace, type SideChatStore } from "./side-chat-store";

/** 侧边聊天历史的 IPC：按项目读写，所有窗口和对话共用同一份。 */
export class SideChatHost {
  constructor(private readonly store: SideChatStore) {}

  register(): void {
    ipcMain.handle(IpcChannel.sideChatThreadsList, (_event, workspace: unknown) =>
      this.store.list(parseSideChatWorkspace(workspace)));
    ipcMain.handle(IpcChannel.sideChatThreadsSave, (_event, workspace: unknown, thread: unknown) => {
      this.store.save(parseSideChatWorkspace(workspace), parseSideChatThread(thread));
    });
    ipcMain.handle(IpcChannel.sideChatThreadsRemove, (_event, workspace: unknown, threadId: unknown) => {
      this.store.remove(parseSideChatWorkspace(workspace), parseSideChatThreadId(threadId));
    });
  }

  dispose(): void {
    ipcMain.removeHandler(IpcChannel.sideChatThreadsList);
    ipcMain.removeHandler(IpcChannel.sideChatThreadsSave);
    ipcMain.removeHandler(IpcChannel.sideChatThreadsRemove);
  }
}
