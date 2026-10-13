import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import { parseRaceDraft, raceBadges, raceLimits, type Race, type RaceDraft, type RaceLane } from "@vela/shared";
import type { LaneRequest, LaneResult } from "@vela/agent";
import { RaceService, type RaceHostRuntime } from "../src/main/race-service.ts";
import { runVerifyCommand } from "../src/main/race-verify.ts";

interface Scenario {
  files?: Record<string, string>;
  status?: LaneResult["status"];
  error?: string;
  /** 为 true 时一直挂起，直到 stopLane 或 release 被调用。 */
  hang?: boolean;
  tokens?: number;
}

async function fixture(t: TestContext, scenarios: Record<string, Scenario> = {}, verify?: RaceHostRuntime["verify"]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vela-race-")));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const git = (...args: string[]) => execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Race");
  git("config", "user.email", "race@example.invalid");
  await writeFile(join(workspace, "a.txt"), "one\ntwo\nthree\n");
  await writeFile(join(workspace, "keep.txt"), "keep\n");
  git("add", "-A");
  git("commit", "-m", "init");

  const requests: LaneRequest[] = [];
  const stopped: string[] = [];
  const releases = new Map<string, () => void>();
  const tokens = new Map<string, number>();
  let resolveCalls = 0;
  const runtime: RaceHostRuntime = {
    resolveExecution: async (lane, sandboxMode) => {
      resolveCalls++;
      if (lane.model?.id === "missing") throw new Error("模型不可用，请选择已配置的模型");
      return { model: lane.model ?? { provider: "fixture", id: "default" }, thinkingLevel: lane.thinkingLevel ?? "off", sandboxMode };
    },
    runLane: async request => {
      requests.push(request);
      const label = request.title.replace("赛马 · ", "");
      const scenario = scenarios[label] ?? {};
      if (scenario.hang) await new Promise<void>(resolve => releases.set(request.conversationId, resolve));
      for (const [path, content] of Object.entries(scenario.files ?? {})) {
        await mkdir(join(request.cwd, path, ".."), { recursive: true });
        await writeFile(join(request.cwd, path), content);
      }
      tokens.set(request.conversationId, scenario.tokens ?? 100);
      return { status: scenario.status ?? "responded", ...(scenario.error ? { error: scenario.error } : {}) };
    },
    stopLane: conversationId => { stopped.push(conversationId); releases.get(conversationId)?.(); },
    laneStats: conversationId => {
      const total = tokens.get(conversationId);
      return total === undefined ? null : { input: total / 2, output: total / 2, cacheRead: 0, total };
    },
    workspaces: () => [workspace],
    sandboxMode: () => "smart",
    worktreePath: branch => join(root, "worktrees", branch.replace("/", "-")),
    verify,
  };
  const file = join(root, "races.json");
  const service = new RaceService(file, runtime);
  service.init();
  t.after(async () => { service.stop(); await rm(root, { recursive: true, force: true }); });

  const draft = (overrides: Partial<RaceDraft> = {}): RaceDraft => ({
    workspace,
    prompt: "Make the change",
    sandboxMode: "smart",
    lanes: [
      { id: "l1", label: "fast", model: { provider: "p", id: "m1" }, thinkingLevel: "low" },
      { id: "l2", label: "careful", model: { provider: "p", id: "m2" }, thinkingLevel: "high", extraPrompt: "Be careful." },
    ],
    ...overrides,
  });
  const settle = async (raceId: string): Promise<Race> => {
    for (let index = 0; index < 400; index++) {
      const race = service.list().races.find(item => item.id === raceId)!;
      if (race.status !== "running") return race;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("race did not settle");
  };
  const branches = () => git("branch", "--list", "vela/race-*");
  return { root, workspace, file, service, runtime, git, draft, settle, branches, requests, stopped, releases, resolveCalls: () => resolveCalls };
}

const lane = (race: Race, id: string): RaceLane => race.lanes.find(item => item.id === id)!;

