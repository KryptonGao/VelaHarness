import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { runHeadless, type HeadlessRunEvent, type HeadlessRunRequest } from "../src/index.ts";
import { startFakeModel, writeModelConfig, type FakeReply, type FakeRequest } from "./support/fake-model.ts";

async function fixture(t: TestContext, reply: (request: FakeRequest) => FakeReply | Promise<FakeReply>) {
  const root = await mkdtemp(join(tmpdir(), "vela-headless-"));
  const cwd = join(root, "workspace");
  const dataDir = join(root, "data");
  const configDir = join(root, "config");
  await mkdir(cwd);
  const model = await startFakeModel(reply);
  await writeModelConfig(configDir, model.url);
  t.after(async () => { await model.close(); await rm(root, { recursive: true, force: true }); });
  const events: HeadlessRunEvent[] = [];
  const run = (overrides: Partial<HeadlessRunRequest> = {}, signal?: AbortSignal) =>
    runHeadless({ cwd, dataDir, configDir, prompt: "do the task", timeoutMs: 60_000, ...overrides }, { signal, onEvent: event => { events.push(event); } });
  return { root, cwd, dataDir, configDir, model, events, run };
}

/** 是否还有命令行里带这个唯一标记的进程。 */
const processAlive = (marker: string): Promise<boolean> =>
  new Promise(resolve => execFile("pgrep", ["-f", marker], error => resolve(!error)));

const bash = (command: string, extra: Record<string, unknown> = {}) => ({ toolCalls: [{ name: "bash", arguments: { command, ...extra } }] });

