import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitFrontmatter } from "../src/renderer/components/preview/markdown-frontmatter.ts";

describe("splitFrontmatter", () => {
  it("parses quoted and bare scalars and strips the block", () => {
    const result = splitFrontmatter('---\nname: ui-ux-pro-max\ndescription: "UI/UX: design \\"pro\\"."\n---\n\n# Title\n');
    assert.deepEqual(result.entries, [
      { key: "name", value: "ui-ux-pro-max" },
      { key: "description", value: 'UI/UX: design "pro".' },
    ]);
    assert.equal(result.body, "# Title\n");
  });

  it("handles lists, flow sequences and block scalars", () => {
    const result = splitFrontmatter(
      "---\ntags:\n  - a\n  - 'b c'\nallowed: [x, \"y\"]\nnotes: >\n  one\n  two\n\n  three\nraw: |\n  l1\n  l2\n---\nbody",
    );
    assert.deepEqual(result.entries, [
      { key: "tags", value: ["a", "b c"] },
      { key: "allowed", value: ["x", "y"] },
      { key: "notes", value: "one two\n\nthree" },
      { key: "raw", value: "l1\nl2" },
    ]);
    assert.equal(result.body, "body");
  });

  it("joins wrapped plain scalars", () => {
    const result = splitFrontmatter("---\ndescription: first line\n  second line\n---\nx");
    assert.deepEqual(result.entries, [{ key: "description", value: "first line second line" }]);
  });

  it("leaves ordinary thematic breaks alone", () => {
    const text = "---\nSome prose here.\n---\nmore";
    assert.deepEqual(splitFrontmatter(text), { entries: [], body: text });
    assert.deepEqual(splitFrontmatter("# Hi\n---\nname: x\n---"), { entries: [], body: "# Hi\n---\nname: x\n---" });
    assert.deepEqual(splitFrontmatter("---\nname: x\nno close"), { entries: [], body: "---\nname: x\nno close" });
  });

  it("handles CRLF and BOM", () => {
    const result = splitFrontmatter("﻿---\r\nname: x\r\n---\r\n# T");
    assert.deepEqual(result.entries, [{ key: "name", value: "x" }]);
    assert.equal(result.body, "# T");
  });
});