it("start 建立每条赛道的 worktree，并行执行后给出客观证据", async t => {
  const f = await fixture(t, {
    fast: { files: { "a.txt": "one\nTWO\nthree\n" }, tokens: 300 },
    careful: { files: { "a.txt": "one\ntwo\nthree\nfour\n", "new/b.txt": "b\n" }, tokens: 900 },
  });
  const started = await f.service.start(f.draft());
  assert.equal(started.lanes.length, 2);
  assert.match(started.startSha, /^[0-9a-f]{40}$/);
  assert.equal(started.baseBranch, "main");
  for (const item of started.lanes) {
    assert.match(item.branch, /^vela\/race-[a-z0-9]+-[12]$/);
    assert.equal(item.worktree, join(f.root, "worktrees", item.branch.replace("/", "-")));
  }
  const race = await f.settle(started.id);
  assert.equal(race.status, "ready");
  const fast = lane(race, "l1");
  const careful = lane(race, "l2");
  assert.equal(fast.status, "responded");
  assert.deepEqual(fast.diff, { files: 1, added: 1, removed: 1 });
  assert.deepEqual(careful.diff, { files: 2, added: 2, removed: 0 });
  assert.equal(fast.tokens?.total, 300);
  assert.equal(careful.tokens?.total, 900);
  assert.match(fast.commitSha ?? "", /^[0-9a-f]{40}$/);
  assert.deepEqual(fast.changedFiles, ["a.txt"]);
  assert.deepEqual(fast.verification, { state: "skipped" });
  // 每条赛道在自己的 worktree 里跑，附加提示只给设置了的那条，并带上隔离提示。
  const byCwd = new Map(f.requests.map(request => [request.cwd, request]));
  assert.equal(byCwd.get(fast.worktree)?.prompt.includes("Be careful."), false);
  assert.equal(byCwd.get(careful.worktree)?.prompt.includes("Be careful."), true);
  assert.match(byCwd.get(fast.worktree)!.prompt, /isolated git worktree/);
  assert.equal(byCwd.get(fast.worktree)?.execution.sandboxMode, "smart");
  assert.equal(byCwd.get(fast.worktree)?.execution.model.id, "m1");
  assert.equal(byCwd.get(careful.worktree)?.execution.thinkingLevel, "high");
  // 主工作区没有被动过。
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(await readFile(join(f.workspace, "a.txt"), "utf8"), "one\ntwo\nthree\n");
});

it("没有任何改动的赛道不可采用，也不跑统一验证", async t => {
  const calls: string[] = [];
  const f = await fixture(t, { fast: { files: { "a.txt": "x\n" } }, careful: {} }, async (_command, cwd) => { calls.push(cwd); return { exitCode: 0, timedOut: false, durationMs: 1, outputTail: "" }; });
  const race = await f.settle((await f.service.start(f.draft({ verifyCommand: "true" }))).id);
  const idle = lane(race, "l2");
  assert.equal(idle.commitSha, null);
  assert.deepEqual(idle.diff, { files: 0, added: 0, removed: 0 });
  assert.deepEqual(idle.verification, { state: "skipped" });
  assert.deepEqual(calls, [lane(race, "l1").worktree]);
  const result = await f.service.adopt(race.id, "l2");
  assert.deepEqual(result.ok, false);
  assert.equal(!result.ok && result.reason, "no_changes");
});

