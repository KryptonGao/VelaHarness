import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { AgentInfo, ToolTrace } from "@vela/shared";

let server: ViteDevServer;
let pane: typeof import("../src/renderer/components/AgentPane.tsx");
let locale: typeof import("../src/renderer/locale.ts");

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  pane = await server.ssrLoadModule("/src/renderer/components/AgentPane.tsx");
  locale = await server.ssrLoadModule("/src/renderer/locale.ts");
});

after(async () => {
  await server?.close();
});

function bash(id: string, command: string): ToolTrace {
  return { id, name: "bash", status: "done", activity: { command } };
}

const agent: AgentInfo = {
  id: "a1",
  parentId: "root",
  path: "/root/review",
  name: "review",
  kind: "general",
  status: "completed",
  depth: 1,
  task: "检查实现",
  steps: [],
  mutated: false,
  finalText: null,
  error: null,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  activeMs: 0,
  runningSince: null,
  pauseRequested: false,
  createdAt: 0,
  updatedAt: 0,
};

// 两条助理消息各带两个命令调用：按消息折叠会得到两组，按位置关系会跨消息合成一组。
const messages = [
  { id: "u1", role: "user" as const, text: "检查实现", thinking: "", tools: [] },
  { id: "a1", role: "assistant" as const, text: "", thinking: "", tools: [bash("b1", "git status"), bash("b2", "git log")] },
  { id: "a2", role: "assistant" as const, text: "", thinking: "", tools: [bash("b3", "pnpm test"), bash("b4", "pnpm typecheck")] },
];

function render(toolFold: "message" | "position" | "none", toolDisplay: "compact" | "card" = "compact"): string {
  locale.setActiveLocale("zh-CN");
  return renderToStaticMarkup(createElement(pane.AgentPane, {
    agent,
    agents: [agent],
    messages,
    conversationId: "c1",
    toolDisplay,
    toolFold,
    onSwitch: () => undefined,
    ensureMessages: () => undefined,
    onControl: () => undefined,
  }));
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("子代理面板的工具折叠", () => {
  it("不折叠时每个工具单独一行，不生成折叠摘要", () => {
    const html = render("none");
    assert.equal(count(html, "tool-compact-group"), 0);
    assert.equal(count(html, "tool-compact-item"), 4);
  });

  it("按 Assistant 消息折叠时每条消息各成一组", () => {
    const html = render("message");
    assert.equal(count(html, "tool-compact-group"), 2);
  });

  it("按位置关系折叠时相邻消息的工具合成一组", () => {
    const html = render("position");
    assert.equal(count(html, "tool-compact-group"), 1);
  });

  it("卡片模式同样遵循不折叠", () => {
    const html = render("none", "card");
    assert.equal(count(html, "tool-run"), 0);
    assert.equal(count(html, "tool-card tool-kind-bash"), 4);
  });

  it("沿用主对话的明体正文与消息块样式，紧凑工具列表是消息块的直接子节点", () => {
    locale.setActiveLocale("zh-CN");
    const html = renderToStaticMarkup(createElement(pane.AgentPane, {
      agent,
      agents: [agent],
      messages: [
        { id: "a1", role: "assistant" as const, text: "结论", thinking: "", tools: [bash("b1", "git status")] },
        { id: "a2", role: "assistant" as const, text: "", thinking: "", tools: [bash("b2", "git log")] },
      ],
      conversationId: "c1",
      toolDisplay: "compact",
      toolFold: "message",
      onSwitch: () => undefined,
      ensureMessages: () => undefined,
      onControl: () => undefined,
    }));
    assert.equal(count(html, 'class="assistant-block"'), 2);
    assert.ok(html.includes('class="agent-reply-prose"'));
    assert.equal(count(html, "agent-stream-text"), 0);
    assert.ok(html.includes('<div class="tool-card-list is-compact" data-arrival-key="a2:tools">'));
  });
});
