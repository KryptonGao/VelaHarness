import {
  defineTool,
  type AgentToolResult,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  outcomeLimits,
  recommendedActionLimits,
  recommendedActionsToolName,
  type ConversationGoal,
  type GoalValidation,
  type GoalStatus,
  type InteractionMode,
  type OutcomeSubmission,
  type RecommendedActions,
} from "@vela/shared";
import { Type } from "typebox";
import { isPlanSafeCommand } from "./plan-command";
import { executionPlanItemMax, type ExecutionPlanUpdateItem } from "./plan";
import { agentToolNames } from "./subagent";
import { memoryReadToolName } from "./memory-tools";
import { webToolNames } from "./web-tools";
import type { GoalValidationDraft } from "./goal-validation";

export const goalContinuePrompt =
  "Continue working on the current goal. If it is already complete, first call record_goal_validation to record the checks, then optionally call submit_outcome to summarize this turn's changes or verification, and finally call update_goal to set the status to complete. If it is not complete, go straight to the next step and do not repeat what has already been done.";

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

/** 运行视图模式下的待办清单工具名；有已批准执行方案时由 update_plan 承担。 */
export const updateTodosToolName = "update_todos";

const todoPrompt = `The user is in Run View: the interface shows your todo list live above the input, so you must keep it current.
You may first explore to understand the project and the task: read files and run read-only commands (such as cat, ls, grep, find without -delete or -exec, git status, git diff, git log). Do not run commands that change anything, and do not edit or write files, until you have a plan. For a task with several distinct steps, once you understand it well enough, call ${updateTodosToolName} with the complete todo list (2-7 concrete items in execution order, at most one in_progress) before your first change. For a simple task that needs only one or two quick actions, or a plain question, skip the list and just do it; do not pad a trivial task with filler items.
Once you have submitted a list, call ${updateTodosToolName} again with the full list after each item finishes: mark it completed and set the next item in_progress. Add, adjust, or merge items when the work changes, and make sure every item is completed (or removed if no longer needed) before your final reply. Do not repeat the list in your reply text.`;

const todoPromptWithPlan =
  "The user is in Run View: the interface shows the execution checklist live above the input, so keep it current with update_plan: you may first read files and run read-only commands (cat, ls, grep, git status, git diff, git log) to understand the task, then submit it before your first change, and update it after each item finishes.";

const outcomePrompt = `If you modified files or ran verification in this turn, consider calling submit_outcome before writing your final reply. This is optional: a suggestion, not a requirement, and you may skip it when the change is small or a plain summary in your reply is enough. If you do submit, submit one item per user requirement, with its actual completion status and any risks, assumptions, or decisions still needing confirmation.
Only cite files changed by completed edit/write calls and bash tool call ids completed in this turn. Leave verificationIds empty if you did not run verification; never invent files, ids, or results. If submission is rejected, correct the invalid references and retry before finishing.
In Goal mode, call record_goal_validation before submit_outcome (record_goal_validation is still required to complete the goal; submit_outcome is not), then update_goal to complete when appropriate. Pure questions and answers with no changes or verification need no outcome submission.`;

const recommendedActionsPrompt = `When you finish the user's request and there is a clear, useful next step the user would probably want (for example committing the changes, running a broader check, or continuing with a follow-up task), call ${recommendedActionsToolName} as the very last step, after your final reply text. The UI shows it as a dismissible card under your reply with one button per action; clicking a button sends that action's prompt to you as the user's next message.
Give 1-${recommendedActionLimits.maxActions} actions. Each prompt must be complete and self-contained, written from the user's point of view as an instruction to you, because it is sent verbatim. Do not call it when the request was a plain question, when you are still working or blocked on the user, or when there is no natural next step; it is optional, and never use it to repeat your reply. After it returns, end your turn without writing anything more.`;

