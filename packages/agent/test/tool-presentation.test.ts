import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolPresentation } from "@vela/shared";
import { activityFromCall, activityFromExecution, toolResultIsError } from "../src/tool-activity.ts";
import { parseLegacyShell, presentationFromCall, presentationFromExecution } from "../src/tool-presentation.ts";

// Safe presentation records deliberately have null prototypes; compare their JSON values.
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const result = (text = "", details: unknown = {}, structuredContent?: unknown) => ({
  content: text ? [{ type: "text", text }] : [], details,
  ...(structuredContent === undefined ? {} : { structuredContent }),
});
function kind<K extends ToolPresentation["kind"]>(value: ToolPresentation | undefined, expected: K): Extract<ToolPresentation, { kind: K }> {
  assert.ok(value, `expected ${expected} presentation`);
  assert.equal(value.kind, expected);
  return value as Extract<ToolPresentation, { kind: K }>;
}
const shell = { id: "bg-1", conversationId: "private-conversation", command: "node test.mjs", cwd: "/repo", status: "exited", exitCode: 1, startedAt: 1, endedAt: 2 };
const rawShell = "shell bg-1 (exited with code 1): node test.mjs\n\n(no new output)";

const schedules = [
  { kind: "once", at: "2026-10-01T10:00:00+08:00" },
  { kind: "daily", time: "22:00", timezone: "Asia/Shanghai" },
  { kind: "weekly", time: "09:00", weekdays: [1, 3, 5], timezone: "Asia/Tokyo" },
  { kind: "cron", expression: "0 9 * * 1", timezone: "UTC" },
];
const task = (schedule = schedules[0]!) => ({ id: "task-1", title: "Review", prompt: "Review changes", workspace: "/repo", schedule, status: "active", missedPolicy: "skip", nextRunAt: 100, createdAt: 1, updatedAt: 2 });
const run = { id: "run-1", taskId: "task-1", trigger: "scheduled", scheduledAt: 100, startedAt: 100, finishedAt: 101, status: "failed", conversationId: "run-chat", error: "offline" };
const readEntry = { scope: "global", path: "/memory/global.md", revision: "abc", bytes: 8, exists: true, content: "# Rules\n", status: "read" };
const failedEntry = { scope: "project", path: "/repo/.vela/MEMORY.md", status: "failed", error: "io-error: denied" };
const oldRead = "scope: global\npath: /memory/global.md\nexists: true\nrevision: abc\nbytes: 8\ncontent:\n---\n# Rules\n";
const oldFailure = "scope: project\npath: /repo/.vela/MEMORY.md\nstatus: failed\nerror: io-error\nmessage: denied";

