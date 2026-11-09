import type { ToolTrace } from "@vela/shared";
import { tr } from "../locale";
import { toolCompactKind, type CompactKind } from "./tool-compact";
import { bashIntentDisplay } from "./bash-intent-label";

export interface ThinkingActivity {
  kind: CompactKind | "tools";
  title: string;
  label: string;
  tool: ToolTrace;
}

/** Show the latest running call, not a completed call or its output. */
export function thinkingActivity(tools: readonly ToolTrace[], live: boolean): ThinkingActivity | null {
  if (!live) return null;
  const tool = tools.findLast((tool) => tool.status === "running");
  if (!tool) return null;
  const kind = toolCompactKind(tool.name) ?? "tools";
  const labels = {
    read: () => tr("正在读取", "Reading"),
    edit: () => tr("正在编辑", "Editing"),
    write: () => tr("正在创建", "Creating"),
    bash: () => tr("正在运行命令", "Running commands"),
    tools: () => tr("正在使用工具", "Using tools"),
  };
  const detail = kind === "bash" ? tool.activity.command
    : kind !== "tools" ? tool.activity.path
    : [tool.activity.mcp ? `${tool.activity.mcp.server} / ${tool.activity.mcp.tool}` : tool.name,
      tool.activity.command || tool.activity.path].filter(Boolean).join(" · ");
  const normalized = detail?.replace(/\s+/g, " ").trim();
  const intent = kind === "bash" ? bashIntentDisplay(tool.activity.command)?.kind : undefined;
  const label = intent === "read" ? labels.read()
    : intent === "list" ? tr("正在列出目录", "Listing directory")
    : intent === "search" ? tr("正在搜索", "Searching for")
    : intent === "find" ? tr("正在查找文件", "Searching files")
    : labels[kind]();
  return { kind, tool, label, title: label + (normalized ? ` · ${normalized}` : "") };
}
