/** Real Settings view with deterministic data, for the marketing site screenshots (?page=models|appearance, ?theme=dark, ?en). */
import React from "react";
import { createRoot } from "react-dom/client";
import type { ModelSummary, ProviderSummary, VelaApi } from "@vela/shared";
import { SettingsView } from "../src/renderer/components/SettingsView";
import { Sidebar } from "../src/renderer/components/Sidebar";
import { usePreferences } from "../src/renderer/hooks/usePreferences";
import type { useModels } from "../src/renderer/hooks/useModels";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
const locale = params.has("en") ? "en" : "zh-CN";
setActiveLocale(locale);
document.documentElement.dataset.scheme = params.get("theme") ?? "light";
try { localStorage.setItem("vela.settingsPage", JSON.stringify(params.get("page") ?? "models")); } catch {}
const noop = () => {};
const noopSubscription = () => noop;
const stubs = {
  platform: "darwin", setLocale: noop, listOpenTargets: async () => [],
  listSkills: async () => ({ skillsDir: "/preview/skills", skills: [], diagnostics: [] }),
  getAgentSettings: async () => ({ provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" }),
  onWorkspaceEvent: noopSubscription, onGitEvent: noopSubscription, onEvent: noopSubscription,
  pickAttachments: async () => [], hydrateAttachments: async () => [],
};
// Unstubbed API (including nested namespaces) resolves to null; on*/subscribe* return a no-op unsubscribe.
const lenient = (name: string): unknown => new Proxy(function () {}, {
  get: (_t, k: string) => k === "then" ? undefined : lenient(k),
  apply: () => /^(on|subscribe)/.test(name) ? noop : Promise.resolve(null),
});
window.vela = new Proxy(stubs, {
  get: (target, name: string) => name in target ? (target as Record<string, unknown>)[name]
    : name === "development" ? undefined : lenient(name),
}) as unknown as VelaApi;
const oauth = { type: "oauth", label: "OAuth" }, key = { type: "api_key", label: "API key" };
const provider = (id: string, name: string, connected: boolean, methods = [key]): ProviderSummary => ({
  id, name, authenticated: connected, stored: connected, custom: false, authSource: null, methods, endpoint: null, modelCount: connected ? 6 : 0,
} as unknown as ProviderSummary);
const providers = [
  provider("openai-codex", "OpenAI Codex", true, [oauth]), provider("deepseek", "DeepSeek", true),
  provider("anthropic", "Anthropic", false, [key, oauth]), provider("google", "Google Gemini", false),
  provider("openrouter", "OpenRouter", false), provider("xai", "xAI", false), provider("mistral", "Mistral", false),
  provider("groq", "Groq", false), provider("amazon-bedrock", "Amazon Bedrock", false),
];
const mk = (provider: string, providerName: string, id: string, name: string): ModelSummary =>
  ({ provider, providerName, id, name, reasoning: true, contextWindow: 256000, available: true, custom: false, thinkingLevels: ["low", "medium", "high"] }) as ModelSummary;
const catalogModels = [
  ...["gpt-6.1-sol", "gpt-6-luna", "gpt-6-mini", "gpt-6-nano", "gpt-5.5-codex", "gpt-5.5"].map(id => mk("openai-codex", "OpenAI Codex", id, id)),
  ...["deepseek-v4.1-pro", "deepseek-v4.1-flash", "deepseek-v4"].map(id => mk("deepseek", "DeepSeek", id, id)),
];
const models = {
  catalog: { providers, models: catalogModels, error: null }, catalogError: null, actionError: null, refreshing: false,
  login: { active: false }, select: noop, setThinking: noop, add: async () => null, remove: async () => null, logout: noop,
  loginProvider: noop, replyLogin: noop, cancelLogin: noop, dismissLogin: noop, refreshFromPi: async () => null,
} as unknown as ReturnType<typeof useModels>;
const project = {
  workspace: { current: "/projects/atlas-web", recents: [] }, approval: null, environment: null, environments: [],
  sandboxMode: "ask", git: null, openWorkspaceDialog: async () => {}, replyApproval: noop, listBranches: async () => [],
} as unknown as ProjectApi;
const now = Date.now();
const conversations = ["修复登录重定向问题", "为项目列表添加搜索", "整理组件库文档"].map((title, i) => ({
  id: `demo-${i}`, title, cwd: "/projects/atlas-web", status: "ready" as const, createdAt: now - i * 3600000, updatedAt: now - i * 3600000, archivedAt: null,
}));
const resize = { widths: { left: 216, right: 300, workbench: 520 }, startResize: noop, nudge: noop, reset: noop };

function Fixture() {
  const preferences = usePreferences();
  return <div className="vela-window platform-darwin right-collapsed" style={{ height: "100vh", "--sidebar-left-width": "216px" } as React.CSSProperties}>
    <Sidebar collapsed={false} platform="darwin" resize={resize} conversations={conversations} activeConversationId="demo-0"
      settingsOpen settingsLabel={locale === "en" ? "Settings" : "设置"} onToggle={noop} onOpenSettings={noop} onNewChat={noop}
      onSwitchConversation={noop} onArchiveConversation={noop} onRenameConversation={noop} />
    <div className="main-stage"><div className="main-stage-pane">
      <SettingsView onPreviewSound={(() => {}) as never} preferences={preferences} platform="darwin" models={models} project={project}
        conversations={conversations} conversationId="demo-0" onUnarchiveConversation={noop} onClose={noop} />
    </div></div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<AppLocaleProvider locale={locale}><Fixture /></AppLocaleProvider>);
