import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { before, describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { parseCommand, UsageError } from "../src/args.ts";
import { runCli, type CliIo, type CliSignal } from "../src/main.ts";
import { LineWriter } from "../src/output.ts";
import { startFakeModel, writeModelConfig, type FakeReply, type FakeRequest } from "../../../packages/runner/test/support/fake-model.ts";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const built = join(appDir, "out/cli.mjs");

const bash = (command: string, extra: Record<string, unknown> = {}) => ({ toolCalls: [{ name: "bash", arguments: { command, ...extra } }] });
const processAlive = (marker: string): Promise<boolean> =>
  new Promise(resolve => execFile("pgrep", ["-f", marker], error => resolve(!error)));

async function fixture(t: TestContext, reply: (request: FakeRequest) => FakeReply | Promise<FakeReply>) {
  const root = await mkdtemp(join(tmpdir(), "vela-cli-"));
  const cwd = join(root, "workspace");
  const dataDir = join(root, "data");
  const configDir = join(root, "config");
  await mkdir(cwd);
  const model = await startFakeModel(reply);
  await writeModelConfig(configDir, model.url);
  t.after(async () => { await model.close(); await rm(root, { recursive: true, force: true }); });
  const base = ["run", "--cwd", cwd, "--data-dir", dataDir, "--config-dir", configDir];
  return { root, cwd, dataDir, configDir, model, base };
}

/** 进程内调用 runCli，收集 stdout / stderr，信号可手动触发。 */
function inProcess(args: string[], options: { stdin?: string; stdoutFactory?: () => Writable } = {}) {
  let out = "";
  let err = "";
  const stdout = options.stdoutFactory?.() ?? new Writable({ write(chunk, _enc, done) { out += chunk.toString(); done(); } });
  const stderr = new Writable({ write(chunk, _enc, done) { err += chunk.toString(); done(); } });
  const listeners = new Set<(signal: CliSignal) => void>();
  const forced: number[] = [];
  const io: CliIo = {
    stdin: Readable.from(options.stdin === undefined ? [] : [options.stdin]),
    stdout, stderr, env: {}, cwd: process.cwd(),
    onSignal: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    forceExit: code => { forced.push(code); },
  };
  const done = runCli(args, io);
  return { done, out: () => out, err: () => err, signal: (name: CliSignal) => { for (const listener of [...listeners]) listener(name); }, forced };
}

describe("argument parsing", () => {
  const env = { cwd: "/work", home: "/home/user" };
  it("applies defaults", () => {
    const parsed = parseCommand(["run", "fix it"], env);
    assert.equal(parsed.kind, "run");
    if (parsed.kind !== "run") return;
    assert.equal(parsed.options.cwd, "/work");
    assert.equal(parsed.options.dataDir, "/home/user/.vela-runner");
    assert.equal(parsed.options.configDir, "/home/user/.vela-runner/config");
    assert.equal(parsed.options.mode, "agent");
    assert.equal(parsed.options.sandboxMode, "ask");
    assert.equal(parsed.options.format, "text");
    assert.equal(parsed.options.model, null);
  });
  it("uses the pnpm launch directory and expands ~", () => {
    const parsed = parseCommand(["run", "--data-dir", "~/runs", "--config-dir", "~/.vela", "x"], { ...env, initCwd: "/launch" });
    assert.ok(parsed.kind === "run");
    assert.equal(parsed.options.cwd, "/launch");
    assert.equal(parsed.options.dataDir, "/home/user/runs");
    assert.equal(parsed.options.configDir, "/home/user/.vela");
  });
  it("rejects invalid combinations with a usage error", () => {
    for (const args of [
      ["run"], ["run", "a", "b"], ["run", "--prompt-file", "p.txt", "task"], ["run", "--provider", "x", "task"], ["run", "--model", "x", "task"],
      ["run", "--format", "xml", "t"], ["run", "--sandbox", "yolo", "t"], ["run", "--mode", "goal", "t"], ["run", "--thinking", "extreme", "t"],
      ["run", "--timeout", "0", "t"], ["run", "--timeout", "abc", "t"], ["run", "--locale", "fr", "t"], ["bogus"], [], ["run", "--nope", "t"],
    ]) assert.throws(() => parseCommand(args, env), UsageError, args.join(" "));
  });
  it("recognizes help and version", () => {
    assert.equal(parseCommand(["--help"], env).kind, "help");
    assert.equal(parseCommand(["-v"], env).kind, "version");
  });
});

describe("stdout back-pressure", () => {
  it("waits for drain and keeps order", async () => {
    const received: string[] = [];
    let drains = 0;
    const slow = new Writable({
      highWaterMark: 1,
      write(chunk, _enc, done) { setTimeout(() => { received.push(chunk.toString()); done(); }, 5); },
    });
    slow.on("drain", () => { drains += 1; });
    const writer = new LineWriter(slow);
    for (let i = 0; i < 20; i += 1) await writer.write(`line-${i}\n`);
    await writer.flush();
    // flush() issues an empty write purely to learn when the queue is drained.
    assert.deepEqual(received.filter(Boolean), Array.from({ length: 20 }, (_, i) => `line-${i}\n`));
    assert.ok(drains > 0, "writer must have waited for drain");
  });
  it("reports a closed output once and drops later writes", async () => {
    const broken = new Writable({ write(_chunk, _enc, done) { done(new Error("EPIPE")); } });
    let notified = 0;
    const writer = new LineWriter(broken, () => { notified += 1; });
    await writer.write("a\n");
    await new Promise(resolve => setImmediate(resolve));
    await writer.write("b\n");
    assert.equal(notified, 1);
    assert.equal(writer.isBroken, true);
  });
});

describe("runCli in process", () => {
  it("prints only the final reply on stdout in text mode and progress on stderr", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, ({ index }) => index === 0 ? bash("echo hi") : "Finished the task.");
    const run = inProcess([...f.base, "--sandbox", "full", "do it"]);
    assert.equal(await run.done, 0, run.err());
    assert.equal(run.out(), "Finished the task.\n");
    assert.match(run.err(), /bash echo hi/);
  });

  it("emits valid JSONL only on stdout, ending with exactly one run_result", { timeout: 60_000 }, async (t) => {
    const secret = `sk-cli-${process.pid}-0123456789`;
    const previous = process.env.VELA_RUNNER_CLI_TOKEN;
    process.env.VELA_RUNNER_CLI_TOKEN = secret;
    t.after(() => { if (previous === undefined) delete process.env.VELA_RUNNER_CLI_TOKEN; else process.env.VELA_RUNNER_CLI_TOKEN = previous; });
    const f = await fixture(t, ({ index }) => index === 0 ? bash("echo hi") : `done ${secret}`);
    const run = inProcess([...f.base, "--sandbox", "full", "--format", "jsonl", "do it"]);
    assert.equal(await run.done, 0, run.err());
    const lines = run.out().split("\n").filter(Boolean);
    const events = lines.map(line => JSON.parse(line));
    assert.ok(events.length >= 3);
    assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
    assert.ok(events.every(event => event.version === 1 && typeof event.runId === "string" && typeof event.timestamp === "string"));
    assert.equal(events.filter(event => event.type === "run_result").length, 1);
    assert.equal(events.at(-1).type, "run_result");
    assert.equal(events.at(-1).payload.status, "completed");
    assert.ok(!run.out().includes(secret), "stdout must not carry credentials");
    assert.equal(run.err(), "", "jsonl mode keeps stderr quiet on success");
  });

  it("reads the task from stdin with --prompt-file -", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => "ok");
    const run = inProcess([...f.base, "--prompt-file", "-"], { stdin: "task from stdin" });
    assert.equal(await run.done, 0, run.err());
    assert.match(JSON.stringify(f.model.requests[0]?.body.messages), /task from stdin/);
  });

  it("exits 3 when approval is required", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => bash("echo nope"));
    const run = inProcess([...f.base, "--format", "jsonl", "do it"]);
    assert.equal(await run.done, 3);
    const result = JSON.parse(run.out().trim().split("\n").at(-1)!);
    assert.equal(result.payload.status, "blocked");
    assert.match(run.err(), /approval_required/);
  });

  it("exits 124 on timeout", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => ({ hang: true }));
    const run = inProcess([...f.base, "--timeout", "1.5", "do it"]);
    assert.equal(await run.done, 124);
  });

  it("exits 2 for usage and configuration problems and 1 for runtime failures", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => ({ status: 400, body: "{}" }));
    assert.equal(await inProcess(["run"]).done, 2);
    assert.equal(await inProcess([...f.base, "--provider", "fake-local", "--model", "missing", "x"]).done, 2);
    assert.equal(await inProcess(["run", "--cwd", join(f.root, "nope"), "--data-dir", f.dataDir, "--config-dir", f.configDir, "x"]).done, 2);
    assert.equal(await inProcess([...f.base, "--prompt-file", join(f.root, "absent.txt")]).done, 2);
    assert.equal(await inProcess([...f.base, "do it"]).done, 1);
  });

  it("exits 130 on SIGINT and forces exit on the second signal", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => ({ hang: true }));
    const run = inProcess([...f.base, "--format", "jsonl", "do it"]);
    await new Promise(resolve => setTimeout(resolve, 1000));
    run.signal("SIGINT");
    run.signal("SIGINT");
    assert.equal(await run.done, 130);
    assert.deepEqual(run.forced, [130]);
    const result = JSON.parse(run.out().trim().split("\n").at(-1)!);
    assert.equal(result.payload.status, "cancelled");
  });

  it("delivers every event through a slow stdout", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, ({ index }) => index === 0 ? bash("echo hi") : "slow done");
    let text = "";
    const run = inProcess([...f.base, "--sandbox", "full", "--format", "jsonl", "do it"], {
      stdoutFactory: () => new Writable({ highWaterMark: 16, write(chunk, _enc, done) { setTimeout(() => { text += chunk.toString(); done(); }, 2); } }),
    });
    assert.equal(await run.done, 0, run.err());
    const events = text.split("\n").filter(Boolean).map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
    assert.equal(events.at(-1).type, "run_result");
  });
});

