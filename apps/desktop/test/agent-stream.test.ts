import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRuntimeStreamEvent } from "@vela/shared";
import {
  applyAgentStreamEvent,
  applyStreamEvent,
  mergeAgentHistory,
  sanitizeAgentEvent,
  type MessageBuckets,
  type UiMessage,
  toUiMessage,
  type AgentMessageBuckets,
} from "../src/renderer/hooks/useSession.ts";

/** 依次把事件喂进 reducer，返回该 agent 的消息列表。 */
function reduce(events: AgentRuntimeStreamEvent[], agentId = "a1"): AgentMessageBuckets[string][string] {
  let buckets: AgentMessageBuckets = {};
  for (const event of events) {
    buckets = applyAgentStreamEvent(buckets, "conv-1", agentId, event);
  }
  return buckets["conv-1"]?.[agentId] ?? [];
}

describe("assistant 模型来源数据链路", () => {
  for (const scope of ["main", "child"] as const) {
    it(`${scope}: 开始复用占位消息，更新/结束补齐来源且不影响旧消息`, () => {
      let messages: UiMessage[] = [{ id: "placeholder", role: "assistant", text: "", thinking: "", tools: [] }];
      const apply = (event: AgentRuntimeStreamEvent) => {
        messages = scope === "main"
          ? applyStreamEvent({ c: messages }, { ...event, conversationId: "c" }).c!
          : applyAgentStreamEvent({ c: { a: messages } }, "c", "a", sanitizeAgentEvent(event)!).c!.a!;
      };
      apply({ type: "assistant_start", model: "gpt-5.4", provider: "openai-codex" });
      assert.equal(messages.length, 1);
      assert.equal(messages[0]!.id, "placeholder");
      assert.equal(messages[0]!.model, "gpt-5.4");
      assert.equal(messages[0]!.provider, "openai-codex");
      apply({ type: "text_delta", delta: "第一条" });
      const first = messages[0];
      apply({ type: "assistant_start" });
      apply({ type: "assistant_update", model: "deepseek-reasoner", provider: "custom-deepseek" });
      apply({ type: "thinking_delta", delta: "原始思考" });
      apply({ type: "assistant_end", model: "deepseek-v4" });
      apply({ type: "assistant_update" });
      assert.equal(messages.length, 2);
      assert.equal(messages[0], first);
      assert.equal(messages[1]!.model, "deepseek-v4");
      assert.equal(messages[1]!.provider, "custom-deepseek");
      assert.equal(messages[1]!.thinking, "原始思考");
      const before = messages;
      apply({ type: "assistant_update", model: "deepseek-v4", provider: "custom-deepseek" });
      assert.equal(messages, before, "相同来源不重复发布消息");
    });

    it(`${scope}: 漏掉开始事件时结束事件仍可补齐模型`, () => {
      const event = { type: "assistant_end" as const, model: "gpt-5.4", provider: "proxy" };
      const messages = scope === "main"
        ? applyStreamEvent({}, { ...event, conversationId: "c" }).c!
        : reduce([sanitizeAgentEvent(event)!]);
      assert.equal(messages[0]?.model, "gpt-5.4");
      assert.equal(messages[0]?.provider, "proxy");
    });
  }

  it("历史转换保留来源，旧历史不从当前模型补猜", () => {
    const base = { id: "history", role: "assistant" as const, text: "回复", thinking: "思考", tools: [], timestamp: null };
    const restored = toUiMessage({ ...base, model: "deepseek-reasoner", provider: "custom-deepseek" });
    assert.equal(restored.model, "deepseek-reasoner");
    assert.equal(restored.provider, "custom-deepseek");
    assert.equal(toUiMessage(base).model, undefined);
    assert.equal(toUiMessage(base).provider, undefined);
    const merged = mergeAgentHistory(reduce([{ type: "assistant_start", model: "gpt-5.4", provider: "openai" }]), [restored]);
    assert.deepEqual(merged?.map(({ model }) => model), ["deepseek-reasoner", "gpt-5.4"]);
  });

  it("子代理 IPC 校验保留合法来源并丢弃非字符串", () => {
    for (const type of ["assistant_start", "assistant_update", "assistant_end"]) {
      assert.deepEqual(sanitizeAgentEvent({ type, model: "gpt-5.4", provider: "proxy" }), { type, model: "gpt-5.4", provider: "proxy" });
      assert.deepEqual(sanitizeAgentEvent({ type, model: 123, provider: null }), { type });
    }
  });
});

