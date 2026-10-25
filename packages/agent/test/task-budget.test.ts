import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultTaskBudgetSettings, evaluateTaskBudget, parseTaskBudgetSettings, type ModelPrice, type TaskBudgetSettings } from "@vela/shared";
import { createTaskBudgetExtension, TaskBudgetTask } from "../src/task-budget.ts";
import { TaskBudgetSettingsStore } from "../src/task-budget-settings.ts";
import { ModelPriceStore } from "../src/model-price-store.ts";
import { TaskCostHistoryStore } from "../src/task-cost-history.ts";

const on: TaskBudgetSettings = { enabled: true, maxMinutes: 10, maxTokens: 1000, maxCost: null, maxSubagents: 16, allowNestedSubagents: true };
const cny: ModelPrice = { model: "p/cny", currency: "CNY", input: 10, output: 20, cacheWrite: 0, cacheRead: 0 };
const usd: ModelPrice = { model: "p/usd", currency: "USD", input: 10, output: 20, cacheWrite: 0, cacheRead: 0 };

describe("任务用量评估", () => {
  it("未启用或没有上限时恒为 ok", () => {
    assert.equal(evaluateTaskBudget({ ...on, enabled: false }, { tokensUsed: 5000, elapsedMs: 1e9 }).phase, "ok");
    assert.equal(evaluateTaskBudget({ enabled: true, maxMinutes: null, maxTokens: null }, { tokensUsed: 5000, elapsedMs: 1e9 }).phase, "ok");
  });

  it("80% 提示，100% 到达上限，并指出先到的维度", () => {
    assert.equal(evaluateTaskBudget(on, { tokensUsed: 790, elapsedMs: 0 }).phase, "ok");
    const warn = evaluateTaskBudget(on, { tokensUsed: 800, elapsedMs: 0 });
    assert.deepEqual([warn.phase, warn.reason], ["warning", "tokens"]);
    const time = evaluateTaskBudget(on, { tokensUsed: 900, elapsedMs: 10 * 60_000 });
    assert.deepEqual([time.phase, time.reason], ["exhausted", "time"]);
    const both = evaluateTaskBudget(on, { tokensUsed: 2000, elapsedMs: 10 * 60_000 });
    assert.deepEqual([both.phase, both.reason], ["exhausted", "tokens"]);
  });

  it("费用上限：80% 提示，100% 到达，并指出先到的是费用", () => {
    const costOnly: TaskBudgetSettings = { ...on, maxMinutes: null, maxTokens: null, maxCost: { currency: "CNY", amount: 2 } };
    assert.equal(evaluateTaskBudget(costOnly, { tokensUsed: 1e9, elapsedMs: 1e9, costUsed: 1.59 }).phase, "ok");
    const warn = evaluateTaskBudget(costOnly, { tokensUsed: 0, elapsedMs: 0, costUsed: 1.6 });
    assert.deepEqual([warn.phase, warn.reason, warn.costRatio], ["warning", "cost", 0.8]);
    const full = evaluateTaskBudget(costOnly, { tokensUsed: 0, elapsedMs: 0, costUsed: 2 });
    assert.deepEqual([full.phase, full.reason], ["exhausted", "cost"]);
    // 同时设置多项时，比例更高的先触发。
    const all = { ...on, maxCost: { currency: "CNY" as const, amount: 2 } };
    assert.equal(evaluateTaskBudget(all, { tokensUsed: 850, elapsedMs: 0, costUsed: 2.2 }).reason, "cost");
    assert.equal(evaluateTaskBudget(all, { tokensUsed: 1500, elapsedMs: 0, costUsed: 2.2 }).reason, "tokens");
    // 没传 costUsed 当作 0；未启用时恒为 ok。
    assert.equal(evaluateTaskBudget(costOnly, { tokensUsed: 0, elapsedMs: 0 }).phase, "ok");
    assert.equal(evaluateTaskBudget({ ...costOnly, enabled: false }, { tokensUsed: 0, elapsedMs: 0, costUsed: 99 }).phase, "ok");
  });

  it("只设置一项上限时另一项不参与", () => {
    const tokensOnly = { enabled: true, maxMinutes: null, maxTokens: 1000 };
    assert.equal(evaluateTaskBudget(tokensOnly, { tokensUsed: 10, elapsedMs: 1e9 }).phase, "ok");
  });
});

