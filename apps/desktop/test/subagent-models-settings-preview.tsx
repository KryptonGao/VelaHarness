/**
 * Real SubagentModelsPage with an in-memory settings API. Open manually
 * (optionally with ?locale=<id>, ?appearance=dark, ?empty=1 for no models, ?stale=1 for a pool entry that is no longer available).
 * Nothing here touches real settings.
 */
import type { AgentSettings, ModelCatalog, ModelSummary } from "@vela/shared";
import React from "react";
import { createRoot } from "react-dom/client";
import { settingsCopy } from "../src/renderer/components/settings-copy";
import { SubagentModelsPage } from "../src/renderer/components/settings/SubagentModelsPage";
import { usePreferences } from "../src/renderer/hooks/usePreferences";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
for (const [key, name] of [["locale", "vela.locale"], ["appearance", "vela.appearance"]] as const) {
  const value = params.get(key);
  if (value) { try { localStorage.setItem(name, value); } catch { /* ignore */ } }
}

const model = (provider: string, providerName: string, id: string, name: string, patch: Partial<ModelSummary> = {}): ModelSummary => ({
  provider, providerName, id, name, reasoning: false, vision: true, contextWindow: 200_000, available: true, custom: false,
  thinkingLevels: ["off", "low", "medium", "high"], ...patch,
});
const catalog: ModelCatalog = {
  error: null,
  providers: [],
  models: params.has("empty") ? [] : [
    model("anthropic", "Anthropic", "claude-opus", "Claude Opus", { reasoning: true }),
    model("anthropic", "Anthropic", "claude-sonnet", "Claude Sonnet", { reasoning: true }),
    model("anthropic", "Anthropic", "claude-haiku", "Claude Haiku"),
    model("openai", "OpenAI", "gpt-5", "GPT-5", { reasoning: true }),
    model("openai", "OpenAI", "gpt-5-mini", "GPT-5 mini"),
    model("deepseek", "DeepSeek", "deepseek-v4", "DeepSeek V4", { custom: true }),
    model("google", "Google Gemini", "gemini-pro", "Gemini Pro", { available: false }),
  ],
};

let settings: AgentSettings = {
  provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "",
  subagentModels: params.has("stale")
    ? [{ provider: "anthropic", modelId: "claude-haiku" }, { provider: "google", modelId: "gemini-pro" }]
    : params.has("empty") ? [] : [{ provider: "anthropic", modelId: "claude-haiku" }],
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const api: Record<string, unknown> = {
  getAgentSettings: async () => { await delay(150); return settings; },
  saveAgentSettings: async (next: AgentSettings) => { await delay(250); settings = next; return settings; },
};
// Preferences call a handful of other host methods; anything not stubbed above is a no-op.
(window as unknown as { vela: unknown }).vela = new Proxy(api, { get: (target, key) => target[key as string] ?? (() => undefined) });

function Harness() {
  const prefs = usePreferences();
  const copy = settingsCopy(prefs.locale);
  return (
    <main className="settings-view" style={{ height: "100vh", background: "var(--bg-chat)" }}>
      <div className="settings-body" style={{ height: "100%" }}>
        <div className="settings-content" style={{ flex: 1 }}>
          <header className="settings-page-header"><h2>{copy.pages.subagents.label}</h2></header>
          <SubagentModelsPage copy={copy} catalog={catalog} hiddenModels={["openai/gpt-5-mini"]} />
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
