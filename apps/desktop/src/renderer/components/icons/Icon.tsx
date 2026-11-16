import { iconRegistry, type IconName } from "./registry.generated";

/** 界面图标只开这几个尺寸，避免各处随手写 13、15、17。 */
export const ICON_SIZES = [12, 14, 16, 18] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** 使用实心变体；该图标没有实心版时退回线性。 */
  filled?: boolean;
  className?: string;
}

/** 界面图标的唯一入口：颜色跟随 currentColor，形状来自 icons/svg 下的 MingCute 图标。 */
export function Icon({ name, size = 14, filled = false, className }: IconProps) {
  const entry = iconRegistry[name];
  const body = filled && entry.fill ? entry.fill : entry.line;
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: body }} />;
}
