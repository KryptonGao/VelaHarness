import assert from "node:assert/strict";
import test from "node:test";
import { createHighlighterCore, type ThemeRegistrationAny } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { createIncrementalTokenizer, type TokenLines } from "../src/renderer/components/preview/incremental-tokenizer.ts";

/** Fake tokenizer: one token per line, the "state" counts the lines seen so far. Records what it was asked to do. */
function fake() {
  const calls: { text: string; state: number | undefined }[] = [];
  const tokenizer = createIncrementalTokenizer<number>((text, state) => {
    calls.push({ text, state });
    const lines = text.split("\n");
    return { tokens: lines.map((line) => [{ content: line, offset: 0 }]), state: (state ?? 0) + lines.length };
  }, () => Promise.resolve());
  return { tokenizer, calls };
}
const numbered = (count: number, prefix = "line") => Array.from({ length: count }, (_, i) => `${prefix} ${i}`);
const text = (tokens: TokenLines | null) => tokens?.map((line) => line.map((token) => token.content).join(""));

test("appending lines only tokenizes the new ones", async () => {
  const { tokenizer, calls } = fake();
  const first = await tokenizer.tokenize(numbered(100));
  assert.deepEqual(text(first), numbered(100));
  const tokenizedBefore = calls.reduce((sum, call) => sum + call.text.split("\n").length, 0);
  assert.equal(tokenizedBefore, 100);

  calls.length = 0;
  const second = await tokenizer.tokenize(numbered(110));
  assert.deepEqual(text(second), numbered(110));
  assert.equal(calls.reduce((sum, call) => sum + call.text.split("\n").length, 0), 10, "only the ten new lines");
  assert.equal(calls[0]!.state, 100, "resumes from the state recorded after the previous input");
});

test("unchanged lines keep their token arrays", async () => {
  const { tokenizer } = fake();
  const first = (await tokenizer.tokenize(numbered(60)))!;
  const second = (await tokenizer.tokenize(numbered(65)))!;
  for (let i = 0; i < 59; i += 1) assert.equal(second[i], first[i], `line ${i} must be reused by reference`);
});

test("a partially written last line is redone once it grows", async () => {
  const { tokenizer, calls } = fake();
  await tokenizer.tokenize(["a", "b", "const x = "]);
  calls.length = 0;
  const grown = await tokenizer.tokenize(["a", "b", "const x = 1;"]);
  assert.deepEqual(text(grown), ["a", "b", "const x = 1;"]);
  assert.deepEqual(calls.map((call) => call.text), ["const x = 1;"]);
});

test("an edit in the middle re-tokenizes from the nearest earlier checkpoint", async () => {
  const { tokenizer, calls } = fake();
  await tokenizer.tokenize(numbered(100));
  calls.length = 0;
  const edited = numbered(100);
  edited[50] = "changed";
  const result = await tokenizer.tokenize(edited);
  assert.deepEqual(text(result), edited);
  const redone = calls.reduce((sum, call) => sum + call.text.split("\n").length, 0);
  assert.ok(redone <= 100 - 50 + 40, `only the tail from the checkpoint is redone, got ${redone}`);
  assert.ok(redone < 100);
});

test("shorter or unrelated input starts over correctly", async () => {
  const { tokenizer } = fake();
  await tokenizer.tokenize(numbered(80));
  assert.deepEqual(text(await tokenizer.tokenize(numbered(10))), numbered(10));
  assert.deepEqual(text(await tokenizer.tokenize(numbered(30, "other"))), numbered(30, "other"));
  assert.deepEqual(text(await tokenizer.tokenize([])), []);
});

test("work is cut into slices with a yield between them", async () => {
  let yields = 0;
  const sizes: number[] = [];
  const tokenizer = createIncrementalTokenizer<number>((chunk, state) => {
    const lines = chunk.split("\n");
    sizes.push(lines.length);
    return { tokens: lines.map((line) => [{ content: line, offset: 0 }]), state: (state ?? 0) + lines.length };
  }, async () => { yields += 1; });
  await tokenizer.tokenize(numbered(200));
  assert.ok(Math.max(...sizes) <= 40, "no slice is larger than the slice size");
  assert.ok(yields >= 4, "the event loop is released between slices");
  assert.equal(sizes.at(-1), 1, "the last line is its own slice so it can be resumed");
});

test("a newer call supersedes one that is waiting between slices, and keeps its progress", async () => {
  const sizes: number[] = [];
  let release: (() => void) | undefined;
  let blocked = false;
  const tokenizer = createIncrementalTokenizer<number>((chunk, state) => {
    const lines = chunk.split("\n");
    sizes.push(lines.length);
    return { tokens: lines.map((line) => [{ content: line, offset: 0 }]), state: (state ?? 0) + lines.length };
  }, () => {
    if (blocked) return Promise.resolve();
    blocked = true;
    return new Promise<void>((resolve) => { release = resolve; });
  });
  const stale = tokenizer.tokenize(numbered(120));
  await Promise.resolve();
  const fresh = tokenizer.tokenize(numbered(130));
  release?.();
  assert.equal(await stale, null, "the superseded call gives up");
  assert.deepEqual(text(await fresh), numbered(130));
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) < 120 + 130, "the first slice of the stale call is not redone");
});

