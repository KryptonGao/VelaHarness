/**
 * Real ModelsPage with an in-memory catalog. Open manually (optionally with ?locale=<id>, ?appearance=dark, ?empty=1).
 * Nothing here touches real settings.
 */
import type { CustomModelInput, ModelCatalog, ModelSummary, ProviderSummary } from "@vela/shared";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { settingsCopy } from "../src/renderer/components/settings-copy";
import { ModelsPage } from "../src/renderer/components/settings/ModelsPage";
import { usePreferences } from "../src/renderer/hooks/usePreferences";
import type { useModels } from "../src/renderer/hooks/useModels";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
for (const [key, name] of [["locale", "vela.locale"], ["appearance", "vela.appearance"]] as const) {
  const value = params.get(key);
  if (value) { try { localStorage.setItem(name, value); } catch { /* ignore */ } }
}

const provider = (id: string, name: string, patch: Partial<ProviderSummary> = {}): ProviderSummary => ({
  id, name, authenticated: false, stored: false, custom: false, authSource: null, methods: [{ type: "api_key", label: "API key" }], endpoint: null, modelCount: 0, ...patch,
});
const model = (providerId: string, providerName: string, id: string, patch: Partial<ModelSummary> = {}): ModelSummary => ({
  provider: providerId, providerName, id, name: id, reasoning: false, vision: false, contextWindow: 200_000, available: true, custom: false,
  thinkingLevels: ["off", "low", "medium", "high"], ...patch,
});
const ds = (id: string, reasoning = false, vision = false, contextWindow = 1_000_000) => model("deepseek", "DeepSeek", id, { custom: true, reasoning, vision, contextWindow });

const seed = (): ModelCatalog => ({
  error: null,
  providers: params.has("empty") ? [] : [
    provider("anthropic", "Anthropic", { authenticated: true, stored: true, authSource: "stored", methods: [{ type: "oauth", label: "Claude" }, { type: "api_key", label: "API key" }], modelCount: 3 }),
    provider("openai", "OpenAI", { authenticated: true, authSource: "environment", modelCount: 2 }),
    provider("github-copilot", "GitHub Copilot", { stored: true, methods: [{ type: "oauth", label: "GitHub" }], modelCount: 2 }),
    provider("google", "Google Gemini", { modelCount: 2 }),
    provider("xai", "xAI", { methods: [{ type: "oauth", label: "xAI" }, { type: "api_key", label: "API key" }] }),
    ...([["amazon-bedrock", "Amazon Bedrock"], ["ant-ling", "Ant Ling"], ["azure", "Azure"], ["baseten", "Baseten"], ["cerebras", "Cerebras"], ["cloudflare-workers-ai", "Cloudflare Workers AI"],
      ["fireworks", "Fireworks"], ["google-vertex", "Google Vertex AI"], ["groq", "Groq"], ["huggingface", "Hugging Face"], ["kimi-coding", "Kimi For Coding"], ["meta", "Meta"],
      ["minimax", "MiniMax"], ["mistral", "Mistral"], ["moonshotai", "Moonshot AI"], ["nvidia", "NVIDIA"], ["opencode", "OpenCode"], ["openrouter", "OpenRouter"], ["qwen-token-plan", "Qwen Token Plan"],
      ["together", "Together AI"], ["vercel-ai-gateway", "Vercel AI Gateway"], ["xiaomi", "Xiaomi MiMo"], ["zai", "Z.ai"], ["radius", "Radius"]] as const).map(([id, name]) => provider(id, name)),
    provider("deepseek", "DeepSeek", { custom: true, authenticated: true, stored: true, authSource: "models_json_key", endpoint: { baseUrl: "https://api.deepseek.com", api: "openai-responses" }, modelCount: 2 }),
    provider("ollama", "Ollama", { custom: true, authenticated: true, endpoint: { baseUrl: "http://127.0.0.1:11434/v1", api: "openai-completions" }, modelCount: 1 }),
  ],
  models: params.has("empty") ? [] : [
    model("anthropic", "Anthropic", "claude-opus-5-5", { reasoning: true, vision: true, contextWindow: 1_000_000 }),
    model("anthropic", "Anthropic", "claude-sonnet-5-5", { reasoning: true, vision: true, contextWindow: 1_000_000 }),
    model("anthropic", "Anthropic", "claude-haiku-5-5", { vision: true, contextWindow: 500_000 }),
    model("openai", "OpenAI", "gpt-5.5", { reasoning: true, vision: true, contextWindow: 400_000 }),
    model("openai", "OpenAI", "gpt-5.5-mini", { reasoning: true, contextWindow: 400_000 }),
    model("github-copilot", "GitHub Copilot", "gpt-5.5", { available: false, reasoning: true }),
    ds("deepseek-v4-pro", true), ds("deepseek-flash", false, true),
    model("ollama", "Ollama", "qwen2.5-coder:7b", { custom: true, contextWindow: 32768 }),
  ],
});

const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

function Harness() {
  const [catalog, setCatalog] = useState(seed);
  const [refreshing, setRefreshing] = useState(false);
  const prefs = usePreferences();
  const models = {
    catalog,
    catalogError: null,
    actionError: null,
    refreshing,
    refreshFromPi: async () => { setRefreshing(true); await delay(900); setRefreshing(false); return { catalog, offline: false, errors: [] }; },
    register: async (input: CustomModelInput) => {
      await delay();
      if (!input.baseUrl.startsWith("http")) return "接口地址需要以 http:// 或 https:// 开头";
      setCatalog((current) => {
        const exists = current.providers.some((item) => item.id === input.providerId);
        const providers = exists
          ? current.providers.map((item) => item.id === input.providerId ? { ...item, endpoint: { baseUrl: input.baseUrl, api: input.api } } : item)
          : [...current.providers, provider(input.providerId, input.providerName, { custom: true, authenticated: true, endpoint: { baseUrl: input.baseUrl, api: input.api } })];
        const rest = current.models.filter((item) => !(item.provider === input.providerId && item.id === input.modelId));
        const entry = model(input.providerId, input.providerName, input.modelId, { name: input.modelName || input.modelId, reasoning: input.reasoning, contextWindow: input.contextWindow ?? 0, custom: true });
        return { ...current, providers, models: [...rest, entry] };
      });
      return null;
    },
    remove: async (providerId: string, id: string) => {
      await delay(150);
      setCatalog((current) => {
        const modelsLeft = current.models.filter((item) => !(item.provider === providerId && item.id === id));
        const gone = !modelsLeft.some((item) => item.provider === providerId && item.custom);
        return { ...current, models: modelsLeft, providers: gone ? current.providers.filter((item) => item.id !== providerId) : current.providers };
      });
      return null;
    },
    logout: async (providerId: string) => setCatalog((current) => ({ ...current, providers: current.providers.map((item) => item.id === providerId ? { ...item, authenticated: false, stored: false } : item) })),
    loginProvider: async (providerId: string) => { await delay(); setCatalog((current) => ({ ...current, providers: current.providers.map((item) => item.id === providerId ? { ...item, authenticated: true, stored: true, authSource: "stored" } : item) })); },
  } as unknown as ReturnType<typeof useModels>;
  const copy = settingsCopy(prefs.locale);
  return (
    <main className="settings-view" style={{ height: "100vh", background: "var(--bg-chat)" }}>
      <div className="settings-body" style={{ height: "100%" }}>
        <div className="settings-content fill" style={{ flex: 1 }}>
          <div className="settings-page-fill"><ModelsPage copy={copy} models={models} preferences={prefs} /></div>
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
