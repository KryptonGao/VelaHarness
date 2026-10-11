import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { thinkingLevels, type ScheduledTaskService } from "@vela/shared";

export const scheduledTaskToolNames = ["create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task"];
export const scheduledTaskInstructions = `When the user asks for a reminder or task in the future, use the Scheduled Tasks tools to create a persistent task; never claim it was created without calling the tool.
Convert natural language into once / daily / weekly / cron, and keep what the user wants executed at the scheduled time as the prompt; for example "remind me to review English every night at 10" maps to daily time=22:00.
One-time times must be ISO 8601 with a time zone; recurring tasks must have an IANA timezone, with Sunday = 0. Resolve relative times against the current system time.
Each run creates a new conversation in the workspace bound to the current conversation, and AgentRuntime executes the prompt there. Runs cannot happen while the app is closed or the computer is asleep; after recovery, missedPolicy decides whether to run once to catch up or skip. Interrupted runs are not replayed automatically.
When the user specifies execution permissions, a model, or a reasoning effort, save them as sandboxMode, model (provider/id), and thinkingLevel respectively; when unspecified or null, the app settings apply. Never raise execution permissions on your own.
Query the real task ID before modifying or deleting. Create a task only when the user asks for a persistent scheduled task; an ordinary "we could do this later" is not authorization.`;

const schedule = Type.Union([
  Type.Object({ kind: Type.Literal("once"), at: Type.String() }),
  Type.Object({ kind: Type.Literal("daily"), time: Type.String(), timezone: Type.String() }),
  Type.Object({ kind: Type.Literal("weekly"), time: Type.String(), weekdays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1 }), timezone: Type.String() }),
  Type.Object({ kind: Type.Literal("cron"), expression: Type.String(), timezone: Type.String() }),
]);
const fields = {
  title: Type.String({ minLength: 1, maxLength: 200 }), prompt: Type.String({ minLength: 1, maxLength: 100000 }), schedule,
  sandboxMode: Type.Optional(Type.Union([Type.Literal("ask"), Type.Literal("smart"), Type.Literal("full"), Type.Null()])),
  model: Type.Optional(Type.Union([Type.Object({ provider: Type.String({ minLength: 1, maxLength: 200 }), id: Type.String({ minLength: 1, maxLength: 500 }) }), Type.Null()])),
  thinkingLevel: Type.Optional(Type.Union([...thinkingLevels.map(level => Type.Literal(level)), Type.Null()])),
  missedPolicy: Type.Optional(Type.Union([Type.Literal("run-once"), Type.Literal("skip")])),
};
export function createScheduledTaskTools(service: ScheduledTaskService, cwd: string, allowed: () => boolean): ToolDefinition[] {
  const guard = (signal?: AbortSignal) => { signal?.throwIfAborted(); if (!allowed()) throw new Error("Plan 模式不能修改定时任务"); };
  const own = (id: string) => { if (!service.list(cwd).tasks.some(task => task.id === id)) throw new Error("当前工作区没有这个任务"); };
  const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} });
  return [defineTool({
    name: "create_scheduled_task", label: "创建定时任务", description: "Save a future reminder or recurring task that the user explicitly asked for to the current workspace.", executionMode: "sequential",
    parameters: Type.Object(fields),
    async execute(_id, params, signal) { guard(signal); return result(await service.create({ ...params, workspace: cwd })); },
  }), defineTool({
    name: "list_scheduled_tasks", label: "查询定时任务", description: "List the current workspace's tasks, their next run times, and run history.",
    parameters: Type.Object({}), execute: async (_id, _params, signal) => { signal?.throwIfAborted(); return result(service.list(cwd)); },
  }), defineTool({
    name: "update_scheduled_task", label: "修改定时任务", description: "Modify a task in the current workspace by its real ID; status=paused pauses it and active resumes it.", executionMode: "sequential",
    parameters: Type.Object({ id: Type.String(), title: Type.Optional(fields.title), prompt: Type.Optional(fields.prompt), schedule: Type.Optional(schedule), missedPolicy: fields.missedPolicy, sandboxMode: fields.sandboxMode, model: fields.model, thinkingLevel: fields.thinkingLevel, status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused")])) }),
    async execute(_call, params, signal) { guard(signal); own(params.id); const { id, ...patch } = params; return result(await service.update(id, { ...patch, workspace: cwd })); },
  }), defineTool({
    name: "delete_scheduled_task", label: "删除定时任务", description: "Delete a task the user specified in the current workspace, along with its run history, by its real ID.", executionMode: "sequential",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_call, params, signal) { guard(signal); own(params.id); await service.delete(params.id); return result({ deleted: params.id }); },
  })];
}
