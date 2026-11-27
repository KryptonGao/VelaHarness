import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { localizeTemplate } from "@vela/shared";
import ja from "../../../packages/shared/src/i18n-messages/ja.ts";
import ko from "../../../packages/shared/src/i18n-messages/ko.ts";
import zhTW from "../../../packages/shared/src/i18n-messages/zh-TW.ts";
import { getActiveLocale, localizeError, setActiveLocale } from "../src/renderer/locale.ts";

const placeholderIndices = (text: string) => [...new Set(text.match(/\{\d+\}/g))].sort();

test("Traditional Chinese covers the same keys as Japanese and Korean and preserves placeholders", () => {
  const keys = Object.keys(zhTW).sort();
  assert.deepEqual(keys, Object.keys(ja).sort(), "Japanese and Traditional Chinese keys differ");
  assert.deepEqual(keys, Object.keys(ko).sort(), "Korean and Traditional Chinese keys differ");
  for (const [source, translated] of Object.entries(zhTW)) {
    assert.ok(translated.trim(), `Empty translation for ${source}`);
    assert.deepEqual(placeholderIndices(translated), placeholderIndices(source), source);
  }
});

test("Traditional Chinese renders counts and translates desktop validation errors", () => {
  for (const count of [0, 1, 7]) {
    assert.equal(localizeTemplate("zh-TW", "{0} 个任务", "{0} tasks", count), `${count} 個任務`);
    assert.equal(localizeTemplate("zh-TW", "{0} 项通过的检查", "{0} passing checks", count), `${count} 項已通過的檢查`);
  }
  const previous = getActiveLocale();
  try {
    setActiveLocale("zh-TW");
    assert.equal(localizeError("Error: 文件路径不正确"), "檔案路徑不正確。");
    assert.equal(localizeError("工作区路径不正确"), "工作區路徑不正確。");
    setActiveLocale("en");
    assert.equal(localizeError("工作区路径不正确"), "Invalid workspace path.");
  } finally {
    setActiveLocale(previous);
  }
});

test("Atelier and Deck render Traditional Chinese greetings instead of falling back to English", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const { NewChatAtelierHeader, NewChatDeckHeader } = await server.ssrLoadModule("/src/renderer/components/NewChatHome.tsx") as typeof import("../src/renderer/components/NewChatHome.tsx");
    const { setActiveLocale } = await server.ssrLoadModule("/src/renderer/locale.ts") as typeof import("../src/renderer/locale.ts");
    const props = {
      project: {} as Parameters<typeof NewChatDeckHeader>[0]["project"],
      mode: "agent" as const,
      hint: "",
      showHint: false,
      onMode: () => {},
      modeDisabled: false,
      canRace: false,
      onOpenRace: () => {},
      now: new Date(2026, 0, 1, 8),
    };
    setActiveLocale("zh-TW");
    assert.match(renderToStaticMarkup(createElement(NewChatAtelierHeader, props)), /早安，<br\/>從<em>哪裡落筆？<\/em>/);
    assert.match(renderToStaticMarkup(createElement(NewChatDeckHeader, props)), /早安，想先進行哪一項？/);
    setActiveLocale("en");
    assert.match(renderToStaticMarkup(createElement(NewChatDeckHeader, props)), /Good morning\. What are we shipping\?/);
  } finally {
    await server.close();
  }
});
