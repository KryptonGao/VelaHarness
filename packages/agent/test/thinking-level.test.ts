import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Api, type Model } from "@earendil-works/pi-ai";
import { clampThinkingLevelFor, modelThinkingLevel, peakThinkingLevel, thinkingLevelsFor, ultraInstructions } from "../src/thinking-level.ts";

function fake(reasoning: boolean, thinkingLevelMap: Record<string, string | null> = {}): Model<Api> {
  return { id: "fake", provider: "fake", reasoning, thinkingLevelMap } as unknown as Model<Api>;
}

const pick = (reasoning: boolean): Model<Api> => fake(reasoning, reasoning ? { xhigh: "xhigh" } : {});

describe("ultra thinking level", () => {
  it("is offered for reasoning and non-reasoning models alike, always last", () => {
    for (const reasoning of [true, false]) {
      const levels = thinkingLevelsFor(pick(reasoning));
      assert.equal(levels.at(-1), "ultra");
      assert.equal(levels.filter((level) => level === "ultra").length, 1);
    }
  });

  it("keeps ultra when clamping and resolves it to the model's real peak level", () => {
    const model = pick(true);
    const peak = peakThinkingLevel(model);
    assert.equal(peak, "xhigh");
    assert.equal(clampThinkingLevelFor(model, "ultra"), "ultra");
    assert.equal(modelThinkingLevel(model, "ultra"), peak);
    assert.equal(modelThinkingLevel(model, "low"), clampThinkingLevelFor(model, "low"));
    assert.equal(modelThinkingLevel(pick(false), "ultra"), "off");
  });

  it("asks for more subagents without touching the reasoning budget", () => {
    assert.match(ultraInstructions, /spawn_agent/);
  });
});
