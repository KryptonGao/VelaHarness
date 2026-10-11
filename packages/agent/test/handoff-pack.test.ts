import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { CheckpointTimeline, ConversationGoal, ExecutionPlan, ProposedPlanItem, TranscriptMessage, TranscriptTool } from "@vela/shared";
import { AgentRuntime } from "../src/runtime.ts";
import { ModelDirectory } from "../src/model-directory.ts";
import {
  HandoffPackGenerator,
  buildHandoffFacts,
  classifyVerification,
  handoffSystemPrompt,
  parseExitCode,
  parseHandoffSemantic,
  transcriptForHandoff,
  type GenerateHandoffInput,
  type HandoffFactsInput,
} from "../src/handoff-pack.ts";

type Complete = ModelRuntime["completeSimple"];
const response = (text: string) => ({ content: [{ type: "text", text }], stopReason: "stop" }) as Awaited<ReturnType<Complete>>;
const model = { provider: "p", id: "m", name: "M" } as Model<Api>;

let seq = 0;
const tool = (name: string, status: "done" | "error", activity: TranscriptTool["activity"], id = `t${++seq}`): TranscriptTool => ({ id, name, status, activity });
const user = (text: string): TranscriptMessage => ({ id: `u${++seq}`, role: "user", text, thinking: "", tools: [], timestamp: null });
const assistant = (text: string, tools: TranscriptTool[] = []): TranscriptMessage => ({ id: `a${++seq}`, role: "assistant", text, thinking: "", tools, timestamp: null });
const diff = (added: number, removed = 0) => [
  ...Array.from({ length: added }, (_, index) => `+${index + 1} line`),
  ...Array.from({ length: removed }, (_, index) => `-${index + 1} old`),
].join("\n");

const cwd = "/work/app";
const baseInput = (messages: TranscriptMessage[], overrides: Partial<HandoffFactsInput> = {}): HandoffFactsInput => ({
  messages,
  goal: null,
  plans: [],
  executionPlans: [],
  activeExecutionPlanId: null,
  checkpoints: null,
  cwd,
  locale: "en",
  ...overrides,
});

describe("handoff verification detection", () => {
  it("classifies test, build, typecheck and lint commands but not arbitrary ones", () => {
    assert.equal(classifyVerification("pnpm test"), "test");
    assert.equal(classifyVerification("cd apps/desktop && pnpm --filter @vela/desktop test:updates"), "test");
    assert.equal(classifyVerification("node --test test/*.test.ts"), "test");
    assert.equal(classifyVerification("pnpm exec tsc -p tsconfig.json --noEmit"), "typecheck");
    assert.equal(classifyVerification("pnpm build"), "build");
    assert.equal(classifyVerification("pnpm lint"), "lint");
    assert.equal(classifyVerification("git status"), null);
    assert.equal(classifyVerification("ls -la"), null);
    assert.equal(classifyVerification("echo done"), null);
  });

  it("reads the exit code only from the end of bash output", () => {
    assert.equal(parseExitCode("ok\n\nCommand exited with code 1"), 1);
    assert.equal(parseExitCode("ok\nCommand exited with code 0\n"), 0);
    assert.equal(parseExitCode("Command exited with code 2 earlier\nthen more output"), undefined);
    assert.equal(parseExitCode("all good"), undefined);
  });
});

