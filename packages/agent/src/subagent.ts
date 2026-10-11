import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isToolCallEventType, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { agentToolNames, type AgentKind, type SubagentKind, type ToolStep } from "@vela/shared";
import { isPlanSafeCommand } from "./plan-command";

export const subagentOutputCap = 12_000;

export const subagentStepCap = 40;

/** agent 树工具名；root 与子代理共享同一组 API。 */
export const spawnAgentToolName = agentToolNames[0];
export const sendMessageToolName = agentToolNames[1];
export const followupTaskToolName = agentToolNames[2];
export { agentToolNames };

const explorePrompt = `You are a read-only investigation subagent. You may only read files and run inspection commands; you must not modify files.
The user message is the task to investigate. When done, reply with a concise conclusion: what you found, the relevant file paths, and the key facts. Do not paste whole files.
You can use spawn_agent to hand parts of the investigation to further read-only subagents; use send_message / followup_task to communicate with other agents in the agent tree.
You cannot see the parent conversation, and you must not ask the user questions.`;

const generalPrompt = `You are an execution subagent. You can read, edit, and run commands, with the same permissions as the current session.
The user message is the task to complete. When done, reply with a concise conclusion: what you did, which files you changed, and what remains unfinished.
You can use spawn_agent to hand work to further subagents, and send_message / followup_task to communicate with other agents in the agent tree.
You cannot see the parent conversation, and you must not ask the user questions.`;

export function agentKindPrompt(kind: SubagentKind): string {
  return kind === "explore" ? explorePrompt : generalPrompt;
}

/** explore 只拿只读工具；general 与主代理一致。agent 工具两组都有，方便子代理继续分派。 */
export function agentToolNamesFor(kind: SubagentKind): string[] {
  if (kind === "explore") return ["read", "bash", ...agentToolNames];
  return ["read", "bash", "edit", "write", ...agentToolNames];
}

const emptyNote = "子代理没有留下文字结论。";

const stoppedNote = "子代理已停止。";

const clipNote = "结论过长，已截断。";

/** 查阅子代理的 bash 只放行 Plan 模式同一套只读命令。 */
export function exploreCommandAllowed(command: string): boolean {
  return isPlanSafeCommand(command);
}

/** 子代理每次调用工具前先过暂停点；被取消时拦下这次调用，让 abort 尽快收尾。 */
export function createAgentPauseExtension(beforeToolCall: () => Promise<boolean>): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async () => {
      if (await beforeToolCall()) return undefined;
      return { block: true, reason: "子代理已被用户取消。" };
    });
  };
}

export function createExploreGuardExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      if (event.toolName === "browser_repl" || event.toolName === "browser_repl_reset") {
        return { block: true, reason: "查阅子代理不能使用 Browser REPL。" };
      }
      if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
        return { block: true, reason: "查阅子代理不能修改文件。" };
      }
      if (isToolCallEventType("bash", event) && !exploreCommandAllowed(event.input.command)) {
        return {
          block: true,
          reason: `查阅子代理只允许只读命令。\n命令: ${event.input.command}`,
        };
      }
    });
  };
}

/**
 * 子代理一回合结束后回给父代理的结论。
 * path 是 agent 树路径，让父代理知道结论来自哪个节点。
 */
export function formatAgentReport(input: {
  agent: AgentKind;
  path: string;
  text: string;
  failure: string;
  stopped: boolean;
}): { text: string; truncated: boolean } {
  const clipped = clipText(input.text.trim(), subagentOutputCap);
  const parts = [`[${input.path} · ${input.agent}]`];
  if (clipped.text) parts.push(clipped.text);
  else if (!input.stopped && !input.failure) parts.push(emptyNote);
  if (input.failure && !input.stopped) parts.push(`子代理没有完成：${input.failure}`);
  if (input.stopped) parts.push(stoppedNote);
  if (clipped.truncated) parts.push(clipNote);
  return { text: parts.join("\n\n"), truncated: clipped.truncated };
}

/** 把一条工具调用记进展示用步骤列表，并按上限裁剪。 */
export function rememberStep(steps: ToolStep[], step: ToolStep): void {
  const index = steps.findIndex((item) => item.id === step.id);
  if (index >= 0) {
    const current = steps[index];
    steps[index] = step.summary ? step : { ...step, summary: current?.summary ?? step.summary };
  } else {
    steps.push(step);
  }
  if (steps.length > subagentStepCap) steps.splice(0, steps.length - subagentStepCap);
}

export function stepSummary(toolName: string, args: unknown): string {
  const command = readString(args, "command");
  const path = readString(args, "path") ?? readString(args, "file_path");
  const summary = command ?? path ?? toolName;
  return clipText(summary.replace(/\s+/g, " ").trim(), 180).text || toolName;
}

export function lastAssistantText(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter((part) => part.trim().length > 0)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

export function clipText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}…`, truncated: true };
}

function readString(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
