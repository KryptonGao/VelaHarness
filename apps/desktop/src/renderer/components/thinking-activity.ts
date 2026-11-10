import type { ToolTrace } from "@vela/shared";
import { tr } from "../locale";
import { toolCompactKind, type CompactKind } from "./tool-compact";

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
    read: () => tr("正在读取文件", "Reading files"),
    edit: () => tr("正在编辑文件", "Editing files"),
    write: () => tr("正在创建文件", "Creating files"),
    bash: () => tr("正在运行命令", "Running commands"),
    tools: () => tr("正在使用工具", "Using tools"),
  };
  const label = labels[kind]();
  return { kind, tool, label, title: label };
}