it("统一验证依序执行，并记录通过、失败与超时", async t => {
  let running = 0;
  let overlap = false;
  const order: string[] = [];
  const f = await fixture(t, {
    fast: { files: { "ok.txt": "1" } }, careful: { files: { "bad.txt": "1" } }, slow: { files: { "slow.txt": "1" } },
  }, async (command, cwd) => {
    running++;
    if (running > 1) overlap = true;
    order.push(cwd);
    await new Promise(resolve => setTimeout(resolve, 20));
    running--;
    if (cwd.endsWith("-1")) return { exitCode: 0, timedOut: false, durationMs: 20, outputTail: "all good" };
    if (cwd.endsWith("-2")) return { exitCode: 2, timedOut: false, durationMs: 20, outputTail: "FAIL a.test" };
    return { exitCode: null, timedOut: true, durationMs: 20, outputTail: "..." };
  });
  const race = await f.settle((await f.service.start(f.draft({
    verifyCommand: "pnpm test",
    lanes: [{ id: "l1", label: "fast" }, { id: "l2", label: "careful" }, { id: "l3", label: "slow" }],
  }))).id);
  assert.equal(overlap, false);
  assert.deepEqual(order, race.lanes.map(item => item.worktree));
  assert.equal(lane(race, "l1").verification.state, "passed");
  assert.equal(lane(race, "l2").verification.state, "failed");
  assert.equal(lane(race, "l2").verification.exitCode, 2);
  assert.equal(lane(race, "l2").verification.outputTail, "FAIL a.test");
  assert.equal(lane(race, "l3").verification.state, "timeout");
  const badges = raceBadges(race.lanes);
  assert.deepEqual(badges.get("l1")?.includes("only_passing"), true);
});

it("runVerifyCommand 在 worktree 里执行、脱敏、截断，并在超时时杀掉整个进程组", async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "vela-race-verify-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "marker.txt"), "here");
  const ok = await runVerifyCommand("test -f marker.txt && echo found", dir, 5_000);
  assert.equal(ok.exitCode, 0);
  assert.match(ok.outputTail, /found/);
  const secret = await runVerifyCommand("echo 'Authorization: Bearer abcdef123456'; exit 4", dir, 5_000);
  assert.equal(secret.exitCode, 4);
  assert.doesNotMatch(secret.outputTail, /abcdef123456/);
  const long = await runVerifyCommand("i=0; while [ $i -lt 2000 ]; do echo line-$i; i=$((i+1)); done; echo END", dir, 10_000);
  assert.ok(long.outputTail.length <= raceLimits.outputTail);
  assert.match(long.outputTail, /END/);
  const started = Date.now();
  const timeout = await runVerifyCommand("sleep 30 & sleep 30", dir, 300);
  assert.equal(timeout.timedOut, true);
  assert.ok(Date.now() - started < 5_000, "超时必须及时返回");
});

it("采用：squash 到暂存区，其余赛道的 worktree 与分支全部清除，不产生提交", async t => {
  const f = await fixture(t, {
    fast: { files: { "a.txt": "one\nTWO\nthree\n", "added.txt": "x\n" } },
    careful: { files: { "keep.txt": "changed\n" } },
  });
  const race = await f.settle((await f.service.start(f.draft())).id);
  const head = f.git("rev-parse", "HEAD");
  const result = await f.service.adopt(race.id, "l1");
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && [...result.files].sort(), ["a.txt", "added.txt"]);
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.match(f.git("status", "--porcelain"), /^M {2}a\.txt$/m);
  assert.equal(await readFile(join(f.workspace, "keep.txt"), "utf8"), "keep\n", "未采用赛道的改动不会进来");
  const after = f.service.list().races.find(item => item.id === race.id)!;
  assert.equal(after.status, "adopted");
  assert.equal(after.adoptedLaneId, "l1");
  assert.ok(after.lanes.every(item => item.worktreeRemovedAt));
  assert.ok(after.lanes.every(item => !existsSync(item.worktree)));
  assert.equal(f.branches(), "");
  assert.equal(f.git("worktree", "list").split("\n").length, 1);
  // 已采用的赛马不能再采用别的赛道。
  const again = await f.service.adopt(race.id, "l2");
  assert.equal(again.ok, false);
});

