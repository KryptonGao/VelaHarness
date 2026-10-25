import type { ToolPlanItem } from "@vela/shared";
import type { OrbActivity } from "./components/jump-orb";
import type { UiMessage } from "./hooks/useSession";

/** 运行视图状态条显示的步骤类型。 */
export type RunStepKind = "thinking" | "writing" | "command" | "reading" | "editing" | "creating" | "searching" | "subagent" | "todos" | "working";

/** 提交待办清单的两个工具:运行视图的 update_todos,以及已批准方案的 update_plan。 */
const todoTools = new Set(["update_todos", "update_plan"]);

const toolKinds: Record<string, RunStepKind> = {
  bash: "command",
  read: "reading",
  edit: "editing",
  write: "creating",
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

/** 状态条里的一步:类型,加上标识(运行中的工具用 id,其余用类型),用来判断是不是同一步。 */
export interface RunStepSignal {
  kind: RunStepKind;
  key: string;
}

/** 正在进行的一步:有工具在跑按工具分类,否则没写出正文是思考,正文在流式输出是撰写。 */
export function runStepSignal(message: UiMessage | undefined): RunStepSignal {
  if (!message) return { kind: "thinking", key: "step:thinking" };
  const running = [...message.tools].reverse().find((tool) => tool.status === "running");
  if (running) return { kind: toolKinds[running.name] ?? "working", key: `tool:${running.id}` };
  // 工具都已结束的消息说明这一步的回复早就写完了，正在等下一次模型响应，属于思考，不是撰写。
  if (message.tools.length > 0) return { kind: "thinking", key: "step:thinking" };
  return message.text.trim() ? { kind: "writing", key: "step:writing" } : { kind: "thinking", key: "step:thinking" };
}

/** 命令类步骤的冷却:命令撑过这么久才显示「运行命令」,一闪而过的命令不换标签。 */
export const runStepCooldownMs = 600;

/** 需要等冷却的步骤类型。 */
const cooledStepKinds = new Set<RunStepKind>(["command"]);

/** 状态条当前显示的步骤;pending 是还在等冷却的命令,冷却作废时整个丢掉。 */
export interface RunStepDisplay {
  kind: RunStepKind;
  key: string;
  pending?: { kind: RunStepKind; key: string; deadline: number };
}

/** 状态条的初始状态:命令类步骤从零开始等冷却,中途切到运行视图也不会直接闪出「运行命令」。 */
export function initialRunStepDisplay(step: RunStepSignal, now: number): RunStepDisplay {
  return advanceRunStep({ kind: "thinking", key: "step:thinking" }, step, now);
}

/**
 * 推进状态条:普通步骤立即切换;命令先挂起 cooldownMs,同一命令到点才显示。
 * 冷却期间命令结束(或换成别的步骤)就作废,所以极短的命令永远看不到「运行命令」。
 */
export function advanceRunStep(
  current: RunStepDisplay,
  step: RunStepSignal,
  now: number,
  cooldownMs: number = runStepCooldownMs,
): RunStepDisplay {
  const pending = current.pending;
  if (pending && step.key === pending.key) {
    return now >= pending.deadline ? { kind: pending.kind, key: pending.key } : current;
  }
  // 命令在冷却内结束,或已经在看别的步骤:丢弃挂起,按新步骤照常显示。
  const shown: RunStepDisplay = { kind: current.kind, key: current.key };
  if (step.key === shown.key) return shown;
  if (cooledStepKinds.has(step.kind)) return { ...shown, pending: { kind: step.kind, key: step.key, deadline: now + cooldownMs } };
  return { kind: step.kind, key: step.key };
}

/** 两个状态在界面上是否等价;定时器到点后据此决定要不要重新渲染。 */
export function sameRunStepDisplay(a: RunStepDisplay, b: RunStepDisplay): boolean {
  return a.kind === b.kind && a.key === b.key && a.pending?.key === b.pending?.key && a.pending?.deadline === b.pending?.deadline;
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
