import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ToolPresentation } from "@vela/shared";
import { activityFromExecution } from "../src/tool-activity.ts";
import { transcriptFromMessages, transcriptFromProjection } from "../src/transcript.ts";

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function call(id: string, name: string, args: unknown): AgentMessage {
  return { role: "assistant", api: "openai-responses", provider: "fixture", model: "fixture", content: [{ type: "toolCall", id, name, arguments: args }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 1 } as unknown as AgentMessage;
}
function response(id: string, name: string, text: string, details: unknown = {}, structuredContent?: unknown, isError = false): AgentMessage {
  return { role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], details, ...(structuredContent === undefined ? {} : { structuredContent }), isError, timestamp: 2 } as unknown as AgentMessage;
}
function toolById(messages: ReturnType<typeof transcriptFromMessages>, id: string) {
  const tool = messages.flatMap(message => message.tools).find(tool => tool.id === id);
  assert.ok(tool, `missing restored tool ${id}`);
  return tool;
}
function expectKind<K extends ToolPresentation["kind"]>(value: ToolPresentation | undefined, kind: K): Extract<ToolPresentation, { kind: K }> {
  assert.ok(value);
  assert.equal(value.kind, kind);
  return value as Extract<ToolPresentation, { kind: K }>;
}

const shellArgs = { shell_id: "bg-1", wait: 1 };
const shellText = "shell bg-1 (exited with code 1): node test.mjs\n\n(no new output)";
const shellDetails = { backgroundShell: { id: "bg-1", command: "node test.mjs", cwd: "/fixture", status: "exited", exitCode: 1, startedAt: 1, endedAt: 2 }, output: "", truncated: false };
const task = { id: "scheduled-1", title: "Review", prompt: "Review docs", workspace: "/fixture", schedule: { kind: "weekly", weekdays: [1], time: "09:00", timezone: "Asia/Tokyo" }, status: "active", missedPolicy: "skip", nextRunAt: 1000, createdAt: 1, updatedAt: 2 };
const memoryEntries = [{ scope: "global", path: "/memory/global.md", content: "# Rules", revision: "abc", bytes: 7, exists: true, status: "read" }, { scope: "project", path: "/fixture/.vela/MEMORY.md", status: "failed", error: "io-error: denied" }];
const validation = { risk: "low", status: "passed", workRevision: 1, checkedAt: 100, checks: [{ category: "test", toolCallId: "verify-1", command: "pnpm test", result: "passed", output: "PASS captured", completedAt: 99, sequence: 1, workRevision: 1 }], skipped: [{ category: "build", reason: "docs only" }], knownIssues: [] };
const goal = { id: "goal-1", objective: "Fix details", status: "active", note: "First validation", workRevision: 1, validation, updatedAt: 100 };
const resource = { server: "docs", resources: [{ server: "docs", name: "Guide", uri: "docs://guide", mimeType: "text/markdown" }], nextCursor: "page-2", errors: [{ server: "offline", error: "unavailable" }] };

function fixtureMessages(): AgentMessage[] {
  return [
    { role: "user", content: "Inspect tool results", timestamp: 0 } as AgentMessage,
    call("shell", "bash_output", shellArgs), response("shell", "bash_output", shellText, shellDetails),
    call("schedule", "list_scheduled_tasks", {}), response("schedule", "list_scheduled_tasks", JSON.stringify({ tasks: [task], runs: [] }), { operation: "list", data: { tasks: [task], runs: [] } }),
    call("memory", "memory_read", {}), response("memory", "memory_read", "Protocol preview", { scopes: ["global", "project"], entries: memoryEntries }),
    call("discovery", "tool_search", { query: "docs", limit: 2 }), response("discovery", "tool_search", "Loaded 1 tool. They are available from your next call:\n- mcp__docs__search: Search docs", { loaded: ["mcp__docs__search"] }),
    call("resource", "list_mcp_resources", { server: "docs" }), response("resource", "list_mcp_resources", JSON.stringify(resource), { server: "docs", tool: "list_mcp_resources" }, resource),
    call("mcp", "mcp__docs__read", { id: "guide" }), response("mcp", "mcp__docs__read", "preview", { server: "docs", tool: "read" }, { nested: { list: [null, true, "value"] } }),
    call("goal-old", "record_goal_validation", { risk: "low", checks: [{ category: "test", toolCallId: "verify-1" }], skipped: [], knownIssues: [] }), response("goal-old", "record_goal_validation", "recorded", { goal, validation }),
    call("goal-new", "update_goal", { status: "complete", note: "Later result" }), response("goal-new", "update_goal", "completed", { goal: { ...goal, status: "complete", note: "Later result", workRevision: 2, updatedAt: 200 } }),
    call("goal-legacy", "record_goal_validation", { risk: "low", checks: [{ category: "test", toolCallId: "legacy-test" }], skipped: [], knownIssues: [] }), response("goal-legacy", "record_goal_validation", "已记录验证"),
    call("unknown", "bash_output", { shell_id: "missing" }), response("unknown", "bash_output", "unknown legacy payload"),
    call("failed", "bash_output", { shell_id: "denied" }), response("failed", "bash_output", "not authorized", {}, undefined, true),
  ];
}

