/**
 * Real UsageReport with main-agent requests plus subagent requests on another model.
 * ?en for English, ?theme=dark. Nothing here touches real data.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import type { TraceAgentRequest, TraceRequest } from "@vela/shared";
import { UsageReport } from "../src/renderer/components/usage/UsageView";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
const locale = params.has("en") ? "en" : "zh-CN";
setActiveLocale(locale);
document.documentElement.dataset.scheme = params.get("theme") ?? "light";
(window as unknown as { vela: unknown }).vela = new Proxy({}, { get: () => () => Promise.resolve(null) });

const at = new Date(2026, 9, 2, 8, 0).getTime();
const requests: TraceRequest[] = Array.from({ length: 12 }, (_, index) => ({
  id: `request-${index + 1}`, number: index + 1, turn: 1, model: "openai-codex/gpt-6.1-sol", contextId: "context", status: "Completed",
  startedAt: at + index * 1000, completedAt: at + index * 1000 + 800, durationMs: 800, firstTokenMs: 200, generationMs: 600,
  usage: { input: 6000, output: 480, cacheRead: 90000, cacheWrite: 1000, totalTokens: 97480 },
}));
const agentRequests: TraceAgentRequest[] = Array.from({ length: 30 }, (_, index) => ({
  id: `agent-${index + 1}`, agentPath: "/root/scan", model: "anthropic/claude-haiku", status: "Completed",
  startedAt: at + 2000 + index * 500, completedAt: at + 2000 + index * 500 + 400, durationMs: null,
  usage: { input: 3000, output: 200, cacheRead: 0, cacheWrite: 0, totalTokens: 3200 },
}));

createRoot(document.getElementById("root")!).render(
  <AppLocaleProvider locale={locale}>
    <main style={{ padding: 24, background: "var(--bg-chat)", minHeight: "100vh" }}>
      <UsageReport requests={requests} agentRequests={params.has("without") ? [] : agentRequests} providers={[{ id: "openai-codex", name: "OpenAI Codex" }, { id: "anthropic", name: "Anthropic" }]} />
    </main>
  </AppLocaleProvider>,
);
