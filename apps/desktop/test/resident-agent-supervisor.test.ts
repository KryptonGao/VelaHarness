import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, mock, type TestContext } from "node:test";
import { residentWakeId, residentWakeWindowMs, type ResidentStatus, type SandboxMode, type SessionStatus, type TranscriptMessage } from "@vela/shared";
import {
  ResidentAgentSupervisor,
  type ResidentApprovals,
  type ResidentInboxSource,
  type ResidentPower,
  type ResidentExecution,
  type ResidentRuntime,
} from "../src/main/resident-agent-supervisor.ts";

interface Job { cwd: string; text: string; execution: ResidentExecution & { sandboxMode?: SandboxMode | null; mode?: "agent" | "plan" }; conversationId: string; finish(): void; fail(message: string): void }

async function fixture(t: TestContext, options: { workspaces?: string[]; sandbox?: SandboxMode; seed?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "vela-resident-"));
  const file = join(dir, "resident-agent.json");
  if (options.seed !== undefined) await writeFile(file, options.seed);
  let now = Date.UTC(2026, 9, 10, 12);
  const calls = { ensure: [] as Array<string | null>, ensureExecution: [] as Array<ResidentExecution | undefined>, prompts: [] as Array<{ id: string; text: string; execution?: ResidentExecution }>, configured: [] as ResidentExecution[], aborted: [] as string[] };
  const jobs: Job[] = [];
  const conversations = new Map<string, SessionStatus>();
  const messages = new Map<string, TranscriptMessage[]>();
  const reports: Array<{ id: string; conversationId: string; text: string }> = [];
  const gates = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  let wakeReply = "Task verified.";
  let holdPrompts = false;
  const append = (id: string, role: TranscriptMessage["role"], text: string) => {
    const transcript = messages.get(id) ?? [];
    transcript.push({ id: `msg-${transcript.length}`, role, text, tools: [], thinking: "", timestamp: now });
    messages.set(id, transcript);
  };
  const runtimeListeners = new Set<(event: { type: string; conversationId?: string }) => void>();
  const inboxListeners = new Set<() => void>();
  const powerListeners = new Set<(event: "suspend" | "resume" | "battery" | "ac") => void>();
  const waits: Array<{ conversationId: string | undefined }> = [];
  let battery = false;
  let approve = true;
  const approvals: Array<Parameters<ResidentApprovals["request"]>[0]> = [];
  const runtime: ResidentRuntime = {
    ensureResidentConversation: async (_cwd, known, execution) => { calls.ensure.push(known); calls.ensureExecution.push(execution); const id = known ?? "resident-1"; conversations.set(id, "ready"); return id; },
    promptBackground: async (id, text, execution) => {
      calls.prompts.push({ id, text, ...(execution ? { execution } : {}) });
      append(id, "user", text);
      if (holdPrompts) {
        conversations.set(id, "streaming");
        try { await new Promise<void>((resolve, reject) => { gates.set(id, { resolve, reject }); }); }
        finally { gates.delete(id); conversations.set(id, "ready"); }
      }
      if (residentWakeId(text)) append(id, "assistant", wakeReply);
    },
    configureBackground: async (_id, execution) => { calls.configured.push(execution); },
    runScheduledTask: (cwd, text, onCreated, execution) => new Promise<void>((resolve, reject) => {
      const conversationId = `task-${jobs.length + 1}`;
      conversations.set(conversationId, "streaming");
      onCreated(conversationId);
      jobs.push({ cwd, text, execution, conversationId,
        finish: () => { conversations.set(conversationId, "ready"); resolve(); },
        fail: message => { conversations.set(conversationId, "ready"); reject(new Error(message)); },
      });
    }),
    abort: async id => {
      calls.aborted.push(id);
      if (gates.has(id)) gates.get(id)!.reject(new Error("任务执行已停止"));
      else jobs.find(job => job.conversationId === id)?.fail("任务执行已停止");
    },
    getConversationInfo: id => conversations.has(id) ? { status: conversations.get(id)!, model: "m" } : null,
    getMessages: id => messages.get(id) ?? [],
    subscribe: listener => { runtimeListeners.add(listener); return () => { runtimeListeners.delete(listener); }; },
  };
  const inbox: ResidentInboxSource = {
    pendingWaits: () => waits,
    pendingCount: () => waits.length,
    recent: () => [],
    subscribe: listener => { inboxListeners.add(listener); return () => { inboxListeners.delete(listener); }; },
  };
  const power: ResidentPower = { isOnBattery: () => battery, subscribe: listener => { powerListeners.add(listener); return () => { powerListeners.delete(listener); }; } };
  const make = () => new ResidentAgentSupervisor({
    file, residentDir: join(dir, "resident"), runtime, inbox,
    approvals: { request: async input => { approvals.push(input); return approve; } },
    power, workspaces: () => options.workspaces ?? ["/work/a", "/work/b"], sandboxMode: () => options.sandbox ?? "ask", now: () => now,
    onWakeReply: reply => reports.push(reply),
  });
  const supervisor = make();
  supervisor.init();
  t.after(async () => { supervisor.dispose(); await rm(dir, { recursive: true, force: true }); });
  const statuses: ResidentStatus[] = [];
  supervisor.subscribe(status => statuses.push(status));
  return {
    dir, file, supervisor, calls, jobs, statuses, approvals, make, messages, reports, gates,
    hold: (value: boolean) => { holdPrompts = value; },
    setWakeReply: (value: string) => { wakeReply = value; },
    tick: (ms: number) => { now += ms; },
    setApprove: (value: boolean) => { approve = value; },
    setBattery: (value: boolean) => { battery = value; for (const l of powerListeners) l(value ? "battery" : "ac"); },
    power: (event: "suspend" | "resume") => { for (const l of powerListeners) l(event); },
    wait: (conversationId: string) => { waits.push({ conversationId }); for (const l of inboxListeners) l(); },
    settle: () => new Promise<void>(resolve => setImmediate(resolve)),
  };
}