const agentTreePrompt = `Subagents are expensive: every subagent runs its own model loop and re-reads context, so its cost adds to yours. Do the work yourself by default. Spawn a subagent only when both hold: (1) the work is large or clearly separable, such as an investigation across many files or independent pieces that can run in parallel, and (2) doing it yourself would flood your context or take clearly longer. When in doubt, do not spawn.
Never spawn a subagent for: a task you can finish in a few tool calls, reading or editing one or a few files, a single search, running a command, checking or re-verifying your own work, or work you are already partway through. Do not spawn one just to be careful, to get a second opinion, or to repeat work another agent already did. Keep a small budget: normally zero or one subagent at a time, at most three in parallel, and spawn another only after earlier ones have finished and their conclusions are used. Never spawn a subagent to wait on, review, or supervise another subagent.
When you do spawn, use spawn_agent to start a persistent subagent: agent is explore (read-only, preferred when nothing needs changing) or general (can modify files); it returns the agent id and path immediately without waiting for the result. State the goal, scope, and completion criteria clearly in the task; fork inherits context and costs more, so keep it at none (default) unless the subagent truly needs the conversation. Parallel general subagents modify the workspace concurrently, so give each its own files.
When a subagent finishes, its conclusion is delivered back to you automatically; use followup_task to wait for it when you need the result to continue, and send_message when you are only adding requirements. Do not redo the subagent's work after it reports; use its conclusion. Subagent progress messages and clean background-command exits are only added to your context without starting a turn. When a delivered conclusion or notice needs no action and you have already given the final reply, answer with at most one short sentence instead of restating earlier results. Do not repeat the subagent's process verbatim to the user.`;

const workTools = ["read", "bash", "edit", "write", ...agentToolNames];

export function toolNamesFor(mode: InteractionMode, hasExecutionPlan: boolean, runView = false): string[] {
  if (mode === "plan") return ["read", "bash", "ask_user_question"];
  // 运行视图下提供待办清单工具(简单任务可不用);有已批准执行方案时由 update_plan 承担,不再重复提供。
  const todos = runView && !hasExecutionPlan ? [updateTodosToolName] : [];
  if (mode === "goal") return [...workTools, ...todos, "record_goal_validation", "submit_outcome", "update_goal"];
  return hasExecutionPlan
    ? [...workTools, "update_plan", "submit_outcome", "ask_user_question"]
    : [...workTools, ...todos, "submit_outcome", "ask_user_question"];
}

export function modeSystemPrompt(mode: InteractionMode, hasExecutionPlan: boolean, runView = false, recommendedActions = false): string {
  if (mode === "plan") return planPrompt;
  const todo = runView ? (hasExecutionPlan ? todoPromptWithPlan : todoPrompt) : "";
  const recommend = recommendedActions ? recommendedActionsPrompt : "";
  if (mode === "goal") return [goalPrompt, todo, outcomePrompt, recommend, agentTreePrompt].filter(Boolean).join("\n\n");
  return [hasExecutionPlan ? agentPlanPrompt : "", todo, outcomePrompt, recommend, agentTreePrompt].filter(Boolean).join("\n\n");
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
  availableTools(mode: InteractionMode, hasExecutionPlan: boolean, runView?: boolean): string[];
  authorizeCall(call: ToolPolicyCall): ToolAuthorizationResult;
}

const planAllowedTools = new Set(["read", "bash", "ask_user_question", memoryReadToolName, ...webToolNames]);
const planDeniedTools = new Set(["edit", "write", "apply_patch"]);

export class DefaultToolPolicy implements ToolPolicy {
  availableTools(mode: InteractionMode, hasExecutionPlan: boolean, runView = false): string[] {
    return toolNamesFor(mode, hasExecutionPlan, runView);
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
      if ((call.input as { run_in_background?: unknown } | null)?.run_in_background === true) {
        return { allowed: false, reason: "Plan 模式不能启动后台命令。" };
      }
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
  /** 运行视图开启:提示词鼓励多步骤任务提交待办清单,简单任务可以不提交。 */
  runView?: boolean;
  /** 推荐操作开启:提示词告知模型可在一轮结束时调用 recommend_actions。 */
  recommendedActions?: boolean;
}

export function createModeExtension(
  read: () => ModeState,
  policy: ToolPolicy = defaultToolPolicy,
): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", async (event) => {
      const state = read();
      const extra = modeSystemPrompt(state.mode, state.hasExecutionPlan, state.runView === true, state.recommendedActions === true);
      if (!extra) return;
      const current = event.systemPromptOptions.appendSystemPrompt.trim();
      event.systemPromptOptions.appendSystemPrompt = current ? `${current}\n\n${extra}` : extra;
    });

    pi.on("tool_call", async (event) => {
      const state = read();
      const result = policy.authorizeCall({
        mode: state.mode,
        toolName: event.toolName,
        input: event.input,
      });
      if (!result.allowed) return { block: true, reason: result.reason };
    });
  };
}

