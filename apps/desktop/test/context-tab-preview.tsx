/** 「上下文」标签页:?theme=dark, ?width=480, ?en, ?scenario=custom|empty。 */
import React from "react";
import { createRoot } from "react-dom/client";
import type { ContextUsage, ConversationContextLimit, VelaApi } from "@vela/shared";
import { ContextTab } from "../src/renderer/components/ContextTab";
import { ConversationViewTabs } from "../src/renderer/components/ConversationViewTabs";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
setActiveLocale(params.has("en") ? "en" : "zh-CN");
document.documentElement.dataset.scheme = params.get("theme") ?? "light";
const width = Number(params.get("width"));

let override: { limitTokens: number | null } | null = params.get("scenario") === "custom" ? { limitTokens: 128_000 } : null;
const global = { limitTokens: null as number | null };
const limit = (): ConversationContextLimit => ({ global, override, effective: override ?? global });
window.vela = {
  getConversationContextLimit: async () => limit(),
  setConversationContextLimit: async (_id: string, next: { limitTokens: number | null } | null) => { override = next; return limit(); },
} as unknown as VelaApi;

const empty = params.get("scenario") === "empty";
const effective = () => override?.limitTokens ?? null;
const usage = (): ContextUsage => {
  const window = Math.min(1_000_000, effective() ?? 1_000_000);
  const segments = empty ? { system: 0, tools: 0, rules: 0, skills: 0, conversation: 0 } : { system: 123, tools: 4600, rules: 5100, skills: 702, conversation: 30_200 };
  const tokens = Object.values(segments).reduce((sum, value) => sum + value, 0);
  return {
    messageCount: 86, toolCallCount: 41, turnCount: 12, stepCount: 53, tokens, contextWindow: window,
    percent: (tokens / window) * 100, segments, sessionTokens: 1_284_300, cacheHitRate: 0.87, outputSpeed: 62,
    modelContextWindow: 1_000_000, contextLimit: effective(), compactAt: window - Math.min(16384, Math.floor(window * 0.25)),
  };
};

function App() {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  // 预览里每次设置变更后重新取一次占用，模拟主进程推送的新状态。
  const original = window.vela.setConversationContextLimit;
  window.vela.setConversationContextLimit = async (...args) => { const result = await original(...args); force(); return result; };
  return (
    <AppLocaleProvider locale={params.has("en") ? "en" : "zh-CN"}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: width || undefined, background: "var(--bg-chat)" }}>
        <ConversationViewTabs view="context" showVersionControl onChange={() => {}} />
        <ContextTab conversationId="preview" context={empty ? null : usage()} />
      </div>
    </AppLocaleProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