const spec = (title: string, workspace = "/work/a") => ({ title, prompt: `do ${title}`, workspace, source: "user" as const });

it("stays idle: no runtime calls happen until there is a real event", async t => {
  const f = await fixture(t);
  await f.settle();
  assert.deepEqual(f.calls.ensure, []);
  assert.equal(f.jobs.length, 0);
  assert.equal(f.supervisor.getStatus().state, "ready");
  assert.equal(f.supervisor.getResidentConversationId(), null);
});

it("reads only the ledger task's last bounded answer and observed distinct tool and file counts", async t => {
  const f = await fixture(t);
  const started = f.supervisor.startTask(spec("one"));
  assert.ok(started.ok);
  const tool = (id: string, name: string, path: string) => ({ id, name, status: "done" as const, activity: { path } });
  const msg = (id: string, role: TranscriptMessage["role"], text: string, tools: TranscriptMessage["tools"] = []): TranscriptMessage =>
    ({ id, role, text, tools, timestamp: 1, thinking: "never returned" });
  f.messages.set("task-1", [msg("a", "user", "private prompt"), msg("b", "assistant", "first", [tool("1", "read", "a"), tool("2", "edit", "/work/a/a")]),
    msg("c", "assistant", "x".repeat(6100), [tool("3", "write", "b")]), msg("d", "assistant", "", [tool("3", "write", "b"), tool("4", "bash", "ignored")])]);
  assert.deepEqual(f.supervisor.readTaskResult("task-1"), { ok: false, reason: "unknown_task" });
  assert.deepEqual(f.supervisor.readTaskResult(started.taskId), { ok: true, taskId: started.taskId, status: "running", text: "x".repeat(6000), truncated: true, toolCalls: 4, filesInvolved: 2 });
});

