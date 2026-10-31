import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { AgentInfo, ToolTrace } from "@vela/shared";
import { agentAvatarDataUri } from "../src/renderer/components/agent-avatar.ts";

let server: ViteDevServer;
let avatar: typeof import("../src/renderer/components/AgentAvatar.tsx");
let panel: typeof import("../src/renderer/components/AgentPanel.tsx");
let pane: typeof import("../src/renderer/components/AgentPane.tsx");
let cards: typeof import("../src/renderer/components/ToolCard.tsx");
let info: typeof import("../src/renderer/components/info-cards/InfoCardContents.tsx");
let locale: typeof import("../src/renderer/locale.ts");

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  avatar = await server.ssrLoadModule("/src/renderer/components/AgentAvatar.tsx");
  panel = await server.ssrLoadModule("/src/renderer/components/AgentPanel.tsx");
  pane = await server.ssrLoadModule("/src/renderer/components/AgentPane.tsx");
  cards = await server.ssrLoadModule("/src/renderer/components/ToolCard.tsx");
  info = await server.ssrLoadModule("/src/renderer/components/info-cards/InfoCardContents.tsx");
  locale = await server.ssrLoadModule("/src/renderer/locale.ts");
  locale.setActiveLocale("zh-CN");
});

after(async () => { await server?.close(); });

const first: AgentInfo = {
  id: "1612940d-b11d-41b0-a34c-9a6b8de2b863", parentId: "root", path: "/root/review", name: "review",
  kind: "general", status: "completed", depth: 1, task: "检查实现", steps: [], mutated: false,
  finalText: "检查完成", error: null,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  activeMs: 1000, runningSince: null, pauseRequested: false, createdAt: 1, updatedAt: 1,
};
const second: AgentInfo = {
  ...first, id: "f9482896-3d88-490f-99b6-95472ebfbbfa", path: "/root/research", name: "research", kind: "explore", status: "paused",
};
const roster = [first, second];
const noop = (): void => undefined;
const tool = (agent: AgentInfo): ToolTrace => ({
  id: `spawn-${agent.id}`, name: "spawn_agent", status: "done",
  activity: { agentId: agent.id, agentPath: agent.path, agent: agent.kind === "root" ? "general" : agent.kind, body: agent.task },
});

function workspace(children: ReactNode, agents: AgentInfo[] = roster): string {
  return renderToStaticMarkup(createElement(panel.AgentWorkspaceProvider, {
    agents, activeAgentId: agents[0]?.id ?? null, openAgent: noop, closeAgent: noop, children,
  }));
}

function imageSources(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*>/g)]
    .filter(([tag]) => /class="agent-avatar"/.test(tag))
    .map(([tag]) => {
      const src = tag.match(/\bsrc="([^"]*)"/)?.[1];
      assert.ok(src, "每张头像应有图片源");
      return src.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    });
}

function paneHtml(agent = first, agents = roster): string {
  return workspace(createElement(pane.AgentPane, {
    agent, agents, messages: [], conversationId: "avatar-fixture", onSwitch: noop, ensureMessages: noop, onControl: noop,
  }), agents);
}

function infoHtml(agents = roster): string {
  // AgentsBody 只读取 agents 与 onOpenAgent；避免给不相关的项目 API 制造假实现。
  const ctx = { agents, onOpenAgent: noop } as unknown as import("../src/renderer/components/info-cards/InfoCardContents.tsx").InfoCardContext;
  return renderToStaticMarkup(createElement(info.infoCardDefinitions.agents.Body, { ctx }));
}

