/** GPT usage ring beside the model name. ?plan=plus|pro (pro is weekly only), ?high=1, ?theme=dark, ?en, ?provider=anthropic. */
import React from "react";
import { createRoot } from "react-dom/client";
import type { UsageLimits } from "@vela/shared";
import { ModelControls } from "../src/renderer/components/ModelControls";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
const locale = params.has("en") ? "en" : "zh-CN";
setActiveLocale(locale);
document.documentElement.dataset.scheme = params.get("theme") ?? "light";

const pro = params.get("plan") === "pro";
const high = params.has("high");
const hour = 3600_000;
const limits: UsageLimits = {
  provider: "openai-codex",
  plan: pro ? "pro" : "plus",
  fetchedAt: Date.now(),
  windows: [
    ...(pro ? [] : [{ windowMinutes: 300, usedPercent: high ? 93 : 4, resetsAt: Date.now() + 3 * hour }]),
    { windowMinutes: 10080, usedPercent: high ? 78 : 25, resetsAt: Date.now() + 80 * hour },
  ],
};
(window as unknown as { vela: unknown }).vela = { getUsageLimits: async () => limits };

const provider = params.get("provider") ?? "openai-codex";
const noop = async () => undefined;
createRoot(document.getElementById("root")!).render(
  <AppLocaleProvider locale={locale}>
    <div style={{ padding: "180px 40px 40px", display: "flex", justifyContent: "flex-end", background: "var(--bg-chat)", minHeight: "100vh" }}>
      <div className="dock-controls-row" style={{ position: "relative" }}>
        <ModelControls
          modelLabel="GPT-6.1 Sol" modelProvider={provider} modelId="gpt-6.1-sol"
          thinkingLevel="high" thinkingLevels={["low", "medium", "high", "xhigh"]}
          disabled={false} catalog={null} catalogError={null} actionError={null} hiddenModels={[]}
          login={{ active: false, notices: [], progress: null, prompt: null, error: null }}
          onSelect={noop} onThinking={noop} onAdd={async () => null} onRemove={noop} onLogout={noop}
          onLogin={noop} onReplyLogin={async () => undefined} onCancelLogin={async () => undefined} onDismissLogin={() => undefined}
        />
      </div>
    </div>
  </AppLocaleProvider>,
);
