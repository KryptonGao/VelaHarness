/**
 * 四边玻璃(侧栏、顶栏、窄边)上叠色的不透明度,单位是百分比。
 * 没有自定义时用各染色自己的默认值,CSS 里 `--glass-opacity` 不设,走 02-base.css 里同样的回退值;
 * 这里的默认值必须与那些回退值一致,滑块才能显示出当前真实的不透明度。
 */
export const glassOpacityRange = { min: 0, max: 100 } as const;

export type GlassTintKind = "theme" | "neutral" | "none";

export function defaultGlassOpacity(tint: GlassTintKind, scheme: "light" | "dark"): number {
  if (tint === "neutral" || tint === "none") return scheme === "dark" ? 62 : 60;
  return scheme === "dark" ? 85 : 55;
}

/** 「不染色」在亮色下没有叠色层,不透明度无从调节;深色下它回退为黑色叠色,可以调。 */
export function glassOpacityApplies(tint: GlassTintKind, scheme: "light" | "dark"): boolean {
  return !(tint === "none" && scheme === "light");
}

export function clampGlassOpacity(value: number): number {
  if (!Number.isFinite(value)) return glassOpacityRange.max;
  return Math.min(glassOpacityRange.max, Math.max(glassOpacityRange.min, Math.round(value)));
}

/** 读取存储值:不是 0–100 的整数就当作没有自定义,不去猜测。 */
export function parseGlassOpacity(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= glassOpacityRange.min && value <= glassOpacityRange.max ? value : null;
}

export function applyGlassOpacity(root: HTMLElement, opacity: number | null): void {
  if (opacity === null) root.style.removeProperty("--glass-opacity");
  else root.style.setProperty("--glass-opacity", String(clampGlassOpacity(opacity) / 100));
}
