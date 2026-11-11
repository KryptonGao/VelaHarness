import assert from "node:assert/strict";
import test from "node:test";
import { settingsCopy } from "../src/renderer/components/settings-copy.ts";
import {
  applyGlassOpacity,
  clampGlassOpacity,
  defaultGlassOpacity,
  glassOpacityApplies,
  parseGlassOpacity,
} from "../src/renderer/glass-opacity.ts";

test("clampGlassOpacity keeps values in 0-100", () => {
  assert.equal(clampGlassOpacity(-5), 0);
  assert.equal(clampGlassOpacity(140), 100);
  assert.equal(clampGlassOpacity(42.4), 42);
  assert.equal(clampGlassOpacity(Number.NaN), 100);
});

test("parseGlassOpacity only accepts stored integers in range", () => {
  assert.equal(parseGlassOpacity("0"), 0);
  assert.equal(parseGlassOpacity("100"), 100);
  assert.equal(parseGlassOpacity("101"), null);
  assert.equal(parseGlassOpacity(""), null);
  assert.equal(parseGlassOpacity("0.5"), null);
  assert.equal(parseGlassOpacity(null), null);
});

test("defaults match the CSS fallbacks in 02-base.css", () => {
  assert.equal(defaultGlassOpacity("theme", "light"), 55);
  assert.equal(defaultGlassOpacity("theme", "dark"), 85);
  assert.equal(defaultGlassOpacity("neutral", "light"), 60);
  assert.equal(defaultGlassOpacity("neutral", "dark"), 62);
  assert.equal(defaultGlassOpacity("none", "dark"), 62);
});

test("opacity does not apply to the light-mode None tint", () => {
  assert.equal(glassOpacityApplies("none", "light"), false);
  assert.equal(glassOpacityApplies("none", "dark"), true);
  assert.equal(glassOpacityApplies("theme", "light"), true);
  assert.equal(glassOpacityApplies("neutral", "light"), true);
});

test("applyGlassOpacity writes and clears the CSS variable", () => {
  const props = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => props.set(name, value),
      removeProperty: (name: string) => props.delete(name),
    },
  } as unknown as HTMLElement;
  applyGlassOpacity(root, 30);
  assert.equal(props.get("--glass-opacity"), "0.3");
  applyGlassOpacity(root, null);
  assert.equal(props.has("--glass-opacity"), false);
});

test("glass tint and opacity copy is translated in every locale", () => {
  const english = settingsCopy("en").appearance;
  const keys = [
    "glassTint", "glassTintHint", "glassTintTheme", "glassTintNone",
    "glassOpacity", "glassOpacityHint", "glassOpacityReset",
  ] as const;
  for (const locale of ["zh-CN", "zh-TW", "ja", "ko"] as const) {
    const copy = settingsCopy(locale).appearance;
    for (const key of keys) {
      assert.notEqual(copy[key], english[key], `${locale} ${key} falls back to English`);
    }
  }
});
