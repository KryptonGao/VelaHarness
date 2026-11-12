import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let panel: typeof import("../src/renderer/components/AgentPanel.tsx");
let context: typeof import("../src/renderer/components/ThinkingGroupModeContext.ts");

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  panel = await server.ssrLoadModule("/src/renderer/components/AgentPanel.tsx");
  context = await server.ssrLoadModule("/src/renderer/components/ThinkingGroupModeContext.ts");
});

after(async () => {
  await server?.close();
});

describe("子代理模型标签", () => {
  const model = { provider: "openai-codex", modelId: "gpt-6.1-sol" };
  const catalog = [{ provider: "openai-codex", id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }];
  const render = (models: typeof catalog) => renderToStaticMarkup(
    createElement(context.ThinkingModelCatalogContext.Provider, { value: models }, createElement(panel.AgentModelTag, { model })),
  );

  it("显示模型列表里的名称，悬停给完整 id", () => {
    const html = render(catalog);
    assert.match(html, />GPT-6\.1 Sol</);
    assert.match(html, /openai-codex\/gpt-6\.1-sol/);
  });

  it("目录里找不到时退回 id", () => {
    assert.match(render([]), />gpt-6\.1-sol</);
  });
});
