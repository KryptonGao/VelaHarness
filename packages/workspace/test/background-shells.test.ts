import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { BackgroundShellExit } from "@vela/shared";
import { BackgroundShellManager } from "../src/background-shells.ts";

const dirs: string[] = [];
const managers: BackgroundShellManager[] = [];

after(async () => {
  for (const manager of managers) manager.dispose();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function setup(): Promise<{ manager: BackgroundShellManager; cwd: string; exits: BackgroundShellExit[] }> {
  const cwd = await mkdtemp(join(tmpdir(), "vela-bg-test-"));
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

describe("BackgroundShellManager", () => {
  it("returns immediately and notifies when the command exits", async () => {
    const { manager, cwd, exits } = await setup();
    const started = Date.now();
    const info = manager.start({ conversationId: "c1", command: "sleep 0.3; echo finished", cwd });
    assert.ok(Date.now() - started < 200);
    assert.equal(info.status, "running");
    await until(() => exits.length === 1, "exit event");
    assert.equal(exits[0]!.status, "exited");
    assert.equal(exits[0]!.exitCode, 0);
    assert.equal(exits[0]!.notify, true);
    assert.match(exits[0]!.output, /finished/);
  });

  it("reads output incrementally and does not repeat what was read", async () => {
    const { manager, cwd } = await setup();
    const { id } = manager.start({ conversationId: "c1", command: "echo one; sleep 0.4; echo two", cwd });
    await until(() => manager.list("c1")[0]!.status === "running", "start");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const first = await manager.read("c1", id);
    assert.equal(first.output.trim(), "one");
    assert.equal(first.info.status, "running");
    const second = await manager.read("c1", id, { wait: 5 });
    assert.equal(second.output.trim(), "two");
    assert.equal(second.info.status, "exited");
    assert.equal((await manager.read("c1", id)).output, "");
  });

  it("does not notify when bash_output already observed the exit", async () => {
    const { manager, cwd, exits } = await setup();
    const { id } = manager.start({ conversationId: "c1", command: "sleep 0.2; echo done", cwd });
    const read = await manager.read("c1", id, { wait: 5 });
    assert.equal(read.info.status, "exited");
    await until(() => exits.length === 1, "exit event");
    assert.equal(exits[0]!.notify, false);
    assert.equal(exits[0]!.output, "");
  });

  it("reports a non-zero exit code", async () => {
    const { manager, cwd, exits } = await setup();
    manager.start({ conversationId: "c1", command: "echo bad >&2; exit 3", cwd });
    await until(() => exits.length === 1, "exit event");
    assert.equal(exits[0]!.status, "exited");
    assert.equal(exits[0]!.exitCode, 3);
    assert.match(exits[0]!.output, /bad/);
  });

  it("kill stops the command without waking the agent", async () => {
    const { manager, cwd, exits } = await setup();
    const { id } = manager.start({ conversationId: "c1", command: "sleep 30", cwd });
    assert.equal(await manager.kill("c1", id), true);
    await until(() => exits.length === 1, "exit event");
    assert.equal(exits[0]!.status, "killed");
    assert.equal(exits[0]!.notify, false);
    assert.equal(await manager.kill("c1", id), false);
  });

  it("marks a command that outlives its timeout as timed_out", async () => {
    const { manager, cwd, exits } = await setup();
    manager.start({ conversationId: "c1", command: "sleep 30", cwd, timeout: 0.2 });
    await until(() => exits.length === 1, "exit event");
    assert.equal(exits[0]!.status, "timed_out");
    assert.equal(exits[0]!.notify, true);
  });

  it("keeps conversations apart and kills a conversation's commands silently", async () => {
    const { manager, cwd, exits } = await setup();
    const { id } = manager.start({ conversationId: "c1", command: "sleep 30", cwd });
    manager.start({ conversationId: "c2", command: "sleep 30", cwd });
    await assert.rejects(() => manager.read("c2", id), /没有这个后台命令/);
    manager.killConversation("c1");
    await until(() => exits.length === 1, "exit event");
    assert.equal(exits[0]!.conversationId, "c1");
    assert.equal(exits[0]!.notify, false);
    assert.equal(manager.list("c2")[0]!.status, "running");
  });

  it("limits running commands per conversation", async () => {
    const { manager, cwd } = await setup();
    for (let index = 0; index < 8; index += 1) manager.start({ conversationId: "c1", command: "sleep 30", cwd });
    assert.throws(() => manager.start({ conversationId: "c1", command: "sleep 30", cwd }), /上限/);
    manager.start({ conversationId: "c2", command: "sleep 30", cwd });
  });

  it("truncates a very large unread output to its tail", async () => {
    const { manager, cwd, exits } = await setup();
    const { id } = manager.start({ conversationId: "c1", command: "yes line | head -n 100000; echo END", cwd });
    await until(() => exits.length === 1, "exit event");
    assert.equal(exits[0]!.truncated, true);
    assert.ok(exits[0]!.output.length <= 30_000);
    assert.match(exits[0]!.output, /END\s*$/);
    assert.equal((await manager.read("c1", id)).output, "");
  });
});
