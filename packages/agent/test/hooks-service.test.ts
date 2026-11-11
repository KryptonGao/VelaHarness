import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HooksService, hookMatches, isGitCommitCommand } from "../src/hooks-service.ts";
import { parseHooksConfig, type HookDefinition, type HookScope } from "../../shared/src/hooks.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-hooks-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  const service = new HooksService({ agentDir });
  t.after(async () => { service.cancel(); await rm(root, { recursive: true, force: true }); });
  const document = (scope: HookScope) => service.getCatalog(cwd).documents.find(d => d.scope === scope)!;
  function save(hooks: HookDefinition[], scope: HookScope = "project") {
    service.save({ cwd, scope, expectedDigest: document(scope).digest, config: { version: 1, hooks } });
  }
  function trust(scope: HookScope = "project") { service.setTrust({ cwd, scope, digest: document(scope).digest, trusted: true }); }
  const run = (event: HookDefinition["event"] = "PreToolUse", extra = {}) => service.run({ cwd, event, toolName: "write", ...extra });
  return { root, cwd, agentDir, service, document, save, trust, run };
}
const hook = (command: string, patch: Partial<HookDefinition> = {}): HookDefinition => ({ id: "test", event: "PreToolUse", command, ...patch });

describe("hooks configuration and trust", () => {
  it("rejects unknown fields, duplicate IDs, invalid events/matchers/limits and unsupported schemas", () => {
    for (const value of [{ hooks: [] }, { version: 1, hooks: [], extra: true }, { version: 1, hooks: [hook("true"), hook("true")] },
      { version: 1, hooks: [hook("true", { timeoutMs: 1 })] }, { version: 1, hooks: [hook("true", { matcher: "(.*)" })] },
      { version: 1, hooks: [hook("true", { event: "Stop", matcher: "*" })] }, { version: 1, hooks: [{ ...hook("true"), env: {} }] }]) assert.throws(() => parseHooksConfig(value));
    assert.deepEqual(parseHooksConfig({ version: 1, hooks: [hook("true")] }).hooks[0], hook("true"));
    assert.throws(() => parseHooksConfig({ version: 1, hooks: Array.from({ length: 10 }, (_, i) => hook("文".repeat(6000), { id: `unicode-${i}` })) }), /too large/);
  });
  it("requires exact explicit trust for global and project commands; edits invalidate it", async t => {
    const f = await fixture(t);
    for (const scope of ["global", "project"] as const) {
      f.save([hook("printf 'ran' > marker")], scope);
      assert.equal(f.document(scope).trusted, false);
      await f.run();
      await assert.rejects(readFile(join(f.cwd, "marker")));
      f.trust(scope);
      assert.equal(f.document(scope).trusted, true);
      assert.equal((await f.run()).allowed, true);
      assert.equal(await readFile(join(f.cwd, "marker"), "utf8"), "ran");
      await rm(join(f.cwd, "marker"));
      await writeFile(f.document(scope).path, JSON.stringify({ version: 1, hooks: [hook("touch other")] }));
      assert.equal(f.document(scope).trusted, false);
    }
  });
  it("rejects stale saves and approvals without overwriting external changes", async t => {
    const f = await fixture(t);
    const stale = f.document("project").digest;
    f.save([hook("true")]);
    assert.throws(() => f.service.save({ cwd: f.cwd, scope: "project", config: { version: 1, hooks: [] }, expectedDigest: stale }), /changed/);
    assert.throws(() => f.service.setTrust({ cwd: f.cwd, scope: "project", trusted: true, digest: stale }), /changed/);
    assert.equal(f.document("project").config.hooks.length, 1);
  });
  it("detects stale revisions even for oversized invalid configuration files", async t => {
    const f = await fixture(t);
    await mkdir(join(f.cwd, ".vela"));
    const path = f.document("project").path;
    await writeFile(path, "x".repeat(128001));
    const stale = f.document("project").digest;
    await writeFile(path, "y".repeat(128002));
    assert.notEqual(f.document("project").digest, stale);
    assert.throws(() => f.service.save({ cwd: f.cwd, scope: "project", expectedDigest: stale, config: { version: 1, hooks: [] } }), /changed/);
  });
  it("canonicalizes workspaces and does not share project approvals", async t => {
    const f = await fixture(t);
    f.save([hook("true")]); f.trust();
    const alias = join(f.root, "alias"); await symlink(f.cwd, alias);
    assert.equal(f.service.getCatalog(alias).documents[1]?.trusted, true);
    const other = join(f.root, "other"); await mkdir(join(other, ".vela"), { recursive: true });
    await writeFile(join(other, ".vela", "hooks.json"), await readFile(f.document("project").path));
    assert.equal(f.service.getCatalog(other).documents[1]?.trusted, false);
    const restarted = new HooksService({ agentDir: f.agentDir });
    assert.equal(restarted.getCatalog(f.cwd).documents[1]?.trusted, true);
  });
  it("rejects symlinked config targets and reports malformed documents without running them", async t => {
    const f = await fixture(t);
    await mkdir(join(f.cwd, ".vela"));
    const external = join(f.root, "external"); await writeFile(external, "unchanged");
    await symlink(external, join(f.cwd, ".vela", "hooks.json"));
    assert.ok(f.document("project").error);
    assert.throws(() => f.save([hook("true")]));
    assert.equal(await readFile(external, "utf8"), "unchanged");
    assert.equal((await f.run()).allowed, true);
    assert.equal(f.service.getCatalog(f.cwd).history.at(-1)?.code, "invalid-config");
  });
});

