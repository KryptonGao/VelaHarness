import type { ReactNode } from "react";
import {
  FollowupTaskIcon,
  MemoryReadIcon,
  MemoryUpdateIcon,
  OutcomeIcon,
  QuestionIcon,
  ScheduleCreateIcon,
  ScheduleDeleteIcon,
  ScheduleListIcon,
  ScheduleUpdateIcon,
  SendMessageIcon,
  SubagentIcon,
  TodoListIcon,
} from "./icons";

/** 有专属图标的工具。图标按工具单独设计,颜色按类型共用(见 tool-groups)。 */
export function toolNameIcon(name: string, size = 13): ReactNode | null {
  if (name === "spawn_agent") return <SubagentIcon size={size} />;
  if (name === "send_message") return <SendMessageIcon size={size} />;
  if (name === "followup_task") return <FollowupTaskIcon size={size} />;
  if (name === "update_todos") return <TodoListIcon size={size} />;
  if (name === "submit_outcome") return <OutcomeIcon size={size} />;
  if (name === "recommend_actions") return <OutcomeIcon size={size} />;
  if (name === "ask_user_question") return <QuestionIcon size={size} />;
  if (name === "create_scheduled_task") return <ScheduleCreateIcon size={size} />;
  if (name === "list_scheduled_tasks") return <ScheduleListIcon size={size} />;
  if (name === "update_scheduled_task") return <ScheduleUpdateIcon size={size} />;
  if (name === "delete_scheduled_task") return <ScheduleDeleteIcon size={size} />;
  if (name === "memory_read") return <MemoryReadIcon size={size} />;
  if (name === "memory_update") return <MemoryUpdateIcon size={size} />;
  return null;
}