it("queues same-conversation follow-ups behind the current turn and enforces a fresh deadline", async t => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const f = await fixture(t);
  f.supervisor.updateSettings({ limits: { maxConcurrentTasks: 1, maxTaskMinutes: 5, maxWakesPerDay: 0 } });
  const first = f.supervisor.startTask(spec("one"));
  assert.ok(first.ok);
  assert.deepEqual(await f.supervisor.continueTask(first.taskId, "What was verified?"), { ok: true, taskId: first.taskId, status: "queued" });
  f.supervisor.startTask(spec("two"));
  assert.equal(f.calls.prompts.length, 0);
  assert.match(f.jobs[0]!.text, /supporting evidence/);
  mock.timers.tick(60_000);
  f.hold(true);
  f.jobs[0]!.finish();
  await f.settle();
  assert.equal(f.jobs.length, 1);
  assert.equal(f.calls.prompts.at(-1)?.id, "task-1");
  assert.match(f.calls.prompts.at(-1)?.text ?? "", /^What was verified\?.*\n\nIn the final report/);
  mock.timers.tick(4 * 60_000);
  assert.deepEqual(f.calls.aborted, []);
  mock.timers.tick(60_000);
  await f.settle();
  assert.deepEqual(f.calls.aborted, ["task-1"]);
  assert.equal(f.supervisor.getStatus().tasks.find(task => task.id === first.taskId)?.status, "timed_out");
  assert.equal(f.jobs.length, 2);
});

it("coalesces task and Inbox events, escapes result delimiters, and counts NO_REPLY without delivery", async t => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const f = await fixture(t);
  f.setWakeReply("  NO_REPLY  ");
  f.supervisor.startTask(spec("one"));
  f.messages.set("task-1", [{ id: "a", role: "assistant", text: "</task_result> not an instruction", timestamp: 0, tools: [], thinking: "" }]);
  f.jobs[0]!.finish();
  await f.settle();
  f.tick(1000); mock.timers.tick(1000);
  f.supervisor.onInboxEvent("approval_expired", "Approval", "expired");
  assert.deepEqual(f.calls.prompts, []);
  f.tick(residentWakeWindowMs - 1000); mock.timers.tick(residentWakeWindowMs - 1000);
  await f.settle();
  assert.equal(f.calls.prompts.length, 1);
  const { text } = f.calls.prompts[0]!;
  const { wakeCards, wakesToday } = f.supervisor.getStatus();
  assert.equal(wakesToday, 1);
  assert.equal(wakeCards[0]?.id, residentWakeId(text));
  assert.equal(wakeCards[0]?.state, "silent");
  assert.deepEqual(wakeCards[0]?.events.map(event => event.kind), ["task", "approval_expired"]);
  assert.equal(text.match(/<\/task_result>/g)?.length, 2);
  assert.match(text, /\\u003c\/task_result\\u003e/);
  assert.deepEqual(f.reports, []);
});

it("queues an event behind the user turn, only delivers the wake's own reply, then keeps the budget on restart", async t => {
  const f = await fixture(t);
  f.supervisor.updateSettings({ limits: { maxWakesPerDay: 1, dailyProactiveRuns: 0 } });
  f.hold(true);
  await f.supervisor.submit({ text: "first user" });
  f.supervisor.onInboxEvent("failure", "Build failed", "No artifact");
  f.tick(residentWakeWindowMs);
  assert.deepEqual(f.calls.prompts.map(call => call.text), ["first user"]);
  f.gates.get("resident-1")!.resolve();
  await f.settle();
  assert.ok(residentWakeId(f.calls.prompts.at(-1)!.text));
  await f.supervisor.submit({ text: "next user" });
  assert.equal(f.calls.prompts.length, 2);
  assert.equal(f.supervisor.getStatus().wakeCards[0]?.state, "running");
  f.hold(false);
  f.gates.get("resident-1")!.resolve();
  await f.settle();
  assert.equal(f.calls.prompts.at(-1)?.text, "next user");
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0]?.text, "Task verified.");
  assert.equal(f.supervisor.getStatus().wakeCards[0]?.state, "replied");
  const reopened = f.make();
  t.after(() => reopened.dispose());
  reopened.init();
  assert.equal(reopened.getStatus().wakesToday, 1);
  reopened.onInboxEvent("failure", "New failure", "");
  assert.equal(reopened.getStatus().lastWakeSkip?.reason, "daily_limit");
  assert.equal(reopened.proactiveRunsToday(), 0);
  f.tick(24 * 60 * 60_000);
  assert.equal(reopened.getStatus().wakesToday, 0);
  reopened.updateSettings({ limits: { maxWakesPerDay: 0 } });
  reopened.onInboxEvent("failure", "Disabled by budget", "");
  assert.equal(reopened.getStatus().lastWakeSkip?.reason, "daily_limit");
  assert.equal(f.calls.prompts.length, 3);
});