describe("任务用量设置校验", () => {
  it("拒绝越界、非数字和全空的启用设置", () => {
    assert.throws(() => parseTaskBudgetSettings(null));
    assert.throws(() => parseTaskBudgetSettings({ enabled: "yes", maxMinutes: 5, maxTokens: null }));
    assert.throws(() => parseTaskBudgetSettings({ enabled: true, maxMinutes: 0, maxTokens: null }), /时间上限/);
    assert.throws(() => parseTaskBudgetSettings({ enabled: true, maxMinutes: null, maxTokens: 5 }), /Token 上限/);
    assert.throws(() => parseTaskBudgetSettings({ enabled: true, maxMinutes: null, maxTokens: null }), /至少/);
    assert.deepEqual(parseTaskBudgetSettings({ enabled: false, maxMinutes: null, maxTokens: null }), { enabled: false, maxMinutes: null, maxTokens: null, maxCost: null, maxSubagents: 16, allowNestedSubagents: true });
    assert.equal(parseTaskBudgetSettings({ enabled: true, maxMinutes: 12.4, maxTokens: null }).maxMinutes, 12);
    assert.equal(parseTaskBudgetSettings({ enabled: true, maxMinutes: null, maxTokens: 10_000_000_000 }).maxTokens, 10_000_000_000);
    assert.throws(() => parseTaskBudgetSettings({ enabled: true, maxMinutes: null, maxTokens: 10_000_000_001 }), /Token 上限/);
  });

  it("费用上限：缺省为不限，金额取整到分，币种和范围非法时拒绝", () => {
    const base = { enabled: true, maxMinutes: null, maxTokens: null };
    assert.equal(parseTaskBudgetSettings({ ...base, maxTokens: 10_000 }).maxCost, null);
    assert.deepEqual(parseTaskBudgetSettings({ ...base, maxCost: { currency: "CNY", amount: 2.005 } }).maxCost, { currency: "CNY", amount: 2.01 });
    assert.deepEqual(parseTaskBudgetSettings({ ...base, maxCost: { currency: "USD", amount: 0.01 } }).maxCost, { currency: "USD", amount: 0.01 });
    assert.throws(() => parseTaskBudgetSettings({ ...base, maxCost: { currency: "EUR", amount: 5 } }), /币种/);
    assert.throws(() => parseTaskBudgetSettings({ ...base, maxCost: { currency: "CNY", amount: 0 } }), /费用上限超出范围/);
    assert.throws(() => parseTaskBudgetSettings({ ...base, maxCost: { currency: "CNY", amount: 1_000_001 } }), /费用上限超出范围/);
    assert.throws(() => parseTaskBudgetSettings({ ...base, maxCost: { currency: "CNY", amount: Number.NaN } }), /费用上限超出范围/);
    assert.throws(() => parseTaskBudgetSettings({ ...base, maxCost: 5 }), /费用上限设置不正确/);
    // 只设费用上限就够启用；三项都空仍然拒绝。
    assert.equal(parseTaskBudgetSettings({ ...base, maxCost: { currency: "CNY", amount: 5 } }).enabled, true);
    assert.throws(() => parseTaskBudgetSettings(base), /至少/);
  });

  it("子代理限制：缺省取默认值，越界或类型错误时拒绝", () => {
    const base = { enabled: false, maxMinutes: null, maxTokens: null };
    const parsed = parseTaskBudgetSettings(base);
    assert.equal(parsed.maxSubagents, defaultTaskBudgetSettings.maxSubagents);
    assert.equal(parsed.allowNestedSubagents, true);
    assert.equal(parseTaskBudgetSettings({ ...base, maxSubagents: 0 }).maxSubagents, 0);
    assert.equal(parseTaskBudgetSettings({ ...base, maxSubagents: 64 }).maxSubagents, 64);
    assert.throws(() => parseTaskBudgetSettings({ ...base, maxSubagents: 65 }), /子代理数量/);
    assert.throws(() => parseTaskBudgetSettings({ ...base, maxSubagents: -1 }), /子代理数量/);
    assert.throws(() => parseTaskBudgetSettings({ ...base, maxSubagents: null }), /子代理数量/);
    assert.throws(() => parseTaskBudgetSettings({ ...base, allowNestedSubagents: "no" }), /嵌套/);
  });

  it("持久化，文件损坏时回到默认（关闭）", () => {
    const dir = mkdtempSync(join(tmpdir(), "vela-budget-"));
    assert.deepEqual(new TaskBudgetSettingsStore(dir).settings, defaultTaskBudgetSettings);
    const store = new TaskBudgetSettingsStore(dir);
    const valid: TaskBudgetSettings = { enabled: true, maxMinutes: 10, maxTokens: 50_000, maxCost: { currency: "USD", amount: 3 }, maxSubagents: 4, allowNestedSubagents: false };
    store.save(valid);
    assert.deepEqual(new TaskBudgetSettingsStore(dir).settings, valid);
    assert.throws(() => store.save({ enabled: true, maxMinutes: -1, maxTokens: null }));
    assert.deepEqual(new TaskBudgetSettingsStore(dir).settings, valid);
    writeFileSync(join(dir, "task-budget-settings.json"), "{broken");
    assert.equal(new TaskBudgetSettingsStore(dir).settings.enabled, false);
    assert.match(readFileSync(join(dir, "task-budget-settings.json"), "utf8"), /broken/);
  });
});