it("采用遇到冲突时还原、保留赛道，可改选另一条", async t => {
  const f = await fixture(t, {
    fast: { files: { "a.txt": "lane one\ntwo\nthree\n" } },
    careful: { files: { "keep.txt": "careful\n" } },
  });
  const race = await f.settle((await f.service.start(f.draft())).id);
  await writeFile(join(f.workspace, "a.txt"), "main moved\ntwo\nthree\n");
  f.git("commit", "-am", "main moved");
  const head = f.git("rev-parse", "HEAD");
  const conflict = await f.service.adopt(race.id, "l1");
  assert.equal(conflict.ok, false);
  assert.equal(!conflict.ok && conflict.reason, "conflict");
  assert.deepEqual(!conflict.ok && conflict.conflicts, ["a.txt"]);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.git("rev-parse", "HEAD"), head);
  const still = f.service.list().races.find(item => item.id === race.id)!;
  assert.equal(still.status, "ready");
  assert.ok(still.lanes.every(item => existsSync(item.worktree)));
  const other = await f.service.adopt(race.id, "l2");
  assert.equal(other.ok, true);
  assert.equal(await readFile(join(f.workspace, "keep.txt"), "utf8"), "careful\n");
});

it("主工作区有未提交的已追踪改动时拒绝采用，不丢任何东西", async t => {
  const f = await fixture(t, { fast: { files: { "a.txt": "lane\n" } }, careful: { files: { "keep.txt": "x\n" } } });
  const race = await f.settle((await f.service.start(f.draft())).id);
  await writeFile(join(f.workspace, "keep.txt"), "my local edit\n");
  const result = await f.service.adopt(race.id, "l1");
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "dirty");
  assert.equal(await readFile(join(f.workspace, "keep.txt"), "utf8"), "my local edit\n");
  assert.equal(f.service.list().races[0].status, "ready");
});

it("赛道还在运行时不能采用；stopLane 停下后进入 ready，已写下的改动保留", async t => {
  const f = await fixture(t, { fast: { files: { "a.txt": "done\n" } }, careful: { hang: true, files: { "late.txt": "partial\n" }, status: "stopped" } });
  const started = await f.service.start(f.draft());
  await new Promise(resolve => setTimeout(resolve, 100));
  const running = f.service.list().races[0];
  assert.equal(running.status, "running");
  const early = await f.service.adopt(started.id, "l1");
  assert.equal(early.ok, false);
  assert.equal(!early.ok && early.reason, "not_ready");
  f.service.stopLane(started.id, "l2");
  assert.deepEqual(f.stopped, [lane(running, "l2").conversationId]);
  const race = await f.settle(started.id);
  assert.equal(lane(race, "l2").status, "stopped");
  assert.equal(lane(race, "l2").changedFiles[0], "late.txt");
  assert.equal(race.status, "ready");
});

it("失败的赛道保留错误信息但不影响其他赛道", async t => {
  const f = await fixture(t, { fast: { files: { "a.txt": "ok\n" } }, careful: { status: "failed", error: "provider 500" } });
  const race = await f.settle((await f.service.start(f.draft())).id);
  assert.equal(lane(race, "l2").status, "failed");
  assert.equal(lane(race, "l2").error, "provider 500");
  assert.equal(race.status, "ready");
  assert.equal((await f.service.adopt(race.id, "l1")).ok, true);
});

it("discard 丢弃整场：停止运行中的赛道，清掉所有 worktree 与分支", async t => {
  const f = await fixture(t, { fast: { hang: true }, careful: { hang: true } });
  const started = await f.service.start(f.draft());
  await new Promise(resolve => setTimeout(resolve, 100));
  await f.service.discard(started.id);
  const race = f.service.list().races.find(item => item.id === started.id)!;
  assert.equal(race.status, "discarded");
  assert.equal(f.stopped.length, 2);
  assert.ok(race.lanes.every(item => item.worktreeRemovedAt && !existsSync(item.worktree)));
  assert.equal(f.branches(), "");
});

