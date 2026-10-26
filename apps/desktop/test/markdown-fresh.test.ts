import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { advanceFreshCuts, completeInline, remarkFresh } from "../src/renderer/components/markdown-fresh.ts";
import { remarkScriptGap } from "../src/renderer/components/markdown-script-gap.ts";

type Node = { type: string; value?: string; children?: Node[]; data?: { hName?: string } };
const show = (node: Node): string => {
  if (node.type === "text") return node.value ?? "";
  const inner = (node.children ?? []).map(show).join("");
  if (node.data?.hName === "span") return node.data && "<f>" + inner + "</f>";
  return node.type === "root" ? inner : `[${inner}]`;
};
const render = (text: string, cuts: number[]) => {
  const processor = unified().use(remarkParse).use(remarkScriptGap).use(remarkFresh, cuts);
  return show(processor.runSync(processor.parse(text)) as Node);
};

describe("markdown fresh text", () => {
  it("leaves text untouched without cuts", () => {
    assert.equal(render("hello world", []), "[hello world]");
  });

  it("wraps only text appended after a cut", () => {
    assert.equal(render("hello world", [5]), "[hello<f> world</f>]");
  });

  it("keeps one span per batch", () => {
    assert.equal(render("abcdef", [2, 4]), "[ab<f>cd</f><f>ef</f>]");
  });

  it("treats everything as fresh when the first cut is 0", () => {
    assert.equal(render("hi **there**", [0]), "[<f>hi </f>[<f>there</f>]]");
  });

  it("wraps inline code as a whole by where it starts", () => {
    assert.equal(render("ab `cd` ef", [0]), "[<f>ab </f><f>`cd`</f><f> ef</f>]".replace("`cd`", "[]"));
    assert.equal(render("ab `cd` ef", [6]), "[ab []<f> ef</f>]");
  });

  it("keeps cuts across mixed-script text", () => {
    const out = render("你好abc世界", [4]);
    assert.match(out, /<f>/);
    assert.ok(out.startsWith("[你好"));
  });

  it("tracks growth and shrinkage", () => {
    const state = { length: 0, cuts: [] as number[], born: [] as number[] };
    assert.deepEqual(advanceFreshCuts(state, 5, 10).cuts, [0]);
    assert.deepEqual(advanceFreshCuts(state, 5, 20).cuts, [0]);
    assert.deepEqual(advanceFreshCuts(state, 9, 30).born, [10, 30]);
    assert.deepEqual(advanceFreshCuts(state, 3, 40).cuts, [0]);
  });

  it("completes unclosed inline syntax while streaming", () => {
    assert.equal(completeInline("a **bold"), "a **bold**");
    assert.equal(completeInline("a `code"), "a `code`");
    assert.equal(completeInline("a ~~gone"), "a ~~gone~~");
    assert.equal(completeInline("x **b `c"), "x **b `c`**");
    assert.equal(completeInline("done **a** then **b"), "done **a** then **b**");
  });

  it("hides a marker that has no content yet and trailing whitespace inside it", () => {
    assert.equal(completeInline("a **"), "a ");
    assert.equal(completeInline("a `"), "a ");
    assert.equal(completeInline("a **bold "), "a **bold**");
  });

  it("only looks at the last paragraph and leaves code fences alone", () => {
    assert.equal(completeInline("one **open\n\ntwo"), "one **open\n\ntwo");
    assert.equal(completeInline("```\n**a"), "```\n**a");
    assert.equal(completeInline("plain text"), "plain text");
    assert.equal(completeInline("escaped \\**star"), "escaped \\**star");
  });
});