it("marks unfinished tasks interrupted on restart instead of replaying them", async t => {
  const f = await fixture(t);
  f.supervisor.updateSettings({ limits: { maxConcurrentTasks: 1 } });
  f.supervisor.startTask(spec("one"));
  f.supervisor.startTask({ ...spec("two"), workspace: "/work/b" });
  assert.deepEqual(f.supervisor.getStatus().tasks.map(task => task.status).sort(), ["queued", "running"]);
  const reopened = f.make();
  reopened.init();
  const tasks = reopened.getStatus().tasks;
  assert.deepEqual(tasks.map(task => task.status), ["interrupted", "interrupted"]);
  assert.ok(tasks.every(task => task.error && task.finishedAt !== null));
  assert.equal(f.jobs.length, 1, "restart must not start the queued task");
  reopened.dispose();
});

it("blocks new work when disabled or paused but never touches work already running", async t => {
  const f = await fixture(t);
  assert.equal(f.supervisor.startTask(spec("run")).ok, true);
  f.supervisor.pause();
  assert.deepEqual(f.supervisor.startTask(spec("later")), { ok: false, reason: "paused" });
  assert.deepEqual(await f.supervisor.submit({ text: "hi" }), { ok: false, reason: "paused" });
  assert.equal(f.supervisor.getStatus().state, "paused");
  assert.deepEqual(f.calls.aborted, []);
  assert.equal(f.supervisor.getStatus().runningTasks, 1);
  f.supervisor.resume();
  f.supervisor.updateSettings({ mode: "disabled" });
  assert.deepEqual(f.supervisor.startTask(spec("x")), { ok: false, reason: "disabled" });
  assert.equal(f.supervisor.getStatus().state, "offline");
  assert.deepEqual(f.calls.aborted, []);
});

it("queues beyond the concurrency limit and starts the next when a slot frees", async t => {
  const f = await fixture(t);
  f.supervisor.updateSettings({ limits: { maxConcurrentTasks: 1 } });
  const first = f.supervisor.startTask(spec("first"));
  const second = f.supervisor.startTask(spec("second"));
  assert.deepEqual([first.ok && first.status, second.ok && second.status], ["running", "queued"]);
  assert.equal(f.jobs.length, 1);
  f.jobs[0]!.finish();
  await f.settle();
  assert.equal(f.jobs.length, 2);
  assert.deepEqual(f.supervisor.getStatus().tasks.map(task => task.status), ["running", "succeeded"]);
  f.jobs[1]!.finish();
  await f.settle();
  assert.equal(f.supervisor.getStatus().state, "ready");
});

it("pausing keeps queued tasks queued until resumed", async t => {
  const f = await fixture(t);
  f.supervisor.updateSettings({ limits: { maxConcurrentTasks: 1 } });
  f.supervisor.startTask(spec("first"));
  f.supervisor.startTask(spec("second"));
  f.supervisor.pause();
  f.jobs[0]!.finish();
  await f.settle();
  assert.equal(f.jobs.length, 1);
  assert.equal(f.supervisor.getStatus().queuedTasks, 1);
  f.supervisor.resume();
  assert.equal(f.jobs.length, 2);
});

it("rejects tasks for unregistered workspaces and a full queue", async t => {
  const f = await fixture(t);
  assert.deepEqual(f.supervisor.startTask(spec("x", "/etc")), { ok: false, reason: "unknown_workspace" });
  assert.deepEqual(f.supervisor.startTask({ ...spec("x"), prompt: "  " }), { ok: false, reason: "invalid" });
  f.supervisor.updateSettings({ limits: { maxConcurrentTasks: 1 } });
  f.supervisor.startTask(spec("running"));
  for (let i = 0; i < 20; i += 1) assert.equal(f.supervisor.startTask(spec(`q${i}`)).ok, true);
  assert.deepEqual(f.supervisor.startTask(spec("overflow")), { ok: false, reason: "queue_full" });
});

