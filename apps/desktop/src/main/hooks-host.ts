import type { AgentRuntime } from "@vela/agent";
import { hookEvents, parseHooksConfig, type HooksSaveInput, type HooksTrustInput, type HooksTestInput } from "@vela/shared";
import { BrowserWindow, ipcMain } from "electron";
import { isAbsolute, resolve } from "node:path";

type Operation = "catalog" | "save" | "trust" | "test";
/** No caller-controlled file paths; configuration management is restricted to registered workspaces. */
export function parseHooksRequest(raw: unknown, knownCwds: readonly string[], operation: Operation): { cwd: string } & Partial<HooksSaveInput & HooksTrustInput & HooksTestInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid hooks request.");
  const input = raw as Record<string, unknown>;
  const fields = operation === "catalog" ? ["cwd"] : operation === "save" ? ["cwd", "scope", "config", "expectedDigest"] : operation === "test" ? ["cwd", "scope", "digest", "event", "toolName"] : ["cwd", "scope", "trusted", "digest"];
  if (Object.keys(input).some(k => !fields.includes(k)) || typeof input.cwd !== "string" || !isAbsolute(input.cwd) || input.cwd.includes("\0")
    || !knownCwds.some(cwd => resolve(cwd) === resolve(input.cwd as string))) throw new Error("Hooks workspace is unavailable.");
  if (Buffer.byteLength(JSON.stringify(input)) > 140_000) throw new Error("Hooks configuration is too large.");
  const cwd = resolve(input.cwd);
  if (operation === "catalog") return { cwd };
  if (input.scope !== "global" && input.scope !== "project") throw new Error("Invalid hooks scope.");
  const digest = operation === "save" ? input.expectedDigest : input.digest;
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("A reviewed hooks revision is required.");
  if (operation === "save") return { cwd, scope: input.scope, config: parseHooksConfig(input.config), expectedDigest: digest };
  if (operation === "test") {
    if (!hookEvents.includes(input.event as HooksTestInput["event"]) || input.toolName !== undefined && (typeof input.toolName !== "string" || !/^[a-zA-Z0-9_.:/-]{1,256}$/.test(input.toolName))) throw new Error("Invalid hooks test event or tool name.");
    return { cwd, scope: input.scope, digest, event: input.event as HooksTestInput["event"], ...(input.toolName === undefined ? {} : { toolName: input.toolName as string }) };
  }
  if (typeof input.trusted !== "boolean") throw new Error("A hooks trust decision is required.");
  return { cwd, scope: input.scope, trusted: input.trusted, digest };
}

export class HooksHost {
  private unsubscribe: (() => void) | null = null;
  private readonly channels: string[] = [];
  constructor(private readonly runtime: AgentRuntime, private readonly cwd: () => string) {}
  register(): void {
    if (this.channels.length) return;
    for (const operation of ["catalog", "save", "trust", "test"] as const) {
      const channel = `hooks:${operation}`;
      this.channels.push(channel);
      ipcMain.handle(channel, (event, raw: unknown) => {
        if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error("Hooks settings are only available in the main application.");
        const input = parseHooksRequest(raw, [this.cwd(), ...this.runtime.listConversations().map(c => c.cwd)], operation);
        if (operation === "catalog") return this.runtime.getHooksCatalog(input);
        if (operation === "test") return this.runtime.testHooks(input as HooksTestInput);
        if (operation === "save") return this.runtime.saveHooksConfig(input as HooksSaveInput);
        return this.runtime.setHooksTrust(input as HooksTrustInput);
      });
    }
    this.unsubscribe = this.runtime.subscribeHooks(record => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("hooks:changed", record);
    });
  }
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const channel of this.channels.splice(0)) ipcMain.removeHandler(channel);
  }
}
