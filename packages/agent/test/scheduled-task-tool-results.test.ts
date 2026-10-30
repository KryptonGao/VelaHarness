import assert from "node:assert/strict";
import { it } from "node:test";
import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskPatch, ScheduledTaskService, ScheduledTasksState, TaskSchedule } from "@vela/shared";
import { createScheduledTaskTools } from "../src/scheduled-task-tools.ts";

it("定时任务四种操作保留 JSON 原文并返回服务实际结果的独立快照", async () => {
  const state: ScheduledTasksState = { tasks: [], runs: [] };
  const service: ScheduledTaskService = {
    list: () => state,
    async create(input: ScheduledTaskInput) {
      const task: ScheduledTask = { ...input, id: "task", status: "active", missedPolicy: input.missedPolicy ?? "run-once", nextRunAt: 3, createdAt: 1, updatedAt: 2 };
      state.tasks.push(task);
      return task;
    },
    async update(id: string, patch: ScheduledTaskPatch) {
      const task = state.tasks.find(task => task.id === id)!;
      Object.assign(task, patch, { updatedAt: 4 });
      return task;
    },
    async delete(id: string) { state.tasks = state.tasks.filter(task => task.id !== id); },
  };
  const tools = createScheduledTaskTools(service, "/workspace", () => true);
  const call = (name: string, params: unknown) => tools.find(tool => tool.name === name)!.execute("fixture", params as never);
  const schedules: TaskSchedule[] = [
    { kind: "once", at: "2030-01-01T09:00:00+08:00" },
    { kind: "daily", time: "22:00", timezone: "Asia/Taipei" },
    { kind: "weekly", time: "22:00", timezone: "Asia/Taipei", weekdays: [1, 3] },
    { kind: "cron", expression: "0 22 * * *", timezone: "Asia/Taipei" },
  ];
  for (const schedule of schedules) {
    const created = await call("create_scheduled_task", { title: "任务", prompt: "提醒", schedule });
    const actual = structuredClone(state.tasks[0]);
    assert.deepEqual(created.content, [{ type: "text", text: JSON.stringify(actual) }]);
    assert.deepEqual(created.details, { operation: "create", data: actual });
    assert.notEqual((created.details as { data: unknown }).data, state.tasks[0]);
    state.runs.push({ id: "run", taskId: "task", trigger: "scheduled", scheduledAt: 1, startedAt: 2, finishedAt: 3, status: "failed", conversationId: "chat", error: "原始运行错误" });
    const listed = await call("list_scheduled_tasks", {});
    const listSnapshot = structuredClone(state);
    assert.deepEqual(listed.content, [{ type: "text", text: JSON.stringify(listSnapshot) }]);
    assert.deepEqual(listed.details, { operation: "list", data: listSnapshot });
    const updated = await call("update_scheduled_task", { id: "task", title: "已更新", status: "paused" });
    assert.deepEqual(updated.content, [{ type: "text", text: JSON.stringify(state.tasks[0]) }]);
    assert.deepEqual(updated.details, { operation: "update", data: structuredClone(state.tasks[0]) });
    assert.equal((created.details as { data: ScheduledTask }).data.title, "任务");
    assert.equal((listed.details as { data: ScheduledTasksState }).data.tasks[0].title, "任务");
    state.runs[0].error = "随后变化";
    assert.equal((listed.details as { data: ScheduledTasksState }).data.runs[0].error, "原始运行错误");
    const deleted = await call("delete_scheduled_task", { id: "task" });
    assert.deepEqual(deleted.content, [{ type: "text", text: '{"deleted":"task"}' }]);
    assert.deepEqual(deleted.details, { operation: "delete", data: { deleted: "task" } });
    state.runs = [];
  }
  const empty = await call("list_scheduled_tasks", {});
  assert.deepEqual(empty.details, { operation: "list", data: { tasks: [], runs: [] } });
  assert.deepEqual(empty.content, [{ type: "text", text: '{"tasks":[],"runs":[]}' }]);
});

it("定时任务失败与只读权限仍保持原有拒绝语义", async () => {
  let mutations = 0;
  const service: ScheduledTaskService = {
    list: () => ({ tasks: [], runs: [] }),
    create: async () => { mutations++; throw new Error("服务创建失败"); },
    update: async () => { mutations++; throw new Error("不应更新"); },
    delete: async () => { mutations++; throw new Error("不应删除"); },
  };
  let allowed = false;
  const tools = createScheduledTaskTools(service, "/workspace", () => allowed);
  const create = tools.find(tool => tool.name === "create_scheduled_task")!;
  const input = { title: "任务", prompt: "提醒", schedule: { kind: "daily", time: "22:00", timezone: "UTC" } };
  await assert.rejects(create.execute("read-only", input), /Plan 模式不能修改定时任务/);
  assert.equal(mutations, 0);
  allowed = true;
  await assert.rejects(create.execute("failure", input), /服务创建失败/);
  assert.equal(mutations, 1);
  await assert.rejects(tools.find(tool => tool.name === "update_scheduled_task")!.execute("not-owned", { id: "missing" }), /当前工作区没有这个任务/);
  assert.equal(mutations, 1);
});
