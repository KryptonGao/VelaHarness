import { useUnifiedIcons } from "../../hooks/useUnifiedIcons";
import { classicGlyphs } from "./classic-glyphs";
import { iconRegistry, type IconName } from "./registry.generated";

/** 界面图标只开这几个尺寸，避免各处随手写 11、13、15、17。 */
export const ICON_SIZES = [10, 12, 14, 16, 18, 20, 24, 28] as const;
export type IconSize = (typeof ICON_SIZES)[number];

/** 把任意像素值归到不小于它的最近一档；超过最大档时取最大档。用于尺寸由外部传入的包装组件。 */
export function snapIconSize(px: number): IconSize {
  return ICON_SIZES.find((size) => size >= px) ?? ICON_SIZES[ICON_SIZES.length - 1];
}

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** 使用实心变体；该图标没有实心版时退回线性。 */
  filled?: boolean;
  className?: string;
  /** 强制使用某一套图标，不看「统一图标」设置；预览和测试用。 */
  variant?: "classic" | "unified";
}

/**
 * 界面图标的唯一入口，颜色跟随 currentColor。
 * 「统一图标」设置关闭（默认）时用原版手绘图标（classic-glyphs.ts），开启后用 icons/svg 下的 MingCute 图标。
 */
export function Icon({ name, size = 14, filled = false, className, variant }: IconProps) {
  const unifiedSetting = useUnifiedIcons();
  const unified = (variant ?? (unifiedSetting ? "unified" : "classic")) === "unified";
  let viewBox = "0 0 24 24";
  let body: string;
  let solid: boolean;
  if (unified) {
    const entry = iconRegistry[name];
    solid = filled && entry.fill !== undefined;
    body = solid ? entry.fill! : entry.line;
  } else {
    const glyph = classicGlyphs[name];
    solid = filled && glyph.fill !== undefined;
    body = solid ? glyph.fill! : glyph.line;
    viewBox = solid ? glyph.fillViewBox ?? glyph.viewBox : glyph.viewBox;
  }
  return <svg className={className} data-icon={name} data-filled={solid || undefined} width={size} height={size} viewBox={viewBox} fill="none" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: body }} />;
}
