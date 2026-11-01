import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionProjection } from "@earendil-works/pi-coding-agent";
import { planFreshPrompt } from "../src/plan.ts";
import {
  branchLeafForTurn,
  countTranscriptActivity,
  transcriptFromMessages,
  transcriptFromProjection,
  transcriptSourcesFromProjection,
} from "../src/transcript.ts";

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 0 } as unknown as AgentMessage;
}

function assistant(text: string, toolCallId?: string): AgentMessage {
  const content: unknown[] = text ? [{ type: "text", text }] : [];
  if (toolCallId) content.push({ type: "toolCall", id: toolCallId, name: "bash", arguments: {} });
  return { role: "assistant", content, timestamp: 0 } as unknown as AgentMessage;
}

function toolResult(toolCallId: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "bash",
    content: [{ type: "text", text: "ok" }],
    isError: false,
    timestamp: 0,
  } as unknown as AgentMessage;
}

function entry(id: string, message: AgentMessage, timestamp = "2025-03-01T08:00:00.000Z") {
  return {
    sourceEntry: { type: "message", id, parentId: null, timestamp, message },
    messages: [message],
  };
}

function projection(entries: ReturnType<typeof entry>[]): SessionProjection {
  return {
    entries,
    messages: entries.flatMap((item) => item.messages),
    thinkingLevel: "medium",
    model: null,
  } as unknown as SessionProjection;
}

function sourcesOf(entries: ReturnType<typeof entry>[]) {
  return transcriptSourcesFromProjection(projection(entries));
}

const planPrompt = planFreshPrompt("原始目标", {
  id: "p1",
  markdown: "# Plan\n\n## Goal\n\n做一件事",
  revision: 1,
  supersedes: null,
  status: "approved",
  objective: "原始目标",
  createdAt: 0,
  approvedAt: 1,
});

describe("MCP history identity", () => {
  const name = "mcp__builtin_notion__notion_list_private_pages";
  const call = { role: "assistant", content: [{ type: "toolCall", id: "notion-call", name, arguments: {} }], timestamp: 0 } as unknown as AgentMessage;
  const body = JSON.stringify({ results: [{ title: "Projects", url: "https://app.notion.com/projects", type: "page" }] });
  const result = (details?: unknown, isError = false) => ({
    role: "toolResult", toolCallId: "notion-call", toolName: name, details, isError,
    content: [{ type: "text", text: isError ? "Tool unavailable" : body }], timestamp: 0,
  }) as unknown as AgentMessage;

  it("restores original MCP names from saved results without a connected catalog", () => {
    const [message] = transcriptFromProjection(projection([
      entry("call", call), entry("result", result({ server: "builtin_notion", tool: "notion-list-private-pages" })),
    ]));
    const { presentation, ...legacyFields } = message!.tools[0]!.activity;
    assert.deepEqual(legacyFields, { mcp: { server: "builtin_notion", tool: "notion-list-private-pages" }, body });
    assert.equal(presentation?.kind, "json");
    if (presentation?.kind === "json") assert.deepEqual(JSON.parse(JSON.stringify(presentation.value)), JSON.parse(body));
    assert.equal(message!.tools[0]!.status, "done");
  });

  it("keeps MCP identity for calls and failed/legacy results without saved metadata", () => {
    for (const [messages, expectedBody, status] of [
      [[call], undefined, "done"],
      [[call, result()], body, "done"],
      [[call, result(undefined, true)], "Tool unavailable", "error"],
      [[call, result({ server: 42, tool: "" })], body, "done"],
    ] as const) {
      const tool = transcriptFromMessages([...messages])[0]!.tools[0]!;
      assert.deepEqual(tool.activity.mcp, { server: "builtin_notion", tool: "notion_list_private_pages" });
      assert.equal(tool.activity.body, expectedBody);
      assert.equal(tool.status, status);
    }
  });

  it("does not promote ordinary tools based on result metadata", () => {
    const [message] = transcriptFromMessages([
      assistant("", "ordinary-call"),
      { ...toolResult("ordinary-call"), details: { server: "builtin_notion", tool: "notion-search" } } as unknown as AgentMessage,
    ]);
    assert.equal(message!.tools[0]!.activity.mcp, undefined);
    assert.equal(message!.tools[0]!.activity.body, "ok");
  });
});