describe("TaskBudgetTask", () => {
  it("只统计任务开始之后的 token，且不会因子代理释放而回落", () => {
    let now = 1_000;
    const task = new TaskBudgetTask(500, { now: () => now });
    assert.equal(task.update(500, on).state?.tokensUsed, 0);
    assert.equal(task.update(1200, on).state?.tokensUsed, 700);
    assert.equal(task.update(900, on).state?.tokensUsed, 700);
    const warned = task.update(1300, on);
    assert.equal(warned.state?.phase, "warning");
    assert.equal(warned.phaseChanged, true);
    now += 11 * 60_000;
    assert.equal(task.update(1300, on).state?.phase, "exhausted");
  });

  it("到达上限后放宽设置也不恢复，关闭设置时不产生状态", () => {
    const task = new TaskBudgetTask(0);
    task.update(2000, on);
    task.markExhausted("tokens");
    const relaxed = task.update(2000, { enabled: true, maxMinutes: null, maxTokens: 1_000_000 });
    assert.equal(relaxed.state?.phase, "exhausted");
    assert.equal(relaxed.state?.reason, "tokens");
    assert.equal(task.update(2000, { ...on, enabled: false }).state, null);
  });

  it("上限随设置实时变化", () => {
    const task = new TaskBudgetTask(0);
    assert.equal(task.update(500, on).state?.phase, "ok");
    assert.equal(task.update(500, { ...on, maxTokens: 400 }).state?.phase, "exhausted");
  });
});