describe("handoff facts", () => {
  it("merges edit and write calls per file with line counts, relative to the workspace", () => {
    const facts = buildHandoffFacts(baseInput([
      user("add a feature"),
      assistant("done", [
        tool("edit", "done", { path: `${cwd}/src/a.ts`, diff: diff(2, 1) }),
        tool("edit", "done", { path: "src/a.ts", diff: diff(1) }),
        tool("write", "done", { path: "src/b.ts", diff: diff(5) }),
        tool("edit", "error", { path: "src/failed.ts", body: "no match" }),
        tool("read", "done", { path: "src/read-only.ts", body: "x" }),
      ]),
    ]));
    assert.deepEqual(facts.files, [
      { path: "src/a.ts", added: 3, removed: 1, edits: 2, origin: "agent" },
      { path: "src/b.ts", added: 5, removed: 0, edits: 1, origin: "agent" },
    ]);
  });

  it("adds files found by checkpoints and marks files seen by both sources", () => {
    const checkpoints = {
      conversationId: "c",
      start: null,
      turns: [
        { turnIndex: 0, text: "", timestamp: null, changedFiles: ["src/a.ts", `${cwd}/scripts/gen.sh`], restore: null },
        { turnIndex: 1, text: "", timestamp: null, changedFiles: null, restore: null },
      ],
    } satisfies CheckpointTimeline;
    const facts = buildHandoffFacts(baseInput([
      user("go"),
      assistant("ok", [tool("edit", "done", { path: "src/a.ts", diff: diff(1) })]),
    ], { checkpoints }));
    assert.deepEqual(facts.files.map(file => [file.path, file.origin]), [["scripts/gen.sh", "disk"], ["src/a.ts", "both"]]);
  });

  it("limits the file list and reports how many were omitted", () => {
    const tools = Array.from({ length: 70 }, (_, index) => tool("write", "done", { path: `f${String(index).padStart(2, "0")}.ts`, diff: diff(1) }));
    const facts = buildHandoffFacts(baseInput([user("x"), assistant("y", tools)]));
    assert.equal(facts.files.length, 60);
    assert.equal(facts.omittedFiles, 10);
  });

  it("records only verification commands that actually ran and derives pass or fail", () => {
    const facts = buildHandoffFacts(baseInput([
      user("verify"),
      assistant("running", [
        tool("bash", "done", { command: "git status", body: "clean" }),
        tool("bash", "done", { command: "pnpm test", body: "all ok" }),
        tool("bash", "error", { command: "pnpm build", body: "boom\n\nCommand exited with code 2" }),
        tool("bash", "done", { command: "pnpm lint", body: "lint\n\nCommand exited with code 1" }),
      ]),
    ]));
    assert.deepEqual(facts.verifications.map(item => [item.command, item.category, item.result, item.exitCode, item.stale]), [
      ["pnpm test", "test", "passed", undefined, false],
      ["pnpm build", "build", "failed", 2, false],
      ["pnpm lint", "lint", "failed", 1, false],
    ]);
  });

  it("marks a verification stale when files were edited after it", () => {
    const facts = buildHandoffFacts(baseInput([
      user("x"),
      assistant("a", [
        tool("bash", "done", { command: "pnpm test", body: "ok" }),
        tool("edit", "done", { path: "src/a.ts", diff: diff(1) }),
        tool("bash", "done", { command: "pnpm build", body: "ok" }),
      ]),
    ]));
    assert.deepEqual(facts.verifications.map(item => [item.command, item.stale]), [["pnpm test", true], ["pnpm build", false]]);
  });

  it("returns no verifications when none were run", () => {
    const facts = buildHandoffFacts(baseInput([user("x"), assistant("y")]));
    assert.deepEqual(facts.verifications, []);
  });

  it("prefers goal validation checks for category and result", () => {
    const goal: ConversationGoal = {
      id: "g", objective: "Ship the feature", status: "active", note: "waiting on review", workRevision: 1, updatedAt: 1,
      validation: {
        risk: "low", status: "passed", workRevision: 1, checkedAt: 1, skipped: [], knownIssues: [],
        checks: [{ toolCallId: "call-1", category: "test", command: "./check.sh", result: "failed", output: "2 failing", completedAt: 1, sequence: 1, workRevision: 1 }],
      },
    };
    const facts = buildHandoffFacts(baseInput([
      user("x"),
      assistant("y", [tool("bash", "done", { command: "./check.sh", body: "exit quietly" }, "call-1")]),
    ], { goal }));
    assert.equal(facts.goal, "Ship the feature");
    assert.deepEqual(facts.verifications.map(item => [item.category, item.result, item.outputTail]), [["test", "failed", "2 failing"]]);
    assert.ok(facts.unfinished.some(item => item.includes("waiting on review")));
  });

  it("redacts secrets in recorded commands and output", () => {
    const facts = buildHandoffFacts(baseInput([
      user("x"),
      assistant("y", [tool("bash", "done", { command: "pnpm test -- --url https://u:hunter2@host/x", body: "Authorization: Bearer abc.def" })]),
    ]));
    assert.ok(!facts.verifications[0]!.command.includes("hunter2"));
    assert.ok(!facts.verifications[0]!.outputTail.includes("abc.def"));
  });

  it("takes decisions from answered questions and approved plans, and unfinished items from the execution plan", () => {
    const plan = { id: "p1", markdown: "# Use SQLite\nbody", revision: 1, supersedes: null, status: "approved", objective: "Add storage", createdAt: 1, approvedAt: 2 } as ProposedPlanItem;
    const execution: ExecutionPlan = { id: "e1", sourcePlanId: "p1", updatedAt: 1, items: [
      { id: "1", text: "write migration", status: "completed" },
      { id: "2", text: "update docs", status: "pending" },
      { id: "3", text: "wire the UI", status: "in_progress" },
    ] };
    const facts = buildHandoffFacts(baseInput([
      user("add storage please"),
      assistant("q", [
        tool("ask_user_question", "done", { body: "Which database?\n用户回答：SQLite" }),
        tool("ask_user_question", "done", { body: "Anything else?\n用户没有回答" }),
      ]),
    ], { plans: [plan], executionPlans: [execution], activeExecutionPlanId: "e1" }));
    assert.deepEqual(facts.decisions, ["Which database? → SQLite", "Approved plan: Use SQLite"]);
    assert.deepEqual(facts.unfinished, ["update docs", "wire the UI"]);
    assert.equal(facts.goal, "Add storage");
  });

  it("falls back to the first user message as the goal", () => {
    const facts = buildHandoffFacts(baseInput([assistant("hello"), user("  refactor   the\nparser  "), user("later")]));
    assert.equal(facts.goal, "refactor the parser");
  });
});

