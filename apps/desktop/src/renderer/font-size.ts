/**
 * 界面字号和代码字号。样式表里所有 ≤20px 的字号都写成 `calc(Npx * var(--ui-scale))`
 * （等宽字体的写成 `--code-scale`），这里只负责把设置里的 px 值换算成这两个比例。
 * 默认值对应原本的设计：回复正文 15px、聊天里的代码块 14px。
 */
export const uiFontSizeRange = { min: 11, max: 15, fallback: 15 } as const;
export const codeFontSizeRange = { min: 8, max: 24, fallback: 14 } as const;

type FontSizeRange = { min: number; max: number; fallback: number };

export function clampFontSize(range: FontSizeRange, value: number): number {
  if (!Number.isFinite(value)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** 读取存储的字号:不是整数或超出范围时回到默认值,不去猜测。 */
export function parseFontSize(range: FontSizeRange, raw: unknown): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return range.fallback;
  const value = Number(raw);
  return value >= range.min && value <= range.max ? value : range.fallback;
}

export function fontScale(range: FontSizeRange, size: number): number {
  return clampFontSize(range, size) / range.fallback;
}

export function applyFontSizes(root: HTMLElement, uiSize: number, codeSize: number): void {
  root.style.setProperty("--ui-scale", String(fontScale(uiFontSizeRange, uiSize)));
  root.style.setProperty("--code-scale", String(fontScale(codeFontSizeRange, codeSize)));
}

/** xterm 不吃 CSS,按同样的比例换算它的字号(原本 12.5px)。 */
export function terminalFontSize(root: HTMLElement): number {
  const scale = Number.parseFloat(root.style.getPropertyValue("--code-scale"));
  return Math.round(12.5 * (Number.isFinite(scale) && scale > 0 ? scale : 1) * 10) / 10;
}