describe("tool presentation transcript reconstruction", () => {
  it("uses exactly the live execution conversion and preserves separate tool/process states", () => {
    const messages = fixtureMessages();
    const history = transcriptFromMessages(messages);
    const shell = toolById(history, "shell");
    assert.equal(shell.status, "done");
    assert.equal(expectKind(shell.activity.presentation, "shell").shell.exitCode, 1);
    assert.deepEqual(shell.activity, activityFromExecution("bash_output", shellArgs, messages[2], false));
    assert.equal(expectKind(toolById(history, "schedule").activity.presentation, "schedule").tasks.length, 1);
    assert.deepEqual(plain(expectKind(toolById(history, "memory").activity.presentation, "memory").entries), memoryEntries);
    assert.equal(expectKind(toolById(history, "discovery").activity.presentation, "discovery").query, "docs");
    assert.deepEqual(plain(expectKind(toolById(history, "resource").activity.presentation, "resource").value), resource);
    assert.deepEqual(plain(expectKind(toolById(history, "mcp").activity.presentation, "json").value), { nested: { list: [null, true, "value"] } });
    assert.deepEqual(toolById(history, "mcp").activity.mcp, { server: "docs", tool: "read" });
    assert.equal(toolById(history, "unknown").activity.presentation, undefined);
    assert.equal(toolById(history, "unknown").activity.body, "unknown legacy payload");
    assert.equal(toolById(history, "failed").status, "error");
    assert.equal(expectKind(toolById(history, "failed").activity.presentation, "shell").source, "request");
  });

  it("does not retrofit old validation from newer goal results or the latest mutable goal", () => {
    const history = transcriptFromMessages(fixtureMessages());
    const captured = expectKind(toolById(history, "goal-old").activity.presentation, "goal");
    const latest = expectKind(toolById(history, "goal-new").activity.presentation, "goal");
    const legacy = expectKind(toolById(history, "goal-legacy").activity.presentation, "goal");
    assert.equal((captured.goal as { note: string }).note, "First validation");
    assert.equal((captured.goal as { workRevision: number }).workRevision, 1);
    assert.deepEqual(plain(captured.validation), validation);
    assert.equal((latest.goal as { note: string }).note, "Later result");
    assert.equal(legacy.source, "request");
    assert.equal(legacy.goal, undefined);
    assert.equal(legacy.validation, undefined, "a latest snapshot cannot prove an older tool result");
    assert.deepEqual(plain(legacy.requested), { risk: "low", checks: [{ category: "test", toolCallId: "legacy-test" }], skipped: [], knownIssues: [] });
  });
});

describe("tool presentation real SessionManager persistence", () => {
  it("writes, reopens and reconstructs structured results in independent root and child sessions without a live catalog", async t => {
    const directory = await mkdtemp(join(tmpdir(), "vela-tool-presentation-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const scope of ["root", "child"]) {
      const sessionDir = join(directory, scope);
      await mkdir(sessionDir, { recursive: true });
      const manager = SessionManager.create("/fixture", sessionDir);
      const messages = fixtureMessages();
      for (const message of messages) manager.appendMessage(message as never);
      const file = manager.getSessionFile();
      assert.ok(file);
      const before = await readFile(file, "utf8");
      assert.match(before, /backgroundShell/);
      assert.match(before, /First validation/);
      const live = transcriptFromMessages(messages).flatMap(message => message.tools);
      const reopened = SessionManager.open(file, sessionDir, "/fixture");
      assert.equal(reopened.getSessionId(), manager.getSessionId());
      const restoredMessages = transcriptFromProjection(reopened.buildSessionProjection());
      assert.deepEqual(restoredMessages.flatMap(message => message.tools), live);
      assert.equal(expectKind(toolById(restoredMessages, "shell").activity.presentation, "shell").shell.exitCode, 1);
      assert.equal(toolById(restoredMessages, "shell").status, "done");
      assert.equal((expectKind(toolById(restoredMessages, "goal-old").activity.presentation, "goal").goal as { note: string }).note, "First validation");
      assert.equal(expectKind(toolById(restoredMessages, "goal-legacy").activity.presentation, "goal").validation, undefined);
      assert.equal(await readFile(file, "utf8"), before, "reading history must not migrate or rewrite JSONL");
    }
  });

  it("restores old protocol-only results and leaves malformed legacy data visible", async t => {
    const directory = await mkdtemp(join(tmpdir(), "vela-tool-legacy-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const manager = SessionManager.create("/fixture", directory);
    const oldMessages = [
      { role: "user", content: "Read legacy", timestamp: 0 } as AgentMessage,
      call("old-shell", "bash_output", { shell_id: "bg-1" }), response("old-shell", "bash_output", shellText),
      call("old-schedule", "create_scheduled_task", task), response("old-schedule", "create_scheduled_task", JSON.stringify(task)),
      call("broken", "list_scheduled_tasks", {}), response("broken", "list_scheduled_tasks", '{"tasks":['),
    ];
    for (const message of oldMessages) manager.appendMessage(message as never);
    const file = manager.getSessionFile();
    assert.ok(file);
    const restored = transcriptFromProjection(SessionManager.open(file, directory).buildSessionProjection());
    assert.equal(expectKind(toolById(restored, "old-shell").activity.presentation, "shell").source, "legacy");
    assert.deepEqual(plain(expectKind(toolById(restored, "old-schedule").activity.presentation, "schedule").tasks), [task]);
    assert.equal(toolById(restored, "broken").activity.presentation, undefined);
    assert.equal(toolById(restored, "broken").activity.body, '{"tasks":[');
  });
});
