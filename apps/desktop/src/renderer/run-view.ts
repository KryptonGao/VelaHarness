import type { ToolPlanItem } from "@vela/shared";
import type { OrbActivity } from "./components/jump-orb";
import type { UiMessage } from "./hooks/useSession";

/** 运行视图状态条显示的步骤类型。 */
export type RunStepKind = "thinking" | "writing" | "command" | "reading" | "editing" | "searching" | "subagent" | "todos" | "working";

/** 提交待办清单的两个工具:运行视图的 update_todos,以及已批准方案的 update_plan。 */
const todoTools = new Set(["update_todos", "update_plan"]);

const toolKinds: Record<string, RunStepKind> = {
  bash: "command",
  read: "reading",
  edit: "editing",
  write: "editing",
  apply_patch: "editing",
  web_search: "searching",
  web_fetch: "searching",
  spawn_agent: "subagent",
  followup_task: "subagent",
  send_message: "subagent",
  task: "subagent",
  update_todos: "todos",
  update_plan: "todos",
};

/** 当前这一轮的助手消息:最后一条用户消息之后的全部。 */
export function currentTurnAssistants(messages: readonly UiMessage[]): UiMessage[] {
  let start = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]!.role === "user") { start = index + 1; break; }
  }
  return messages.slice(start).filter((message) => message.role === "assistant");
}

/** 本轮最近一次提交的待办清单;还没提交时为 null。 */
export function latestTodos(messages: readonly UiMessage[]): ToolPlanItem[] | null {
  const assistants = currentTurnAssistants(messages);
  for (let index = assistants.length - 1; index >= 0; index--) {
    const tools = assistants[index]!.tools;
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex--) {
      const tool = tools[toolIndex]!;
      const plan = todoTools.has(tool.name) ? tool.activity.plan : undefined;
      if (plan && plan.length > 0) return plan;
    }
  }
  return null;
}

/** 本轮开始时间:第一条带 turnStartedAt 的助手消息。 */
export function currentTurnStartedAt(messages: readonly UiMessage[]): number | undefined {
  return currentTurnAssistants(messages).find((message) => message.turnStartedAt !== undefined)?.turnStartedAt;
}

/** 正在进行的一步:有工具在跑按工具分类,否则没写出正文是思考,正文在流式输出是撰写。 */
export function currentRunStep(message: UiMessage | undefined): RunStepKind {
  if (!message) return "thinking";
  const running = [...message.tools].reverse().find((tool) => tool.status === "running");
  if (running) return toolKinds[running.name] ?? "working";
  return message.text.trim() ? "writing" : "thinking";
}

/** 状态条的圆球样式池:思考和撰写用三点,其余(工具、子代理)用四点,与 ActivityIndicator 一致。 */
export function orbActivityOf(kind: RunStepKind): OrbActivity {
  return kind === "thinking" || kind === "writing" ? "thinking" : "command";
}

export function formatRunElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
