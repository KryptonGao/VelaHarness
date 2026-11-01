import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { isColorIcon, monoIconTint, providerIconName, providerIconNames } from "../src/renderer/components/settings/provider-icons.ts";

const assetsDir = join(import.meta.dirname, "../src/renderer/assets/providers");

test("every mapped icon ships as an SVG asset", () => {
  for (const name of providerIconNames) assert.ok(existsSync(join(assetsDir, `${name}.svg`)), `${name}.svg is missing`);
});

test("built-in providers resolve by id", () => {
  assert.equal(providerIconName({ id: "anthropic", name: "Anthropic" }), "anthropic");
  assert.equal(providerIconName({ id: "github-copilot", name: "GitHub Copilot" }), "copilot-color");
  assert.equal(providerIconName({ id: "openai-codex", name: "ChatGPT" }), "openai");
  assert.equal(providerIconName({ id: "minimax-cn", name: "MiniMax CN" }), "minimax-color");
});

test("custom providers resolve by their name or id when it names a known vendor", () => {
  assert.equal(providerIconName({ id: "custom-x1", name: "DeepSeek" }), "deepseek-color");
  assert.equal(providerIconName({ id: "ollama", name: "本地" }), "ollama");
  assert.equal(providerIconName({ name: "Open Router" }), "openrouter-color");
  assert.equal(providerIconName({ name: "BigModel" }), "zhipu-color");
});

test("providers without a color version fall back to the monochrome one", () => {
  assert.equal(isColorIcon("deepseek-color"), true);
  assert.equal(isColorIcon("anthropic"), false);
  assert.equal(providerIconName({ id: "anthropic", name: "Anthropic" }), "anthropic");
  assert.ok(monoIconTint.anthropic);
});

test("unknown providers have no icon", () => {
  assert.equal(providerIconName({ id: "radius", name: "Radius" }), null);
  assert.equal(providerIconName({ id: "custom-1", name: "我的网关" }), null);
});