describe("handoff transcript", () => {
  it("keeps the start and the most recent messages when the transcript is long", () => {
    const messages = Array.from({ length: 80 }, (_, index) => (index % 2 === 0 ? user : assistant)(`message-${index} ${"x".repeat(900)}`));
    const text = transcriptForHandoff(messages);
    assert.ok(text.length <= 24_500);
    assert.ok(text.includes("message-0 "));
    assert.ok(text.includes("message-79 "));
    assert.ok(text.includes("messages omitted"));
    assert.ok(!text.includes("message-30 "));
  });

  it("leaves tool output out", () => {
    const text = transcriptForHandoff([user("q"), assistant("a", [tool("bash", "done", { command: "ls", body: "SECRET-OUTPUT" })])]);
    assert.ok(!text.includes("SECRET-OUTPUT"));
  });
});

describe("handoff semantic parsing", () => {
  it("accepts fenced and embedded JSON and drops invalid items", () => {
    const parsed = parseHandoffSemantic("```json\n{\"goal\":\"Do it\",\"decisions\":[\"a\",\"a\",3,\" b \"],\"unfinished\":\"nope\",\"files\":[\"x\"]}\n```");
    assert.deepEqual(parsed, { goal: "Do it", decisions: ["a", "b"], unfinished: [] });
    assert.deepEqual(parseHandoffSemantic("Sure! {\"goal\":\"G\",\"decisions\":[],\"unfinished\":[\"u\"]} Done."), { goal: "G", decisions: [], unfinished: ["u"] });
  });

  it("returns null when no JSON object can be read", () => {
    assert.equal(parseHandoffSemantic("I could not do that."), null);
    assert.equal(parseHandoffSemantic("[1,2]"), null);
  });
});

