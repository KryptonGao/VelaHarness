export type ColorScheme = "light" | "dark";

export const lightThemes = ["daylight", "paper", "celadon"] as const;
export const darkThemes = ["midnight", "graphite", "ember"] as const;

export type LightTheme = (typeof lightThemes)[number];
export type DarkTheme = (typeof darkThemes)[number];
export type ThemeId = LightTheme | DarkTheme;

export const defaultLightTheme: LightTheme = "daylight";
export const defaultDarkTheme: DarkTheme = "midnight";

export function isLightTheme(value: unknown): value is LightTheme {
  return (lightThemes as readonly unknown[]).includes(value);
}

export function isDarkTheme(value: unknown): value is DarkTheme {
  return (darkThemes as readonly unknown[]).includes(value);
}

/* ---------------------------------------------------------------- 自定义主题 */

/** 自定义主题的 id 以 custom- 开头,和内置主题互不冲突。 */
export type CustomThemeId = `custom-${string}`;
/** 当前选中的主题:内置主题或用户创建的自定义主题。 */
export type SelectedThemeId = ThemeId | CustomThemeId;

/** 用户只需要调四个基础色,其余变量由它们推导,明暗基底里没覆盖的部分沿用内置值。 */
export interface CustomThemeColors {
  background: string;
  surface: string;
  text: string;
  accent: string;
}

export interface CustomTheme {
  id: CustomThemeId;
  name: string;
  scheme: ColorScheme;
  colors: CustomThemeColors;
}

export const customThemeColorKeys = ["background", "surface", "text", "accent"] as const;
export type CustomThemeColorKey = (typeof customThemeColorKeys)[number];

export const maxCustomThemes = 12;
export const maxCustomThemeNameLength = 24;

/** 内置主题的基础色,用来作为新建自定义主题的起点;与 styles.css 里对应主题块保持一致。 */
export const builtinThemeColors: Record<ThemeId, CustomThemeColors> = {
  daylight: { background: "#ffffff", surface: "#ffffff", text: "#202124", accent: "#2563eb" },
  paper: { background: "#faf8f3", surface: "#fffdf8", text: "#29241f", accent: "#c15f3c" },
  celadon: { background: "#f8fbf9", surface: "#ffffff", text: "#17231f", accent: "#0e7c6b" },
  midnight: { background: "#16181d", surface: "#1e2128", text: "#f3f5f8", accent: "#4f8cff" },
  graphite: { background: "#111112", surface: "#19191b", text: "#ececee", accent: "#8e7dff" },
  ember: { background: "#1a1613", surface: "#221d19", text: "#f3eadf", accent: "#eb8a5e" },
};

export function isCustomThemeId(value: unknown): value is CustomThemeId {
  return typeof value === "string" && /^custom-[a-z0-9]{1,32}$/.test(value);
}

export function createCustomThemeId(): CustomThemeId {
  const random = Math.random().toString(36).slice(2, 8);
  return `custom-${Date.now().toString(36)}${random}`;
}

/** 接受 #rgb 或 #rrggbb,统一成小写 #rrggbb;不合法返回 null。 */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(text) ? text : null;
}

/** 从本地存储里读出的值不可信:字段不合法的主题整条丢弃,名称做长度裁剪。 */
export function parseCustomTheme(value: unknown): CustomTheme | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isCustomThemeId(raw.id)) return null;
  if (raw.scheme !== "light" && raw.scheme !== "dark") return null;
  if (typeof raw.name !== "string") return null;
  const name = raw.name.trim().slice(0, maxCustomThemeNameLength);
  if (!name) return null;
  if (!raw.colors || typeof raw.colors !== "object") return null;
  const source = raw.colors as Record<string, unknown>;
  const colors = {} as CustomThemeColors;
  for (const key of customThemeColorKeys) {
    const hex = normalizeHex(source[key]);
    if (!hex) return null;
    colors[key] = hex;
  }
  return { id: raw.id, name, scheme: raw.scheme, colors };
}

export function parseCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const themes: CustomTheme[] = [];
  for (const item of value) {
    const theme = parseCustomTheme(item);
    if (!theme || seen.has(theme.id)) continue;
    seen.add(theme.id);
    themes.push(theme);
    if (themes.length >= maxCustomThemes) break;
  }
  return themes;
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** 按 weight 把 a 混入 b(weight 为 a 的占比,0–1)。 */
function mix(a: string, b: string, weight: number): string {
  const from = toRgb(a);
  const to = toRgb(b);
  return toHex([0, 1, 2].map((i) => from[i]! * weight + to[i]! * (1 - weight)) as Rgb);
}

function alpha(hex: string, opacity: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** WCAG 相对亮度,用来挑选强调色上的文字颜色。 */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两色对比度(1–21),编辑器里用来提示正文可读性。 */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * 由四个基础色推导出主题变量。输出全是具体的 hex / rgba 值:
 * 终端(xterm)和画布组件直接读取这些变量,不能解析 color-mix。
 * 没有写出的变量(状态色、工具色、阴影等)沿用 data-scheme 对应的内置值。
 */
export function customThemeVars(theme: Pick<CustomTheme, "scheme" | "colors">): Record<string, string> {
  const { background, surface, text, accent } = theme.colors;
  const dark = theme.scheme === "dark";
  const code = mix(text, background, 0.05);
  return {
    "--bg-sidebar-glass": alpha(mix(text, background, 0.05), dark ? 0.6 : 0.55),
    "--bg-sidebar-hover": alpha(text, dark ? 0.06 : 0.05),
    "--bg-sidebar-active": surface,
    "--bg-chat": background,
    "--bg-chat-bubble-user": mix(accent, background, dark ? 0.18 : 0.1),
    "--bg-card-surface": surface,
    "--bg-surface-subtle": mix(text, background, 0.04),
    "--bg-elevated": surface,
    "--bg-code": code,
    "--bg-hover": mix(text, background, 0.07),
    "--scrollbar-thumb": alpha(text, 0.16),
    "--border-subtle": alpha(text, dark ? 0.09 : 0.1),
    "--border-strong": mix(text, background, 0.2),
    "--overlay": dark ? "rgba(0, 0, 0, 0.5)" : alpha(text, 0.2),
    "--text-primary": text,
    "--text-secondary": mix(text, background, 0.82),
    "--text-muted": mix(text, background, 0.62),
    "--text-dim": mix(text, background, 0.42),
    "--accent-blue": accent,
    "--accent-blue-hover": dark ? mix(accent, "#ffffff", 0.85) : mix(accent, "#000000", 0.85),
    "--accent-contrast": luminance(accent) > 0.5 ? "#111318" : "#ffffff",
    "--term-bg": code,
    "--term-fg": text,
    "--term-cmd": text,
    "--syntax-fg": text,
    "--syntax-comment": mix(text, background, 0.45),
  };
}
