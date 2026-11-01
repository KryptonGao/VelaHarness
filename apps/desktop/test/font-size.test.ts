import assert from "node:assert/strict";
import test from "node:test";
import { clampFontSize, codeFontSizeRange, fontScale, parseFontSize, uiFontSizeRange } from "../src/renderer/font-size.ts";

test("clampFontSize keeps sizes inside the allowed range", () => {
  assert.equal(clampFontSize(uiFontSizeRange, 8), 11);
  assert.equal(clampFontSize(uiFontSizeRange, 99), 15);
  assert.equal(clampFontSize(uiFontSizeRange, 12.6), 13);
  assert.equal(clampFontSize(codeFontSizeRange, 7), 8);
  assert.equal(clampFontSize(codeFontSizeRange, 30), 24);
  assert.equal(clampFontSize(codeFontSizeRange, Number.NaN), 14);
});

test("parseFontSize falls back on anything but an in-range integer", () => {
  assert.equal(parseFontSize(uiFontSizeRange, "13"), 13);
  assert.equal(parseFontSize(uiFontSizeRange, "10"), 15);
  assert.equal(parseFontSize(uiFontSizeRange, "13.5"), 15);
  assert.equal(parseFontSize(uiFontSizeRange, null), 15);
  assert.equal(parseFontSize(codeFontSizeRange, "24"), 24);
  assert.equal(parseFontSize(codeFontSizeRange, "25"), 14);
  assert.equal(parseFontSize(codeFontSizeRange, ""), 14);
});

test("fontScale is 1 at the default size", () => {
  assert.equal(fontScale(uiFontSizeRange, 15), 1);
  assert.equal(fontScale(codeFontSizeRange, 14), 1);
  assert.equal(fontScale(uiFontSizeRange, 11), 11 / 15);
  assert.equal(fontScale(codeFontSizeRange, 24), 24 / 14);
});
