import assert from "node:assert/strict";
import { it } from "node:test";
import type { ConversationGoal, GoalStatus, GoalValidation } from "@vela/shared";
import { AgentRuntime } from "../src/runtime.ts";
import { createModeTools, type ModeToolHost, type ToolOutcome } from "../src/interaction.ts";
import type { GoalValidationDraft, GoalValidationEvidence } from "../src/goal-validation.ts";

type Entry = {
  snapshot: { goal: ConversationGoal | null };
  goalValidationEvidence: Map<string, GoalValidationEvidence>;
};
interface GoalRuntime {
  updateGoal(entry: Entry, status: Extract<GoalStatus, "active" | "complete">, note: string | null): ToolOutcome;
  recordGoalValidation(entry: Entry, draft: GoalValidationDraft): ToolOutcome;
  patchEntry(entry: Entry, patch: { goal: ConversationGoal }): void;
}

function fixture() {
  // 复用真实运行时方法，仅替换落盘/事件通知，不创建模型或修改外部状态。
  const runtime = Object.create(AgentRuntime.prototype) as GoalRuntime;
  runtime.patchEntry = (entry, patch) => { Object.assign(entry.snapshot, patch); };
  const entry: Entry = {
    snapshot: { goal: {
      id: "goal", objective: "验证快照", status: "active", note: null,
      workRevision: 0, validation: null, updatedAt: 1,
    } },
    goalValidationEvidence: new Map([["diff", {
      toolCallId: "diff", command: "git diff --check", result: "passed", output: "ok",
      completedAt: 2, sequence: 1, workRevision: 0,
    }]]),
  };
  const host: ModeToolHost = {
    updateExecutionPlan: () => ({ ok: true, text: "updated" }),
    updateGoal: (status, note) => runtime.updateGoal(entry, status, note),
    recordGoalValidation: draft => runtime.recordGoalValidation(entry, draft),
    submitOutcome: () => ({ ok: true, text: "submitted" }),
    recommendActions: () => ({ ok: true, text: "recommended" }),
    askUser: async () => ({ ok: true, text: "answered", answer: null }),
  };
  const tools = createModeTools(host);
  const call = (name: string, params: unknown) => tools.find(tool => tool.name === name)!.execute("fixture", params as never);
  const draft: GoalValidationDraft = {
    risk: "low", checks: [{ category: "diff", toolCallId: "diff" }], knownIssues: [],
    skipped: ["test", "build", "typecheck", "regression"].map(category => ({
      category: category as GoalValidationDraft["skipped"][number]["category"], reason: "本次改动不涉及此项",
    })),
  };
  return { runtime, entry, call, draft };
}

it("Goal 工具保留原文本并透传执行时的独立验证/目标快照", async () => {
  const f = fixture();
  const recorded = await f.call("record_goal_validation", f.draft);
  const validation = (recorded.details as { validation: GoalValidation }).validation;
  assert.deepEqual(recorded.content, [{ type: "text", text: "已记录，未发现未说明的失败。命令 1 项，跳过 4 项，已知失败 0 项。完成前若再运行可能修改工作区的工具，需要重新记录验证。" }]);
  assert.deepEqual(validation, f.entry.snapshot.goal!.validation);
  assert.notEqual(validation, f.entry.snapshot.goal!.validation);
  assert.notEqual(validation.checks[0], f.entry.snapshot.goal!.validation!.checks[0]);
  const completed = await f.call("update_goal", { status: "complete", note: "已完成" });
  const goal = (completed.details as { goal: ConversationGoal }).goal;
  assert.deepEqual(completed.content, [{ type: "text", text: "目标已完成，交付验证已记录。" }]);
  assert.deepEqual(goal, f.entry.snapshot.goal);
  assert.notEqual(goal.validation, f.entry.snapshot.goal!.validation);
  f.entry.snapshot.goal!.note = "随后修改";
  f.entry.snapshot.goal!.validation!.checks[0].output = "随后修改";
  f.entry.snapshot.goal!.validation!.skipped[0].reason = "随后修改";
  assert.equal(goal.note, "已完成");
  assert.equal(goal.validation!.checks[0].output, "ok");
  assert.equal(validation.checks[0].output, "ok");
  assert.equal(validation.skipped[0].reason, "本次改动不涉及此项");
  goal.validation!.checks[0].output = "界面副本修改";
  assert.equal(validation.checks[0].output, "ok");
});

it("进行中的目标与含已知问题的完成结果也保留快照", async () => {
  const f = fixture();
  const active = await f.call("update_goal", { status: "active", note: "继续检查" });
  assert.deepEqual(active.content, [{ type: "text", text: "目标仍在进行。继续检查" }]);
  const captured = (active.details as { goal: ConversationGoal }).goal;
  assert.equal(captured.status, "active");
  const result = f.runtime.recordGoalValidation(f.entry, f.draft);
  assert.equal(result.ok, true);
  f.entry.snapshot.goal!.validation!.status = "known_issues";
  const completed = await f.call("update_goal", { status: "complete" });
  assert.deepEqual(completed.content, [{ type: "text", text: "目标已完成，验证记录中包含已知问题。请在最终回复中列出失败检查和依据。" }]);
  assert.equal((completed.details as { goal: ConversationGoal }).goal.validation!.status, "known_issues");
  assert.equal(captured.status, "active");
  assert.equal(captured.validation, null);
});

it("失败的 Goal 操作仍抛出原错误，不产生成功快照", async () => {
  const f = fixture();
  await assert.rejects(f.call("update_goal", { status: "complete" }), /提交交付验证/);
  f.entry.snapshot.goal!.status = "paused";
  await assert.rejects(f.call("update_goal", { status: "active" }), /目标已暂停/);
  await assert.rejects(f.call("record_goal_validation", f.draft), /未处于进行中/);
  f.entry.snapshot.goal = null;
  await assert.rejects(f.call("update_goal", { status: "active" }), /当前没有目标/);
});
