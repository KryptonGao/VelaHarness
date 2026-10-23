/**
 * 网页工具设置的 IPC：校验调用方与请求形状，交给 AgentRuntime 持有的 WebToolsService。
 * 密钥只进不出：界面写入后只能看到「已保存」。
 */
import { BrowserWindow, ipcMain } from "electron";
import { WebToolsError, type AgentRuntime } from "@vela/agent";
import { IpcChannel, createLogger, type WebCapability, type WebToolsResult } from "@vela/shared";

const log = createLogger("web-tools");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function failure(error: unknown): WebToolsResult<never> {
  if (error instanceof WebToolsError) return { ok: false, code: error.code, message: error.message };
  log.warn("web tools request failed", error);
  return { ok: false, code: "invalid", message: "网页工具请求失败" };
}

function exactFields(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!record(raw)) throw new WebToolsError("invalid", "请求格式不正确");
  if (Object.keys(raw).some(key => !fields.includes(key))) throw new WebToolsError("invalid", "请求包含不支持的字段");
  return raw;
}

export function parseKeyRequest(raw: unknown): { providerId: string; apiKey: string | null } {
  const input = exactFields(raw, ["providerId", "apiKey"]);
  if (typeof input.providerId !== "string" || !input.providerId) throw new WebToolsError("invalid", "缺少提供商");
  if (input.apiKey !== null && typeof input.apiKey !== "string") throw new WebToolsError("invalid", "密钥必须是文本或 null");
  return { providerId: input.providerId, apiKey: input.apiKey };
}

export function parseTestRequest(raw: unknown): { providerId: string; capability: WebCapability } {
  const input = exactFields(raw, ["providerId", "capability"]);
  if (typeof input.providerId !== "string" || !input.providerId) throw new WebToolsError("invalid", "缺少提供商");
  if (input.capability !== "search" && input.capability !== "fetch") throw new WebToolsError("invalid", "测试类型不正确");
  return { providerId: input.providerId, capability: input.capability };
}

export class WebToolsHost {
  private readonly channels: string[] = [];
  private readonly tests = new Set<AbortController>();

  constructor(private readonly runtime: AgentRuntime) {}

  register(): void {
    if (this.channels.length) return;
    const handle = (channel: string, action: (raw: unknown) => Promise<unknown> | unknown) => {
      this.channels.push(channel);
      ipcMain.handle(channel, async (event, raw: unknown) => {
        if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) {
          throw new Error("网页工具请求不可用");
        }
        try {
          return { ok: true, value: await action(raw) };
        } catch (error) {
          return failure(error);
        }
      });
    };
    const service = this.runtime.webTools;
    handle(IpcChannel.webToolsGet, () => service.getState());
    handle(IpcChannel.webToolsSave, raw => service.save(raw));
    handle(IpcChannel.webToolsSetKey, raw => {
      const input = parseKeyRequest(raw);
      return service.setApiKey(input.providerId, input.apiKey);
    });
    handle(IpcChannel.webToolsTest, async raw => {
      const input = parseTestRequest(raw);
      const controller = new AbortController();
      this.tests.add(controller);
      try {
        return await service.test(input.providerId, input.capability, controller.signal);
      } finally {
        this.tests.delete(controller);
      }
    });
  }

  dispose(): void {
    for (const controller of this.tests) controller.abort();
    this.tests.clear();
    for (const channel of this.channels.splice(0)) ipcMain.removeHandler(channel);
  }
}