describe("tool presentation: background shell", () => {
  it("keeps read success independent from a process exit code of 1", () => {
    const execution = result(rawShell, { backgroundShell: shell, output: "", truncated: false });
    assert.equal(toolResultIsError("bash_output", execution, false), false);
    const activity = activityFromExecution("bash_output", { shell_id: "bg-1", wait: 2 }, execution, false);
    const presentation = kind(activity.presentation, "shell");
    assert.equal(presentation.operation, "read");
    assert.equal(presentation.source, "result");
    assert.equal(presentation.shell.exitCode, 1);
    assert.equal(presentation.shell.status, "exited");
    assert.equal(presentation.output, "");
    assert.equal(activity.body, rawShell, "original protocol remains available");
    assert.equal("conversationId" in presentation.shell, false, "internal identities are not copied wholesale");
  });

  it("preserves running, timed out, negative exit, empty output and explicit truncation", () => {
    for (const status of ["running", "timed_out", "killed", "exited"]) {
      const p = kind(presentationFromExecution("bash_output", { shell_id: "bg-1" }, result("wire", {
        backgroundShell: { ...shell, status, exitCode: status === "exited" ? -9 : null }, output: "last lines\n", truncated: true,
      }), false), "shell");
      assert.equal(p.shell.status, status);
      assert.equal(p.output, "last lines\n");
      assert.equal(p.truncated, true);
      if (status === "exited") assert.equal(p.shell.exitCode, -9);
    }
    const p = kind(presentationFromExecution("bash_output", {}, result(rawShell, { backgroundShell: shell }), false), "shell");
    assert.equal(p.output, "", "older details with a protocol body still recover empty output");
  });

  it("shows shell start and both successful kill outcomes without treating already-exited as failure", () => {
    const started = kind(presentationFromExecution("bash", { command: shell.command, run_in_background: true }, result("Started background shell bg-1.", { backgroundShell: { ...shell, status: "running", exitCode: null } }), false), "shell");
    assert.equal(started.operation, "start");
    for (const killed of [true, false]) {
      const p = kind(presentationFromExecution("bash_kill", { shell_id: "bg-1" }, result("Stopped", { backgroundShell: shell, killed }), false), "shell");
      assert.equal(p.operation, "kill");
      assert.equal(p.killed, killed);
    }
    for (const [text, killed] of [["Stopped background shell bg-1.", true], ["Background shell bg-1 had already exited.", false]] as const) {
      const p = kind(presentationFromExecution("bash_kill", { shell_id: "bg-1" }, result(text), false), "shell");
      assert.equal(p.source, "legacy");
      assert.equal(p.killed, killed);
      assert.equal(p.shell.id, "bg-1");
    }
  });

  it("strictly parses known legacy headers and leaves malformed output untouched", () => {
    const text = "shell bg-1 (stopped: timed out): pnpm test\n\n[Output was cut; showing the last 64000 characters of what is unread.]\ntail\n";
    const p = kind(presentationFromExecution("bash_output", { shell_id: "bg-1" }, result(text), false), "shell");
    assert.equal(p.source, "legacy");
    assert.equal(p.shell.status, "timed_out");
    assert.equal(p.truncated, true);
    assert.equal(p.output, "tail\n");
    assert.equal(parseLegacyShell("ordinary output mentioning shell bg-1"), undefined);
    assert.equal(presentationFromExecution("bash_output", {}, result("shell unknown format\nlog"), false), undefined);
  });

  it("errors retain request identity but do not claim a process result", () => {
    const p = kind(presentationFromExecution("bash_output", { shell_id: "missing", token: "secret" }, result("not found"), true), "shell");
    assert.equal(p.source, "request");
    assert.equal(p.shell.id, "missing");
    assert.equal(p.shell.status, undefined);
    assert.equal(JSON.stringify(p).includes("secret"), false);
  });
});

describe("tool presentation: scheduled tasks", () => {
  it("covers four operations and every schedule without losing timezone or run errors", () => {
    for (const schedule of schedules) {
      const data = task(schedule);
      for (const operation of ["create", "update"] as const) {
        const p = kind(presentationFromExecution(`${operation}_scheduled_task`, data, result("wire", { operation, data }), false), "schedule");
        assert.equal(p.operation, operation);
        assert.equal(p.source, "result");
        assert.deepEqual(plain(p.tasks), [data]);
      }
      const listing = kind(presentationFromExecution("list_scheduled_tasks", {}, result("wire", { operation: "list", data: { tasks: [data], runs: [run] } }), false), "schedule");
      assert.deepEqual(plain(listing.tasks), [data]);
      assert.deepEqual(plain(listing.runs), [run]);
    }
    const removed = kind(presentationFromExecution("delete_scheduled_task", { id: "task-1" }, result('{"deleted":"task-1"}', { operation: "delete", data: { deleted: "task-1" } }), false), "schedule");
    assert.equal(removed.operation, "delete");
    assert.equal(removed.deletedId, "task-1");
    assert.deepEqual(removed.tasks, []);
  });

  it("reads known legacy JSON and does not invent missing tasks or results", () => {
    const listing = kind(presentationFromExecution("list_scheduled_tasks", {}, result(JSON.stringify({ tasks: [], runs: [] })), false), "schedule");
    assert.equal(listing.source, "legacy");
    assert.deepEqual(listing.tasks, []);
    for (const [name, text] of [["list_scheduled_tasks", '{"tasks":[]}'], ["create_scheduled_task", '{"title":"requested"}'], ["delete_scheduled_task", "deleted"], ["list_scheduled_tasks", '{"tasks":[']]) {
      assert.equal(presentationFromExecution(name!, {}, result(text!), false), undefined);
    }
    const pending = kind(presentationFromCall("create_scheduled_task", { title: "Not saved", schedule: schedules[0] }), "schedule");
    assert.equal(pending.source, "request");
    assert.equal(JSON.stringify(pending).includes('"status":"active"'), false, "a request summary must not claim an active saved task");
    assert.equal(JSON.stringify(pending).includes('"id":"task-1"'), false, "a real task id cannot be invented from the request");
  });
});

