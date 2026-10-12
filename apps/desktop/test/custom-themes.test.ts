import assert from "node:assert/strict";
import test from "node:test";
import {
  builtinThemeColors,
  contrastRatio,
  customThemeVars,
  maxCustomThemes,
  normalizeHex,
  parseCustomTheme,
  parseCustomThemes,
  type CustomTheme,
} from "../src/renderer/themes.ts";

const sample: CustomTheme = {
  id: "custom-abc123",
  name: "Sunset",
  scheme: "dark",
  colors: { background: "#1a1613", surface: "#221d19", text: "#f3eadf", accent: "#eb8a5e" },
};

test("normalizeHex accepts #rgb and #rrggbb only", () => {
  assert.equal(normalizeHex("#ABC"), "#aabbcc");
  assert.equal(normalizeHex(" #1A2b3C "), "#1a2b3c");
  for (const bad of ["abc", "#abcd", "#12345g", "red", "", null, 12]) assert.equal(normalizeHex(bad), null);
});

test("parseCustomTheme rejects malformed stored data and trims names", () => {
  assert.deepEqual(parseCustomTheme({ ...sample, name: "  Sunset  " }), sample);
  assert.equal(parseCustomTheme({ ...sample, id: "midnight" }), null);
  assert.equal(parseCustomTheme({ ...sample, id: "custom-<script>" }), null);
  assert.equal(parseCustomTheme({ ...sample, scheme: "sepia" }), null);
  assert.equal(parseCustomTheme({ ...sample, name: "   " }), null);
  assert.equal(parseCustomTheme({ ...sample, colors: { ...sample.colors, accent: "url(x)" } }), null);
  assert.equal(parseCustomTheme({ ...sample, colors: { background: "#000000" } }), null);
  assert.equal(parseCustomTheme("nope"), null);
  assert.equal(parseCustomTheme({ ...sample, name: "x".repeat(80) })?.name.length, 24);
});

test("parseCustomThemes drops duplicates and enforces the limit", () => {
  assert.deepEqual(parseCustomThemes("nope"), []);
  assert.equal(parseCustomThemes([sample, sample, { bad: true }]).length, 1);
  const many = Array.from({ length: maxCustomThemes + 5 }, (_, i) => ({ ...sample, id: `custom-t${i}` }));
  assert.equal(parseCustomThemes(many).length, maxCustomThemes);
});

test("customThemeVars emits only concrete colors (xterm and canvas cannot parse color-mix)", () => {
  for (const scheme of ["light", "dark"] as const) {
    const vars = customThemeVars({ scheme, colors: sample.colors });
    assert.equal(vars["--bg-chat"], sample.colors.background);
    assert.equal(vars["--text-primary"], sample.colors.text);
    assert.equal(vars["--accent-blue"], sample.colors.accent);
    assert.equal(vars["--term-fg"], sample.colors.text);
    for (const [name, value] of Object.entries(vars)) {
      assert.match(name, /^--[a-z-]+$/);
      assert.match(value, /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/, `${name}=${value}`);
    }
  }
});

test("accent contrast flips with the accent luminance", () => {
  const colors = { ...sample.colors };
  assert.equal(customThemeVars({ scheme: "dark", colors: { ...colors, accent: "#ffe066" } })["--accent-contrast"], "#111318");
  assert.equal(customThemeVars({ scheme: "dark", colors: { ...colors, accent: "#1d4ed8" } })["--accent-contrast"], "#ffffff");
});

test("built-in seeds are valid and readable", () => {
  for (const [id, colors] of Object.entries(builtinThemeColors)) {
    for (const value of Object.values(colors)) assert.equal(normalizeHex(value), value, id);
    assert.ok(contrastRatio(colors.text, colors.background) > 7, `${id} text contrast`);
  }
  assert.ok(contrastRatio("#ffffff", "#000000") > 20.9);
});
