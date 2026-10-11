import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { createLogger, IpcChannel, SandboxCapabilityBroker, type UiSandboxIssueResult } from "@vela/shared";

const log = createLogger("intelligent-ui:sandbox");

/**
 * 沙盒微应用的 capability 发放（IUI-14）。令牌一次性、限定大小、会过期、可撤销，
 * 渲染层在用户确认之后才兑换；iframe 里的代码永远看不到令牌。
 * 这里只做准入与频率限制，真正的副作用（发消息、写剪贴板）仍由渲染层走既有通道，且每次都要用户确认。
 */
export class UiSandboxHost {
  readonly broker = new SandboxCapabilityBroker({ token: () => randomUUID() });

  register(): void {
    ipcMain.handle(IpcChannel.uiSandboxIssue, (_event, appKey: unknown, capability: unknown, size: unknown): UiSandboxIssueResult => {
      const result = this.broker.issue(typeof appKey === "string" ? appKey : "", capability, typeof size === "number" ? size : 0);
      // 只记录结果，不记录应用内容或文本。
      log.debug(result.ok ? "capability issued" : `capability denied: ${result.error}`);
      return result;
    });
    ipcMain.handle(IpcChannel.uiSandboxRedeem, (_event, token: unknown, appKey: unknown, capability: unknown, size: unknown) => {
      const result = this.broker.redeem(typeof token === "string" ? token : "", typeof appKey === "string" ? appKey : "", capability, typeof size === "number" ? size : 0);
      if (!result.ok) log.debug(`capability rejected: ${result.error}`);
      return { ok: result.ok };
    });
    ipcMain.handle(IpcChannel.uiSandboxRevoke, (_event, appKey: unknown) => {
      if (typeof appKey === "string") this.broker.revoke(appKey);
    });
  }

  dispose(): void {
    this.broker.revokeAll();
    ipcMain.removeHandler(IpcChannel.uiSandboxIssue);
    ipcMain.removeHandler(IpcChannel.uiSandboxRedeem);
    ipcMain.removeHandler(IpcChannel.uiSandboxRevoke);
  }
}
