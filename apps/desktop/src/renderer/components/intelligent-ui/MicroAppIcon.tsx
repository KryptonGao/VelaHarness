import { isUiAppIconName, type UiAppBlock } from "@vela/shared";
import { Icon, type IconSize } from "../icons";

/** 微应用默认复用窗口布局图标；模型只能选择协议白名单中的图标。 */
export function MicroAppIcon({ app, size }: { app: Pick<UiAppBlock, "icon">; size?: IconSize }) {
  const { icon } = app;
  return <Icon name={isUiAppIconName(icon) ? icon : "visual"} size={size} />;
}