describe("Bottts 子代理头像生成", () => {
  it("同一持久 ID 始终得到相同的本地 SVG data URI", () => {
    const actual = agentAvatarDataUri(first.id);
    assert.equal(actual, agentAvatarDataUri(first.id));
    assert.ok(actual.startsWith("data:image/svg+xml;utf8,"));
    const svg = decodeURIComponent(actual.slice("data:image/svg+xml;utf8,".length));
    assert.match(svg, /<svg\b/);
    assert.match(svg, /<\/svg>/);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|image)\b/i);
    assert.doesNotMatch(svg, /(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i);
  });

  it("随机 UUID 对应不同外观，不使用工具调用或运行状态作为种子", () => {
    const ids = Array.from({ length: 64 }, () => randomUUID());
    const sources = ids.map(agentAvatarDataUri);
    assert.equal(new Set(sources).size, ids.length);
    for (let index = 0; index < ids.length; index += 1) assert.equal(agentAvatarDataUri(ids[index]!), sources[index]);
  });

  it("完全本地生成，不请求 DiceBear 在线 API", (context) => {
    const fetch = context.mock.method(globalThis, "fetch", () => { throw new Error("头像生成不得联网"); });
    assert.ok(agentAvatarDataUri("offline-" + randomUUID()).startsWith("data:image/svg+xml;utf8,"));
    assert.equal(fetch.mock.callCount(), 0);
  });

  it("大量身份轮换并触发有界缓存淘汰后，旧 ID 仍重建为同一张图", () => {
    const expected = agentAvatarDataUri(first.id);
    // 不绑定 Map/LRU 等内部实现；容量限制由实现维护，行为必须不依赖缓存命中。
    for (let index = 0; index < 1100; index += 1) {
      assert.ok(agentAvatarDataUri(`avatar-cache-churn-${index}`).startsWith("data:image/svg+xml;utf8,"));
    }
    assert.equal(agentAvatarDataUri(first.id), expected);
  });
});

describe("子代理头像跨界面一致性", () => {
  it("AgentAvatar 是装饰图片，默认20px，也支持显式尺寸", () => {
    const html = renderToStaticMarkup(createElement(avatar.AgentAvatar, { agentId: first.id }));
    assert.deepEqual(imageSources(html), [agentAvatarDataUri(first.id)]);
    assert.match(html, /\balt=""/);
    assert.match(html, /\baria-hidden="true"/);
    assert.match(html, /\bwidth="20"/);
    assert.match(html, /\bheight="20"/);
    const sized = renderToStaticMarkup(createElement(avatar.AgentAvatar, { agentId: first.id, size: 28 }));
    assert.match(sized, /\bwidth="28"/);
    assert.match(sized, /\bheight="28"/);
  });

  it("紧凑卡片、普通卡片、Agent Pane 与信息卡对同一代理使用同一张图", () => {
    for (const compact of [false, true]) {
      const html = workspace(createElement(cards.ToolCard, { tool: tool(first), compact }));
      assert.deepEqual(imageSources(html), [agentAvatarDataUri(first.id)]);
      assert.match(html, /agent-status-dot is-completed/);
    }
    assert.deepEqual(imageSources(paneHtml()), [agentAvatarDataUri(first.id)]);
    assert.deepEqual(imageSources(infoHtml()), roster.map((agent) => agentAvatarDataUri(agent.id)));
  });

  it("状态、任务和名称更新不更换头像，完成/暂停/失败标记仍独立显示", () => {
    for (const status of ["completed", "paused", "failed"] as const) {
      const updated: AgentInfo = { ...first, status, name: "renamed", task: "新任务", updatedAt: 99 };
      const agents = [updated, second];
      const html = workspace(createElement(cards.ToolCard, { tool: tool(updated), compact: true }), agents);
      assert.deepEqual(imageSources(html), [agentAvatarDataUri(first.id)]);
      assert.match(html, new RegExp(`agent-status-dot is-${status}`));
      assert.deepEqual(imageSources(paneHtml(updated, agents)), [agentAvatarDataUri(first.id)]);
      const infoCard = infoHtml(agents);
      assert.equal(imageSources(infoCard)[0], agentAvatarDataUri(first.id));
      assert.match(infoCard, new RegExp(`info-card-chip is-${status}`));
    }
  });

  it("尚未拿到代理 ID 或路径的工具保留通用图标，不编造头像身份", () => {
    const pending: ToolTrace = { id: "spawn-pending", name: "spawn_agent", status: "running", activity: { body: "准备启动" } };
    for (const compact of [false, true]) {
      // 使用 done 避免现有 ActivityIndicator 的 SSR 限制；身份回退与运行状态无关。
      const html = workspace(createElement(cards.ToolCard, { tool: { ...pending, status: "done" }, compact }), []);
      assert.deepEqual(imageSources(html), []);
      assert.match(html, /<svg\b/);
      assert.match(html, new RegExp(compact ? "tool-compact-icon" : "tool-card-icon"));
    }
  });

  it("历史工具记录只有持久 agentId、尚无实时 roster 时仍显示相同头像", () => {
    for (const compact of [false, true]) {
      const html = workspace(createElement(cards.ToolCard, { tool: tool(first), compact }), []);
      assert.deepEqual(imageSources(html), [agentAvatarDataUri(first.id)]);
    }
  });
});