describe("runHeadless", () => {
  it("completes a plain reply and reports the final text", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => "All done.");
    const result = await f.run();
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    assert.equal(result.finalText, "All done.");
    assert.deepEqual(result.model, { provider: "fake-local", id: "fake-model" });
    assert.ok(result.tokens && result.tokens.total.total > 0);
    // exactly one run_result, and it is last; sequence is contiguous.
    const results = f.events.filter(event => event.type === "run_result");
    assert.equal(results.length, 1);
    assert.equal(f.events.at(-1)?.type, "run_result");
    assert.deepEqual(f.events.map(event => event.sequence), f.events.map((_, index) => index + 1));
    assert.equal(f.events[0]?.type, "run_started");
    // run.json is the terminal record; mode bits are private.
    const record = JSON.parse(await readFile(join(result.runDir, "run.json"), "utf8"));
    assert.equal(record.version, 1);
    assert.equal(record.status, "completed");
    assert.equal(record.request.prompt, undefined);
    assert.equal(((await stat(result.runDir)).mode & 0o777), 0o700);
    assert.equal(((await stat(join(result.runDir, "run.json"))).mode & 0o777), 0o600);
  });

  it("does not touch the config directory's selection or the desktop conversation index", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => "ok");
    const before = await readFile(join(f.configDir, "selection.json"), "utf8");
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.equal(await readFile(join(f.configDir, "selection.json"), "utf8"), before);
    await assert.rejects(stat(join(f.configDir, "conversations.json")));
    const index = JSON.parse(await readFile(join(result.runDir, "agent", "conversations.json"), "utf8"));
    assert.equal(index.conversations.length, 1);
    assert.equal(index.conversations[0].id, result.conversationId);
  });

  it("blocks and denies an approval request in ask mode instead of approving", { timeout: 60_000 }, async (t) => {
    const marker = join(tmpdir(), `vela-approval-${process.pid}-${Date.now()}`);
    const f = await fixture(t, () => bash(`touch ${marker}`));
    const result = await f.run({ sandboxMode: "ask" });
    assert.equal(result.status, "blocked");
    assert.equal(result.error?.code, "approval_required");
    assert.equal(result.blocked?.kind, "approval");
    await assert.rejects(stat(marker));
    assert.ok(f.events.some(event => event.type === "approval"));
  });

  it("blocks on ask_user_question without answering for the user", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => ({ toolCalls: [{ name: "ask_user_question", arguments: { question: "Which database?", options: [{ label: "pg" }, { label: "sqlite" }] } }] }));
    const result = await f.run();
    assert.equal(result.status, "blocked");
    assert.equal(result.error?.code, "question_required");
    assert.match(result.blocked?.detail ?? "", /Which database/);
  });

  it("runs commands in full mode and waits for a background command and the follow-up reply", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, ({ index, body }) => {
      if (index === 0) return bash("sleep 1; echo bg-finished", { run_in_background: true });
      if (index === 1) return "Started it.";
      assert.match(JSON.stringify(body.messages), /bg-finished/);
      return "Background command finished.";
    });
    const result = await f.run({ sandboxMode: "full" });
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    // run_result must not come before the wake-up turn.
    assert.equal(result.finalText, "Background command finished.");
    assert.equal(f.model.requests.length, 3);
  });

  it("does not report a result until a running subagent has finished and the main agent has replied", { timeout: 60_000 }, async (t) => {
    const lastText = (request: FakeRequest): string => JSON.stringify(request.body.messages.at(-1));
    const f = await fixture(t, async (request) => {
      const last = lastText(request);
      if (request.index === 0) return { toolCalls: [{ name: "spawn_agent", arguments: { agent: "explore", task: "SUBTASK_MARKER look around", name: "scout" } }] };
      if (last.includes("SUBTASK_MARKER")) { await new Promise(resolve => setTimeout(resolve, 1500)); return "child conclusion"; }
      if (last.includes("child conclusion")) return "Main saw the child result.";
      return "Spawned a scout; waiting.";
    });
    const result = await f.run();
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    assert.equal(result.finalText, "Main saw the child result.");
    assert.ok(result.tokens && result.tokens.subagents.length === 1, "sub-agent usage is reported separately");
    assert.deepEqual(result.subagentFailures, []);
  });

  it("times out and leaves no background process behind", { timeout: 60_000 }, async (t) => {
    const token = `29.${process.pid}${Date.now() % 100000}`;
    const f = await fixture(t, ({ index }) => index === 0 ? bash(`sleep ${token}`, { run_in_background: true }) : "Started; waiting.");
    const result = await f.run({ sandboxMode: "full", timeoutMs: 3000 });
    assert.equal(result.status, "timed_out");
    assert.equal(result.error?.code, "timed_out");
    assert.equal(await processAlive(`sleep ${token}`), false, "background command must be gone after the run returns");
  });

  it("leaves no background process after a cancellation either", { timeout: 60_000 }, async (t) => {
    const token = `28.${process.pid}${Date.now() % 100000}`;
    const f = await fixture(t, ({ index }) => index === 0 ? bash(`sleep ${token}`, { run_in_background: true }) : index === 1 ? "Started." : ({ status: 500, body: "{}" }));
    // The wake-up never comes (the command outlives the run), so cancel after the command started.
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2500);
    const result = await f.run({ sandboxMode: "full" }, controller.signal);
    assert.equal(result.status, "cancelled");
    assert.equal(await processAlive(`sleep ${token}`), false);
  });

  it("cancels on caller abort and reports cancelled", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => ({ hang: true }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1500);
    const result = await f.run({}, controller.signal);
    assert.equal(result.status, "cancelled");
    assert.equal(result.error?.code, "cancelled");
  });

  it("fails with a model error and does not mask it with later text", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => ({ status: 400, body: JSON.stringify({ error: { message: "bad request" } }) }));
    const result = await f.run();
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "runtime_error");
  });

  it("rejects an unavailable explicit model without substituting another", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => "should not be called");
    const result = await f.run({ model: { provider: "fake-local", id: "missing" } });
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "model_unavailable");
    assert.equal(f.model.requests.length, 0);
  });

  it("rejects an explicit thinking level the model does not support", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => "should not be called");
    const result = await f.run({ thinkingLevel: "high" });
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "thinking_unsupported");
  });

  it("requires a proposed plan in plan mode and never approves it", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => "<proposed_plan>\n# Plan\n1. Do the thing\n</proposed_plan>");
    const result = await f.run({ mode: "plan" });
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    assert.match(result.plan?.markdown ?? "", /Do the thing/);
    const missing = await fixture(t, () => "I have no plan.");
    const none = await missing.run({ mode: "plan" });
    assert.equal(none.status, "failed");
    assert.equal(none.error?.code, "plan_missing");
  });

  it("asks the model to judge in smart mode and blocks when it cannot call it safe", { timeout: 60_000 }, async (t) => {
    const marker = join(tmpdir(), `vela-smart-${process.pid}-${Date.now()}`);
    // The first request is the agent turn (a bash call); the next is the risk evaluation, which answers with nonsense -> unknown.
    const f = await fixture(t, ({ index }) => index === 0 ? bash(`touch ${marker}`) : "I am not sure.");
    const result = await f.run({ sandboxMode: "smart" });
    assert.equal(result.status, "blocked");
    assert.equal(result.error?.code, "approval_required");
    await assert.rejects(stat(marker));
  });

  it("counts every real tool execution exactly once", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, ({ index }) => index === 0 ? bash("echo one") : index === 1 ? bash("echo two") : "done");
    const result = await f.run({ sandboxMode: "full" });
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    const index = JSON.parse(await readFile(join(result.runDir, "agent", "conversations.json"), "utf8"));
    assert.equal(index.conversations[0].toolCallCount, 2);
  });

  it("redacts credential-looking environment values from emitted events and run.json", { timeout: 60_000 }, async (t) => {
    const secret = `sk-test-${process.pid}-abcdef123456`;
    process.env.VELA_RUNNER_TEST_TOKEN = secret;
    t.after(() => { delete process.env.VELA_RUNNER_TEST_TOKEN; });
    const f = await fixture(t, () => `The key is ${secret}.`);
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.ok(!JSON.stringify(f.events).includes(secret), "events must not carry the secret");
    assert.ok(!(await readFile(join(result.runDir, "run.json"), "utf8")).includes(secret));
  });

  it("rejects invalid requests before creating a run", async (t) => {
    const f = await fixture(t, () => "unused");
    await assert.rejects(f.run({ prompt: "   " }), { code: "invalid_request" });
    await assert.rejects(f.run({ cwd: join(f.root, "missing") }), { code: "invalid_request" });
    await assert.rejects(f.run({ timeoutMs: -1 }), { code: "invalid_request" });
    await assert.rejects(stat(join(f.dataDir, "runs")));
  });

  it("keeps parallel runs in separate directories", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => "parallel ok");
    const [a, b] = await Promise.all([f.run(), f.run()]);
    assert.equal(a.status, "completed");
    assert.equal(b.status, "completed");
    assert.notEqual(a.runDir, b.runDir);
    assert.notEqual(a.conversationId, b.conversationId);
  });
});