it("重启后进行中的赛马标为 interrupted，仍可 discard 清理残留 worktree", async t => {
  const f = await fixture(t, { fast: { hang: true }, careful: { hang: true } });
  const started = await f.service.start(f.draft());
  await new Promise(resolve => setTimeout(resolve, 100));
  // 模拟崩溃：不调用 stop，直接用同一份文件起一个新服务。
  const reborn = new RaceService(f.file, f.runtime);
  reborn.init();
  const race = reborn.list().races.find(item => item.id === started.id)!;
  assert.equal(race.status, "interrupted");
  assert.ok(race.lanes.every(item => item.status === "interrupted" && item.finishedAt !== null));
  assert.ok(race.lanes.every(item => existsSync(item.worktree)));
  assert.equal((await reborn.adopt(race.id, "l1")).ok, false);
  await reborn.discard(race.id);
  assert.ok(reborn.list().races[0].lanes.every(item => !existsSync(item.worktree)));
  assert.equal(f.branches(), "");
  for (const release of f.releases.values()) release();
  await new Promise(resolve => setTimeout(resolve, 100));
});

it("被改过的 races.json 会被拒绝，且不会再写入或清理任何东西", async t => {
  const f = await fixture(t, { fast: { files: { "a.txt": "x\n" } }, careful: { files: { "keep.txt": "x\n" } } });
  const race = await f.settle((await f.service.start(f.draft())).id);
  const stored = JSON.parse(await readFile(f.file, "utf8"));
  stored.races[0].lanes[0].branch = "main";
  await writeFile(f.file, JSON.stringify(stored));
  const forged = new RaceService(f.file, f.runtime);
  forged.init();
  assert.match(forged.list().error ?? "", /赛马记录损坏/);
  assert.deepEqual(forged.list().races, []);
  await assert.rejects(() => forged.start(f.draft()), /赛马记录损坏/);
  assert.match(f.git("branch", "--list", "main"), /main/);

  const outside = JSON.parse(await readFile(f.file, "utf8"));
  outside.races[0].lanes[0].branch = race.lanes[0].branch;
  outside.races[0].lanes[0].worktree = join(f.root, "elsewhere");
  await writeFile(f.file, JSON.stringify(outside));
  const moved = new RaceService(f.file, f.runtime);
  moved.init();
  assert.match(moved.list().error ?? "", /赛马记录损坏/);
});

it("start 的输入校验：赛道数量、非 git、未登记工作区、不可用的模型都不会留下任何东西", async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.service.start(f.draft({ lanes: [{ id: "x", label: "only" }] })), /赛道数量/);
  await assert.rejects(() => f.service.start(f.draft({ lanes: Array.from({ length: raceLimits.maxLanes + 1 }, (_, index) => ({ id: `l${index}`, label: `n${index}` })) })), /赛道数量/);
  await assert.rejects(() => f.service.start(f.draft({ workspace: join(f.root, "elsewhere") })), /工作区未登记/);
  await assert.rejects(() => f.service.start(f.draft({ lanes: [{ id: "a", label: "a" }, { id: "b", label: "b", model: { provider: "p", id: "missing" } }] })), /模型不可用/);
  assert.equal(f.service.list().races.length, 0);
  assert.equal(f.branches(), "");
  assert.equal(existsSync(join(f.root, "worktrees")), false);
});

it("非 git 目录：preflight 报告不可用，start 拒绝", async t => {
  const f = await fixture(t);
  const plain = join(f.root, "plain");
  await mkdir(plain);
  const runtime = { ...f.runtime, workspaces: () => [plain] };
  const service = new RaceService(join(f.root, "plain-races.json"), runtime);
  service.init();
  assert.deepEqual(await service.preflight(plain), { git: false, branch: null, dirty: false, sandboxMode: "smart" });
  await assert.rejects(() => service.start(f.draft({ workspace: plain })), /git 仓库/);
  assert.deepEqual(await f.service.preflight(f.workspace), { git: true, branch: "main", dirty: false, sandboxMode: "smart" });
  await writeFile(join(f.workspace, "a.txt"), "dirty\n");
  assert.equal((await f.service.preflight(f.workspace)).dirty, true);
  await assert.rejects(() => f.service.preflight("/not/registered"), /工作区未登记/);
});

