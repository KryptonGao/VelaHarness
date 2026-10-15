import assert from "node:assert/strict";
import test from "node:test";
import { taskBudgetLimits } from "@vela/shared";
import { readLimit, sliderIndex, stopText, taskBudgetMinuteStops, taskBudgetTokenStops } from "../src/renderer/components/settings/task-budget-stops.ts";

test("滑块档位都在允许范围内并且递增", () => {
  for (const stops of [taskBudgetMinuteStops, taskBudgetTokenStops]) {
    assert.deepEqual([...stops], [...stops].sort((a, b) => a - b));
  }
  assert.ok(taskBudgetMinuteStops.every((value) => value >= taskBudgetLimits.minMinutes && value <= taskBudgetLimits.maxMinutes));
  assert.ok(taskBudgetTokenStops.every((value) => value >= taskBudgetLimits.minTokens && value <= taskBudgetLimits.maxTokens));
});

test("空值落在最右的「不限」，其他值落在最近的档位，并能往返", () => {
  assert.equal(sliderIndex(taskBudgetMinuteStops, ""), taskBudgetMinuteStops.length);
  assert.equal(stopText(taskBudgetMinuteStops, taskBudgetMinuteStops.length), "");
  assert.equal(sliderIndex(taskBudgetMinuteStops, "30"), taskBudgetMinuteStops.indexOf(30));
  assert.equal(sliderIndex(taskBudgetMinuteStops, "50"), taskBudgetMinuteStops.indexOf(45));
  assert.equal(sliderIndex(taskBudgetTokenStops, "2000000"), taskBudgetTokenStops.indexOf(2_000_000));
  assert.equal(sliderIndex(taskBudgetTokenStops, "10000000000"), taskBudgetTokenStops.length - 1);
  assert.equal(sliderIndex(taskBudgetTokenStops, "abc"), taskBudgetTokenStops.length);
  taskBudgetTokenStops.forEach((value, index) => assert.equal(readLimit(stopText(taskBudgetTokenStops, index)), value));
});
