import assert from "node:assert/strict";
import test from "node:test";
import type { ModelSummary, ProviderSummary } from "@vela/shared";
import {
  authSourceKind,
  formatContext,
  groupListed,
  listedProviders,
  providerModels,
  providerMonogram,
  providerStatus,
  resolveSelection,
  unlistedBuiltins,
} from "../src/renderer/components/settings/models-view.ts";

const provider = (id: string, patch: Partial<ProviderSummary> = {}): ProviderSummary => ({
  id,
  name: id,
  authenticated: false,
  stored: false,
  custom: false,
  authSource: null,
  methods: [],
  endpoint: null,
  modelCount: 0,
  ...patch,
});

const providers = [
  provider("anthropic", { authenticated: true, stored: true }),
  provider("openai", { authenticated: true, authSource: "environment" }),
  provider("copilot", { stored: true }),
  provider("google"),
  provider("deepseek", { custom: true, authenticated: true }),
  provider("ollama", { custom: true }),
];

test("provider status separates connected, expired and untouched providers", () => {
  assert.equal(providerStatus(providers[0]), "connected");
  assert.equal(providerStatus(providers[2]), "attention");
  assert.equal(providerStatus(providers[3]), "disconnected");
});

test("the list keeps connected and custom providers and the ones just picked", () => {
  const none = new Set<string>();
  assert.deepEqual(listedProviders(providers, none).map((item) => item.id), ["anthropic", "openai", "copilot", "deepseek", "ollama"]);
  assert.deepEqual(listedProviders(providers, new Set(["google"])).map((item) => item.id), ["anthropic", "openai", "copilot", "google", "deepseek", "ollama"]);
});

test("the add page offers only built-in providers that are not listed yet", () => {
  assert.deepEqual(unlistedBuiltins(providers, new Set()).map((item) => item.id), ["google"]);
  assert.deepEqual(unlistedBuiltins(providers, new Set(["google"])), []);
});

test("listed providers split into built-in and custom groups in order", () => {
  const groups = groupListed(listedProviders(providers, new Set()));
  assert.deepEqual(groups.builtin.map((item) => item.id), ["anthropic", "openai", "copilot"]);
  assert.deepEqual(groups.custom.map((item) => item.id), ["deepseek", "ollama"]);
});

test("context windows are shortened the way the model rows show them", () => {
  assert.equal(formatContext(1_000_000), "1M");
  assert.equal(formatContext(1_048_576), "1M");
  assert.equal(formatContext(262_144), "262.1K");
  assert.equal(formatContext(200_000), "200K");
  assert.equal(formatContext(32_768), "32.8K");
  assert.equal(formatContext(0), "");
  assert.equal(formatContext(Number.NaN), "");
});

test("auth sources fold into the four labels the account card knows", () => {
  assert.equal(authSourceKind("stored"), "stored");
  assert.equal(authSourceKind("environment"), "environment");
  assert.equal(authSourceKind("models_json_key"), "config");
  assert.equal(authSourceKind("models_json_command"), "config");
  assert.equal(authSourceKind("runtime"), "runtime");
  assert.equal(authSourceKind("fallback"), "runtime");
  assert.equal(authSourceKind(null), null);
});

test("monograms are stable per name and handle non-Latin or empty names", () => {
  assert.deepEqual(providerMonogram("DeepSeek"), providerMonogram("DeepSeek"));
  assert.equal(providerMonogram("deepseek").letter, "D");
  assert.equal(providerMonogram("空悲切").letter, "空");
  assert.equal(providerMonogram("  ").letter, "?");
  assert.ok(providerMonogram("Kimi").hue >= 0 && providerMonogram("Kimi").hue < 360);
});

test("provider models keep only the available models of that provider", () => {
  const model = (provider: string, id: string, available: boolean): ModelSummary => ({
    provider, providerName: provider, id, name: id, reasoning: false, contextWindow: 0, available, custom: false, thinkingLevels: [],
  });
  const all = [model("a", "1", true), model("a", "2", false), model("b", "3", true)];
  assert.deepEqual(providerModels(all, "a").map((item) => item.id), ["1"]);
});

test("selection survives while its provider is listed and falls back to the first", () => {
  const listed = listedProviders(providers, new Set());
  assert.equal(resolveSelection(listed, "openai"), "openai");
  assert.equal(resolveSelection(listed, "google"), "anthropic");
  assert.equal(resolveSelection(listed, null), "anthropic");
  assert.equal(resolveSelection([], "openai"), null);
});