it("stops a task that runs past the time limit and reports it as timed out", async t => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const f = await fixture(t);
  f.supervisor.updateSettings({ limits: { maxTaskMinutes: 5 } });
  f.supervisor.startTask(spec("slow"));
  assert.equal(f.supervisor.taskForConversation("task-1")?.timedOut, false);
  mock.timers.tick(5 * 60_000);
  await f.settle();
  assert.deepEqual(f.calls.aborted, ["task-1"]);
  const task = f.supervisor.getStatus().tasks[0]!;
  assert.equal(task.status, "timed_out");
  assert.match(task.error ?? "", /5 分钟/);
});

it("cancels queued and running tasks", async t => {
  const f = await fixture(t);
  f.supervisor.updateSettings({ limits: { maxConcurrentTasks: 1 } });
  const running = f.supervisor.startTask(spec("a"));
  const queued = f.supervisor.startTask(spec("b"));
  assert.ok(running.ok && queued.ok);
  await f.supervisor.cancelTask(queued.ok ? queued.taskId : "");
  await f.supervisor.cancelTask(running.ok ? running.taskId : "");
  await f.settle();
  assert.deepEqual(f.supervisor.getStatus().tasks.map(task => task.status), ["cancelled", "cancelled"]);
  assert.equal(f.jobs.length, 1, "a cancelled queued task never starts");
});

it("records failures with the runtime error", async t => {
  const f = await fixture(t);
  f.supervisor.startTask(spec("boom"));
  f.jobs[0]!.fail("模型不可用");
  await f.settle();
  const task = f.supervisor.getStatus().tasks[0]!;
  assert.equal(task.status, "failed");
  assert.equal(task.error, "模型不可用");
});

it("creates the resident conversation lazily, once, and reuses it after a restart", async t => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.supervisor.submit({ text: "你好" }), f.supervisor.submit({ text: "再来" })]);
  assert.deepEqual([first, second], [{ ok: true, target: "resident" }, { ok: true, target: "resident" }]);
  assert.deepEqual(f.calls.ensure, [null], "concurrent submits share one creation");
  assert.deepEqual(f.calls.prompts.map(prompt => prompt.id), ["resident-1", "resident-1"]);
  const reopened = f.make();
  reopened.init();
  assert.equal(reopened.getResidentConversationId(), "resident-1");
  assert.equal(reopened.isResidentConversation("resident-1"), true);
  assert.equal(reopened.isResidentConversation("task-1"), false);
  await reopened.submit({ text: "还在吗" });
  assert.deepEqual(f.calls.ensure.at(-1), "resident-1");
  reopened.dispose();
});

it("submitting with a workspace creates a task directly", async t => {
  const f = await fixture(t);
  const result = await f.supervisor.submit({ text: "检查构建结果", workspace: "/work/b" });
  assert.equal(result.ok && result.target, "task");
  assert.equal(f.jobs[0]?.cwd, "/work/b");
  assert.equal(f.calls.ensure.length, 0, "no resident conversation is needed for a direct task");
  assert.equal((await f.supervisor.submit({ text: "x", workspace: "/nope" })).ok, false);
  assert.equal((await f.supervisor.submit({ text: "   " })).ok, false);
});

it("surfaces a resident startup failure as an error state, then recovers", async t => {
  const f = await fixture(t);
  const original = f.supervisor as unknown as { options: { runtime: ResidentRuntime } };
  const ensure = original.options.runtime.ensureResidentConversation;
  original.options.runtime.ensureResidentConversation = async () => { throw new Error("没有可用的模型"); };
  const failed = await f.supervisor.submit({ text: "hi" });
  assert.deepEqual(failed, { ok: false, reason: "failed", message: "没有可用的模型" });
  assert.equal(f.supervisor.getStatus().state, "error");
  original.options.runtime.ensureResidentConversation = ensure;
  assert.equal((await f.supervisor.submit({ text: "hi" })).ok, true);
  assert.equal(f.supervisor.getStatus().state, "ready");
});

