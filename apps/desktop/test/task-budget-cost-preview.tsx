/** Cost guard UI: limit tab, banner (?phase=warning|exhausted), pre-run forecast. ?theme=dark, ?en, ?tab (limit tab only), ?uncounted=0, ?over=1. */
import React from "react";
import { createRoot } from "react-dom/client";
import { parseTaskBudgetSettings, type ConversationTaskBudget, type SessionSnapshot, type TaskBudgetSettings, type TaskBudgetState, type TaskCostForecast, type VelaApi } from "@vela/shared";
import { TaskBudgetBanner } from "../src/renderer/components/TaskBudgetBanner";
import { TaskBudgetTab } from "../src/renderer/components/TaskBudgetTab";
import { TaskCostForecastHint } from "../src/renderer/components/TaskCostForecastHint";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
const locale = params.has("en") ? "en" : "zh-CN";
setActiveLocale(locale);
document.documentElement.dataset.scheme = params.get("theme") ?? "light";

const global: TaskBudgetSettings = { enabled: true, maxMinutes: 30, maxTokens: null, maxCost: { currency: "CNY", amount: 2 }, maxSubagents: 16, allowNestedSubagents: true };
let override: TaskBudgetSettings | null = global;
const conversation = (): ConversationTaskBudget => ({ global, override, effective: override ?? global });
const forecast: TaskCostForecast = { currency: "CNY", low: 0.84, median: 1.32, high: 2.4, samples: 7, sameModel: params.get("mixed") !== "1", limit: params.get("over") === "1" ? 1.2 : 2 };

(window as unknown as { vela: Partial<VelaApi> }).vela = {
  getConversationTaskBudget: async () => conversation(),
  setConversationTaskBudget: async (_id, next) => {
    override = next === null ? null : parseTaskBudgetSettings(next);
    return conversation();
  },
  estimateTaskCost: async () => forecast,
  setModelPrices: async () => undefined,
  getModelPrices: async () => [],
};

const phase = (params.get("phase") ?? "exhausted") as "warning" | "exhausted";
const uncounted = params.get("uncounted") === "0" ? 0 : 2;
const budget: TaskBudgetState = {
  phase, reason: "cost", startedAt: Date.now() - 95_000, tokensUsed: 412_000, maxTokens: null, maxMs: 30 * 60_000,
  costUsed: phase === "exhausted" ? 2.03 : 1.64, maxCost: { currency: "CNY", amount: 2 }, uncountedModels: uncounted,
  exhaustedAt: phase === "exhausted" ? Date.now() - 4_000 : null,
};
const idleSession = { id: "c1", status: "ready", modelProvider: "p", modelId: "m", taskBudget: null } as unknown as SessionSnapshot;

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ position: "relative", height: 210, margin: "0 0 12px", border: "1px dashed var(--border-subtle)", borderRadius: 12, ["--composer-clearance" as string]: "40px" }}>
    <small style={{ position: "absolute", top: 6, left: 10, color: "var(--text-muted)" }}>{title}</small>
    {children}
  </section>;
}

createRoot(document.getElementById("root")!).render(
  <AppLocaleProvider locale={locale}>
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 16, background: "var(--bg-chat)" }}>
      {params.has("tab") ? null : <Frame title="banner"><TaskBudgetBanner budget={budget} conversationId="c1" /></Frame>}
      {params.has("tab") ? null : <Frame title="forecast"><TaskCostForecastHint session={idleSession} /></Frame>}
      <div style={{ height: params.has("tab") ? 1250 : 760, position: "relative", display: "flex" }}><TaskBudgetTab conversationId="c1" budget={budget} /></div>
    </div>
  </AppLocaleProvider>,
);
