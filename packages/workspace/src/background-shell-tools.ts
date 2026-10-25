import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { backgroundReadLimitChars, type BackgroundShellInfo, type BackgroundShellManager } from "./background-shells";

const backgroundGuidance =
  "Set run_in_background to true for commands that run long or never exit (dev servers, watchers, long builds or test suites): it returns a shell id immediately and the command keeps running while you continue other work. Read new output with bash_output and stop it with bash_kill. You are woken automatically with the result when it exits, so do not poll in a loop.";

/**
 * 给 bash 加上 run_in_background：前台调用原样走 Pi 的实现，后台调用先过同一道权限门，
 * 再交给 BackgroundShellManager 启动并立刻返回。
 */
export function withBackgroundOption(
  tool: ToolDefinition,
  cwd: string,
  manager: BackgroundShellManager,
  conversationId: string,
  authorize: (command: string, cwd: string, signal?: AbortSignal) => Promise<void>,
): ToolDefinition {
  const base = tool.parameters as unknown as { properties: Record<string, never> };
  return defineTool({
    ...tool,
    description: `${tool.description} ${backgroundGuidance}`,
    parameters: Type.Object({
      ...base.properties,
      run_in_background: Type.Optional(Type.Boolean({ description: "Run the command in the background and return a shell id immediately" })),
    }),
    // 后台启动的结果没有退出码和耗时，不满足原有的结构化输出约定。
    outputSchema: undefined,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { run_in_background: background, ...rest } = params as { command: string; timeout?: number; run_in_background?: boolean };
      if (!background) return tool.execute(toolCallId, rest, signal, onUpdate, ctx);
      const workingDirectory = ctx.cwd || cwd;
      await authorize(rest.command, workingDirectory, signal);
      const info = manager.start({ conversationId, command: rest.command, cwd: workingDirectory, ...(rest.timeout ? { timeout: rest.timeout } : {}) });
      return {
        content: [{
          type: "text",
          text: `Started background shell ${info.id}. It keeps running while you continue.\nUse bash_output with shell_id "${info.id}" to read new output, and bash_kill to stop it. You will be notified automatically when it exits.`,
        }],
        details: { backgroundShell: info },
      };
    },
  } as ToolDefinition);
}

const outputSchema = Type.Object({
  shell_id: Type.String({ description: "The shell id returned when the command was started with run_in_background" }),
  wait: Type.Optional(Type.Number({ description: "Seconds to wait for the command to exit before reading (optional, default 0, max 600). Returns early when it exits." })),
});

const killSchema = Type.Object({
  shell_id: Type.String({ description: "The shell id of the background command to stop" }),
});

export function createBackgroundShellTools(manager: BackgroundShellManager, conversationId: string): ToolDefinition[] {
  const bashOutput = defineTool({
    name: "bash_output",
    label: "bash_output",
    description:
      "Read the output a background shell produced since the last read, together with its status. Use wait to block until it exits or the wait elapses.",
    promptSnippet: "Read new output and status of a background shell started with bash run_in_background",
    parameters: outputSchema,
    async execute(_toolCallId, params, signal) {
      const read = await manager.read(conversationId, params.shell_id, { wait: params.wait, signal });
      return {
        content: [{ type: "text", text: formatRead(read.info, read.output, read.truncated) }],
        details: { backgroundShell: read.info },
      };
    },
  });
  const bashKill = defineTool({
    name: "bash_kill",
    label: "bash_kill",
    description: "Stop a background shell and its child processes. Does nothing if it already exited.",
    promptSnippet: "Stop a background shell started with bash run_in_background",
    parameters: killSchema,
    async execute(_toolCallId, params) {
      const killed = await manager.kill(conversationId, params.shell_id);
      const info = manager.list(conversationId).find((shell) => shell.id === params.shell_id);
      return {
        content: [{ type: "text", text: killed ? `Stopped background shell ${params.shell_id}.` : `Background shell ${params.shell_id} had already exited.` }],
        details: info ? { backgroundShell: info } : undefined,
      };
    },
  });
  return [bashOutput, bashKill] as ToolDefinition[];
}

export function describeShellStatus(info: BackgroundShellInfo): string {
  if (info.status === "running") return "running";
  if (info.status === "exited") return `exited with code ${info.exitCode ?? "unknown"}`;
  if (info.status === "timed_out") return "stopped: timed out";
  return info.status;
}

function formatRead(info: BackgroundShellInfo, output: string, truncated: boolean): string {
  const header = `shell ${info.id} (${describeShellStatus(info)}): ${info.command}`;
  if (!output) return `${header}\n\n(no new output)`;
  const note = truncated ? `[Output was cut; showing the last ${backgroundReadLimitChars} characters of what is unread.]\n` : "";
  return `${header}\n\n${note}${output}`;
}
