import type { ReactNode } from "react";
import { Icon, snapIconSize } from "./icons";

/** 有专属图标的工具。图标按工具单独设计,颜色按类型共用(见 tool-groups)。 */
export function toolNameIcon(name: string, size = 13): ReactNode | null {
  if (name === "spawn_agent") return <Icon name="subagent" size={snapIconSize(size)} />;
  if (name === "send_message") return <Icon name="send" size={snapIconSize(size)} />;
  if (name === "followup_task") return <Icon name="followup" size={snapIconSize(size)} />;
  if (name === "update_todos") return <Icon name="todo-list" size={snapIconSize(size)} />;
  if (name === "submit_outcome") return <Icon name="outcome" size={snapIconSize(size)} />;
  if (name === "recommend_actions") return <Icon name="outcome" size={snapIconSize(size)} />;
  if (name === "ask_user_question") return <Icon name="question" size={snapIconSize(size)} />;
  if (name === "show_visual") return <Icon name="visual" size={snapIconSize(size)} />;
  if (name === "create_scheduled_task") return <Icon name="schedule-create" size={snapIconSize(size)} />;
  if (name === "list_scheduled_tasks") return <Icon name="schedule-list" size={snapIconSize(size)} />;
  if (name === "update_scheduled_task") return <Icon name="schedule-update" size={snapIconSize(size)} />;
  if (name === "delete_scheduled_task") return <Icon name="schedule-delete" size={snapIconSize(size)} />;
  if (name === "memory_read") return <Icon name="memory-read" size={snapIconSize(size)} />;
  if (name === "memory_update") return <Icon name="memory-update" size={snapIconSize(size)} />;
  return null;
}
