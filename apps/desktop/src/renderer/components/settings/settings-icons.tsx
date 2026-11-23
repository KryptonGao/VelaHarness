import type { SettingsPageId } from "./settings-registry";
import { Icon, type IconName } from "../icons";

/** 设置导航里每个页面的图标(16px,继承文字颜色)。 */
const pageIcons = {
  appearance: "sun",
  interface: "sidebar",
  shortcuts: "keyboard",
  updates: "info",
  defaults: "sliders",
  approvals: "shield",
  subagents: "subagent",
  display: "chat",
  skills: "sparkles",
  models: "chip",
  integrations: "mcp",
  mcp: "server",
  web: "globe",
  hooks: "hook",
  memory: "brain",
  workspace: "folder",
  archived: "archive",
  usage: "chart-bar",
  storage: "inbox",
  logs: "document",
  development: "prompt",
} as const satisfies Record<SettingsPageId, IconName>;

export function SettingsPageIcon({ page }: { page: SettingsPageId }) {
  return <Icon name={pageIcons[page]} size={16} className="page-nav-icon" />;
}
