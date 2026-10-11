import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import { outcomeLimits, type InteractionMode, type OutcomeSubmission } from "@vela/shared";
import { Value } from "typebox/value";
import {
  createModeTools, defaultToolPolicy, goalContinuePrompt, isGoalContinuePrompt, modeSystemPrompt, modeToolNames, toolNamesFor,
  type ModeToolHost, type ToolOutcome,
} from "../src/interaction.ts";
import { AgentRuntime, type RuntimeEvent } from "../src/runtime.ts";
import { activityFromCall, activityFromExecution } from "../src/tool-activity.ts";
import { transcriptFromMessages } from "../src/transcript.ts";

function submission(files: string[] = [], verificationIds: string[] = []): OutcomeSubmission {
  return { items: [{ requirement: "保存用户需要的修改", status: "done", files, verificationIds, toConfirm: [] }] };
}

interface Entry {
  session: AgentSession;
  snapshot: { cwd: string; mode: InteractionMode };
  turnToolEvidence: Map<string, { name: string; path?: string }>;
}
interface Internals {
  conversations: Map<string, Entry>;
  handlePiEvent(conversationId: string, event: AgentSessionEvent): void;
  submitOutcome(entry: Entry, draft: OutcomeSubmission): ToolOutcome;
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vela-outcome-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const runtime = new AgentRuntime({ cwd, agentDir: join(root, "agent") });
  t.after(async () => {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await runtime.createConversation(cwd);
  const id = runtime.activeConversationId!;
  const internals = runtime as unknown as Internals;
  const entry = internals.conversations.get(id)!;
  const events: RuntimeEvent[] = [];
  t.after(runtime.subscribe(event => events.push(event)));
  const emit = (event: AgentSessionEvent) => internals.handlePiEvent(id, event);
  const user = (text = "本轮用户任务") => emit({ type: "message_start", message: {
    role: "user", content: [{ type: "text", text }], timestamp: Date.now(),
  } });
  const start = (toolCallId: string, toolName: string, args: unknown = {}) => emit({
    type: "tool_execution_start", toolCallId, toolName, args,
  });
  const end = (toolCallId: string, toolName: string, isError = false) => emit({
    type: "tool_execution_end", toolCallId, toolName, isError,
    result: { content: [{ type: "text", text: isError ? "Command exited with code 1" : "completed" }], details: {} },
  });
  const complete = (toolCallId: string, toolName: string, args: unknown, isError = false) => {
    start(toolCallId, toolName, args);
    end(toolCallId, toolName, isError);
  };
  return { runtime, id, entry, internals, cwd, events, emit, user, start, end, complete,
    submit: (draft: OutcomeSubmission) => internals.submitOutcome(entry, draft) };
}

function scripted(session: AgentSession, replies: Array<string | ToolCall[]>): () => void {
  let index = 0;
  session.agent.streamFunction = model => {
    const reply = replies[index++];
    assert.notEqual(reply, undefined, "fixture must never make a real model request");
    const message: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: typeof reply === "string" ? [{ type: "text", text: reply }] : reply,
      stopReason: typeof reply === "string" ? "stop" : "toolUse", timestamp: Date.now(),
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    if (typeof reply === "string") stream.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: message });
    else reply.forEach((toolCall, contentIndex) => stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: message }));
    stream.push({ type: "done", reason: typeof reply === "string" ? "stop" : "toolUse", message });
    return stream;
  };
  return () => assert.equal(index, replies.length);
}

function call(id: string, name: string, args: unknown): ToolCall {
  return { type: "toolCall", id, name, arguments: args as ToolCall["arguments"] };
}

