import {
  defineTool,
  type AgentToolResult,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  outcomeLimits,
  type GoalStatus,
  type InteractionMode,
  type OutcomeSubmission,
} from "@vela/shared";
import { Type } from "typebox";
import { isPlanSafeCommand } from "./plan-command";
import { executionPlanItemMax, type ExecutionPlanUpdateItem } from "./plan";
import { agentToolNames } from "./subagent";
import { memoryReadToolName } from "./memory-tools";
import type { GoalValidationDraft } from "./goal-validation";

export const goalContinuePrompt =
  "Continue working on the current goal. If it is already complete, first call record_goal_validation to record the checks, then call submit_outcome for this turn's changes or verification, and finally call update_goal to set the status to complete. If it is not complete, go straight to the next step and do not repeat what has already been done.";

/** 旧英文续跑提示仍要识别为系统代发，避免重载时变成用户需求。 */
const legacyEnglishGoalContinuePrompt =
  "Continue working on the current goal. If it is already complete, first call record_goal_validation to record the checks, then call update_goal to set the status to complete. If it is not complete, go straight to the next step and do not repeat what has already been done.";

/** 旧版本写入会话文件的中文续跑提示；历史消息仍要按系统代发识别。 */
const legacyGoalContinuePrompt =
  "继续执行当前目标。若已经完成，先调用 record_goal_validation 记录检查，再调用 update_goal 将状态设为 complete。若还没完成，直接做下一步，不要重复已经做过的事。";

/** 系统代发的 Goal 续跑消息（含旧中文版本）。 */
export function isGoalContinuePrompt(text: string): boolean {
  return text === goalContinuePrompt || text === legacyEnglishGoalContinuePrompt || text === legacyGoalContinuePrompt;
}

export const goalTurnLimit = 20;

export const goalTurnLimitNote = "已达到本轮自动执行上限，可以继续；完成前仍需提交交付验证。";

const planPrompt = `You are in Plan mode. You may only inspect code; you must not modify files or run commands that change the system. You can read long-term memory with ${memoryReadToolName}, but you cannot write to it.

First understand the user's goal and proactively explore the codebase to establish the facts needed for implementation: relevant modules, data flow, interfaces, persistence, tests, and existing issues.
Anything you can find in the repository, configuration, documentation, or source code you must look up yourself; do not hand questions the repository can answer back to the user.
Use ask_user_question only for product preferences, behavior choices that cannot be inferred from the code, tradeoffs, missing requirements, and compatibility strategies that must be decided by the user.

When the plan is decision-complete — another implementing agent would not need to make any major architectural decision after receiving it — output the complete plan at the end of your reply:
<proposed_plan>
# <plan title>

## Goal

...
</proposed_plan>

State the plan title in one sentence on the first line; the UI uses it as the title of the Plan Document and the chat preview.

Write the plan in Markdown, including sections as needed such as Goal, Current Architecture, Proposed Architecture, Data Model Changes, Runtime Changes, UI Changes, Persistence / Migration, Error Handling / Edge Cases, Testing, and Implementation Steps.
Name the concrete files or modules, interfaces / classes / functions, data flow, state lifecycle, API or IPC changes, persistence and migration strategy, UI behavior, test strategy, compatibility, and edge cases; do not write a list of steps with no anchor in the code, and do not give only a diff.
If the user asks for changes to an existing plan, output the complete revised plan as a new revision; do not rewrite the old version in place.
After outputting the plan, do not use ask_user_question to ask for confirmation to execute, and do not modify files; once the plan is generated, the UI lets the user approve it, keep revising, or execute it in a fresh context.`;

const goalPrompt = `You are in Goal mode. The goal is already recorded in the conversation, and you must keep working until it is done.

You can read, edit, and run commands. After each stretch of progress, call update_goal: keep it active while you are still working and write a one-line progress note; set it to complete only when the work is truly done.
Before finishing you must call record_goal_validation. Check the diff, targeted tests, build, type check, and regressions according to the risk level; explain why any category was not run. Cite only bash tool call ids that actually completed within this goal, and never fabricate command results.
If you ran other bash commands after a check command, record them under "other" or re-run the checks after them; the runtime treats unrecorded later commands as possibly modifying the workspace.
Medium- and high-risk changes must have the diff inspected and targeted tests run; high-risk changes must also run a broader regression. After a failure, fix it and re-run, or record the failed call together with evidence that it is genuinely unrelated to this change. If you run bash, edit, write, or spawn a general subagent with spawn_agent after validation, you must validate again.
The final reply lists the checks that were run and their results, the checks that were skipped and why, and any items that still fail when completing with known issues.
Do not mark the goal complete unless the required result has been achieved. You cannot pause the goal; pausing is up to the user.
If this round is not finished, do the next thing you can do; do not stop and wait for the user to say continue.`;

