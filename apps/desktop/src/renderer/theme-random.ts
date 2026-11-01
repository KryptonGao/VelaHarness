import {
  builtinThemeColors,
  contrastRatio,
  customThemeVars,
  darkThemes,
  lightThemes,
  type ColorScheme,
  type CustomThemeColors,
} from "./themes";

/**
 * 随机主题:在 OKLCH(感知均匀)空间里按规则抽样四个基础色,再用 paletteIssues 把关。
 *
 * 规则的出发点是「只让色相随机,其余都被限制在好看的区间里」:
 * - 背景、卡片、文字只带很淡的色调(低彩度),所以无论色相落在哪里都不会发花;
 * - 强调色的彩度有下限(不发灰)也有上限(不刺眼),亮度按明暗基底落在各自的区间;
 * - 强调色的亮度还会被微调到与背景、卡片、按钮文字都满足对比度;
 * - 推导出的次级文字(muted / dim / 代码注释)同样要过对比度,不合格就重抽。
 */

export type Rng = () => number;

const attempts = 40;

/** 正文与背景/卡片的最低对比度(WCAG AAA 级别)。 */
const minTextContrast = 10;
/** 强调色作为文字(链接等)出现在背景/卡片上,以及按钮文字压在强调色上的最低对比度(WCAG AA)。 */
const minAccentContrast = 4.5;
/** 次级文字 text-muted 的最低对比度。 */
const minMutedContrast = 4.5;
/**
 * 最弱的辅助文字(text-dim、代码注释)的最低对比度。它们由正文色按固定比例混入背景推导而来,
 * 浅色主题里即使正文是纯黑也到不了 3:1,所以门槛放在 2.5;真正的次级文字由 text-muted 把关。
 */
const minDimContrast = 2.5;
/** 强调色的最低彩度,低于它会显得发灰、和中性色分不开(多发生在黄绿色相的浅色强调色上)。 */
const minAccentChroma = 0.1;

/* ------------------------------------------------------------------ OKLCH */

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

function inGamut(rgb: readonly number[]): boolean {
  return rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005);
}

function encode(channel: number): number {
  const v = Math.min(1, Math.max(0, channel));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** 转成 #rrggbb;超出 sRGB 色域时保持亮度和色相、只降低彩度,返回实际用上的彩度。 */
function oklchToHex(color: Oklch): { hex: string; chroma: number } {
  let chroma = color.c;
  if (!inGamut(oklchToLinearRgb(color))) {
    let low = 0;
    let high = color.c;
    for (let i = 0; i < 20; i += 1) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinearRgb({ ...color, c: mid }))) low = mid;
      else high = mid;
    }
    chroma = low;
  }
  const rgb = oklchToLinearRgb({ ...color, c: chroma });
  const hex = `#${rgb.map((channel) => Math.round(encode(channel) * 255).toString(16).padStart(2, "0")).join("")}`;
  return { hex, chroma };
}

/* -------------------------------------------------------------- 抽样与校验 */

function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

/** 中性色相对强调色的色相偏移:多数同色系或邻近色,偶尔取对比色(彩度极低,只是一层淡淡的底色)。 */
const neutralHueOffsets = [0, 0, 0, 20, -20, 40, -40, 180] as const;

interface Candidate {
  colors: CustomThemeColors;
  accentChroma: number;
}