it("delegation needs approval and is bound to a registered workspace", async t => {
  const f = await fixture(t);
  await f.supervisor.submit({ text: "hi" });
  const unknown = await f.supervisor.delegate({ workspace: "/etc", title: "t", prompt: "p" });
  assert.equal(unknown.ok, false);
  assert.equal(f.approvals.length, 0, "no approval is asked for an unregistered workspace");

  f.setApprove(false);
  const denied = await f.supervisor.delegate({ workspace: "/work/a", title: "t", prompt: "p" });
  assert.deepEqual(denied, { ok: false, reason: "用户拒绝了这个后台任务" });
  assert.equal(f.jobs.length, 0);
  assert.equal(f.approvals[0]?.kind, "delegate");
  assert.equal(f.approvals[0]?.cwd, "/work/a");
  assert.equal(f.approvals[0]?.conversationId, "resident-1");

  f.setApprove(true);
  const ok = await f.supervisor.delegate({ workspace: "/work/a", title: "t", prompt: "p" });
  assert.equal(ok.ok, true);
  assert.equal(f.supervisor.getStatus().tasks[0]?.source, "agent");
});

it("re-checks the authoritative state after an approval was granted", async t => {
  const f = await fixture(t);
  await f.supervisor.submit({ text: "hi" });
  const gate = { release: () => {} };
  const original = f.supervisor as unknown as { options: { approvals: ResidentApprovals } };
  original.options.approvals = { request: () => new Promise<boolean>(resolve => { gate.release = () => resolve(true); }) };
  const pending = f.supervisor.delegate({ workspace: "/work/a", title: "t", prompt: "p" });
  f.supervisor.pause();
  gate.release();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(f.jobs.length, 0);
});

it("proactive rule tasks never run with full access and can be read-only", async t => {
  const f = await fixture(t, { sandbox: "full" });
  f.supervisor.updateSettings({ mode: "proactive" });
  f.supervisor.startTask({ ...spec("rule"), source: "rule", ruleId: "r1", readOnly: true, reason: "文件变化" });
  f.supervisor.startTask({ ...spec("user", "/work/b") });
  assert.deepEqual(f.jobs[0]?.execution, { model: null, thinkingLevel: null, sandboxMode: "smart", mode: "plan" });
  assert.deepEqual(f.jobs[1]?.execution, { model: null, thinkingLevel: null, sandboxMode: null, mode: "agent" });
  assert.equal(f.supervisor.proactiveRunsToday(), 1);
  assert.equal(f.supervisor.hasActiveRuleTask("r1"), true);
  assert.equal(f.supervisor.taskForConversation("task-1")?.reason, "文件变化");
  f.tick(24 * 60 * 60_000);
  assert.equal(f.supervisor.proactiveRunsToday(), 0, "the counter belongs to a calendar day");
});

it("reports working when something runs even if another item waits, and waiting when idle", async t => {
  const f = await fixture(t);
  f.supervisor.startTask(spec("a"));
  f.wait("task-1");
  let status = f.supervisor.getStatus();
  assert.equal(status.state, "working");
  assert.equal(status.waitingItems, 1);
  f.jobs[0]!.finish();
  await f.settle();
  status = f.supervisor.getStatus();
  assert.equal(status.waitingItems, 0, "finished tasks no longer count as waiting");
  f.supervisor.startTask(spec("b"));
  f.wait("task-2");
  f.jobs[1]!.finish();
  await f.settle();
  assert.equal(f.supervisor.getStatus().state, "ready");
  await f.supervisor.submit({ text: "hi" });
  f.wait("resident-1");
  assert.equal(f.supervisor.getStatus().state, "waiting_user");
});

it("tracks system sleep and power source without cancelling anything", async t => {
  const f = await fixture(t);
  f.supervisor.startTask(spec("a"));
  f.power("suspend");
  assert.equal(f.supervisor.getStatus().state, "suspended");
  assert.equal(f.supervisor.getRuntimeFlags().suspended, true);
  f.power("resume");
  assert.equal(f.supervisor.getStatus().state, "working");
  f.setBattery(true);
  assert.equal(f.supervisor.getStatus().onBattery, true);
  assert.deepEqual(f.calls.aborted, []);
});

