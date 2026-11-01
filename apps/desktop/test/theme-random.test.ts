import assert from "node:assert/strict";
import test from "node:test";
import { paletteIssues, randomThemeColors, type Rng } from "../src/renderer/theme-random.ts";
import { builtinThemeColors, customThemeVars, normalizeHex, type ColorScheme } from "../src/renderer/themes.ts";

/** 带种子的随机源,让测试可复现。 */
function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const schemes: ColorScheme[] = ["light", "dark"];
const samples = 1000;

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

test("every random palette is valid hex and passes the readability rules", () => {
  for (const scheme of schemes) {
    const rng = seeded(scheme === "dark" ? 7 : 11);
    for (let i = 0; i < samples; i += 1) {
      const colors = randomThemeColors(scheme, rng);
      for (const value of Object.values(colors)) assert.equal(normalizeHex(value), value);
      assert.deepEqual(paletteIssues(colors, scheme), [], `${scheme} ${JSON.stringify(colors)}`);
    }
  }
});

test("random palettes are varied and almost never fall back to a built-in theme", () => {
  for (const scheme of schemes) {
    const rng = seeded(42);
    const builtin = new Set(Object.values(builtinThemeColors).map((colors) => colors.accent));
    const accents = new Set<string>();
    const hueBuckets = new Set<number>();
    for (let i = 0; i < samples; i += 1) {
      const { accent } = randomThemeColors(scheme, rng);
      accents.add(accent);
      hueBuckets.add(Math.floor(hue(accent) / 30));
      assert.ok(!builtin.has(accent), "fallback palette was used");
    }
    assert.ok(accents.size > samples * 0.9, `${scheme} accents not varied: ${accents.size}`);
    assert.equal(hueBuckets.size, 12, `${scheme} accent hues miss part of the wheel`);
  }
});

test("dark palettes are dark and light palettes are light", () => {
  const luma = (hex: string) => Number.parseInt(hex.slice(1, 3), 16) * 0.3 + Number.parseInt(hex.slice(3, 5), 16) * 0.59 + Number.parseInt(hex.slice(5, 7), 16) * 0.11;
  const rng = seeded(5);
  for (let i = 0; i < 200; i += 1) {
    const dark = randomThemeColors("dark", rng);
    assert.ok(luma(dark.background) < 80 && luma(dark.text) > 200, JSON.stringify(dark));
    const light = randomThemeColors("light", rng);
    assert.ok(luma(light.background) > 230 && luma(light.text) < 80, JSON.stringify(light));
  }
});

test("paletteIssues flags unreadable palettes", () => {
  const good = builtinThemeColors.midnight;
  assert.deepEqual(paletteIssues(good, "dark"), []);
  assert.ok(paletteIssues({ ...good, text: "#4a4d55" }, "dark").includes("text-on-background"));
  assert.ok(paletteIssues({ ...good, accent: "#232a3a" }, "dark").includes("accent-on-background"));
  // 亮度居中的强调色,黑白按钮文字都不达标。
  assert.ok(paletteIssues({ ...builtinThemeColors.daylight, accent: "#777777" }, "light").includes("accent-button-text"));
});

test("accent-contrast picks whichever of white and dark text reads better", () => {
  // 中等亮度的橙色:旧规则(亮度 > 0.5 才用深色)会给它配白字,对比度只有约 2.6。
  const vars = customThemeVars({ scheme: "dark", colors: { ...builtinThemeColors.ember, accent: "#eb8a5e" } });
  assert.equal(vars["--accent-contrast"], "#111318");
});