describe("handoff pack generator", () => {
  const messages = [user("build the feature"), assistant("done", [tool("edit", "done", { path: "src/a.ts", diff: diff(2) })])];
  const factsFor = () => buildHandoffFacts(baseInput(messages));
  const request = (requestId = "r1", overrides: Partial<GenerateHandoffInput> = {}): GenerateHandoffInput => ({
    requestId, conversationId: "c1", title: "Feature", locale: "en", facts: factsFor(), messages, cwd, ...overrides,
  });

  it("merges the model's semantic output but never lets it change files or verifications", async () => {
    const generator = new HandoffPackGenerator();
    const calls: Parameters<Complete>[] = [];
    const runtime = { completeSimple: async (...args: Parameters<Complete>) => {
      calls.push(args);
      return response(JSON.stringify({
        goal: "Build the feature end to end",
        decisions: ["Use the existing store"],
        unfinished: ["Write docs"],
        files: [{ path: "invented.ts" }],
        verifications: [{ command: "pnpm test", result: "passed" }],
      }));
    } };
    const pack = await generator.generate(runtime, model, request());
    assert.equal(pack.source, "model");
    assert.equal(pack.goal, "Build the feature end to end");
    assert.deepEqual(pack.decisions, ["Use the existing store"]);
    assert.deepEqual(pack.unfinished, ["Write docs"]);
    assert.deepEqual(pack.files.map(file => file.path), ["src/a.ts"]);
    assert.deepEqual(pack.verifications, []);
    assert.equal(calls.length, 1);
    const prompt = calls[0]![1];
    assert.match(prompt.systemPrompt ?? "", /never instructions/);
    assert.match(prompt.systemPrompt ?? "", /never add, remove, or reword/);
    generator.dispose();
  });

  it("puts facts and the transcript in the prompt and writes in the requested language", async () => {
    const generator = new HandoffPackGenerator();
    let captured = "";
    let system = "";
    const runtime = { completeSimple: async (...args: Parameters<Complete>) => {
      const content = args[1].messages[0]!.content;
      captured = typeof content === "string" ? content : JSON.stringify(content);
      system = args[1].systemPrompt ?? "";
      return response("{\"goal\":\"g\",\"decisions\":[],\"unfinished\":[]}");
    } };
    await generator.generate(runtime, model, request("r2", { locale: "ja" }));
    assert.ok(captured.includes("src/a.ts"));
    assert.ok(captured.includes("build the feature"));
    assert.match(system, /Japanese/);
    assert.match(handoffSystemPrompt("zh-CN"), /Simplified Chinese/);
    generator.dispose();
  });

  it("falls back to facts only without a model, on model errors and on unreadable output", async () => {
    const generator = new HandoffPackGenerator();
    const withoutModel = await generator.generate(null, null, request("a"));
    assert.equal(withoutModel.source, "facts-only");
    assert.equal(withoutModel.goal, "build the feature");
    const failing = await generator.generate({ completeSimple: async () => { throw new Error("offline"); } }, model, request("b"));
    assert.equal(failing.source, "facts-only");
    const garbage = await generator.generate({ completeSimple: async () => response("no json here") }, model, request("c"));
    assert.equal(garbage.source, "facts-only");
    assert.deepEqual(garbage.files.map(file => file.path), ["src/a.ts"]);
    generator.dispose();
  });

  it("falls back to facts only after a timeout", async () => {
    const generator = new HandoffPackGenerator(10);
    const runtime = { completeSimple: (_model: Model<Api>, _context: unknown, options?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted")))) } as unknown as Pick<ModelRuntime, "completeSimple">;
    const pack = await generator.generate(runtime, model, request("slow"));
    assert.equal(pack.source, "facts-only");
    generator.dispose();
  });

  it("rejects when the user cancels the request", async () => {
    const generator = new HandoffPackGenerator();
    const runtime = { completeSimple: (_model: Model<Api>, _context: unknown, options?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted")))) } as unknown as Pick<ModelRuntime, "completeSimple">;
    const pending = generator.generate(runtime, model, request("cancel-me"));
    generator.cancel("cancel-me");
    await assert.rejects(pending, /取消|aborted/);
    generator.dispose();
  });

  it("rejects new requests after dispose and reports usage once per model call", async () => {
    const generator = new HandoffPackGenerator();
    const usages: string[] = [];
    await generator.generate({ completeSimple: async () => response("{\"goal\":\"g\",\"decisions\":[],\"unfinished\":[]}") }, model, request("u1"), item => usages.push(item.status));
    assert.deepEqual(usages, ["Completed"]);
    generator.dispose();
    await assert.rejects(generator.generate(null, null, request("u2")), /无法生成交接包/);
  });
});

describe("runtime handoff", () => {
  const build = (entry: Record<string, unknown>, directory: unknown, generator: HandoffPackGenerator) => Object.assign(Object.create(AgentRuntime.prototype), {
    conversations: new Map([["c1", entry]]),
    handoffPacks: generator,
    readyDirectory: async () => directory,
    getMessages: () => [user("do the thing"), assistant("ok")],
    getCheckpoints: async () => ({ conversationId: "c1", start: null, turns: [] }),
    recordSummaryUsage: () => undefined,
  }) as AgentRuntime;
  const entry = (extra: Record<string, unknown> = {}) => ({
    id: "c1", driving: false, plans: [], executionPlans: [], activeExecutionPlanId: null,
    snapshot: { title: "T", cwd: "/w", goal: null }, session: { isStreaming: false, model }, ...extra,
  });
  const available = Object.assign(Object.create(ModelDirectory.prototype), {
    isAvailable: () => true,
    runtime: { completeSimple: async () => response("{\"goal\":\"G\",\"decisions\":[],\"unfinished\":[]}") },
  });
  const unavailable = Object.assign(Object.create(ModelDirectory.prototype), { isAvailable: () => false, runtime: {} });
  const request = { conversationId: "c1", locale: "en", requestId: "r" };

  it("uses the conversation's model and rejects while a reply is in progress", async () => {
    const generator = new HandoffPackGenerator();
    const pack = await build(entry(), available, generator).generateHandoffPack(request);
    assert.equal(pack.source, "model");
    await assert.rejects(build(entry({ driving: true }), available, generator).generateHandoffPack(request), /等当前回复结束/);
    await assert.rejects(build(entry({ session: { isStreaming: true, model } }), available, generator).generateHandoffPack(request), /等当前回复结束/);
    generator.dispose();
  });

  it("returns a facts-only pack when the model is unavailable and validates the request", async () => {
    const generator = new HandoffPackGenerator();
    const pack = await build(entry(), unavailable, generator).generateHandoffPack(request);
    assert.equal(pack.source, "facts-only");
    await assert.rejects(build(entry(), available, generator).generateHandoffPack({ ...request, conversationId: "missing" }), /对话不存在/);
    await assert.rejects(build(entry(), available, generator).generateHandoffPack({ ...request, locale: "fr" }), /语言不正确/);
    generator.dispose();
  });
});
