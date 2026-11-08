import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forgetToolStart, noteToolStart, toolStart } from "../src/renderer/components/tool-running-clock.ts";

describe("tool running clock", () => {
  it("keeps the first start so a remounted row does not restart at zero", () => {
    noteToolStart("a", 1000);
    noteToolStart("a", 9000);
    assert.equal(toolStart("a", 20000), 1000);
  });

  it("starts counting at first sight for an unreported call, then forgets", () => {
    assert.equal(toolStart("b", 500), 500);
    assert.equal(toolStart("b", 900), 500);
    forgetToolStart("b");
    assert.equal(toolStart("b", 900), 900);
  });
});