const agentPlanPrompt =
  "There is an approved execution plan. Before starting, break the actual implementation into trackable items and submit them with update_plan, then keep updating them with update_plan during execution: at most one item in_progress, mark items completed when done, and add, adjust, or merge items to match the actual implementation. The execution checklist only records progress; do not use it to rewrite the approved plan. If the design needs to change, stop, explain to the user, and suggest going back to Plan mode. When you hit a decision that needs the user's call during execution, you can ask with ask_user_question.";

const outcomePrompt = `If you modified files or ran verification in this turn, call submit_outcome before writing your final reply. Submit one item per user requirement, with its actual completion status and any risks, assumptions, or decisions still needing confirmation.
Only cite files changed by completed edit/write calls and bash tool call ids completed in this turn. Leave verificationIds empty if you did not run verification; never invent files, ids, or results. If submission is rejected, correct the invalid references and retry before finishing.
In Goal mode, call record_goal_validation before submit_outcome, then update_goal to complete when appropriate. Pure questions and answers with no changes or verification do not require an outcome submission.`;

const agentTreePrompt = `When you need broad investigation or want to hand off a self-contained piece of work, use spawn_agent to start a persistent subagent: agent is explore (read-only) or general (can modify files); it returns the agent id and path immediately without waiting for the result.
name is the last segment of the path (such as backend); fork decides how much of the current context the subagent inherits: none inherits nothing (default), all inherits everything, and a number means the most recent N turns.
When a subagent finishes, its conclusion is delivered back to you automatically; use followup_task to wait for it when you need the result to continue, and send_message when you are only adding requirements.
You can spawn several subagents in parallel, but note that they modify the workspace concurrently; do not spawn a subagent for simple single-file reads or writes. State the goal, scope, and completion criteria clearly in the task, and do not repeat the subagent's process verbatim to the user.`;

const workTools = ["read", "bash", "edit", "write", ...agentToolNames];

export function toolNamesFor(mode: InteractionMode, hasExecutionPlan: boolean): string[] {
  if (mode === "plan") return ["read", "bash", "ask_user_question"];
  if (mode === "goal") return [...workTools, "record_goal_validation", "submit_outcome", "update_goal"];
  return hasExecutionPlan
    ? [...workTools, "update_plan", "submit_outcome", "ask_user_question"]
    : [...workTools, "submit_outcome", "ask_user_question"];
}

export function modeSystemPrompt(mode: InteractionMode, hasExecutionPlan: boolean): string {
  if (mode === "plan") return planPrompt;
  if (mode === "goal") return `${goalPrompt}\n\n${outcomePrompt}\n\n${agentTreePrompt}`;
  return [hasExecutionPlan ? agentPlanPrompt : "", outcomePrompt, agentTreePrompt].filter(Boolean).join("\n\n");
}

// ---------- Tool policy ----------

/**
 * 区分「工具是否提供给模型」和「Runtime 最终是否允许执行」。
 * availableTools 决定注册后激活哪些工具；authorizeCall 是执行前的最后一道闸。
 */
export interface ToolPolicyCall {
  mode: InteractionMode;
  toolName: string;
  input: unknown;
}

export type ToolAuthorizationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface ToolPolicy {
  availableTools(mode: InteractionMode, hasExecutionPlan: boolean): string[];
  authorizeCall(call: ToolPolicyCall): ToolAuthorizationResult;
}

const planAllowedTools = new Set(["read", "bash", "ask_user_question", memoryReadToolName]);
const planDeniedTools = new Set(["edit", "write", "apply_patch"]);

export class DefaultToolPolicy implements ToolPolicy {
  availableTools(mode: InteractionMode, hasExecutionPlan: boolean): string[] {
    return toolNamesFor(mode, hasExecutionPlan);
  }

  authorizeCall(call: ToolPolicyCall): ToolAuthorizationResult {
    if (call.mode !== "plan") return { allowed: true };
    if (!planAllowedTools.has(call.toolName)) {
      if (planDeniedTools.has(call.toolName)) {
        return { allowed: false, reason: "Plan 模式不能修改文件。先提交计划，等用户批准后再执行。" };
      }
      return { allowed: false, reason: `Plan 模式不允许调用 ${call.toolName}。` };
    }
    if (call.toolName === "bash") {
      const command = bashCommandOf(call.input);
      if (!command) return { allowed: false, reason: "Plan 模式只能运行查阅类命令。" };
      if (!isPlanSafeCommand(command)) {
        return { allowed: false, reason: `Plan 模式只允许查阅命令。\n命令: ${command}` };
      }
    }
    return { allowed: true };
  }
}