export type ToolOutcome =
  | { ok: true; text: string; details?: { goal?: ConversationGoal; validation?: GoalValidation } }
  | { ok: false; text: string };

/**
 * createModeTools 提供的全部自定义工具名。
 * Pi 的 createAgentSession 把 tools 参数当作注册表白名单(内置与自定义都过滤),
 * 这些名字必须并入 tools,否则工具进不了注册表,setActiveToolsByName 会静默忽略。
 */
export const modeToolNames = ["update_plan", updateTodosToolName, "update_goal", "record_goal_validation", "submit_outcome", "ask_user_question", recommendedActionsToolName];

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
  recommendActions(draft: RecommendedActions): ToolOutcome;
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
      "Optionally submit one outcome item per user requirement before the final reply when this turn changed files or ran verification; skipping it is fine. Attribute only files changed by completed edit/write calls and completed bash tool call ids from this turn. The runtime validates references; correct rejected references and retry. In Goal mode, record_goal_validation must come first. Do not fabricate evidence; leave verificationIds empty when no verification was run.",
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

  const recommendActions = defineTool({
    name: recommendedActionsToolName,
    label: "推荐操作",
    description:
      "Offer the user 1-3 recommended next actions as buttons under your final reply. Each action has a short label and a complete, self-contained prompt that is sent verbatim as the user's next message when they click it. Call it only as the last step of a finished turn when a clear next step exists; do not use it for plain questions or to repeat your reply.",
    promptSnippet: "Offer 1-3 recommended next actions (label + prompt) as buttons after finishing a task",
    executionMode: "sequential",
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: recommendedActionLimits.questionLength, description: "One short sentence suggesting the next step, e.g. \"Commit these changes?\"" }),
      actions: Type.Array(
        Type.Object({
          label: Type.String({ minLength: 1, maxLength: recommendedActionLimits.labelLength, description: "Short button text" }),
          prompt: Type.String({ minLength: 1, maxLength: recommendedActionLimits.promptLength, description: "Complete instruction sent to you verbatim as the user's next message" }),
        }),
        { minItems: 1, maxItems: recommendedActionLimits.maxActions },
      ),
    }),
    execute: async (_toolCallId, params) => outcome(host.recommendActions(params)),
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

  const updateTodos = defineTool({
    name: updateTodosToolName,
    label: "更新待办清单",
    description:
      "Submit or update the todo list shown live in the user's Run View. Always send the complete list in execution order: at most one item in_progress, finished items marked completed. Use it for tasks with several steps (skip it for simple ones); call it after your initial read-only exploration and before your first change, and again each time an item finishes or the plan changes.",
    promptSnippet: "Submit/update the todo list (list of step + status) shown in Run View",
    executionMode: "sequential",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          step: Type.String({ description: "One todo item, a short concrete action" }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
        }),
        { description: "The complete todo list in execution order", minItems: 1, maxItems: executionPlanItemMax },
      ),
    }),
    execute: async (_toolCallId, params) => outcome(todoListOutcome(params.todos as ExecutionPlanUpdateItem[])),
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

  return [updatePlan, updateTodos, updateGoal, recordGoalValidation, submitOutcome, recommendActions, askUserQuestion];
}

/** update_todos 不改任何对话状态,清单只随工具调用显示在界面上;这里只校验「最多一项进行中」。 */
export function todoListOutcome(items: readonly ExecutionPlanUpdateItem[]): ToolOutcome {
  if (items.filter(item => item.status === "in_progress").length > 1) {
    return { ok: false, text: "待办清单最多只能有一项 in_progress，请调整后重新提交完整清单。" };
  }
  const done = items.filter(item => item.status === "completed").length;
  const active = items.find(item => item.status === "in_progress");
  return { ok: true, text: `待办清单已更新：${done}/${items.length} 完成${active ? `，进行中：${active.step}` : ""}。` };
}

function outcome(result: ToolOutcome): AgentToolResult<Extract<ToolOutcome, { ok: true }>["details"]> {
  if (!result.ok) throw new Error(result.text);
  return {
    content: [{ type: "text", text: result.text }],
    details: result.details,
  };
}
