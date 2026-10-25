import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { BackgroundShellExit } from "@vela/shared";
import { BackgroundShellManager } from "../../workspace/src/background-shells.ts";
import { createSandboxedToolDefinitions } from "../../workspace/src/sandbox-tools.ts";

const dirs: string[] = [];
const managers: BackgroundShellManager[] = [];

after(async () => {
  for (const manager of managers) manager.dispose();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function setup(): Promise<{ manager: BackgroundShellManager; cwd: string; exits: BackgroundShellExit[] }> {
  const cwd = await mkdtemp(join(tmpdir(), "vela-bg-tools-"));
  dirs.push(cwd);
  const manager = new BackgroundShellManager();
  managers.push(manager);
  const exits: BackgroundShellExit[] = [];
  manager.subscribe((event) => exits.push(event));
  return { manager, cwd, exits };
}

const until = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe("background shell tools", () => {
  const permission = { request: async () => true };

  it("adds run_in_background to bash and registers bash_output and bash_kill", async () => {
    const { manager, cwd } = await setup();
    const tools = createSandboxedToolDefinitions({ cwd, workspace: cwd, permission: permission as never, conversationId: "c1", background: manager });
    assert.deepEqual(tools.map((tool) => tool.name), ["bash", "edit", "write", "bash_output", "bash_kill"]);
    const bash = tools[0]!;
    assert.ok("run_in_background" in (bash.parameters as { properties: object }).properties);
  });

  it("keeps bash synchronous and without the extra tools when background is not provided", async () => {
    const { cwd } = await setup();
    const tools = createSandboxedToolDefinitions({ cwd, workspace: cwd, permission: permission as never, conversationId: "c1" });
    assert.deepEqual(tools.map((tool) => tool.name), ["bash", "edit", "write"]);
    assert.ok(!("run_in_background" in (tools[0]!.parameters as { properties: object }).properties));
  });

  it("runs a background command through bash and reads it back with bash_output", async () => {
    const { manager, cwd, exits } = await setup();
    const tools = createSandboxedToolDefinitions({ cwd, workspace: cwd, permission: permission as never, conversationId: "c1", background: manager });
    const [bash, , , bashOutput, bashKill] = tools as [typeof tools[number], never, never, typeof tools[number], typeof tools[number]];
    const context = { cwd } as never;
    const started = await bash.execute("t1", { command: "echo hi; sleep 30", run_in_background: true }, undefined, undefined, context);
    const text = (started.content[0] as { text: string }).text;
    const id = /bg-\d+/.exec(text)![0];
    await new Promise((resolve) => setTimeout(resolve, 300));
    const read = await bashOutput.execute("t2", { shell_id: id }, undefined, undefined, context);
    assert.match((read.content[0] as { text: string }).text, /running\)[\s\S]*hi/);
    const killed = await bashKill.execute("t3", { shell_id: id }, undefined, undefined, context);
    assert.match((killed.content[0] as { text: string }).text, /Stopped/);
    await until(() => exits.length === 1, "exit event");
  });

  it("does not start the command when permission is denied", async () => {
    const { manager, cwd } = await setup();
    const tools = createSandboxedToolDefinitions({ cwd, workspace: cwd, permission: { request: async () => false } as never, conversationId: "c1", background: manager });
    await assert.rejects(() => tools[0]!.execute("t1", { command: "echo no", run_in_background: true }, undefined, undefined, { cwd } as never), /用户拒绝了命令执行/);
    assert.equal(manager.list("c1").length, 0);
  });
});
