import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addUsageByModel, cappedCost, estimateTaskCost, ledgerCost, parseTaskCostHistory, primaryModel, taskCostHistoryLimits,
  type ModelPrice, type TaskCostRecord, type UsageByModel,
} from "@vela/shared";

const cny: ModelPrice = { model: "p/a", currency: "CNY", input: 10, output: 20, cacheWrite: 12, cacheRead: 1 };
const other: ModelPrice = { model: "p/b", currency: "CNY", input: 100, output: 200, cacheWrite: 0, cacheRead: 0 };
const usd: ModelPrice = { model: "p/usd", currency: "USD", input: 1, output: 1, cacheWrite: 0, cacheRead: 0 };

const usage = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite });
function record(at: number, model: string, input: number, kind = "chat"): TaskCostRecord {
  return { at, kind, model, durationMs: 1000, requests: 1, usageByModel: { [model]: usage(input) } };
}

describe("任务费用账本", () => {
  it("按模型累加，非法数值按 0 处理", () => {
    const ledger: UsageByModel = {};
    addUsageByModel(ledger, "p/a", usage(100, 50, 10, 5));
    addUsageByModel(ledger, "p/a", usage(1));
    addUsageByModel(ledger, "p/a", { input: Number.NaN, output: -3 });
    assert.deepEqual(ledger["p/a"], usage(101, 50, 10, 5));
    assert.equal(primaryModel({ "p/a": usage(10), "p/b": usage(500) }), "p/b");
    assert.equal(primaryModel({}), null);
  });

  it("四类 Token 各按自己的单价计费，币种分开汇总", () => {
    const ledger: UsageByModel = {};
    addUsageByModel(ledger, "p/a", usage(1_000_000, 1_000_000, 1_000_000, 1_000_000));
    addUsageByModel(ledger, "p/usd", usage(2_000_000));
    addUsageByModel(ledger, "p/none", usage(9));
    const total = ledgerCost(ledger, [cny, usd]);
    assert.deepEqual(total.cost, { CNY: 43, USD: 2 });
    assert.deepEqual(total.unpriced, ["p/none"]);
  });

  it("上限币种只计该币种：未登记价格和另一币种的模型都不计入", () => {
    const ledger: UsageByModel = {};
    addUsageByModel(ledger, "p/a", usage(1_000_000));
    addUsageByModel(ledger, "p/usd", usage(5_000_000));
    addUsageByModel(ledger, "p/none", usage(5_000_000));
    assert.deepEqual(cappedCost(ledger, [cny, usd], "CNY"), { used: 10, uncounted: 2 });
    assert.deepEqual(cappedCost(ledger, [cny, usd], "USD"), { used: 5, uncounted: 2 });
    assert.deepEqual(cappedCost(ledger, [], "CNY"), { used: 0, uncounted: 3 });
  });
});

describe("同类任务费用预估", () => {
  // p/a 每百万输入 10 元：input 100_000 → ¥1。
  const query = { kind: "chat", model: "p/a" };

  it("样本不足时不给预估", () => {
    assert.equal(estimateTaskCost([], [cny], query), null);
    assert.equal(estimateTaskCost([record(1, "p/a", 100_000), record(2, "p/a", 100_000)], [cny], query), null);
  });

  it("用同模型的同类记录，给出中位数和中间一半区间", () => {
    const history = [100_000, 200_000, 300_000, 400_000, 500_000].map((input, index) => record(index, "p/a", input));
    const estimate = estimateTaskCost(history, [cny], query)!;
    assert.equal(estimate.currency, "CNY");
    assert.equal(estimate.samples, 5);
    assert.equal(estimate.sameModel, true);
    assert.equal(estimate.median, 3);
    assert.equal(estimate.low, 2);
    assert.equal(estimate.high, 4);
  });

  it("不混入别的类别；同模型样本不够时退回同类别，并标明不是同一模型", () => {
    const history = [
      record(1, "p/a", 100_000), record(2, "p/a", 100_000), record(3, "p/b", 100_000),
      record(4, "p/a", 10_000_000, "recipe"),
    ];
    const estimate = estimateTaskCost(history, [cny, other], query)!;
    assert.equal(estimate.sameModel, false);
    assert.equal(estimate.samples, 3);
    assert.equal(estimate.median, 1);
    assert.equal(estimateTaskCost(history, [cny, other], { ...query, kind: "recipe" }), null);
  });

  it("用现在的价格重新换算，价格改了预估跟着变", () => {
    const history = [1, 2, 3].map(at => record(at, "p/a", 100_000));
    assert.equal(estimateTaskCost(history, [cny], query)?.median, 1);
    assert.equal(estimateTaskCost(history, [{ ...cny, input: 30 }], query)?.median, 3);
  });

  it("币种：优先用指定的上限币种，否则取所选模型的币种；没有价格就不估", () => {
    const history = [1, 2, 3].map(at => ({ ...record(at, "p/a", 100_000), usageByModel: { "p/a": usage(100_000), "p/usd": usage(1_000_000) } }));
    assert.equal(estimateTaskCost(history, [cny, usd], query)?.currency, "CNY");
    const inUsd = estimateTaskCost(history, [cny, usd], { ...query, currency: "USD" })!;
    assert.equal(inUsd.currency, "USD");
    assert.equal(inUsd.median, 1);
    assert.equal(estimateTaskCost(history, [], query), null);
    assert.equal(estimateTaskCost(history, [cny], { kind: "chat", model: null }), null);
  });

  it("只参考最近的记录，没有任何花费的记录不算样本", () => {
    const old = Array.from({ length: taskCostHistoryLimits.window }, (_, index) => record(index, "p/a", 100_000));
    const recent = Array.from({ length: taskCostHistoryLimits.window }, (_, index) => record(1000 + index, "p/a", 300_000));
    assert.equal(estimateTaskCost([...old, ...recent], [cny], query)?.median, 3);
    const free = [1, 2, 3].map(at => record(at, "p/a", 0));
    assert.equal(estimateTaskCost(free, [cny], query), null);
  });
});

describe("任务费用历史解析", () => {
  it("丢弃损坏的条目，保留合法的，并限制数量", () => {
    const good = record(5, "p/a", 1000);
    const parsed = parseTaskCostHistory([good, null, "x", { ...good, kind: "" }, { ...good, at: "no" }, { ...good, usageByModel: {} }, { ...good, usageByModel: [] }]);
    assert.deepEqual(parsed, [good]);
    assert.deepEqual(parseTaskCostHistory({ not: "an array" }), []);
    const many = Array.from({ length: taskCostHistoryLimits.maxRecords + 20 }, (_, index) => record(index, "p/a", 1));
    assert.equal(parseTaskCostHistory(many).length, taskCostHistoryLimits.maxRecords);
    assert.equal(parseTaskCostHistory(many)[0]?.at, 20);
  });
});
