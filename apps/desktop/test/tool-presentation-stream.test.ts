import assert from "node:assert/strict";
import test from "node:test";
import type { ToolPresentation } from "@vela/shared";
import { applyStreamEvent, applyAgentStreamEvent, toUiMessage, type MessageBuckets, type AgentMessageBuckets } from "../src/renderer/hooks/useSession.ts";

const request: ToolPresentation = { version: 1, kind: "shell", source: "request", operation: "read", shell: { id: "bg-1" } };
const finished: ToolPresentation = { version: 1, kind: "shell", source: "result", operation: "read", shell: { id: "bg-1", command: "node test.mjs", status: "exited", exitCode: 1 }, output: "" };

test("主/子代理保留结构化身份，结束时替换请求快照并区分读取与进程状态", () => {
  let main: MessageBuckets = {};
  let child: AgentMessageBuckets = {};
  const events = [
    { type: "tool_start" as const, toolCallId: "s", toolName: "bash_output", activity: { presentation: request } },
    { type: "tool_output" as const, toolCallId: "s", activity: { body: "partial" } },
    { type: "tool_end" as const, toolCallId: "s", toolName: "bash_output", isError: false, activity: { body: "raw", presentation: finished } },
  ];
  for (const event of events) {
    main = applyStreamEvent(main, { ...event, conversationId: "c" });
    child = applyAgentStreamEvent(child, "c", "agent", event);
    assert.deepEqual(child.c.agent.at(-1)?.tools, main.c.at(-1)?.tools);
    const presentation = main.c.at(-1)?.tools[0]?.activity.presentation;
    assert.equal(presentation?.kind, "shell");
    if (presentation?.kind === "shell") assert.equal(presentation.shell.id, "bg-1");
  }
  const tool = main.c.at(-1)!.tools[0]!;
  assert.equal(tool.status, "done");
  assert.equal(tool.activity.presentation?.source, "result");
  assert.equal(tool.activity.presentation?.kind, "shell");
  if (tool.activity.presentation?.kind === "shell") assert.equal(tool.activity.presentation.shell.exitCode, 1);
});

test("历史入口使用同一校验，丢弃未知展示版本但保留原文", () => {
  const restored = toUiMessage({ id: "m", role: "assistant", text: "", thinking: "", timestamp: 1, tools: [
    { id: "valid", name: "bash_output", status: "done", activity: { presentation: finished } },
    { id: "future", name: "other", status: "done", activity: { body: "original", presentation: { ...finished, version: 2 } as unknown as ToolPresentation } },
  ] });
  assert.equal(restored.tools[0]!.activity.presentation?.kind, "shell");
  assert.equal(restored.tools[1]!.activity.presentation, undefined);
  assert.equal(restored.tools[1]!.activity.body, "original");
});

test("错误结束不残留请求数据或假装执行成功", () => {
  let messages = applyStreamEvent({}, { type: "tool_start", conversationId: "c", toolCallId: "s", toolName: "bash_output", activity: { presentation: request } });
  messages = applyStreamEvent(messages, { type: "tool_end", conversationId: "c", toolCallId: "s", toolName: "bash_output", isError: true, activity: { body: "denied" } });
  const tool = messages.c.at(-1)!.tools[0]!;
  assert.equal(tool.status, "error");
  assert.equal(tool.activity.presentation, undefined);
  assert.equal(tool.activity.body, "denied");
});
