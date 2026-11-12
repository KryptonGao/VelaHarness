import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, mock } from "node:test";
import { AgentRuntime } from "../../../packages/agent/src/runtime.ts";
import { IpcChannel, type ExecutionEnvironment, type WorktreeHandoffResult } from "@vela/shared";
import { runGit } from "../../../packages/workspace/src/git-run.ts";
import { WorkspaceManager } from "../../../packages/workspace/src/workspace-manager.ts";
import { WorktreeSessions } from "../../../packages/workspace/src/worktree-session.ts";

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;
const handlers = new Map<string, Handler>();
mock.module("electron", {
  namedExports: {
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler), on: () => {} },
    BrowserWindow: { getAllWindows: () => [] },
    shell: {},
    dialog: {},
  },
});
mock.module("../src/main/menu.ts", { namedExports: { getApplicationLocale: () => "zh-CN" } });
const { ProjectHost } = await import("../src/main/project-host.ts");

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(cwd, args);
  assert.equal(result.code, 0, `git ${args.join(" ")} 失败: ${result.stderr}`);
  return result.stdout;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function setup(t: import("node:test").TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vela-wt-env-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await writeFile(join(repo, "a.txt"), "a\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "init"]);

  const workspaceManager = new WorkspaceManager(join(root, "workspaces.json"));
  await workspaceManager.init(repo);
  const worktrees = new WorktreeSessions(join(root, "worktrees"));
  const pending: Promise<void>[] = [];
  let project: InstanceType<typeof ProjectHost>;
  const runtime = new AgentRuntime({
    cwd: root,
    agentDir: join(root, "agent"),
    onActiveCwd: (cwd, assigned, repository) => pending.push(project.syncConversationWorkspace(cwd, assigned, repository ?? null)),
  });
  project = new ProjectHost({
    workspaceManager,
    runtime,
    worktrees,
    fallbackCwd: root,
    git: { subscribe: () => {}, attach: async () => {} },
    sandbox: { subscribe: () => {} },
  } as unknown as ConstructorParameters<typeof ProjectHost>[0]);
  project.register();
  t.after(async () => {
    project.dispose();
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await runtime.createConversation(repo);
  await Promise.all(pending.splice(0));
  const call = async <T>(channel: string, ...args: unknown[]) => {
    const result = await handlers.get(channel)!(null, ...args);
    await Promise.all(pending.splice(0));
    return result as T;
  };
  const active = () => runtime.listConversations().find((chat) => chat.id === runtime.activeConversationId)!;
  return { root, repo, workspaceManager, worktrees, runtime, project, call, active };
}

it("choosing Worktree starts a chat bound to its own worktree without adding a workspace", async (t) => {
  const { repo, workspaceManager, runtime, call, active } = await setup(t);
  const empty = active();
  assert.equal(empty.worktree, undefined);

  const environment = await call<ExecutionEnvironment>(IpcChannel.envSet, "worktree");
  const bound = active();
  assert.notEqual(bound.id, empty.id);
  assert.ok(bound.worktree);
  assert.equal(bound.worktree.repository, repo);
  assert.equal(bound.worktree.branch, null);
  assert.equal(bound.cwd.startsWith(join(repo, "..", "worktrees")), true);
  assert.equal((await git(bound.cwd, ["rev-parse", "HEAD"])).trim(), bound.worktree.baseSha);

  assert.equal(environment.kind, "worktree");
  assert.equal(environment.path, bound.cwd);
  const state = workspaceManager.getState();
  assert.equal(state.current, bound.cwd);
  assert.equal(state.repository, repo);
  assert.deepEqual(state.recents.map((recent) => recent.path), [repo]);
  // 空的旧对话被收起,不留空壳。
  assert.notEqual(runtime.listConversations().find((chat) => chat.id === empty.id)?.archivedAt, null);
  const listed = await call<ExecutionEnvironment[]>(IpcChannel.envList);
  assert.equal(listed.find((entry) => entry.kind === "local")?.path, repo);
  assert.equal(listed.find((entry) => entry.kind === "worktree")?.path, bound.cwd);
});

it("selecting Worktree again does not create another one", async (t) => {
  const { call, active, root } = await setup(t);
  await call(IpcChannel.envSet, "worktree");
  const first = active();
  const again = await call<ExecutionEnvironment>(IpcChannel.envSet, "worktree");
  assert.equal(active().id, first.id);
  assert.equal(again.path, first.cwd);
  const created = (await git(join(root, "repo"), ["worktree", "list", "--porcelain"])).split("\n").filter((line) => line.startsWith("worktree "));
  assert.equal(created.length, 2);
});

it("each new Worktree chat gets its own directory, and Local returns to the repository", async (t) => {
  const { repo, runtime, workspaceManager, call, active } = await setup(t);
  await call(IpcChannel.envSet, "worktree");
  const first = active();
  runtime.addUsage(first.id, 1, 0); // 发过消息的对话不是空壳
  await call(IpcChannel.envSet, "local");
  assert.equal(active().cwd, repo);
  assert.equal(active().worktree, undefined);
  assert.equal(workspaceManager.getState().current, repo);
  assert.equal(workspaceManager.getState().repository, null);
  assert.equal(runtime.listConversations().find((chat) => chat.id === first.id)?.archivedAt, null);

  await call(IpcChannel.envSet, "worktree");
  const second = active();
  assert.notEqual(second.cwd, first.cwd);
  assert.equal(await exists(first.cwd), true);
});

it("switching away from an empty worktree chat removes its untouched worktree", async (t) => {
  const { call, active } = await setup(t);
  await call(IpcChannel.envSet, "worktree");
  const bound = active();
  await call(IpcChannel.envSet, "local");
  assert.equal(await exists(bound.cwd), false);
});

it("hands the worktree's changes back to the local checkout", async (t) => {
  const { repo, call, active } = await setup(t);
  await call(IpcChannel.envSet, "worktree");
  const bound = active();
  await writeFile(join(bound.cwd, "a.txt"), "edited in worktree\n");
  await writeFile(join(bound.cwd, "new.txt"), "new\n");

  const result = await call<WorktreeHandoffResult>(IpcChannel.envHandoff);
  assert.equal(result.status, "applied");
  assert.equal(result.files, 2);
  assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "edited in worktree\n");
  assert.equal(await readFile(join(repo, "new.txt"), "utf8"), "new\n");
});

it("refuses to hand off outside a worktree chat", async (t) => {
  const { call } = await setup(t);
  await assert.rejects(Promise.resolve(handlers.get(IpcChannel.envHandoff)!(null)), /不在工作树环境/);
  void call;
});

it("keeps worktrees that hold work, and rebuilds a cleaned one when the chat is restored", async (t) => {
  const { runtime, project, call, active } = await setup(t);
  await call(IpcChannel.envSet, "worktree");
  const dirty = active();
  runtime.addUsage(dirty.id, 1, 0);
  await writeFile(join(dirty.cwd, "scratch.txt"), "x\n");
  await project.releaseWorktree(dirty.id);
  assert.equal(await exists(join(dirty.cwd, "scratch.txt")), true);

  await rm(join(dirty.cwd, "scratch.txt"));
  await project.releaseWorktree(dirty.id);
  assert.equal(await exists(dirty.cwd), false);
  await project.restoreWorktree(dirty.id);
  assert.equal(await exists(join(dirty.cwd, "a.txt")), true);
  assert.equal((await git(dirty.cwd, ["rev-parse", "HEAD"])).trim(), dirty.worktree!.baseSha);
});