function candidate(scheme: ColorScheme, rng: Rng): Candidate {
  const dark = scheme === "dark";
  const accentHue = rng() * 360;
  const neutralHue = (accentHue + pick(rng, neutralHueOffsets) + 360) % 360;

  const backgroundL = dark ? between(rng, 0.16, 0.24) : between(rng, 0.965, 0.99);
  const backgroundC = dark ? between(rng, 0.008, 0.022) : between(rng, 0.004, 0.016);
  // 深色下卡片比背景亮一档;浅色下卡片更接近纯白,和背景拉开一点层次。
  const surfaceL = dark ? backgroundL + between(rng, 0.03, 0.05) : Math.min(1, backgroundL + between(rng, 0.012, 0.025));
  const surfaceC = dark ? backgroundC : backgroundC * 0.4;
  // 浅色下正文更深:次级文字是按比例混入背景推导的,正文太浅会让 text-muted 掉到 4.5 以下。
  const textL = dark ? between(rng, 0.93, 0.97) : between(rng, 0.14, 0.21);
  const textC = dark ? between(rng, 0.004, 0.014) : between(rng, 0.01, 0.03);

  const background = oklchToHex({ l: backgroundL, c: backgroundC, h: neutralHue }).hex;
  const surface = oklchToHex({ l: surfaceL, c: surfaceC, h: neutralHue }).hex;
  const text = oklchToHex({ l: textL, c: textC, h: neutralHue }).hex;

  // 强调色:先按区间抽亮度和彩度,再沿远离背景的方向微调亮度直到各项对比度达标。
  let accentL = dark ? between(rng, 0.7, 0.8) : between(rng, 0.48, 0.58);
  const accentC = between(rng, 0.12, 0.2);
  let accent = oklchToHex({ l: accentL, c: accentC, h: accentHue });
  for (let i = 0; i < 20 && !accentReadable(accent.hex, background, surface); i += 1) {
    accentL += dark ? 0.01 : -0.01;
    accent = oklchToHex({ l: accentL, c: accentC, h: accentHue });
  }

  return { colors: { background, surface, text, accent: accent.hex }, accentChroma: accent.chroma };
}

function accentReadable(accent: string, background: string, surface: string): boolean {
  const vars = customThemeVars({ scheme: "dark", colors: { background, surface, text: "#ffffff", accent } });
  return (
    contrastRatio(accent, background) >= minAccentContrast &&
    contrastRatio(accent, surface) >= minAccentContrast &&
    contrastRatio(accent, vars["--accent-contrast"]!) >= minAccentContrast
  );
}

/**
 * 检查一组基础色(连同由它们推导出的次级文字色)是否清晰可读,返回不满足的规则名;空数组表示通过。
 * 随机生成器用它做最终把关,测试也用它覆盖大量样本。
 */
export function paletteIssues(colors: CustomThemeColors, scheme: ColorScheme): string[] {
  const issues: string[] = [];
  const vars = customThemeVars({ scheme, colors });
  const { background, surface, text, accent } = colors;

  if (contrastRatio(text, background) < minTextContrast) issues.push("text-on-background");
  if (contrastRatio(text, surface) < minTextContrast) issues.push("text-on-surface");
  if (contrastRatio(accent, background) < minAccentContrast) issues.push("accent-on-background");
  if (contrastRatio(accent, surface) < minAccentContrast) issues.push("accent-on-surface");
  if (contrastRatio(accent, vars["--accent-contrast"]!) < minAccentContrast) issues.push("accent-button-text");
  for (const base of [background, surface]) {
    if (contrastRatio(vars["--text-muted"]!, base) < minMutedContrast) issues.push("muted-text");
    if (contrastRatio(vars["--text-dim"]!, base) < minDimContrast) issues.push("dim-text");
    if (contrastRatio(vars["--syntax-comment"]!, base) < minDimContrast) issues.push("code-comment");
  }
  return [...new Set(issues)];
}

/** 抽不到合格配色(概率极低)时的兜底:从同明暗、且自己也满足上述规则的内置主题里随机取一套。 */
function fallback(scheme: ColorScheme, rng: Rng): CustomThemeColors {
  const ids = scheme === "dark" ? darkThemes : lightThemes;
  const passing = ids.filter((id) => paletteIssues(builtinThemeColors[id], scheme).length === 0);
  return { ...builtinThemeColors[pick(rng, passing.length ? passing : [ids[0]])] };
}

/** 随机生成一组好看且可读的主题基础色。rng 默认 Math.random,测试可传入带种子的随机源。 */
export function randomThemeColors(scheme: ColorScheme, rng: Rng = Math.random): CustomThemeColors {
  for (let i = 0; i < attempts; i += 1) {
    const next = candidate(scheme, rng);
    if (next.accentChroma >= minAccentChroma && paletteIssues(next.colors, scheme).length === 0) return next.colors;
  }
  return fallback(scheme, rng);
}
