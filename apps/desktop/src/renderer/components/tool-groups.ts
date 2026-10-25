import { isAgentToolName } from "@vela/shared";

/** 工具按类型分组:同一组的卡片图标和「已启用工具」芯片共用一个颜色。 */
export type ToolGroup = "agent" | "flow" | "schedule" | "memory" | "web" | "bash" | "read" | "edit" | "write";

const flowTools = new Set(["update_todos", "submit_outcome", "recommend_actions", "ask_user_question"]);
const scheduleTools = new Set(["create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task"]);
const memoryTools = new Set(["memory_read", "memory_update"]);
const webTools = new Set(["web_search", "web_fetch"]);
const fileTools = new Set<string>(["bash", "read", "edit", "write"]);

export function toolGroupOf(name: string): ToolGroup | null {
  if (isAgentToolName(name)) return "agent";
  if (flowTools.has(name)) return "flow";
  if (scheduleTools.has(name)) return "schedule";
  if (memoryTools.has(name)) return "memory";
  if (webTools.has(name)) return "web";
  if (fileTools.has(name)) return name as ToolGroup;
  return null;
}

/** 通用卡片自带配色的分组;文件类、网页和子代理另有各自的卡片样式。 */
export function cardToolGroup(name: string): "flow" | "schedule" | "memory" | null {
  const group = toolGroupOf(name);
  return group === "flow" || group === "schedule" || group === "memory" ? group : null;
}