describe("hooks execution", () => {
  it("matches tool globs, never evaluates regular expressions", () => {
    assert.equal(hookMatches("mcp__*?", "mcp__x"), true);
    assert.equal(hookMatches("read", "readFile"), false);
    assert.equal(hookMatches("*", undefined), false);
    assert.equal(isGitCommitCommand({ command: "git -C /repo commit -m message" }), true);
    assert.equal(isGitCommitCommand({ command: "git status" }), false);
  });
  it("runs global then project, sends versioned stdin and aggregates context", async t => {
    const f = await fixture(t);
    f.save([hook("printf '{\"additionalContext\":\"global\"}'")], "global"); f.trust("global");
    f.save([hook("node -e 'let s=\"\";process.stdin.on(\"data\",c=>s+=c);process.stdin.on(\"end\",()=>{const x=JSON.parse(s); console.log(JSON.stringify({additionalContext:[x.version,x.event,x.toolInput.path].join(\":\")}))})'")]); f.trust();
    const result = await f.run("PreToolUse", { toolInput: { path: "test.txt" } });
    assert.equal(result.allowed, true);
    assert.equal(result.additionalContext, "global\n1:PreToolUse:test.txt");
  });
  it("supports denial and short circuits later commands", async t => {
    const f = await fixture(t);
    f.save([hook("printf '{\"decision\":\"deny\",\"reason\":\"test required\"}'"), hook("touch must-not-run", { id: "second" })]); f.trust();
    const result = await f.run();
    assert.equal(result.allowed, false); assert.equal(result.failed, false); assert.equal(result.reason, "test required");
    await assert.rejects(readFile(join(f.cwd, "must-not-run")));
    assert.equal(f.service.getCatalog(f.cwd).history.at(-1)?.status, "denied");
  });
  it("skips disabled, unmatched and restricted hooks", async t => {
    const f = await fixture(t);
    f.save([hook("touch must-not-run"), hook("exit 1", { id: "disabled", enabled: false }), hook("exit 1", { id: "unmatched", matcher: "read" })]); f.trust();
    assert.equal((await f.service.run({ cwd: f.cwd, event: "PreToolUse", toolName: "write" }, { allowed: false })).allowed, true);
    await assert.rejects(readFile(join(f.cwd, "must-not-run")));
    assert.deepEqual(f.service.getCatalog(f.cwd).history.map(r => r.code), ["restricted"]);
  });
  it("fails closed on nonzero exit, malformed protocol, oversized output and timeout", async t => {
    const f = await fixture(t);
    for (const [command, expected] of [["exit 2", "exit"], ["echo log-not-json", "invalid-output"], ["echo '{\"decision\":\"maybe\"}'", "invalid-output"],
      ["node -e 'process.stdout.write(\"x\".repeat(70000))'", "output-limit"], ["sleep 10", "timeout"]] as const) {
      f.save([hook(command, { timeoutMs: 200 })]); f.trust();
      const result = await f.run();
      assert.equal(result.allowed, false, command); assert.equal(result.failed, true, command);
      assert.equal(f.service.getCatalog(f.cwd).history.at(-1)?.code, expected);
    }
  });
  it("cancels running processes and descendants on abort and trust revocation", async t => {
    const f = await fixture(t);
    for (const revoke of [false, true]) {
      f.save([hook("(sleep 0.6; touch leaked) & wait")]); f.trust();
      const controller = new AbortController();
      const approvedDigest = f.document("project").digest;
      const pending = f.service.run({ cwd: f.cwd, event: "PreToolUse" }, { signal: controller.signal });
      await new Promise(r => setTimeout(r, 50));
      if (revoke) {
        // Revocation must still stop old commands after an external config edit.
        await writeFile(f.document("project").path, `${await readFile(f.document("project").path, "utf8")}\n`);
        f.service.setTrust({ cwd: f.cwd, scope: "project", trusted: false, digest: approvedDigest });
      } else controller.abort();
      assert.equal((await pending).failed, true);
      assert.equal(f.service.getCatalog(f.cwd).history.at(-1)?.code, "cancelled");
    }
    await new Promise(r => setTimeout(r, 800));
    await assert.rejects(readFile(join(f.cwd, "leaked")));
  });
  it("test runs require current approval, matching rules, and synthetic input", async t => {
    const f = await fixture(t);
    f.save([hook("node -e 'let s=\"\";process.stdin.on(\"data\",c=>s+=c);process.stdin.on(\"end\",()=>process.exit(JSON.parse(s).toolInput.hookTest?0:1))'", { matcher: "write" })]);
    const input = { cwd: f.cwd, scope: "project" as const, digest: f.document("project").digest, event: "PreToolUse" as const, toolName: "write" };
    await assert.rejects(f.service.test(input), /approve/);
    f.trust();
    assert.equal((await f.service.test(input)).allowed, true);
    await assert.rejects(f.service.test({ ...input, toolName: "read" }), /No enabled/);
    f.save([hook("true")]);
    await assert.rejects(f.service.test(input), /approve/);
  });
  it("refuses oversized stdin and stops a chain whose approved configuration changed", async t => {
    const f = await fixture(t);
    f.save([hook("touch must-not-run")]); f.trust();
    const result = await f.run("PreToolUse", { toolInput: { text: "x".repeat(1_000_001) } });
    assert.equal(result.failed, true);
    assert.equal(f.service.getCatalog(f.cwd).history.at(-1)?.code, "input-limit");
    await assert.rejects(readFile(join(f.cwd, "must-not-run")));
    f.save([hook("true"), hook("touch must-not-run", { id: "second" })]); f.trust();
    const unsubscribe = f.service.subscribe(run => {
      if (run.hookId === "test" && run.status === "allowed") f.save([hook("true")]);
    });
    assert.equal((await f.run()).failed, true); unsubscribe();
    assert.equal(f.service.getCatalog(f.cwd).history.at(-1)?.code, "changed");
    await assert.rejects(readFile(join(f.cwd, "must-not-run")));
  });
  it("keeps only bounded metadata in history and observer payloads", async t => {
    const f = await fixture(t);
    f.save([hook("printf '{\"reason\":\"secret-output\",\"additionalContext\":\"private-context-token\"}'")]); f.trust();
    const observed: unknown[] = [];
    f.service.subscribe(r => observed.push(r));
    await f.run("PreToolUse", { toolInput: { token: "secret-input" } });
    const text = JSON.stringify([observed, f.service.getCatalog(f.cwd).history]);
    for (const privateText of ["secret-input", "secret-output", "private-context-token", "printf"]) assert.ok(!text.includes(privateText));
    for (let i = 0; i < 205; i++) await f.service.run({ cwd: f.cwd, event: "PreToolUse" }, { allowed: false });
    assert.equal(f.service.getCatalog(f.cwd).history.length, 200);
  });
});