export const defaultToolPolicy = new DefaultToolPolicy();

function bashCommandOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" && command.trim() ? command : null;
}

export interface ModeState {
  mode: InteractionMode;
  hasExecutionPlan: boolean;
}

export function createModeExtension(
  read: () => ModeState,
  policy: ToolPolicy = defaultToolPolicy,
): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", async (event) => {
      const state = read();
      const extra = modeSystemPrompt(state.mode, state.hasExecutionPlan);
      if (!extra) return;
      const current = event.systemPromptOptions.appendSystemPrompt.trim();
      event.systemPromptOptions.appendSystemPrompt = current ? `${current}\n\n${extra}` : extra;
    });

    pi.on("tool_call", async (event) => {
      const result = policy.authorizeCall({
        mode: read().mode,
        toolName: event.toolName,
        input: event.input,
      });
      if (result.allowed) return;
      return { block: true, reason: result.reason };
    });
  };
}

export type ToolOutcome = { ok: true; text: string } | { ok: false; text: string };

/**
 * createModeTools 提供的全部自定义工具名。
 * Pi 的 createAgentSession 把 tools 参数当作注册表白名单(内置与自定义都过滤),
 * 这些名字必须并入 tools,否则工具进不了注册表,setActiveToolsByName 会静默忽略。
 */
export const modeToolNames = ["update_plan", "update_goal", "record_goal_validation", "submit_outcome", "ask_user_question"];

export interface AskUserInput {
  toolCallId: string;
  question: string;
  options: { label: string; description?: string }[];
  /** 用户点停止时立刻了结提问,不悬挂到用户回答。 */
  signal: AbortSignal | undefined;
}

export interface ModeToolHost {
  updateExecutionPlan(items: ExecutionPlanUpdateItem[]): ToolOutcome;
  updateGoal(status: Extract<GoalStatus, "active" | "complete">, note: string | null): ToolOutcome;
  recordGoalValidation(draft: GoalValidationDraft): ToolOutcome;
  submitOutcome(draft: OutcomeSubmission): ToolOutcome;
  askUser(input: AskUserInput): Promise<AskUserOutcome>;
}

/** askUser 的结果。answer 随工具 details 透出,供界面在已回答的卡片上展示。 */
export type AskUserOutcome =
  | { ok: true; text: string; answer: string | null }
  | { ok: false; text: string };