describe("tool presentation: memory", () => {
  it("keeps new dual-source reads and partial failure separate", () => {
    const p = kind(presentationFromExecution("memory_read", {}, result(`${oldRead}\n\n${oldFailure}`, { scopes: ["global", "project"], entries: [readEntry, failedEntry] }), false), "memory");
    assert.equal(p.operation, "read");
    assert.equal(p.source, "result");
    assert.deepEqual(plain(p.entries), [readEntry, failedEntry]);
  });

  it("restores complete legacy source protocols including partial failure, empty and absent documents", () => {
    const p = kind(presentationFromExecution("memory_read", {}, result(`${oldRead}\n\n${oldFailure}`), false), "memory");
    assert.equal(p.source, "legacy");
    assert.deepEqual(plain(p.entries), [readEntry, failedEntry]);
    for (const [exists, revision, body] of [[true, "abc", "(文件存在但内容为空)"], [false, "absent", "(文件不存在；保存时 expectedRevision 使用 absent)"]] as const) {
      const text = `scope: project\npath: /repo/.vela/MEMORY.md\nexists: ${exists}\nrevision: ${revision}\nbytes: 0\ncontent:\n---\n${body}`;
      const empty = kind(presentationFromExecution("memory_read", {}, result(text), false), "memory");
      assert.equal(empty.entries[0]!.content, "");
      assert.equal(empty.entries[0]!.exists, exists);
    }
  });

  it("does not split ordinary memory content at a scope-like line", () => {
    const body = "## Preferences\n\nscope: project\nnot a protocol header\n";
    const text = oldRead.replace("# Rules\n", body);
    const p = kind(presentationFromExecution("memory_read", {}, result(text), false), "memory");
    assert.equal(p.entries.length, 1);
    assert.equal(p.entries[0]!.content, body);
    assert.equal(presentationFromExecution("memory_read", {}, result("some arbitrary memory text"), false), undefined);
  });

  it("distinguishes saved, cleared and unchanged results without copying requested content", () => {
    for (const operation of ["saved", "cleared", "unchanged"] as const) {
      const p = kind(presentationFromExecution("memory_update", { scope: "global", content: "unsaved request", expectedRevision: "old" }, result("wire", { scope: "global", path: "/memory/global.md", revision: "new", bytes: operation === "cleared" ? 0 : 8, changed: operation !== "unchanged", operation }), false), "memory");
      assert.equal(p.operation, operation);
      assert.equal(p.entries[0]!.revision, "new");
      assert.equal(p.entries[0]!.content, undefined);
      assert.equal(JSON.stringify(p).includes("unsaved request"), false);
    }
    const p = kind(presentationFromExecution("memory_update", { scope: "project", content: "not saved" }, result("[conflict] changed externally"), true), "memory");
    assert.equal(p.source, "request");
    assert.equal(p.operation, "update");
    assert.equal(p.entries[0]!.content, undefined);
  });
});

