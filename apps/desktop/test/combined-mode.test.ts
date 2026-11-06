import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  combinedModeChange,
  combinedModeOptions,
  currentCombinedMode,
} from "../src/renderer/components/composer/combined-mode.ts";

describe("combined mode", () => {
  it("derives the highlighted row from interaction mode and permission", () => {
    assert.equal(currentCombinedMode("agent", "smart"), "auto");
    assert.equal(currentCombinedMode("agent", "ask"), "manual");
    assert.equal(currentCombinedMode("agent", "full"), "full");
    assert.equal(currentCombinedMode("plan", "full"), "plan");
    assert.equal(currentCombinedMode("goal", "ask"), "goal");
  });

  it("every agent row round-trips through its own change", () => {
    for (const option of combinedModeOptions.filter((entry) => entry.interaction === "agent")) {
      const change = combinedModeChange(option.id, { interaction: "plan", sandbox: "ask" });
      const next = { interaction: change.interaction ?? "plan", sandbox: change.sandbox ?? "ask" } as const;
      assert.equal(currentCombinedMode(next.interaction, next.sandbox), option.id);
    }
  });

  it("plan and goal keep the current permission", () => {
    assert.deepEqual(combinedModeChange("plan", { interaction: "agent", sandbox: "full" }), { interaction: "plan", sandbox: null });
    assert.deepEqual(combinedModeChange("goal", { interaction: "plan", sandbox: "smart" }), { interaction: "goal", sandbox: null });
  });

  it("skips writes that would not change anything", () => {
    assert.deepEqual(combinedModeChange("auto", { interaction: "agent", sandbox: "smart" }), { interaction: null, sandbox: null });
    assert.deepEqual(combinedModeChange("full", { interaction: "agent", sandbox: "ask" }), { interaction: null, sandbox: "full" });
  });

  it("never changes a permission that is locked by a recipe snapshot", () => {
    assert.deepEqual(
      combinedModeChange("manual", { interaction: "plan", sandbox: "full" }, { sandboxLocked: true }),
      { interaction: "agent", sandbox: null },
    );
  });

  it("lists the permission levels first so they form the full rows of the menu", () => {
    const ids = combinedModeOptions.map((option) => option.id);
    assert.deepEqual(ids, ["auto", "manual", "full", "plan", "goal"]);
    assert.deepEqual(combinedModeOptions.map((option) => Boolean(option.sandbox)), [true, true, true, false, false]);
  });
});
