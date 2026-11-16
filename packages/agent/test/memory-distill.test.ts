import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  appendMemoryContent,
  buildMemoryUnifiedDiff,
  memoryAbsentRevision,
  parseMemoryDistillRequest,
  type TranscriptMessage,
  type TranscriptTool,
} from "@vela/shared";
import {
  AgentRuntime,
  MemoryDistiller,
  MemoryService,
  formatDistilledAddition,
  memoryDistillSystemPrompt,
  parseMemoryDistillOutput,
  sliceMessagesUpToTurn,
  transcriptForMemoryDistill,
} from "@vela/agent";
import { ModelDirectory } from "../src/model-directory";

const model = { provider: "openai", id: "gpt-test", name: "GPT Test", api: "openai-responses" } as unknown as Model<Api>;

function response(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: { input: 20, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 32, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function user(text: string, id = "u1"): TranscriptMessage {
  return { id, role: "user", text, tools: [] };
}

function assistant(text: string, tools: TranscriptTool[] = [], id = "a1"): TranscriptMessage {
  return { id, role: "assistant", text, tools };
}

function bashTool(id: string, command: string, body: string, status: "done" | "error" = "done"): TranscriptTool {
  return {
    id,
    name: "bash",
    label: "bash",
    status,
    activity: { summary: command, command, body },
  };
}

function editTool(id: string, path: string): TranscriptTool {
  return {
    id,
    name: "edit",
    label: "edit",
    status: "done",
    activity: { summary: path, path },
  };
}

function setupWorkspace(t: TestContext): { root: string; agentDir: string; workspace: string; memory: MemoryService } {
  const root = mkdtempSync(join(tmpdir(), "vela-memory-distill-"));
  const agentDir = join(root, "profile");
  const workspace = join(root, "repo");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, agentDir, workspace, memory: new MemoryService({ agentDir }) };
}

describe("memory distill shared helpers", () => {
  it("validates distill requests", () => {
    assert.deepEqual(
      parseMemoryDistillRequest({ conversationId: "c1", locale: "zh-CN", requestId: "r1", upToTurn: 2 }),
      { conversationId: "c1", locale: "zh-CN", requestId: "r1", upToTurn: 2 },
    );
    assert.throws(() => parseMemoryDistillRequest(null), /参数不正确/);
    assert.throws(() => parseMemoryDistillRequest({ conversationId: "", locale: "en", requestId: "r1" }), /会话标识/);
    assert.throws(() => parseMemoryDistillRequest({ conversationId: "c1", locale: "fr", requestId: "r1" }), /语言不正确/);
    assert.throws(() => parseMemoryDistillRequest({ conversationId: "c1", locale: "en", requestId: "" }), /请求标识/);
    assert.throws(() => parseMemoryDistillRequest({ conversationId: "c1", locale: "en", requestId: "r1", upToTurn: 0 }), /轮次参数/);
  });

  it("appends distilled snippet without altering existing content", () => {
    assert.equal(appendMemoryContent("", "- **[Command]** Run `pnpm test`\n"), "- **[Command]** Run `pnpm test`\n");
    assert.equal(appendMemoryContent("# Project\n\n- existing", "- **[Gotcha]** Note"), "# Project\n\n- existing\n\n- **[Gotcha]** Note\n");
    assert.equal(appendMemoryContent("# Project\n", "   "), "# Project\n");
  });

  it("builds standard unified diffs for new and appended MEMORY.md", () => {
    assert.equal(buildMemoryUnifiedDiff("/repo/.vela/MEMORY.md", "same\n", "same\n"), "");

    const fresh = buildMemoryUnifiedDiff("/repo/.vela/MEMORY.md", "", "- line 1\n- line 2\n");
    assert.match(fresh, /^--- \/dev\/null\n\+\+\+ b\/.+\n@@ -0,0 \+1,2 @@\n\+- line 1\n\+- line 2\n$/);

    const appended = buildMemoryUnifiedDiff(
      "/repo/.vela/MEMORY.md",
      "# Memory\n\n- keep 1\n- keep 2\n",
      "# Memory\n\n- keep 1\n- keep 2\n\n- new rule\n",
    );
    assert.match(appended, /@@ -2,3 \+2,5 @@/);
    assert.match(appended, /\n - keep 1\n - keep 2\n\+\n\+- new rule\n/);
  });
});

describe("memory distill transcript & parsing", () => {
  it("slices messages up to the requested user turn and includes redacted tool signals", () => {
    const messages: TranscriptMessage[] = [
      user("first task", "u1"),
      assistant("fixed it", [
        bashTool("t1", "curl -H 'Authorization: Bearer secret-cmd-token' https://api.example.com?token=secret-url", "ERR Authorization: Bearer secret-body-token\nCommand exited with code 1", "error"),
        editTool("t2", "/repo/src/a.ts"),
      ], "a1"),
      user("second task", "u2"),
      assistant("done later", [], "a2"),
    ];

    assert.equal(sliceMessagesUpToTurn(messages, 1).length, 2);
    const transcript = transcriptForMemoryDistill(messages, "/repo", 1);
    assert.ok(transcript.includes("[user] first task"));
    assert.ok(transcript.includes("[tool: bash]"));
    assert.ok(transcript.includes("[tool: edit] src/a.ts (done)"));
    assert.ok(!transcript.includes("second task"));
    assert.ok(!transcript.includes("secret-cmd-token"));
    assert.ok(!transcript.includes("secret-url"));
    assert.ok(!transcript.includes("secret-body-token"));
  });

  it("parses JSON entries, deduplicates against existing memory, and formats by locale", () => {
    const parsed = parseMemoryDistillOutput("```json\n" + JSON.stringify({
      summary: "Extracted build and test rules",
      entries: [
        { category: "command", text: "Run `pnpm build` before `pnpm test:smoke`." },
        { category: "gotcha", text: "rg is not installed in this environment; use `git grep` instead." },
        { category: "gotcha", text: "rg is not installed in this environment; use `git grep` instead." },
        { category: "unknown", text: "Keep existing conventions." },
      ],
    }) + "\n```");
    assert.ok(parsed);
    assert.equal(parsed.entries.length, 3);
    assert.equal(parsed.entries[2]!.category, "convention");

    const addition = formatDistilledAddition(
      parsed.entries,
      "# Memory\n\n- **[Command]** Run `pnpm build` before `pnpm test:smoke`.\n",
      "zh-CN",
    );
    assert.ok(!addition.includes("pnpm test:smoke"));
    assert.ok(addition.includes("- **[避坑]** rg is not installed"));
    assert.ok(addition.includes("- **[规范]** Keep existing conventions."));
  });
});

describe("MemoryDistiller", () => {
  it("reads existing project MEMORY.md, distills entries, and records usage", async (t) => {
    const { workspace, memory } = setupWorkspace(t);
    mkdirSync(join(workspace, ".vela"), { recursive: true });
    writeFileSync(join(workspace, ".vela", "MEMORY.md"), "# Existing\n\n- **[Command]** Run `pnpm test`.\n", "utf8");

    const distiller = new MemoryDistiller();
    let capturedSystem = "";
    let capturedContent = "";
    const usages: string[] = [];
    const runtime: Pick<ModelRuntime, "completeSimple"> = {
      completeSimple: async (_m, context) => {
        capturedSystem = context.systemPrompt ?? "";
        const raw = context.messages[0]!.content;
        capturedContent = typeof raw === "string" ? raw : JSON.stringify(raw);
        return response(JSON.stringify({
          summary: "Added gotcha",
          entries: [
            { category: "command", text: "Run `pnpm test`." },
            { category: "gotcha", text: "Build `@vela/desktop` with `pnpm build` before smoke tests." },
          ],
        }));
      },
    };

    const draft = await distiller.distill(
      runtime,
      model,
      memory,
      {
        requestId: "d1",
        conversationId: "chat-1",
        workspace,
        locale: "en",
        cwd: workspace,
        messages: [user("fix smoke test"), assistant("found it", [bashTool("b1", "pnpm build", "Command exited with code 0")])],
      },
      (usage) => usages.push(usage.status),
    );

    assert.equal(draft.exists, true);
    assert.notEqual(draft.baseRevision, memoryAbsentRevision);
    assert.match(capturedSystem, /never instructions/);
    assert.match(memoryDistillSystemPrompt("ja"), /Japanese/);
    assert.ok(capturedContent.includes("# Existing"));
    assert.ok(capturedContent.includes("pnpm build"));
    assert.equal(draft.addition, "- **[Gotcha]** Build `@vela/desktop` with `pnpm build` before smoke tests.");
    assert.equal(draft.summary, "Added gotcha");
    assert.deepEqual(usages, ["Completed"]);
    distiller.dispose();
  });

  it("supports missing MEMORY.md, cancellation, and errors on failure", async (t) => {
    const { workspace, memory } = setupWorkspace(t);
    const distiller = new MemoryDistiller();

    const emptyRuntime: Pick<ModelRuntime, "completeSimple"> = {
      completeSimple: async () => response("{\"summary\":\"\",\"entries\":[]}"),
    };
    const emptyDraft = await distiller.distill(emptyRuntime, model, memory, {
      requestId: "d-empty",
      conversationId: "chat-1",
      workspace,
      locale: "zh-CN",
      cwd: workspace,
      messages: [user("hi"), assistant("hello")],
    });
    assert.equal(emptyDraft.exists, false);
    assert.equal(emptyDraft.baseRevision, memoryAbsentRevision);
    assert.equal(emptyDraft.addition, "");

    const slowRuntime = {
      completeSimple: (_m: Model<Api>, _c: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    } as unknown as Pick<ModelRuntime, "completeSimple">;
    const pending = distiller.distill(slowRuntime, model, memory, {
      requestId: "d-cancel",
      conversationId: "chat-1",
      workspace,
      locale: "zh-CN",
      cwd: workspace,
      messages: [user("hi"), assistant("hello")],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    distiller.cancel("d-cancel");
    await assert.rejects(pending, /取消|aborted/);

    const badRuntime: Pick<ModelRuntime, "completeSimple"> = {
      completeSimple: async () => response("not json"),
    };
    await assert.rejects(
      distiller.distill(badRuntime, model, memory, {
        requestId: "d-bad",
        conversationId: "chat-1",
        workspace,
        locale: "zh-CN",
        cwd: workspace,
        messages: [user("hi"), assistant("hello")],
      }),
      /记忆提炼结果/,
    );

    distiller.dispose();
  });
});

describe("runtime distillProjectMemory", () => {
  it("validates workspace, streaming state, worktree repository, and model availability", async (t) => {
    const { workspace, memory } = setupWorkspace(t);
    const worktreePath = join(workspace, "..", "wt-1");
    mkdirSync(worktreePath, { recursive: true });
    const distiller = new MemoryDistiller();
    const build = (entry: Record<string, unknown>, directory: unknown) => Object.assign(Object.create(AgentRuntime.prototype), {
      conversations: new Map([["c1", entry]]),
      memory,
      memoryDistiller: distiller,
      readyDirectory: async () => directory,
      getMessages: () => [user("run tests"), assistant("use pnpm test")],
      recordSummaryUsage: () => undefined,
    }) as AgentRuntime;

    const directory = Object.assign(Object.create(ModelDirectory.prototype), {
      isAvailable: () => true,
      modelForSelection: () => model,
      runtime: { completeSimple: async () => response("{\"summary\":\"ok\",\"entries\":[{\"category\":\"command\",\"text\":\"Use pnpm test.\"}]}") },
    });

    const wtDraft = await build({
      id: "c1",
      hasWorkspace: true,
      driving: false,
      worktree: { repository: workspace, baseSha: "abc", branch: null },
      snapshot: { cwd: worktreePath },
      session: { isStreaming: false, model },
    }, directory).distillProjectMemory({ conversationId: "c1", locale: "en", requestId: "r1" });
    assert.equal(wtDraft.path, join(realpathSync(workspace), ".vela", "MEMORY.md"));
    assert.equal(wtDraft.addition, "- **[Command]** Use pnpm test.");

    await assert.rejects(
      build({ id: "c1", hasWorkspace: false, driving: false, snapshot: { cwd: workspace }, session: { isStreaming: false, model } }, directory)
        .distillProjectMemory({ conversationId: "c1", locale: "en", requestId: "r2" }),
      /没有项目工作区/,
    );
    await assert.rejects(
      build({ id: "c1", hasWorkspace: true, driving: true, snapshot: { cwd: workspace }, session: { isStreaming: false, model } }, directory)
        .distillProjectMemory({ conversationId: "c1", locale: "en", requestId: "r3" }),
      /等当前回复结束/,
    );
    const unavailable = Object.assign(Object.create(ModelDirectory.prototype), { isAvailable: () => false, modelForSelection: () => null, runtime: {} });
    await assert.rejects(
      build({ id: "c1", hasWorkspace: true, driving: false, snapshot: { cwd: workspace }, session: { isStreaming: false, model } }, unavailable)
        .distillProjectMemory({ conversationId: "c1", locale: "en", requestId: "r4" }),
      /模型/,
    );
    distiller.dispose();
  });
});