it("pushes a status only when something observable changed", async t => {
  const f = await fixture(t);
  const before = f.statuses.length;
  f.supervisor.updateSettings({ mode: "standby" });
  assert.equal(f.statuses.length, before);
  f.supervisor.pause();
  assert.equal(f.statuses.length, before + 1);
  assert.equal(f.statuses.at(-1)?.paused, true);
  assert.ok(f.statuses.at(-1)!.revision > (f.statuses.at(-2)?.revision ?? 0));
});

it("persists settings and quarantines a corrupt store instead of overwriting it", async t => {
  const f = await fixture(t);
  f.supervisor.updateSettings({ mode: "proactive", limits: { maxTaskMinutes: 20 } });
  const reopened = f.make();
  reopened.init();
  assert.equal(reopened.getSettings().mode, "proactive");
  assert.equal(reopened.getSettings().limits.maxTaskMinutes, 20);
  reopened.dispose();

  const bad = await fixture(t, { seed: "{not json" });
  assert.equal(bad.supervisor.getSettings().mode, "standby");
  assert.match(bad.supervisor.getStatus().error ?? "", /已损坏/);
  assert.ok((await readdir(bad.dir)).some(name => name.startsWith("resident-agent.json.corrupt-")));
});

it("runs the resident chat and its tasks on the model and effort chosen in settings", async t => {
  const f = await fixture(t);
  f.supervisor.updateSettings({ model: { provider: "anthropic", id: "claude-opus" }, thinkingLevel: "high" });
  const expected = { model: { provider: "anthropic", id: "claude-opus" }, thinkingLevel: "high" };
  assert.deepEqual(await f.supervisor.submit({ text: "你好" }), { ok: true, target: "resident" });
  await f.settle();
  assert.deepEqual(f.calls.ensureExecution, [expected]);
  assert.deepEqual(f.calls.prompts[0]?.execution, expected);
  f.supervisor.startTask(spec("one"));
  assert.deepEqual({ model: f.jobs[0]!.execution.model, thinkingLevel: f.jobs[0]!.execution.thinkingLevel }, expected);
});

it("defaults to the new-chat selection and clears the choice with null", async t => {
  const f = await fixture(t);
  assert.deepEqual(f.supervisor.getSettings().model, null);
  assert.deepEqual(f.supervisor.getSettings().thinkingLevel, null);
  f.supervisor.updateSettings({ model: { provider: "p", id: "m" }, thinkingLevel: "low" });
  f.supervisor.updateSettings({ model: null, thinkingLevel: null });
  assert.equal(f.supervisor.getSettings().model, null);
  assert.equal(f.supervisor.getSettings().thinkingLevel, null);
});

it("applies a model change to the live resident conversation only when it changed", async t => {
  const f = await fixture(t);
  f.supervisor.updateSettings({ thinkingLevel: "low" });
  assert.deepEqual(f.calls.configured, [], "no conversation yet, nothing to reconfigure");
  await f.supervisor.submit({ text: "hi" });
  await f.settle();
  f.supervisor.updateSettings({ thinkingLevel: "high" });
  f.supervisor.updateSettings({ thinkingLevel: "high" });
  f.supervisor.updateSettings({ limits: { maxTaskMinutes: 30 } });
  await f.settle();
  assert.deepEqual(f.calls.configured, [{ model: null, thinkingLevel: "high" }]);
});

it("keeps the choice but reports it when the live conversation cannot take the new model", async t => {
  const f = await fixture(t);
  await f.supervisor.submit({ text: "hi" });
  await f.settle();
  const { runtime } = (f.supervisor as unknown as { options: { runtime: ResidentRuntime } }).options;
  runtime.configureBackground = async () => { throw new Error("这个模型还不能使用，请先登录或填写密钥"); };
  f.supervisor.updateSettings({ model: { provider: "p", id: "gone" } });
  await f.settle();
  assert.deepEqual(f.supervisor.getSettings().model, { provider: "p", id: "gone" });
  assert.match(f.supervisor.getStatus().error ?? "", /还不能使用/);
});
