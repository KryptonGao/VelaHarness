import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultTaskBudgetSettings, evaluateTaskBudget, parseTaskBudgetSettings, type TaskBudgetSettings } from "@vela/shared";
import { createTaskBudgetExtension, TaskBudgetTask } from "../src/task-budget.ts";
import { TaskBudgetSettingsStore } from "../src/task-budget-settings.ts";

const on: TaskBudgetSettings = { enabled: true, maxMinutes: 10, maxTokens: 1000, maxSubagents: 16, allowNestedSubagents: true };

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
    assert.deepEqual(parseTaskBudgetSettings({ enabled: false, maxMinutes: null, maxTokens: null }), { enabled: false, maxMinutes: null, maxTokens: null, maxSubagents: 16, allowNestedSubagents: true });
    assert.equal(parseTaskBudgetSettings({ enabled: true, maxMinutes: 12.4, maxTokens: null }).maxMinutes, 12);
    assert.equal(parseTaskBudgetSettings({ enabled: true, maxMinutes: null, maxTokens: 10_000_000_000 }).maxTokens, 10_000_000_000);
    assert.throws(() => parseTaskBudgetSettings({ enabled: true, maxMinutes: null, maxTokens: 10_000_000_001 }), /Token 上限/);
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
    const valid: TaskBudgetSettings = { enabled: true, maxMinutes: 10, maxTokens: 50_000, maxSubagents: 4, allowNestedSubagents: false };
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