describe("子代理运行流 reducer", () => {
  it("用户消息和 assistant 文本按顺序累积", () => {
    const messages = reduce([
      { type: "user_message", text: "查一下启动流程" },
      { type: "assistant_start" },
      { type: "text_delta", delta: "我先" },
      { type: "text_delta", delta: "读代码" },
    ]);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, "user");
    assert.equal(messages[0]?.text, "查一下启动流程");
    assert.equal(messages[1]?.role, "assistant");
    assert.equal(messages[1]?.text, "我先读代码");
  });

  it("thinking 和工具调用挂在最后一条 assistant 上", () => {
    const messages = reduce([
      { type: "assistant_start" },
      { type: "thinking_delta", delta: "先看运行时" },
      {
        type: "tool_start",
        toolCallId: "t1",
        toolName: "read",
        activity: { path: "src/runtime.ts" },
      },
      {
        type: "tool_output",
        toolCallId: "t1",
        activity: { body: "export function ..." },
      },
      {
        type: "tool_end",
        toolCallId: "t1",
        toolName: "read",
        isError: false,
        activity: { path: "src/runtime.ts", body: "export function ..." },
      },
      { type: "text_delta", delta: "看完了" },
    ]);
    assert.equal(messages.length, 1);
    const message = messages[0]!;
    assert.equal(message.thinking, "先看运行时");
    assert.equal(message.text, "看完了");
    assert.equal(message.tools.length, 1);
    assert.equal(message.tools[0]?.status, "done");
    assert.equal(message.tools[0]?.activity.path, "src/runtime.ts");
    assert.equal(message.tools[0]?.activity.body, "export function ...");
  });

  it("工具失败标成 error，回合报错并进正文", () => {
    const messages = reduce([
      { type: "assistant_start" },
      { type: "tool_start", toolCallId: "t2", toolName: "bash", activity: { command: "npm test" } },
      {
        type: "tool_end",
        toolCallId: "t2",
        toolName: "bash",
        isError: true,
        activity: { command: "npm test", body: "failed" },
      },
      { type: "error", message: "模型中断了" },
    ]);
    assert.equal(messages[0]?.tools[0]?.status, "error");
    assert.match(messages[0]?.text ?? "", /模型中断了/);
  });

  it("update_plan 事件保留结构化执行清单，未知状态退回 pending", () => {
    const messages = reduce([
      { type: "assistant_start" },
      {
        type: "tool_start",
        toolCallId: "plan-1",
        toolName: "update_plan",
        activity: {
          body: "✓ A\n→ B",
          plan: [
            { text: "A", status: "completed" },
            { text: "B", status: "in_progress" },
            { text: "C", status: "bogus" as never },
          ],
        },
      },
    ]);
    assert.deepEqual(messages[0]?.tools[0]?.activity.plan, [
      { text: "A", status: "completed" },
      { text: "B", status: "in_progress" },
      { text: "C", status: "pending" },
    ]);
  });

  it("文本片段保留历史消息和未变化工具的引用", () => {
    let buckets: AgentMessageBuckets = {};
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a1", { type: "user_message", text: "任务" });
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a1", { type: "tool_start", toolCallId: "t", toolName: "read", activity: { path: "file.ts" } });
    const before = buckets["conv-1"]!["a1"]!;
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a1", { type: "text_delta", delta: "输出" });
    const after = buckets["conv-1"]!["a1"]!;
    assert.equal(after[0], before[0]);
    assert.notEqual(after[1], before[1]);
    assert.equal(after[1]!.tools, before[1]!.tools);
    assert.equal(before[1]!.text, "");
  });

  it("assistant_start 会另起一块，不同 agent 互不串流", () => {
    let buckets: AgentMessageBuckets = {};
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a1", { type: "assistant_start" });
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a1", { type: "text_delta", delta: "第一步" });
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a1", { type: "assistant_start" });
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a1", { type: "text_delta", delta: "第二步" });
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a2", { type: "assistant_start" });
    buckets = applyAgentStreamEvent(buckets, "conv-1", "a2", { type: "text_delta", delta: "另一个" });

    assert.deepEqual(
      buckets["conv-1"]?.["a1"]?.map((message) => message.text),
      ["第一步", "第二步"],
    );
    assert.deepEqual(
      buckets["conv-1"]?.["a2"]?.map((message) => message.text),
      ["另一个"],
    );
  });
});