test("tokenizer failure resets and reports null", async () => {
  let fail = false;
  const tokenizer = createIncrementalTokenizer<number>((chunk, state) => {
    if (fail) return null;
    const lines = chunk.split("\n");
    return { tokens: lines.map((line) => [{ content: line, offset: 0 }]), state: (state ?? 0) + lines.length };
  }, () => Promise.resolve());
  await tokenizer.tokenize(numbered(10));
  fail = true;
  assert.equal(await tokenizer.tokenize(numbered(20)), null);
  fail = false;
  assert.deepEqual(text(await tokenizer.tokenize(numbered(20))), numbered(20));
});

// The real thing: tokens produced incrementally must be exactly what a single full pass produces.
const theme: ThemeRegistrationAny = {
  name: "test",
  type: "light",
  colors: { "editor.foreground": "var(--fg)", "editor.background": "var(--bg)" },
  tokenColors: [
    { settings: { foreground: "var(--fg)" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "var(--comment)", fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"], settings: { foreground: "var(--string)" } },
    { scope: ["constant.numeric"], settings: { foreground: "var(--number)" } },
    { scope: ["keyword", "storage"], settings: { foreground: "var(--keyword)" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "var(--function)" } },
    { scope: ["entity.name.tag", "entity.other.attribute-name", "support.type.property-name"], settings: { foreground: "var(--attr)" } },
  ],
};

const typescript = [
  "/* a block comment",
  "   that spans lines */",
  "export async function load(path: string): Promise<number> {",
  "  const text = `template ${path}",
  "    continued line`;",
  "  if (text.length > 10) {",
  "    return 42; // trailing comment",
  "  }",
  ...Array.from({ length: 70 }, (_, i) => `  const value${i} = compute(${i}, "payload-${i}");`),
  "  return 0;",
  "}",
];
const css = [
  "/* layout */",
  ".composer { display: grid; gap: 4px; }",
  "@media (min-width: 600px) {",
  "  .composer > .slot:nth-child(2) { padding: 0 calc(var(--gap) * 2); }",
  ...Array.from({ length: 70 }, (_, i) => `  .row-${i} { color: color-mix(in srgb, var(--fg) ${i}%, transparent); }`),
  "}",
];

async function realTokenizer(lang: "typescript" | "css") {
  const highlighter = await createHighlighterCore({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) });
  await highlighter.loadLanguage(lang === "css" ? (await import("shiki/langs/css.mjs")).default : (await import("shiki/langs/typescript.mjs")).default);
  const options = { lang, theme, tokenizeMaxLineLength: 2000, tokenizeTimeLimit: 100 };
  const full = (lines: string[]) => highlighter.codeToTokens(lines.join("\n"), options).tokens;
  const incremental = createIncrementalTokenizer((chunk: string, state) => {
    const result = highlighter.codeToTokens(chunk, { ...options, ...(state ? { grammarState: state } : {}) });
    return { tokens: result.tokens, state: highlighter.getLastGrammarState(result.tokens) };
  }, () => Promise.resolve());
  return { full, incremental };
}
/** Offsets are relative to each tokenized chunk; everything the renderer draws must match. */
const visible = (tokens: TokenLines | null) => tokens?.map((line) => line.map(({ content, color, fontStyle }) => ({ content, color, fontStyle })));

for (const [lang, source] of [["typescript", typescript], ["css", css]] as const) {
  test(`incremental ${lang} tokens equal a full pass, however the text arrives`, async () => {
    const { full, incremental } = await realTokenizer(lang);
    assert.deepEqual(visible(await incremental.tokenize(source)), visible(full(source)), "one shot");

    // Stream it in uneven pieces, including a half-written last line each time, as a model would.
    const { incremental: streamed } = await realTokenizer(lang);
    let lines: string[] = [];
    let step = 0;
    for (let cursor = 0; cursor < source.length; ) {
      cursor = Math.min(source.length, cursor + 1 + ((step++ * 7) % 11));
      lines = source.slice(0, cursor);
      const partial = [...lines.slice(0, -1), lines.at(-1)!.slice(0, Math.ceil(lines.at(-1)!.length / 2))];
      assert.deepEqual(visible(await streamed.tokenize(partial)), visible(full(partial)), `partial at ${cursor}`);
      assert.deepEqual(visible(await streamed.tokenize(lines)), visible(full(lines)), `complete at ${cursor}`);
    }
  });
}
