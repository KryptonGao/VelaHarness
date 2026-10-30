import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { BackgroundShellExit } from "@vela/shared";
import { backgroundReadLimitChars, BackgroundShellManager, type BackgroundShellInfo } from "../../workspace/src/background-shells.ts";
import { createBackgroundShellTools } from "../../workspace/src/background-shell-tools.ts";
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

const until = async (condition: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
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
    let read = await bashOutput.execute("t2", { shell_id: id }, undefined, undefined, context);
    await until(async () => {
      if ((read.details as { output: string }).output) return true;
      read = await bashOutput.execute("t2", { shell_id: id }, undefined, undefined, context);
      return Boolean((read.details as { output: string }).output);
    }, "background output");
    assert.match((read.content[0] as { text: string }).text, /running\)[\s\S]*hi/);
    const readDetails = read.details as { backgroundShell: { id: string; status: string }; output: string; truncated: boolean };
    assert.equal(readDetails.backgroundShell.id, id);
    assert.equal(readDetails.backgroundShell.status, "running");
    assert.match(readDetails.output, /hi/);
    assert.equal(readDetails.truncated, false);
    const killed = await bashKill.execute("t3", { shell_id: id }, undefined, undefined, context);
    assert.match((killed.content[0] as { text: string }).text, /Stopped/);
    assert.equal((killed.details as { killed: boolean }).killed, true);
    await until(() => exits.length === 1, "exit event");
    const alreadyExited = await bashKill.execute("t4", { shell_id: id }, undefined, undefined, context);
    assert.equal((alreadyExited.details as { killed: boolean }).killed, false);
    assert.match((alreadyExited.content[0] as { text: string }).text, /had already exited/);
  });

  it("keeps a nonzero process exit separate from a successful output read", async () => {
    const { manager, cwd } = await setup();
    const tools = createSandboxedToolDefinitions({ cwd, workspace: cwd, permission: permission as never, conversationId: "c1", background: manager });
    const bash = tools.find(tool => tool.name === "bash")!;
    const output = tools.find(tool => tool.name === "bash_output")!;
    const context = { cwd } as never;
    const started = await bash.execute("failed-start", { command: "printf failure; exit 1", run_in_background: true }, undefined, undefined, context);
    const id = (started.details as { backgroundShell: { id: string } }).backgroundShell.id;
    const read = await output.execute("failed-read", { shell_id: id, wait: 10 }, undefined, undefined, context);
    assert.deepEqual((read.details as { output: string }).output, "failure");
    assert.equal((read.details as { backgroundShell: { exitCode: number } }).backgroundShell.exitCode, 1);
    assert.equal((read as { isError?: boolean }).isError, undefined);
    assert.equal((read.content[0] as { text: string }).text, `shell ${id} (exited with code 1): printf failure; exit 1\n\nfailure`);
    const empty = await output.execute("empty-read", { shell_id: id }, undefined, undefined, context);
    assert.equal((empty.details as { output: string }).output, "");
    assert.equal((empty.details as { truncated: boolean }).truncated, false);
    assert.equal((empty.content[0] as { text: string }).text, `shell ${id} (exited with code 1): printf failure; exit 1\n\n(no new output)`);
  });

  it("preserves independent truncation metadata without changing model protocol text", async () => {
    const info: BackgroundShellInfo = { id: "bg-fixture", conversationId: "c1", command: "fixture", cwd: "/fixture", status: "timed_out", exitCode: null, startedAt: 1, endedAt: 2 };
    const manager = {
      read: async () => ({ info, output: "last output", truncated: true }),
      kill: async () => false,
      list: () => [info],
    } as unknown as BackgroundShellManager;
    const [output, kill] = createBackgroundShellTools(manager, "c1");
    const read = await output.execute("truncated", { shell_id: info.id }, undefined, undefined, {} as never);
    assert.deepEqual(read.details, { backgroundShell: info, output: "last output", truncated: true });
    assert.equal((read.content[0] as { text: string }).text,
      `shell ${info.id} (stopped: timed out): fixture\n\n[Output was cut; showing the last ${backgroundReadLimitChars} characters of what is unread.]\nlast output`);
    const stopped = await kill.execute("already-stopped", { shell_id: info.id }, undefined, undefined, {} as never);
    assert.deepEqual(stopped.details, { backgroundShell: info, killed: false });
    assert.equal((stopped.content[0] as { text: string }).text, `Background shell ${info.id} had already exited.`);
  });

  it("does not start the command when permission is denied", async () => {
    const { manager, cwd } = await setup();
    const tools = createSandboxedToolDefinitions({ cwd, workspace: cwd, permission: { request: async () => false } as never, conversationId: "c1", background: manager });
    await assert.rejects(() => tools[0]!.execute("t1", { command: "echo no", run_in_background: true }, undefined, undefined, { cwd } as never), /用户拒绝了命令执行/);
    assert.equal(manager.list("c1").length, 0);
  });
});
