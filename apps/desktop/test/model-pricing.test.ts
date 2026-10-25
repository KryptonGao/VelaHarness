import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  costOfUsage, formatCost, parseModelPrice, parseModelPrices, removeModelPrice, serializeModelPrices, upsertModelPrice,
  type ModelPrice, type TraceRequest,
} from "@vela/shared";
import { latestTaskRequests, modelCost, summarizeCost, summarizeUsage } from "../src/renderer/components/usage/usage-model.ts";

const cny: ModelPrice = { model: "openai/model-a", currency: "CNY", input: 2, output: 8, cacheWrite: 2.5, cacheRead: 0.2 };
const usd: ModelPrice = { model: "other/model-b", currency: "USD", input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

function request(id: string, extra: Partial<TraceRequest> = {}): TraceRequest {
  return {
    id, number: 1, turn: 1, model: "openai/model-a", status: "Completed", contextId: "c1",
    startedAt: 1, completedAt: 2, durationMs: 1, firstTokenMs: 1, generationMs: 1,
    usage: { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 100_000, totalTokens: 3_600_000 },
    ...extra,
  };
}

describe("model price registration", () => {
  it("round-trips valid prices and drops damaged entries", () => {
    assert.deepEqual(parseModelPrices(serializeModelPrices([cny, usd])), [cny, usd]);
    const text = JSON.stringify([cny, { ...usd, currency: "EUR" }, { ...usd, output: -1 }, { ...usd, input: "3" }, null, "x"]);
    assert.deepEqual(parseModelPrices(text), [cny]);
    assert.deepEqual(parseModelPrices("not json"), []);
    assert.deepEqual(parseModelPrices(null), []);
  });

  it("keeps the last price when a model is listed twice", () => {
    const later = { ...cny, input: 5 };
    assert.deepEqual(parseModelPrices(JSON.stringify([cny, later])), [later]);
  });

  it("rejects non-finite, negative and absurd prices", () => {
    assert.equal(parseModelPrice({ ...cny, input: Number.NaN }), null);
    assert.equal(parseModelPrice({ ...cny, cacheRead: -0.1 }), null);
    assert.equal(parseModelPrice({ ...cny, output: 1e9 }), null);
    assert.equal(parseModelPrice({ ...cny, model: "  " }), null);
    assert.equal(parseModelPrice({ ...cny, cacheWrite: 0 })?.cacheWrite, 0);
  });

  it("replaces an existing model in place and removes by model", () => {
    const other = { ...usd, model: "x/y" };
    const list = upsertModelPrice([cny, other], { ...cny, input: 9 });
    assert.deepEqual(list.map(item => [item.model, item.input]), [["openai/model-a", 9], ["x/y", 3]]);
    assert.deepEqual(removeModelPrice(list, "x/y").map(item => item.model), ["openai/model-a"]);
  });
});

describe("cost calculation", () => {
  it("prices each token class separately, per million tokens", () => {
    // 1M input × 2 + 0.5M output × 8 + 0.1M cache write × 2.5 + 2M cache read × 0.2
    assert.ok(Math.abs(costOfUsage(request("1").usage!, cny) - (2 + 4 + 0.25 + 0.4)) < 1e-9);
  });

  it("totals each currency separately and flags models without a price", () => {
    const stats = summarizeUsage([
      request("1"), request("2"),
      request("3", { model: "other/model-b" }),
      request("4", { model: "free/model-c" }),
      request("5", { model: "openai/model-a", usage: null, status: "Failed" }),
    ]);
    const cost = summarizeCost(stats.models, [cny, usd]);
    assert.ok(Math.abs(cost.total.CNY! - 2 * 6.65) < 1e-9);
    assert.ok(Math.abs(cost.total.USD! - (3 + 7.5 + 0.375 + 0.6)) < 1e-9);
    assert.deepEqual(cost.unpriced, ["free/model-c"]);
  });

  it("never shows an unmetered or unpriced model as zero", () => {
    const [model] = summarizeUsage([request("1", { usage: null })]).models;
    assert.equal(modelCost(model!, [cny]), null);
    assert.equal(formatCost({}), null);
    assert.deepEqual(summarizeCost([], [cny]).total, {});
  });

  it("formats small amounts without rounding them away", () => {
    assert.equal(formatCost({ CNY: 12.3456 }), "¥12.35");
    assert.equal(formatCost({ USD: 0.0042 }), "$0.0042");
    assert.equal(formatCost({ CNY: 1, USD: 2 }), "¥1.00 · $2.00");
  });

  it("selects the latest task as the highest turn", () => {
    const requests = [request("1", { turn: 1 }), request("2", { turn: 2 }), request("3", { turn: 2 })];
    assert.deepEqual(latestTaskRequests(requests).map(item => item.id), ["2", "3"]);
    assert.deepEqual(latestTaskRequests([]), []);
  });
});
