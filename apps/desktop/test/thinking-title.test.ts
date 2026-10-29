import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitThinkingTitle } from "../src/renderer/thinking-title.ts";

describe("thinking title", () => {
  it("takes a bold first line as the title and keeps the rest as the body", () => {
    assert.deepEqual(
      splitThinkingTitle("**Considering workbench fixtures**\n\nI’m thinking about it.\n\nSecond paragraph.", false),
      { title: "Considering workbench fixtures", body: "I’m thinking about it.\n\nSecond paragraph." },
    );
  });

  it("accepts a heading line and leading blank lines", () => {
    assert.deepEqual(splitThinkingTitle("\n\n## Plan the fix\nDetails", false), { title: "Plan the fix", body: "Details" });
  });

  it("does not treat ordinary first lines as a title", () => {
    assert.equal(splitThinkingTitle("I need to inspect the runtime.\n\nThen edit.", false), null);
    assert.equal(splitThinkingTitle("**Bold** followed by prose\n\nbody", false), null);
    assert.equal(splitThinkingTitle("**a** and **b**\n\nbody", false), null);
    assert.equal(splitThinkingTitle("", false), null);
  });

  it("waits for the title line to finish while streaming", () => {
    assert.equal(splitThinkingTitle("**Considering workbench fix", true), null);
    assert.equal(splitThinkingTitle("**Considering workbench fixtures**", true), null);
    assert.deepEqual(splitThinkingTitle("**Considering workbench fixtures**\n", true), { title: "Considering workbench fixtures", body: "" });
  });

  it("accepts a finished thought that is only a title", () => {
    assert.deepEqual(splitThinkingTitle("**Checking the toggle**", false), { title: "Checking the toggle", body: "" });
  });
});