describe("MCP renderer activity", () => {
  it("preserves the MCP marker when the main conversation finishes with an output-only event", () => {
    let buckets: MessageBuckets = {};
    for (const event of [
      { type: "tool_start" as const, conversationId: "main", toolCallId: "remote", toolName: "opaque", activity: { mcp: { server: "docs", tool: "lookup" } } },
      { type: "tool_output" as const, conversationId: "main", toolCallId: "remote", activity: { body: "Searching" } },
      { type: "tool_end" as const, conversationId: "main", toolCallId: "remote", toolName: "opaque", isError: true, activity: { body: "Failed" } },
    ]) buckets = applyStreamEvent(buckets, event);
    assert.deepEqual(buckets.main?.[0]?.tools[0]?.activity.mcp, { server: "docs", tool: "lookup" });
    assert.equal(buckets.main?.[0]?.tools[0]?.status, "error");
    assert.equal(buckets.main?.[0]?.tools[0]?.activity.body, "Failed");
  });

  it("retains server metadata through output and completion patches without parsing the registered name", () => {
    const messages = reduce([
      { type: "tool_start", toolCallId: "remote", toolName: "opaque-registered-name", activity: { mcp: { server: "docs", tool: "lookup" } } },
      { type: "tool_output", toolCallId: "remote", activity: { body: "Searching" } },
      { type: "tool_end", toolCallId: "remote", toolName: "opaque-registered-name", isError: false, activity: { body: "Found a result" } },
    ]);
    assert.deepEqual(messages[0]?.tools[0]?.activity.mcp, { server: "docs", tool: "lookup" });
    assert.equal(messages[0]?.tools[0]?.activity.body, "Found a result");
    assert.equal(messages[0]?.tools[0]?.status, "done");
  });

  it("keeps MCP identity when restoring historical tool output", () => {
    const message = toUiMessage({ id: "history", role: "assistant", text: "", thinking: "", tools: [{ id: "remote", name: "opaque-registered-name", status: "done", activity: { body: "Saved result", mcp: { server: "docs", tool: "lookup" } } }] });
    assert.deepEqual(message.tools[0]?.activity.mcp, { server: "docs", tool: "lookup" });
    assert.equal(message.historical, true);
  });

  it("ignores malformed metadata and does not infer a server from an MCP-looking tool name", () => {
    const messages = reduce([{ type: "tool_start", toolCallId: "unmarked", toolName: "mcp__docs__lookup", activity: { mcp: { server: "", tool: "lookup" } } }]);
    assert.equal(messages[0]?.tools[0]?.activity.mcp, undefined);
  });

  it("窗口重开后实时流先到时,回填的历史排在它前面", () => {
    const live = reduce([{ type: "assistant_start" }, { type: "text_delta", delta: "继续检查" }]);
    const history = [
      toUiMessage({ id: "h1", role: "user", text: "审查 runtime", thinking: "", tools: [] }),
      toUiMessage({ id: "h2", role: "assistant", text: "已读完", thinking: "先读文件", tools: [] }),
    ];
    const merged = mergeAgentHistory(live, history);
    assert.deepEqual(merged?.map((message) => message.text), ["审查 runtime", "已读完", "继续检查"]);
  });

  it("没有实时消息时直接用历史,已回填过则不再合并", () => {
    const history = [toUiMessage({ id: "h1", role: "assistant", text: "done", thinking: "", tools: [] })];
    const restored = mergeAgentHistory(undefined, history);
    assert.equal(restored?.length, 1);
    assert.equal(mergeAgentHistory(restored!, history), null);
  });
});