describe("submit_outcome 工具契约", () => {
  it("Agent 有无执行计划和 Goal 均可提交，Plan 不提供且执行策略拒绝", () => {
    for (const mode of ["agent", "goal"] as const) {
      for (const plan of [false, true]) assert.ok(toolNamesFor(mode, plan).includes("submit_outcome"));
    }
    for (const plan of [false, true]) assert.equal(toolNamesFor("plan", plan).includes("submit_outcome"), false);
    assert.ok(modeToolNames.includes("submit_outcome"));
    assert.equal(defaultToolPolicy.authorizeCall({ mode: "plan", toolName: "submit_outcome", input: submission() }).allowed, false);
    assert.doesNotMatch(modeSystemPrompt("plan", false), /submit_outcome/);
    for (const plan of [false, true]) {
      assert.match(modeSystemPrompt("agent", plan), /submit_outcome before writing your final reply/);
      assert.match(modeSystemPrompt("agent", plan), /Leave verificationIds empty/);
    }
    assert.match(modeSystemPrompt("goal", false), /record_goal_validation before submit_outcome/);
    assert.match(goalContinuePrompt, /record_goal_validation.*submit_outcome.*update_goal/);
    assert.equal(isGoalContinuePrompt("Continue working on the current goal. If it is already complete, first call record_goal_validation to record the checks, then call update_goal to set the status to complete. If it is not complete, go straight to the next step and do not repeat what has already been done."), true);
  });

  it("顺序执行、遵循共享上限、向 host 传递提交并传播失败", async () => {
    const drafts: OutcomeSubmission[] = [];
    let reject = false;
    const host: ModeToolHost = {
      updateExecutionPlan: () => ({ ok: true, text: "updated" }),
      updateGoal: () => ({ ok: true, text: "updated" }),
      recordGoalValidation: () => ({ ok: true, text: "recorded" }),
      askUser: async () => ({ ok: true, text: "answered", answer: null }),
      submitOutcome: draft => {
        drafts.push(draft);
        return reject ? { ok: false, text: "invalid reference" } : { ok: true, text: "submitted" };
      },
    };
    const tool = createModeTools(host).find(tool => tool.name === "submit_outcome")!;
    assert.equal(tool.executionMode, "sequential");
    const draft = { ...submission(), summary: "完成" };
    assert.equal(Value.Check(tool.parameters, draft), true);
    assert.equal(Value.Check(tool.parameters, { items: [] }), false);
    assert.equal(Value.Check(tool.parameters, { items: Array(outcomeLimits.maxItems + 1).fill(draft.items[0]) }), false);
    assert.equal(Value.Check(tool.parameters, { items: [{ ...draft.items[0], status: "invented" }] }), false);
    assert.equal(Value.Check(tool.parameters, { items: [{ ...draft.items[0], verificationIds: ["x".repeat(outcomeLimits.idLength + 1)] }] }), false);
    const result = await tool.execute("outcome", draft);
    assert.deepEqual(drafts, [draft]);
    assert.deepEqual(result.content, [{ type: "text", text: "submitted" }]);
    reject = true;
    await assert.rejects(tool.execute("invalid", draft), /invalid reference/);
  });

  it("开始、结束与重载记录均保留结构化归属；坏参数安全降级", () => {
    const draft = { ...submission(["src/file.ts"], ["test"]), summary: "交付完成" };
    const activity = activityFromCall("submit_outcome", draft);
    assert.deepEqual(activity.outcome, draft);
    assert.match(activity.body ?? "", /需求 1 项/);
    const result = { content: [{ type: "text", text: "submitted" }] };
    assert.deepEqual(activityFromExecution("submit_outcome", draft, result, false).outcome, draft);
    assert.deepEqual(activityFromExecution("submit_outcome", draft, result, true).outcome, draft);
    assert.deepEqual(activityFromCall("submit_outcome", { items: [null] }), {});
  });
});

