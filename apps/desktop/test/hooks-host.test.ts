import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { AgentRuntime } from "@vela/agent";
import type { HookRunRecord } from "@vela/shared";
const handlers = new Map<string, (event: unknown, input: unknown) => unknown>();
const sends: unknown[] = [];
mock.module("electron", { namedExports: {
  ipcMain: { handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel) },
  BrowserWindow: { fromWebContents: (sender: unknown) => sender ? {} : null, getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args: unknown[]) => sends.push(args) } }] },
} });
const { HooksHost, parseHooksRequest } = await import("../src/main/hooks-host.ts");
const cwd = "/workspace";
const digest = "a".repeat(64);
const config = { version: 1, hooks: [{ id: "guard", event: "PreToolUse", command: "true" }] };

describe("hooks settings IPC", () => {
  it("validates known workspaces, fields, schema and reviewed revisions", () => {
    assert.deepEqual(parseHooksRequest({ cwd }, [cwd], "catalog"), { cwd });
    assert.deepEqual(parseHooksRequest({ cwd, scope: "project", config, expectedDigest: digest }, [cwd], "save"), { cwd, scope: "project", config, expectedDigest: digest });
    for (const raw of [{ cwd: "/elsewhere" }, { cwd: "relative" }, { cwd, path: "/etc/hooks.json" }]) assert.throws(() => parseHooksRequest(raw, [cwd], "catalog"));
    for (const raw of [{ cwd, scope: "project", trusted: true }, { cwd, scope: "project", trusted: "true", digest }, { cwd, scope: "remote", trusted: true, digest }]) assert.throws(() => parseHooksRequest(raw, [cwd], "trust"));
    assert.throws(() => parseHooksRequest({ cwd, scope: "project", expectedDigest: digest, config: { ...config, arbitrary: true } }, [cwd], "save"));
    assert.throws(() => parseHooksRequest({ cwd, scope: "project", digest, event: "Anything" }, [cwd], "test"));
    assert.throws(() => parseHooksRequest({ cwd, scope: "project", digest, event: "Stop", toolName: "$(command)" }, [cwd], "test"));
  });
  it("enforces the main window frame, dispatches operations, streams metadata and disposes handlers", () => {
    let listener: ((record: HookRunRecord) => void) | null = null;
    const calls: unknown[] = [];
    const runtime = {
      listConversations: () => [{ cwd: "/other-project" }],
      getHooksCatalog: (input: unknown) => calls.push(["catalog", input]), saveHooksConfig: (input: unknown) => calls.push(["save", input]),
      setHooksTrust: (input: unknown) => calls.push(["trust", input]), testHooks: (input: unknown) => calls.push(["test", input]),
      subscribeHooks: (callback: (record: HookRunRecord) => void) => { listener = callback; return () => { listener = null; }; },
    };
    const host = new HooksHost(runtime as unknown as AgentRuntime, () => cwd);
    host.register(); host.register(); assert.equal(handlers.size, 4);
    const frame = {}; const event = { sender: { mainFrame: frame }, senderFrame: frame };
    handlers.get("hooks:catalog")!(event, { cwd: "/other-project" });
    handlers.get("hooks:save")!(event, { cwd, scope: "project", config, expectedDigest: digest });
    handlers.get("hooks:trust")!(event, { cwd, scope: "project", trusted: true, digest });
    handlers.get("hooks:test")!(event, { cwd, scope: "project", digest, event: "PreToolUse", toolName: "write" });
    assert.equal(calls.length, 4);
    assert.throws(() => handlers.get("hooks:trust")!({ sender: event.sender, senderFrame: {} }, { cwd, scope: "global", trusted: true, digest }), /main application/);
    assert.throws(() => handlers.get("hooks:catalog")!({ sender: null }, { cwd }), /main application/);
    const publish = listener as unknown as (record: HookRunRecord) => void;
    publish({ id: "run", cwd, scope: "project", hookId: "guard", event: "Stop", status: "allowed", code: "ok", startedAt: 1, durationMs: 2 });
    assert.equal((sends[0] as unknown[])[0], "hooks:changed");
    host.dispose(); assert.equal(handlers.size, 0); assert.equal(listener, null);
  });
});