describe("tool presentation: discovery, resources and structured MCP", () => {
  it("keeps authoritative loaded tool names, reliable descriptions and empty matches", () => {
    const text = "Loaded 2 tools. They are available from your next call:\n- mcp__docs__search: Search docs\n- mcp__docs__read: Read docs";
    const p = kind(presentationFromExecution("tool_search", { query: "docs", limit: 2, authorization: "secret" }, result(text, { loaded: ["mcp__docs__search", "other", 42] }), false), "discovery");
    assert.equal(p.query, "docs");
    assert.equal(p.limit, 2);
    assert.deepEqual(plain(p.tools), [{ name: "mcp__docs__search", description: "Search docs" }, { name: "other" }]);
    assert.equal(JSON.stringify(p).includes("secret"), false);
    const empty = kind(presentationFromExecution("tool_search", { query: "none" }, result("No matching tools found.", { loaded: [] }), false), "discovery");
    assert.deepEqual(empty.tools, []);
    const legacy = kind(presentationFromExecution("tool_search", {}, result(text), false), "discovery");
    assert.equal(legacy.source, "legacy");
    assert.equal(legacy.tools.length, 2);
    assert.equal(presentationFromExecution("tool_search", {}, result("unrecognized response"), false), undefined);
  });

  it("preserves resource metadata, cursors and partial server errors without depending on mcp__ naming", () => {
    for (const [name, key, operation] of [["list_mcp_resources", "resources", "list"], ["list_mcp_resource_templates", "resourceTemplates", "templates"]] as const) {
      const payload = { server: "docs", [key]: [{ name: "Guide", uri: "docs://guide", mimeType: "text/markdown" }], nextCursor: "cursor-2", errors: [{ server: "offline", error: "unavailable" }] };
      const p = kind(presentationFromExecution(name, { server: "docs" }, result("wire", { server: "docs" }, payload), false), "resource");
      assert.equal(p.operation, operation);
      assert.equal(p.server, "docs");
      assert.equal(p.source, "result");
      assert.deepEqual(plain(p.value), payload);
      const legacy = kind(presentationFromExecution(name, {}, result(JSON.stringify(payload)), false), "resource");
      assert.equal(legacy.source, "legacy");
    }
  });

  it("keeps validated images separate and never embeds arbitrary binary blobs in resource JSON", () => {
    const execution = {
      content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }, { type: "image", mimeType: "text/html", data: "aGVsbG8=" }, { type: "text", text: "preview" }],
      structuredContent: { server: "docs", uri: "docs://image", contents: [{ uri: "docs://image", mimeType: "image/png", blob: "do-not-embed-binary" }] },
      details: { server: "docs", fullOutputPath: "/tmp/full-output.txt" },
    };
    const p = kind(presentationFromExecution("read_mcp_resource", { server: "docs", uri: "docs://image" }, execution, false), "resource");
    assert.equal(p.operation, "read");
    assert.equal(p.uri, "docs://image");
    assert.equal(p.fullOutputPath, "/tmp/full-output.txt");
    assert.deepEqual(p.images, [{ mimeType: "image/png", data: "aGVsbG8=" }]);
    assert.equal(JSON.stringify(p.value).includes("do-not-embed-binary"), false);
    const plain = kind(presentationFromExecution("read_mcp_resource", { uri: "docs://plain" }, result("# Plain"), false), "resource");
    assert.deepEqual(JSON.parse(JSON.stringify(plain.value)), { contents: [{ text: "# Plain" }] });
  });

  it("prefers structured MCP content, preserves unknown data and rejects incomplete JSON promotion", () => {
    const payload = { nested: { unknown: [null, true, "", 3] }, label: "<script>alert(1)</script>", url: "javascript:alert(1)" };
    const p = kind(presentationFromExecution("mcp__docs__read", {}, result("model preview", {}, payload), false), "json");
    assert.equal(p.source, "result");
    assert.deepEqual(plain(p.value), payload, "HTML and URLs remain inert data, not executed or discarded by conversion");
    const explicitNull = kind(presentationFromExecution("mcp__docs__read", {}, result("preview", {}, null), false), "json");
    assert.equal(explicitNull.value, null, "a structured null is valid JSON, not absent data");
    assert.equal(explicitNull.source, "result");
    const fenced = kind(presentationFromExecution("mcp__docs__read", {}, result('```json\n{"n":null}\n```'), false), "json");
    assert.deepEqual(plain(fenced.value), { n: null });
    for (const name of ["mcp__docs__read", "browser_repl"]) {
      assert.equal(presentationFromExecution(name, {}, result('prefix {"x":1}'), false), undefined);
      assert.equal(presentationFromExecution(name, {}, result('{"x":'), false), undefined);
    }
    assert.equal(presentationFromExecution("bash", {}, result('{"x":1}'), false), undefined);
    assert.equal(presentationFromExecution("read", {}, result('{"x":1}'), false), undefined);
  });

  it("removes prototype-bearing keys and marks bounded JSON rather than fabricating missing contents", () => {
    const dangerous = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"safe":{"known":"yes"}}');
    const p = kind(presentationFromExecution("mcp__docs__read", {}, result("wire", {}, dangerous), false), "json");
    assert.equal(Object.hasOwn(p.value as object, "__proto__"), false);
    assert.equal(Object.hasOwn(p.value as object, "constructor"), false);
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
    const huge = kind(presentationFromExecution("mcp__docs__read", {}, result("wire", {}, { text: "x".repeat(100_000) }), false), "json");
    assert.equal(huge.truncated, true);
    assert.ok(JSON.stringify(huge).length < 81_000);
  });
});