describe("built CLI process", () => {
  before(async () => {
    await new Promise<void>((resolve, reject) => execFile(process.execPath, ["build.mjs"], { cwd: appDir }, error => error ? reject(error) : resolve()));
  });

  const spawnCli = (args: string[], env: Record<string, string> = {}) =>
    spawn(process.execPath, [built, ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
  const exited = (child: ReturnType<typeof spawnCli>) => new Promise<number | null>(resolve => child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 : null))));

  it("runs without Electron or the test loader and prints the reply", { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, () => "built ok");
    const child = spawnCli([...f.base, "go"]);
    let out = "";
    child.stdout.on("data", chunk => { out += chunk; });
    assert.equal(await exited(child), 0);
    assert.equal(out, "built ok\n");
  });

  it("bundle only depends on Node built-ins and the Pi runtime packages", async () => {
    const source = await readFile(built, "utf8");
    const specifiers = new Set([...source.matchAll(/^\s*(?:import|export)\s[^"']*?from\s+"([^"]+)"/gm)].map(match => match[1]!));
    for (const specifier of specifiers) {
      assert.ok(specifier.startsWith("node:") || specifier.startsWith("@earendil-works/") || specifier === "typebox" || specifier.startsWith("./"),
        `unexpected import ${specifier}`);
    }
    assert.ok(!/from "electron"|require\("electron"\)/.test(source));
    assert.ok(!source.includes("apps/desktop/src"), "no desktop sources in the bundle");
  });

  it("cancels on SIGINT / SIGTERM with 130 / 143 and leaves no background command", { timeout: 60_000 }, async (t) => {
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
      const token = `27.${process.pid}${Date.now() % 100000}`;
      const f = await fixture(t, ({ index }) => index === 0 ? bash(`sleep ${token}`, { run_in_background: true }) : index === 1 ? "Started." : ({ hang: true }));
      const child = spawnCli([...f.base, "--sandbox", "full", "--format", "jsonl", "go"]);
      let out = "";
      child.stdout.on("data", chunk => { out += chunk; });
      const started = Date.now();
      while (!(await processAlive(`sleep ${token}`))) {
        if (Date.now() - started > 15_000) throw new Error("background command never started");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      child.kill(signal);
      assert.equal(await exited(child), code);
      assert.equal(JSON.parse(out.trim().split("\n").at(-1)!).payload.status, "cancelled");
      assert.equal(await processAlive(`sleep ${token}`), false, `${signal}: background command must be gone`);
    }
  });

  it("cancels and cleans up when stdout is closed (EPIPE)", { timeout: 60_000 }, async (t) => {
    const marker = join(tmpdir(), `vela-epipe-${process.pid}-${Date.now()}`);
    const token = `26.${process.pid}${Date.now() % 100000}`;
    const f = await fixture(t, ({ index }) => index === 0 ? bash(`sleep ${token}; touch ${marker}`, { run_in_background: true }) : index === 1 ? "Started." : ({ hang: true }));
    const child = spawnCli([...f.base, "--sandbox", "full", "--format", "jsonl", "go"]);
    child.stdout.once("data", () => child.stdout.destroy());
    const code = await exited(child);
    assert.equal(code, 1);
    assert.equal(await processAlive(`sleep ${token}`), false);
    await assert.rejects(stat(marker));
  });

  it("rejects a bad option with exit 2 and a message on stderr", async () => {
    const child = spawnCli(["run", "--format", "xml", "x"]);
    let err = "";
    child.stderr.on("data", chunk => { err += chunk; });
    assert.equal(await exited(child), 2);
    assert.match(err, /--format/);
  });
});
