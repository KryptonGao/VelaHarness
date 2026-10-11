import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ResidentTask } from "@vela/shared";

/** 常驻 Agent 能读到的事项摘要。只含安全摘要，不含命令全文或对话记录。 */
export interface ResidentInboxSummary {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string;
  workspace?: string;
  updatedAt: number;
}

export type ResidentDelegateResult =
  | { ok: true; taskId: string; status: "queued" | "running" }
  | { ok: false; reason: string };

/**
 * 常驻 Agent 与宿主之间的边界。Agent 没有文件和命令工具，只能读取这些真实记录，
 * 并通过 `delegate` 请求在某个已登记工作区里启动后台任务（宿主负责审批、并发和预算）。
 */
export interface ResidentToolHost {
  workspaces(): string[];
  tasks(): ResidentTask[];
  inbox(filter: { pendingOnly: boolean; limit: number }): ResidentInboxSummary[];
  delegate(input: { workspace: string; title: string; prompt: string; signal?: AbortSignal }): Promise<ResidentDelegateResult>;
}

export const residentToolNames = ["list_workspaces", "list_background_tasks", "list_inbox_items", "delegate_workspace_task"];

export const residentInstructions = `## Resident Agent

You are Vela's resident coordinator, running in the Agent Inbox. You cannot read or write files or run commands: that work is done by background tasks in workspaces.

- When the user asks you to inspect or change a project, first use list_workspaces to find the matching workspace, then use delegate_workspace_task to create a background task. The task runs in that workspace under the user's permission settings; creating the task itself needs the user's approval in the Inbox. If it is rejected, do not retry — just tell the user.
- Do not mix content from different workspaces; each task targets exactly one workspace. The task prompt must state the goal, the scope, and the completion criteria.
- When reporting progress, results, and failures, cite only the real records returned by list_background_tasks and list_inbox_items. Do not invent statuses, counts, or durations. A task being "finished" does not mean it was "verified"; report failures and interruptions honestly.
- You are not invoked when there are no new events; do nothing just to stay online. Use ask_user_question when the user needs to decide.
- When appropriate, use the UI to present reviews, comparisons, or proposals (see the Intelligent UI notes above); the UI only displays and collects feedback and cannot approve any tool request.`;

const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} });

export function createResidentTools(host: ResidentToolHost): ToolDefinition[] {
  return [
    defineTool({
      name: "list_workspaces",
      label: "查询工作区",
      description: "List the registered workspaces where background tasks can be created.",
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        signal?.throwIfAborted();
        return result({ workspaces: host.workspaces() });
      },
    }),
    defineTool({
      name: "list_background_tasks",
      label: "查询后台任务",
      description: "List recent background tasks with their real status: queued、running、succeeded、failed、cancelled、interrupted、timed_out。",
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        signal?.throwIfAborted();
        return result({
          tasks: host.tasks().map(task => ({
            id: task.id, title: task.title, workspace: task.workspace, source: task.source, status: task.status,
            error: task.error ?? null, createdAt: task.createdAt, startedAt: task.startedAt, finishedAt: task.finishedAt,
          })),
        });
      },
    }),
    defineTool({
      name: "list_inbox_items",
      label: "查询收件箱",
      description: "List item summaries in the Agent Inbox (approvals, questions, results, failures). With pendingOnly set to true, only items waiting on the user are returned.",
      parameters: Type.Object({
        pendingOnly: Type.Optional(Type.Boolean()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      }),
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        return result({ items: host.inbox({ pendingOnly: params.pendingOnly === true, limit: params.limit ?? 20 }) });
      },
    }),
    defineTool({
      name: "delegate_workspace_task",
      label: "创建后台任务",
      description: "Create a background task in one registered workspace. Requires user approval; returns the task id and status.",
      executionMode: "sequential",
      parameters: Type.Object({
        workspace: Type.String({ minLength: 1, maxLength: 1000 }),
        title: Type.String({ minLength: 1, maxLength: 120 }),
        prompt: Type.String({ minLength: 1, maxLength: 8000 }),
      }),
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        return result(await host.delegate({ workspace: params.workspace, title: params.title, prompt: params.prompt, signal }));
      },
    }),
  ];
}