describe("assistant 模型来源", () => {
  it("主会话投影与子代理消息都保留每条 SDK 消息的 model/provider", () => {
    const messages = [
      user("切换模型"),
      { ...assistant("GPT 回复"), model: "gpt-5.4", provider: "openai-codex" },
      { ...assistant("DeepSeek 回复"), model: "deepseek-reasoner", provider: "custom-deepseek" },
      assistant("旧历史"),
    ] as AgentMessage[];
    for (const restored of [transcriptFromMessages(messages), transcriptFromProjection(projection(messages.map((message, index) => entry(String(index), message))))]) {
      assert.deepEqual(restored.map(({ model, provider }) => ({ model, provider })), [
        { model: undefined, provider: undefined },
        { model: "gpt-5.4", provider: "openai-codex" },
        { model: "deepseek-reasoner", provider: "custom-deepseek" },
        { model: undefined, provider: undefined },
      ]);
    }
  });
});

describe("用户图片消息的展示文本", () => {
  const note = "[Image: original 2032x1059, displayed at 2000x1042. Multiply coordinates by 1.02 to map to original image.]";
  const secondNote = "[Image: original 4000x3000, displayed at 2000x1500. Multiply coordinates by 2.00 to map to original image.]";
  const image = { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" };
  function imageUser(text: string, count = 1): AgentMessage {
    return { role: "user", content: [{ type: "text", text }, ...Array.from({ length: count }, () => ({ ...image }))], timestamp: 0 };
  }
  function restore(message: AgentMessage) {
    return [transcriptFromMessages([message]), transcriptFromProjection(projection([entry("image-user", message)]))];
  }

  it("实时和磁盘历史隐藏 SDK 缩放说明，但保留图片与模型原文", () => {
    const text = `为什么新建子代理每次都要带入之前的对话\n\n${note}`;
    const message = imageUser(text);
    const original = structuredClone(message);
    for (const restored of restore(message)) {
      assert.equal(restored[0]?.text, "为什么新建子代理每次都要带入之前的对话");
      assert.deepEqual(restored[0]?.images, [image]);
    }
    assert.deepEqual(message, original);
  });

  it("支持多张图片以及纯图片消息，不留下空文字气泡", () => {
    for (const [message, expected] of [
      [imageUser(`比较两张图\n\n${note}\n${secondNote}`, 2), "比较两张图"],
      [imageUser(`\n\n${note}`), ""],
    ] as const) {
      for (const restored of restore(message)) {
        assert.equal(restored.length, 1);
        assert.equal(restored[0]?.text, expected);
        assert.equal(restored[0]?.images?.length, message.content.length - 1);
      }
    }
  });

  it("保留用户正文、换行、引用和没有图片的同名说明", () => {
    const texts = [
      `解释这段：\n\n${note}\n\n然后继续`,
      `\`\`\`text\n${note}\n\`\`\``,
      `原文 ${note}`,
      `说明\n\n[Image: original 2032x1059, displayed at 2000x1042.]`,
      `说明\n\n${note}\n${secondNote}`, // 一张图片不应消费两条说明。
    ];
    for (const text of texts) {
      for (const restored of restore(imageUser(text))) assert.equal(restored[0]?.text, text);
    }
    const literal = `解释这段\n\n${note}`;
    for (const restored of restore(user(literal))) assert.equal(restored[0]?.text, literal);
    for (const restored of restore(imageUser(`保留换行\n\n\n\n${note}`))) assert.equal(restored[0]?.text, "保留换行\n\n");
    for (const restored of restore(imageUser(`引用：\n\n${note}\n\n问题\n\n${secondNote}`))) {
      assert.equal(restored[0]?.text, `引用：\n\n${note}\n\n问题`);
    }
  });
});

describe("transcript timestamps", () => {
  it("keeps the writing time of each message's source entry", () => {
    const messages = transcriptFromProjection(projection([
      entry("u1", user("你好"), "2025-03-01T08:00:00.000Z"),
      entry("a1", assistant("在"), "2025-03-01T08:00:05.000Z"),
    ]));
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.timestamp, Date.parse("2025-03-01T08:00:00.000Z"));
    assert.equal(messages[1]?.timestamp, Date.parse("2025-03-01T08:00:05.000Z"));
  });

  it("leaves timestamps empty for sessions without persisted entries", () => {
    const messages = transcriptFromMessages([user("你好"), assistant("在")]);
    assert.deepEqual(messages.map((message) => message.timestamp), [null, null]);
  });

  it("skips empty assistant blocks and system-issued plan prompts", () => {
    const entries = [
      entry("u1", user("开始")),
      entry("hidden", user(planPrompt)),
      entry("empty", assistant("")),
      entry("a1", assistant("完成")),
    ];
    assert.deepEqual(sourcesOf(entries).map((source) => source.entryId), ["u1", "hidden", "empty", "a1"]);
    assert.deepEqual(transcriptFromProjection(projection(entries)).map((message) => message.text), ["开始", "完成"]);
  });

  it("strips proposed plan blocks from assistant text", () => {
    const messages = transcriptFromProjection(projection([
      entry("a1", assistant("说明段落\n\n<proposed_plan>\n# Plan\n\n## Goal\n\nX\n</proposed_plan>\n\n收尾")),
    ]));
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.text.includes("<proposed_plan>"), false);
    assert.match(messages[0]?.text ?? "", /说明段落/);
    assert.match(messages[0]?.text ?? "", /收尾/);
  });

  it("maps stripped plan blocks back to revision ids for chat previews", () => {
    const plans = [
      { id: "p1", markdown: "# 方案\n\nv1", revision: 1, supersedes: null, status: "superseded" as const, objective: null, createdAt: 1, approvedAt: null },
      { id: "p2", markdown: "# 方案\n\nv2", revision: 2, supersedes: "p1", status: "approved" as const, objective: null, createdAt: 2, approvedAt: 3 },
    ];
    const messages = transcriptFromProjection(
      projection([
        entry("a1", assistant("说明\n\n<proposed_plan>\n# 方案\n\nv1\n</proposed_plan>")),
        entry("a2", assistant("<proposed_plan>\n# 方案\n\nv2\n</proposed_plan>\n\n收尾")),
      ]),
      plans,
    );
    assert.deepEqual(messages.map((message) => message.planIds), [["p1"], ["p2"]]);
    assert.equal(messages[0]?.text, "说明");
    assert.equal(messages[1]?.text, "收尾");
  });

  it("keeps plan-only assistant messages so the preview survives", () => {
    const messages = transcriptFromProjection(
      projection([entry("a1", assistant("<proposed_plan>\n# 方案\n\n只有方案\n</proposed_plan>"))]),
      [{ id: "p1", markdown: "# 方案\n\n只有方案", revision: 1, supersedes: null, status: "draft", objective: null, createdAt: 1, approvedAt: null }],
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.text, "");
    assert.deepEqual(messages[0]?.planIds, ["p1"]);
  });
});