it("同时进行的赛马数量有上限", async t => {
  const f = await fixture(t, { fast: { hang: true }, careful: { hang: true } });
  const first = await f.service.start(f.draft());
  const second = await f.service.start(f.draft());
  await assert.rejects(() => f.service.start(f.draft()), /最多同时进行/);
  await new Promise(resolve => setTimeout(resolve, 100));
  for (const release of f.releases.values()) release();
  await f.settle(first.id);
  await f.settle(second.id);
});

it("parseRaceDraft：严格解析并拒绝越界输入", () => {
  const base = { workspace: "/w", prompt: "go", sandboxMode: "smart", lanes: [{ id: "a", label: "A" }, { id: "b", label: "" , model: { provider: "p", id: "m" } }] };
  const parsed = parseRaceDraft({ ...base, verifyCommand: "  pnpm test  ", extra: "dropped" });
  assert.equal(parsed.verifyCommand, "pnpm test");
  assert.equal(parsed.lanes[1].label, "m");
  assert.equal("extra" in parsed, false);
  assert.throws(() => parseRaceDraft({ ...base, prompt: "  " }), /任务不能为空/);
  assert.throws(() => parseRaceDraft({ ...base, sandboxMode: "yolo" }), /沙箱模式/);
  assert.throws(() => parseRaceDraft({ ...base, lanes: [base.lanes[0], base.lanes[0]] }), /赛道 ID 重复/);
  assert.throws(() => parseRaceDraft({ ...base, lanes: [{ id: "a", thinkingLevel: "turbo" }, { id: "b" }] }), /思考强度/);
  assert.throws(() => parseRaceDraft({ ...base, verifyCommand: "x".repeat(raceLimits.verifyCommandLength + 1) }), /验证指令/);
  assert.throws(() => parseRaceDraft(null), /赛马设置/);
});

it("raceBadges 只标事实最优：并列都标，全部相同或只有一条可比时不标", () => {
  const make = (id: string, patch: Partial<RaceLane>): RaceLane => ({
    id, label: id, resolvedExecution: { model: { provider: "p", id }, thinkingLevel: "off", sandboxMode: "smart" }, extraPrompt: "",
    branch: `vela/race-aaaa-1`, worktree: "/w", conversationId: id, status: "responded", startedAt: 0, finishedAt: 1000,
    tokens: { input: 0, output: 0, cacheRead: 0, total: 100 }, diff: { files: 1, added: 5, removed: 0 }, commitSha: "a".repeat(40), changedFiles: ["a"],
    verification: { state: "skipped" }, error: null, ...patch,
  });
  const lanes = [
    make("a", { finishedAt: 500, tokens: { input: 0, output: 0, cacheRead: 0, total: 300 } }),
    make("b", { finishedAt: 900, tokens: { input: 0, output: 0, cacheRead: 0, total: 100 }, diff: { files: 1, added: 1, removed: 0 } }),
    make("c", { finishedAt: 900, tokens: { input: 0, output: 0, cacheRead: 0, total: 100 }, status: "failed" }),
  ];
  const badges = raceBadges(lanes);
  assert.deepEqual(badges.get("a"), ["fastest"]);
  assert.deepEqual(badges.get("b"), ["fewest_tokens", "smallest_diff"]);
  assert.equal(badges.has("c"), false, "失败的赛道不参与评比");
  assert.equal(raceBadges([make("only", {})]).size, 0);
  assert.equal(raceBadges([make("x", {}), make("y", {})]).size, 0, "完全相同时不标");
  const passing = raceBadges([make("p", { verification: { state: "passed" } }), make("q", { verification: { state: "failed" } })]);
  assert.deepEqual(passing.get("p"), ["only_passing"]);
});
