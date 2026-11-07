import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, it } from "node:test";
import { TerminalCloseCheck, probeTerminalCommand, terminalHasRunningCommand } from "../src/main/terminal-close.ts";

const idle = "1 0 Ss /sbin/launchd\n100 1 Ss /bin/zsh\n";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options: { busy?: boolean; probeError?: boolean } = {}) {
  type Session = { owner: number };
  const original: Session = { owner: 7 };
  const sessions = new Map<string, Session>([["term", original]]);
  let probes = 0;
  const check = new TerminalCloseCheck({
    getSession: id => sessions.get(id),
    probe: async () => {
      probes++;
      if (options.probeError) throw new Error("ps unavailable");
      return options.busy ?? true;
    },
  });
  return { check, sessions, original, probes: () => probes };
}

describe("terminal process inspection", () => {
  it("allows a live but idle shell, including a login shell", () => {
    assert.equal(terminalHasRunningCommand(100, "/bin/zsh", idle), false);
    assert.equal(terminalHasRunningCommand(100, "/bin/zsh", idle.replace("/bin/zsh", "-zsh")), false);
  });

  it("finds foreground, background and stopped direct child jobs", () => {
    for (const state of ["S+", "S", "T"]) {
      assert.equal(terminalHasRunningCommand(100, "/bin/zsh", idle + `200 100 ${state} sleep\n`), true);
    }
  });

  it("detects commands that exec replaced the shell without leaving children", () => {
    assert.equal(terminalHasRunningCommand(100, "/bin/zsh", idle.replace("/bin/zsh", "/usr/bin/python3")), true);
    assert.equal(terminalHasRunningCommand(100, "/bin/zsh", idle.replace("/bin/zsh", "/Applications/Some Tool/bin/worker")), true);
  });

  it("allows exited shells and ignores zombie child jobs and unrelated processes", () => {
    assert.equal(terminalHasRunningCommand(100, "/bin/zsh", "1 0 Ss /sbin/launchd\n"), false);
    assert.equal(terminalHasRunningCommand(100, "/bin/zsh", "100 1 Z zsh\n"), false);
    assert.equal(terminalHasRunningCommand(100, "/bin/zsh", idle + "200 100 Z sleep\n201 1 S sleep\n"), false);
  });

  it("rejects invalid or missing process data rather than declaring idle", () => {
    for (const table of ["", "\n", "not a process table", idle + "truncated"]) {
      assert.throws(() => terminalHasRunningCommand(100, "/bin/zsh", table));
    }
    for (const pid of [0, -1, NaN, 1.2]) assert.throws(() => terminalHasRunningCommand(pid, "/bin/zsh", idle));
  });
});

describe("asynchronous ps inspection", { skip: process.platform === "win32" }, () => {
  for (const [name, command, expected] of [
    ["idle", "", false],
    ["foreground command", "sleep 20\n", true],
    ["background command", "sleep 20 &\n", true],
    ["exec replacement", "exec sleep 20\n", true],
  ] as const) {
    it(`detects a real ${name}`, async () => {
      const shell = spawn("/bin/sh", [], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
      const exited = once(shell, "exit");
      await once(shell, "spawn");
      try {
        if (command) shell.stdin.write(command);
        let actual = !expected;
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          actual = await probeTerminalCommand(shell.pid!, "/bin/sh");
          if (actual === expected) break;
          await new Promise(done => setTimeout(done, 20));
        }
        assert.equal(actual, expected);
      } finally {
        // Kill the isolated process group so background jobs cannot outlive the test.
        process.kill(-shell.pid!, "SIGKILL");
        await exited;
      }
    });
  }
});

describe("terminal close status", () => {
  it("reports idle for idle and already exited sessions", async () => {
    const f = fixture({ busy: false });
    assert.equal(await f.check.request("term", 7), "idle");
    assert.equal(await f.check.request("exited", 7), "idle");
    assert.equal(f.probes(), 1);
    assert.equal(f.sessions.get("term"), f.original);
  });

  it("reports busy without ending the session", async () => {
    const f = fixture();
    assert.equal(await f.check.request("term", 7), "busy");
    assert.equal(f.sessions.get("term"), f.original);
    assert.equal(f.probes(), 1);
  });

  it("checks owner before probing or joining a pending request", async () => {
    const probe = deferred<boolean>();
    const session = { owner: 7 };
    let probes = 0;
    const check = new TerminalCloseCheck({
      getSession: () => session,
      probe: () => { probes++; return probe.promise; },
    });
    assert.equal(await check.request("term", 8), "unavailable");
    assert.equal(probes, 0);
    const own = check.request("term", 7);
    assert.equal(await check.request("term", 8), "unavailable");
    assert.equal(probes, 1);
    probe.resolve(true);
    assert.equal(await own, "busy");
  });

  it("shares a pending probe, then allows a fresh status check", async () => {
    const probe = deferred<boolean>();
    const session = { owner: 7 };
    let probes = 0;
    const check = new TerminalCloseCheck({
      getSession: () => session,
      probe: () => { probes++; return probes === 1 ? probe.promise : Promise.resolve(false); },
    });
    const first = check.request("term", 7);
    assert.equal(check.request("term", 7), first);
    assert.equal(probes, 1);
    probe.resolve(true);
    assert.equal(await first, "busy");
    assert.equal(await check.request("term", 7), "idle");
    assert.equal(probes, 2);
  });

  it("conservatively reports busy when inspection fails and clears the pending request", async () => {
    const f = fixture({ probeError: true });
    assert.equal(await f.check.request("term", 7), "busy");
    assert.equal(await f.check.request("term", 7), "busy");
    assert.equal(f.probes(), 2);
    assert.equal(f.sessions.get("term"), f.original);
  });

  it("reports idle when the session exits during inspection", async () => {
    for (const busy of [false, true]) {
      const probe = deferred<boolean>();
      const f = fixture();
      const check = new TerminalCloseCheck({
        getSession: id => f.sessions.get(id),
        probe: () => probe.promise,
      });
      const result = check.request("term", 7);
      f.sessions.delete("term");
      probe.resolve(busy);
      assert.equal(await result, "idle");
    }
  });

  it("reports unavailable for a replacement regardless of the old probe result", async () => {
    for (const busy of [false, true]) {
      const probe = deferred<boolean>();
      const f = fixture();
      const check = new TerminalCloseCheck({
        getSession: id => f.sessions.get(id),
        probe: () => probe.promise,
      });
      const result = check.request("term", 7);
      f.sessions.set("term", { owner: 7 });
      probe.resolve(busy);
      assert.equal(await result, "unavailable");
    }
  });

  it("checks ownership again after a pending probe", async () => {
    const probe = deferred<boolean>();
    const session = { owner: 7 };
    const check = new TerminalCloseCheck({ getSession: () => session, probe: () => probe.promise });
    const result = check.request("term", 7);
    session.owner = 8;
    probe.resolve(false);
    assert.equal(await result, "unavailable");
  });

  it("checks a replacement independently of the original session's pending request", async () => {
    const probe = deferred<boolean>();
    const f = fixture();
    let probes = 0;
    const check = new TerminalCloseCheck({
      getSession: id => f.sessions.get(id),
      probe: session => { probes++; return session === f.original ? probe.promise : Promise.resolve(false); },
    });
    const old = check.request("term", 7);
    f.sessions.set("term", { owner: 7 });
    assert.equal(await check.request("term", 7), "idle");
    probe.resolve(true);
    assert.equal(await old, "unavailable");
    assert.equal(probes, 2);
  });
});