describe("TaskBudgetTask 费用", () => {
  const cost: TaskBudgetSettings = { ...on, maxMinutes: null, maxTokens: null, maxCost: { currency: "CNY", amount: 1 } };
  const usage = (input: number, output = 0) => ({ input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output });

  it("按登记价格累计整棵 agent 树的费用，跨过阶段时报告变化", () => {
    const task = new TaskBudgetTask(0);
    const prices = [cny];
    assert.equal(task.update(0, cost, prices).state?.costUsed, 0);
    task.recordUsage("p/cny", usage(50_000));
    const warned = task.update(0, cost, prices);
    assert.equal(warned.state?.costUsed, 0.5);
    assert.equal(warned.state?.phase, "ok");
    assert.equal(warned.changed, true);
    task.recordUsage("p/cny", usage(30_000, 5_000));
    const near = task.update(0, cost, prices);
    assert.ok(Math.abs(near.state!.costUsed! - 0.9) < 1e-9);
    assert.deepEqual([near.state?.phase, near.state?.reason], ["warning", "cost"]);
    assert.equal(near.phaseChanged, true);
    // 没有新请求时费用不变，不再报告变化。
    assert.equal(task.update(0, cost, prices).changed, false);
  });

  it("没登记价格、或登记为另一种币种的模型不计入，并计数提示", () => {
    const task = new TaskBudgetTask(0);
    task.recordUsage("p/cny", usage(10_000));
    task.recordUsage("p/usd", usage(1_000_000));
    task.recordUsage("p/unknown", usage(1_000_000));
    const state = task.update(0, cost, [cny, usd]).state!;
    assert.equal(state.costUsed, 0.1);
    assert.equal(state.uncountedModels, 2);
    assert.equal(state.phase, "ok");
    // 价格尚未同步给主进程时，一切都不计入。
    assert.equal(task.update(0, cost, []).state?.costUsed, 0);
  });

  it("费用上限的币种和价格改动立即作用于进行中的任务", () => {
    const task = new TaskBudgetTask(0);
    task.recordUsage("p/usd", usage(100_000));
    assert.equal(task.update(0, cost, [usd]).state?.costUsed, 0);
    const inUsd: TaskBudgetSettings = { ...cost, maxCost: { currency: "USD", amount: 1 } };
    assert.equal(task.update(0, inUsd, [usd]).state?.phase, "exhausted");
    assert.equal(task.update(0, { ...cost, maxCost: null }, [usd]).state?.costUsed, null);
  });

  it("账本忽略非法用量，只统计一次请求一次", () => {
    const task = new TaskBudgetTask(0);
    task.recordUsage("p/cny", { input: -5, output: Number.NaN, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
    assert.equal(task.update(0, cost, [cny]).state?.costUsed, 0);
    assert.equal(task.requests, 1);
  });
});

describe("模型价格副本与任务费用历史", () => {
  it("价格同步前为 null，保存后持久化；非法条目整体拒绝，不改变已有价格", () => {
    const dir = mkdtempSync(join(tmpdir(), "vela-prices-"));
    const store = new ModelPriceStore(dir);
    assert.equal(store.list(), null);
    assert.equal(store.synced, false);
    store.save([cny, usd, { ...cny, input: 99 }]);
    assert.deepEqual(new ModelPriceStore(dir).list(), [{ ...cny, input: 99 }, usd]);
    assert.throws(() => store.save([cny, { ...usd, output: -1 }]), /价格/);
    assert.throws(() => store.save("nope"), /价格/);
    assert.deepEqual(new ModelPriceStore(dir).list(), [{ ...cny, input: 99 }, usd]);
    store.save([]);
    assert.deepEqual(new ModelPriceStore(dir).list(), []);
    assert.equal(new ModelPriceStore(dir).synced, true);
  });

  it("历史记录持久化、限量，文件损坏时从空开始", () => {
    const dir = mkdtempSync(join(tmpdir(), "vela-history-"));
    const store = new TaskCostHistoryStore(dir);
    assert.deepEqual(store.list(), []);
    const record = (at: number) => ({ at, kind: "chat", model: "p/cny", durationMs: 1, requests: 1, usageByModel: { "p/cny": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } } });
    for (let at = 1; at <= 205; at += 1) store.append(record(at));
    const reloaded = new TaskCostHistoryStore(dir).list();
    assert.equal(reloaded.length, 200);
    assert.equal(reloaded[0]?.at, 6);
    writeFileSync(join(dir, "task-cost-history.json"), "{broken");
    assert.deepEqual(new TaskCostHistoryStore(dir).list(), []);
  });
});

describe("用量上限扩展", () => {
  it("到达上限后拦下工具调用", async () => {
    let exhausted = false;
    const handlers: Record<string, (event: unknown) => Promise<unknown>> = {};
    createTaskBudgetExtension(() => exhausted)({ on: (name: string, handler: (event: unknown) => Promise<unknown>) => { handlers[name] = handler; } } as never);
    assert.equal(await handlers.tool_call!({}), undefined);
    exhausted = true;
    assert.deepEqual(await handlers.tool_call!({}), { block: true, reason: "任务用量已到上限，不再继续调用工具或模型。请根据已有结果整理交接。" });
  });
});