describe("countTranscriptActivity", () => {
  it("counts user messages and tool calls for a branched history", () => {
    const sources = sourcesOf([
      entry("u1", user("执行")),
      entry("a1", assistant("", "call-1")),
      entry("r1", toolResult("call-1")),
      entry("a2", assistant("完成")),
    ]);
    assert.deepEqual(countTranscriptActivity(sources), { messageCount: 1, toolCallCount: 1 });
  });
});

describe("branchLeafForTurn", () => {
  it("points at the last visible reply of the requested turn", () => {
    const sources = sourcesOf([
      entry("u1", user("第一轮")),
      entry("a1", assistant("回答一")),
      entry("u2", user("第二轮")),
      entry("a2", assistant("回答二")),
    ]);
    assert.equal(branchLeafForTurn(sources, 0), "a1");
    assert.equal(branchLeafForTurn(sources, 1), "a2");
  });

  it("counts only visible messages as turns", () => {
    const sources = sourcesOf([
      entry("u1", user("开始")),
      entry("hidden", user(planPrompt)),
      entry("empty", assistant("")),
      entry("a1", assistant("完成")),
    ]);
    assert.equal(branchLeafForTurn(sources, 0), "a1");
  });

  it("keeps the last reply when the turn ends with an empty block", () => {
    const sources = sourcesOf([
      entry("u1", user("开始")),
      entry("a1", assistant("回答")),
      entry("empty", assistant("")),
    ]);
    assert.equal(branchLeafForTurn(sources, 0), "a1");
  });

  it("extends the branch point through following tool results", () => {
    const sources = sourcesOf([
      entry("u1", user("执行")),
      entry("a1", assistant("", "call-1")),
      entry("r1", toolResult("call-1")),
    ]);
    assert.equal(branchLeafForTurn(sources, 0), "r1");
  });

  it("returns null for missing turns and messages without an entry", () => {
    const sources = sourcesOf([entry("u1", user("只有一条"))]);
    assert.equal(branchLeafForTurn(sources, 5), null);
    assert.equal(
      branchLeafForTurn(
        [
          { message: user("临时"), entryId: null, timestamp: null },
          { message: assistant("回答"), entryId: null, timestamp: null },
        ],
        0,
      ),
      null,
    );
  });
});