describe("Runtime 本轮成果证据", () => {
  it("拒绝不存在、正在执行、read 和失败的编辑；接受成功 edit/write 和失败的 bash", async t => {
    const f = await fixture(t);
    f.user();
    await writeFile(join(f.cwd, "existing.ts"), "已有文件");
    f.complete("read", "read", { path: "existing.ts" });
    f.complete("failed-edit", "edit", { path: "failed.ts" }, true);
    f.start("running", "bash", { command: "pnpm test" });
    const rejected = f.submit(submission(["existing.ts", "failed.ts", "invented.ts"], ["read", "running", "invented-id"]));
    assert.equal(rejected.ok, false);
    for (const ref of ["existing.ts", "failed.ts", "invented.ts", "read", "running", "invented-id"]) assert.ok(rejected.text.includes(ref));
    f.complete("edit", "edit", { file_path: join(f.cwd, "edited.ts") });
    f.complete("write", "write", { path: "written.ts", content: "new content" });
    f.complete("failed-test", "bash", { command: "pnpm test" }, true);
    assert.equal(f.submit(submission(["edited.ts", "written.ts"], ["failed-test"])).ok, true);
    f.end("running", "bash");
    assert.equal(f.submit(submission([], ["running"])).ok, true);
    assert.equal(f.submit({ items: [] }).ok, false);
    f.entry.snapshot.mode = "plan";
    assert.equal(f.submit(submission()).ok, false);
  });

  it("assistant/工具循环与子代理通知不重置；实际 user/Goal 续跑开始才重置", async t => {
    const f = await fixture(t);
    f.user();
    f.complete("write", "write", { path: "file.ts" });
    f.complete("test", "bash", { command: "pnpm test" });
    const draft = submission(["file.ts"], ["test"]);
    const first = f.entry.turnToolEvidence;
    f.emit({ type: "turn_start" });
    f.emit({ type: "agent_start" });
    f.emit({ type: "message_start", message: {
      role: "custom", customType: "vela_agent_result", content: "子代理完成", display: false, timestamp: Date.now(),
    } });
    f.emit({ type: "message_start", message: {
      role: "assistant", content: [], api: "openai-completions", provider: "fixture", model: "fixture",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse", timestamp: Date.now(),
    } });
    assert.equal(f.entry.turnToolEvidence, first);
    assert.equal(f.submit(draft).ok, true);
    // 排队本身还没有开始新用户回合。
    f.emit({ type: "queue_update", steering: ["后续要求"], followUp: [] });
    assert.equal(f.submit(draft).ok, true);
    f.user("后续要求");
    assert.equal(f.entry.turnToolEvidence.size, 0);
    assert.equal(f.submit(draft).ok, false);
    f.complete("goal-test", "bash", { command: "pnpm test" });
    f.entry.snapshot.mode = "goal";
    f.user(goalContinuePrompt);
    assert.equal(f.submit(submission([], ["goal-test"])).ok, false);
  });

  it("跨回合迟到的工具结果与另一对话的证据不能混入当前回合", async t => {
    const f = await fixture(t);
    f.user();
    f.start("old-write", "write", { path: "old.ts" });
    f.start("old-test", "bash", { command: "pnpm test" });
    f.user("新任务");
    f.end("old-write", "write");
    f.end("old-test", "bash");
    assert.equal(f.entry.turnToolEvidence.size, 0);
    assert.equal(f.submit(submission(["old.ts"], ["old-test"])).ok, false);
    f.complete("current-test", "bash", { command: "pnpm test" });
    await f.runtime.createConversation(f.cwd);
    const other = f.internals.conversations.get(f.runtime.activeConversationId!)!;
    assert.equal(f.internals.submitOutcome(other, submission([], ["current-test"])).ok, false);
    assert.equal(f.submit(submission([], ["current-test"])).ok, true);
  });

  it("真实 Pi 会话完成 write/bash 后拒绝捏造引用，允许重试，并在下一用户回合拒绝旧证据", async t => {
    const f = await fixture(t);
    await f.runtime.addModel({
      providerId: "outcome-fixture", providerName: "Outcome fixture", modelId: "fixture-model", modelName: "Outcome fixture",
      api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-fixture-key",
      reasoning: false, contextWindow: 32768, maxTokens: 4096,
    });
    await f.runtime.saveAgentSettings({
      ...await f.runtime.getAgentSettings(), provider: "outcome-fixture", modelId: "fixture-model", thinkingLevel: "off",
    });
    const draft = submission(["result.txt"], ["bash-check"]);
    const check = scripted(f.entry.session, [
      [call("write-file", "write", { path: "result.txt", content: "delivered" })],
      [call("bash-check", "bash", { command: "test -f result.txt" })],
      [call("bad-outcome", "submit_outcome", submission(["fake.txt"], ["fake-id"]))],
      [call("valid-outcome", "submit_outcome", draft)],
      "交付完成",
    ]);
    await f.runtime.prompt(f.id, "创建 result.txt 并验证");
    check();
    const toolResult = (id: string) => {
      const message = f.entry.session.messages.find(message => message.role === "toolResult" && message.toolCallId === id);
      assert.ok(message?.role === "toolResult", `missing ${id}`);
      return message;
    };
    assert.equal(toolResult("write-file").isError, false);
    assert.equal(toolResult("bash-check").isError, false);
    assert.equal(toolResult("bad-outcome").isError, true);
    assert.equal(toolResult("valid-outcome").isError, false);
    assert.equal(await readFile(join(f.cwd, "result.txt"), "utf8"), "delivered");
    const ended = f.events.find(event => event.type === "tool_end" && event.toolCallId === "valid-outcome");
    assert.ok(ended?.type === "tool_end");
    assert.deepEqual(ended.activity.outcome, draft);
    const restored = transcriptFromMessages(f.entry.session.messages).flatMap(message => message.tools).find(tool => tool.id === "valid-outcome");
    assert.deepEqual(restored?.activity.outcome, draft);
    const next = scripted(f.entry.session, [
      [call("old-outcome", "submit_outcome", draft)],
      [call("without-evidence", "submit_outcome", submission())],
      "没有本轮验证",
    ]);
    await f.runtime.prompt(f.id, "新一轮仅讨论需求");
    next();
    assert.equal(toolResult("old-outcome").isError, true);
    assert.equal(toolResult("without-evidence").isError, false);
  });
});