export function createModeTools(host: ModeToolHost): ToolDefinition[] {
  const submitOutcome = defineTool({
    name: "submit_outcome",
    label: "提交成果验收",
    description:
      "Submit one outcome item per user requirement before the final reply when this turn changed files or ran verification. Attribute only files changed by completed edit/write calls and completed bash tool call ids from this turn. The runtime validates references; correct rejected references and retry. In Goal mode, record_goal_validation must come first. Do not fabricate evidence; leave verificationIds empty when no verification was run.",
    promptSnippet: "Submit requirement outcomes, changed files, completed bash ids, and items to confirm",
    executionMode: "sequential",
    parameters: Type.Object({
      items: Type.Array(
        Type.Object({
          requirement: Type.String({ minLength: 1, maxLength: outcomeLimits.itemLength, description: "One user requirement" }),
          status: Type.Union([Type.Literal("done"), Type.Literal("partial"), Type.Literal("not_done")]),
          files: Type.Array(Type.String({ minLength: 1, maxLength: outcomeLimits.pathLength }), {
            maxItems: outcomeLimits.maxFiles, description: "Changed file paths relative to the workspace",
          }),
          verificationIds: Type.Array(Type.String({ minLength: 1, maxLength: outcomeLimits.idLength }), {
            maxItems: outcomeLimits.maxVerifications, description: "Completed bash tool call ids from this turn; empty if no verification was run",
          }),
          toConfirm: Type.Array(Type.String({ minLength: 1, maxLength: outcomeLimits.itemLength }), {
            maxItems: outcomeLimits.maxConfirmations, description: "Risks, assumptions, and decisions for the user to confirm",
          }),
        }),
        { minItems: 1, maxItems: outcomeLimits.maxItems },
      ),
      summary: Type.Optional(Type.String({ maxLength: outcomeLimits.itemLength })),
    }),
    execute: async (_toolCallId, params) => outcome(host.submitOutcome(params)),
  });

  const updatePlan = defineTool({
    name: "update_plan",
    label: "更新执行清单",
    description:
      "Update the current execution checklist. Submit the complete checklist matching the actual implementation: at most one item in_progress, completed items marked completed, and items may be added, adjusted, or merged. It only records progress; do not use it to rewrite the approved plan.",
    promptSnippet: "Update the execution checklist (list of step + status)",
    executionMode: "sequential",
    parameters: Type.Object({
      plan: Type.Array(
        Type.Object({
          step: Type.String({ description: "One execution item" }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
        }),
        { description: "The complete checklist in execution order", minItems: 1, maxItems: executionPlanItemMax },
      ),
    }),
    execute: async (_toolCallId, params) =>
      outcome(host.updateExecutionPlan(params.plan as ExecutionPlanUpdateItem[])),
  });

  const updateGoal = defineTool({
    name: "update_goal",
    label: "更新目标",
    description: "Update the current goal. Keep it active while still working and write a one-line progress note; set it to complete only when truly done. It cannot be used to pause.",
    promptSnippet: "Set the goal status to active or complete",
    executionMode: "sequential",
    parameters: Type.Object({
      status: Type.Union([Type.Literal("active"), Type.Literal("complete")]),
      note: Type.Optional(Type.String({ description: "A one-line progress note" })),
    }),
    execute: async (_toolCallId, params) => outcome(host.updateGoal(params.status, params.note ?? null)),
  });

  const category = Type.Union([
    Type.Literal("diff"),
    Type.Literal("test"),
    Type.Literal("build"),
    Type.Literal("typecheck"),
    Type.Literal("regression"),
    Type.Literal("other"),
  ]);
  const recordGoalValidation = defineTool({
    name: "record_goal_validation",
    label: "记录验证",
    description:
      "Submit the delivery validation for the current Goal. Check results must cite bash tool call ids completed within this goal; the runtime reads the command, status, and output from the actual results. Other bash commands run after a check must be categorized as other, or the checks must be re-run after them. Give a reason for every category of check that was not run.",
    promptSnippet: "Record the Goal's check commands, actual results, and skip reasons",
    executionMode: "sequential",
    parameters: Type.Object({
      risk: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
      checks: Type.Array(
        Type.Object({
          category,
          toolCallId: Type.String({ description: "Id of a completed bash tool call" }),
        }),
        { description: "Checks that were actually run, with their tool call ids" },
      ),
      skipped: Type.Array(
        Type.Object({
          category,
          reason: Type.String({ description: "Reason it was not run; diff/test for medium- and high-risk changes and regression for high-risk changes cannot be skipped" }),
        }),
        { description: "Check categories that were explicitly not run, with reasons" },
      ),
      knownIssues: Type.Array(
        Type.Object({
          toolCallId: Type.String({ description: "Id of the failed bash tool call" }),
          reason: Type.String({ description: "Evidence that the failure is unrelated to this change" }),
        }),
        { description: "Failed checks accepted when completing with known issues; list only the latest checks that still fail" },
      ),
    }),
    execute: async (_toolCallId, params) => outcome(host.recordGoalValidation(params as GoalValidationDraft)),
  });

  const askUserQuestion = defineTool({
    name: "ask_user_question",
    label: "提问",
    description:
      "Ask the user about a key decision and wait for the answer. You can offer 2-4 options to pick from; the user can also type freely or skip. Do not use it for trivial matters.",
    promptSnippet: "Ask the user a question (question + options) and continue after the answer",
    parameters: Type.Object({
      question: Type.String({ description: "The question to ask the user, stated clearly in one sentence" }),
      options: Type.Optional(
        Type.Array(
          Type.Object({
            label: Type.String({ description: "Option text, short" }),
            description: Type.Optional(Type.String({ description: "Additional explanation for the option" })),
          }),
          { description: "2-4 options; if omitted, the user answers freely", minItems: 2, maxItems: 4 },
        ),
      ),
    }),
    execute: async (toolCallId, params, signal) => {
      const result = await host.askUser({
        toolCallId,
        question: params.question,
        options: params.options ?? [],
        signal,
      });
      if (!result.ok) throw new Error(result.text);
      return {
        content: [{ type: "text", text: result.text }],
        details: { answer: result.answer },
      };
    },
  });

  return [updatePlan, updateGoal, recordGoalValidation, submitOutcome, askUserQuestion];
}

function outcome(result: ToolOutcome): AgentToolResult<undefined> {
  if (!result.ok) throw new Error(result.text);
  return {
    content: [{ type: "text", text: result.text }],
    details: undefined,
  };
}