describe("tool presentation: goal evidence and integration", () => {
  it("keeps real goal/validation results distinct from old request-only information", () => {
    const validation = { risk: "low", status: "passed", workRevision: 1, checkedAt: 10, checks: [{ category: "test", toolCallId: "test-1", command: "pnpm test", result: "passed", output: "PASS", completedAt: 9, sequence: 1, workRevision: 1 }], skipped: [{ category: "build", reason: "docs only" }], knownIssues: [] };
    const goal = { id: "goal-1", objective: "Ship", status: "active", note: "Tests done", workRevision: 1, validation, updatedAt: 10 };
    const p = kind(presentationFromExecution("record_goal_validation", { risk: "low" }, result("recorded", { goal, validation }), false), "goal");
    assert.equal(p.source, "result");
    assert.deepEqual(plain(p.validation), validation);
    assert.deepEqual(plain(p.goal), goal);
    goal.note = "A later goal update";
    validation.checks[0]!.output = "MUTATED";
    assert.equal((p.goal as { note: string }).note, "Tests done", "display retains the captured execution result");
    assert.equal(((p.validation as { checks: { output: string }[] }).checks[0]!).output, "PASS");
    const old = kind(presentationFromExecution("record_goal_validation", { risk: "low", checks: [{ category: "test", toolCallId: "old-test" }], skipped: [], knownIssues: [] }, result("记录完成"), false), "goal");
    assert.equal(old.source, "request");
    assert.equal(old.goal, undefined);
    assert.equal(old.validation, undefined);
    assert.deepEqual(plain(old.requested), { risk: "low", checks: [{ category: "test", toolCallId: "old-test" }], skipped: [], knownIssues: [] });
  });

  it("integrates call and execution wrappers without replacing original text", () => {
    const call = activityFromCall("bash_output", { shell_id: "bg-1" });
    assert.equal(kind(call.presentation, "shell").source, "request");
    const raw = result(rawShell, { backgroundShell: shell, output: "" });
    const executed = activityFromExecution("bash_output", { shell_id: "bg-1" }, raw, false);
    assert.deepEqual(executed.presentation, presentationFromExecution("bash_output", { shell_id: "bg-1" }, raw, false));
    assert.equal(executed.body, rawShell);
    assert.equal(activityFromExecution("bash_output", { shell_id: "bg-1" }, result("unknown format"), false).presentation, undefined);
    const reset = kind(presentationFromExecution("browser_repl_reset", {}, result("Browser REPL context reset; pages retained."), false), "notice");
    assert.equal(reset.code, "browser-reset");
  });
});
