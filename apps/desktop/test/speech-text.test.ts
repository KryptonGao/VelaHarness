import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { billingLength, splitSpeechText } from "@vela/shared";

describe("speech text splitting", () => {
  it("counts Han characters twice and everything else once", () => {
    assert.equal(billingLength("你好 ab"), 7);
  });

  it("keeps short text in one chunk", () => {
    assert.deepEqual(splitSpeechText("第一段。\n\n第二段。", 100), ["第一段。\n\n第二段。"]);
  });

  it("breaks between paragraphs before exceeding the budget", () => {
    const chunks = splitSpeechText("aaaa\n\nbbbb\n\ncccc", 10);
    assert.deepEqual(chunks, ["aaaa\n\nbbbb", "cccc"]);
    for (const chunk of chunks) assert.ok(billingLength(chunk) <= 10);
  });

  it("splits one oversized paragraph at sentence ends", () => {
    const text = "这是第一句。这是第二句。这是第三句。";
    const chunks = splitSpeechText(text, 14);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(billingLength(chunk) <= 14, chunk);
    assert.equal(chunks.join(""), text);
  });

  it("hard-cuts text without any break point and drops blank input", () => {
    const chunks = splitSpeechText("a".repeat(25), 10);
    assert.deepEqual(chunks.map(chunk => chunk.length), [10, 10, 5]);
    assert.deepEqual(splitSpeechText("  \n\n  "), []);
  });
});
