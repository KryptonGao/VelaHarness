/** Real components for the modern Codex grouping interaction checks. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { AgentInfo, AppState, ToolTrace, VelaApi } from "@vela/shared";
import { usePreferences } from "../src/renderer/hooks/usePreferences";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import { CoherentGroup } from "../src/renderer/components/Thinking";
import { ToolList } from "../src/renderer/components/ToolCard";
import { AgentPane } from "../src/renderer/components/AgentPane";
import { ThinkingGroupModeContext } from "../src/renderer/components/ThinkingGroupModeContext";
import { ConversationDisplayPage } from "../src/renderer/components/settings/ConversationDisplayPage";
import { settingsCopy } from "../src/renderer/components/settings-copy";
import { ChatView } from "../src/renderer/components/ChatView";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import type { useModels } from "../src/renderer/hooks/useModels";
import "../src/renderer/styles.css";

window.addEventListener("error", event => console.error(event.error?.stack ?? event.message));
window.vela = {
  platform: "darwin", setLocale() {}, setRunView: async () => {}, setRecommendedActions: async () => {}, estimateTaskCost: async () => null,
  listOpenTargets: async () => [], listSkills: async () => ({ skills: [] }),
  getIntelligentUi: async () => ({ preference: "auto", microApps: false }),
  getAgentSettings: async () => ({ provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" }),
} as unknown as VelaApi;

const tools: ToolTrace[] = [
  { id: "command", name: "bash", status: "done", activity: {
    command: "pwd && rg --files -g '*.swift' -g 'Package.swift'",
    body: Array.from({ length: 40 }, (_, i) => `OpenType/UI/Settings/SettingsView${i}.swift`).join("\n"),
  } },
  { id: "edit", name: "edit", status: "done", activity: { path: "src/SettingsView.tsx", diff: Array.from({ length: 35 }, (_, i) => `+${i + 1} const setting${i} = true;`).join("\n") } },
  ...Array.from({ length: 20 }, (_, i): ToolTrace => ({ id: `read-${i}`, name: "read", status: "done", activity: { path: `src/SettingsStore${i}.swift`, body: "Content" } })),
];
const thought = "**Inspecting settings**\n\nThis summary stays out of the expanded Codex tool list.";
const agent = {
  id: "agent-1", parentId: "root", path: "/root/settings", name: "settings", kind: "worker",
  status: "completed", depth: 1, task: "Inspect settings", steps: [], mutated: false, finalText: null, error: null,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, activeMs: 0, runningSince: null, pauseRequested: false, createdAt: 1, updatedAt: 1,
} as unknown as AgentInfo;
const noop = () => {};
const ready = async () => {};
const project = { sandboxMode: "ask", approval: null, workspace: null, git: null, environment: null, environments: [], openWorkspaceDialog: ready } as unknown as ProjectApi;
const models = { catalog: { models: [], providers: [] }, login: { active: false }, select: noop, setThinking: noop, add: noop, remove: noop,
  logout: noop, loginProvider: noop, replyLogin: noop, cancelLogin: noop, dismissLogin: noop } as unknown as ReturnType<typeof useModels>;
const state = {
  activeConversationId: "codex", conversations: [{ id: "codex", title: "Inspect settings", status: "ready" }],
  context: { messageCount: 3, toolCallCount: 22, turnCount: 1, stepCount: 1, tokens: 0, contextWindow: null, percent: null,
    segments: { system: 0, tools: 0, rules: 0, skills: 0, conversation: 0 }, sessionTokens: null, cacheHitRate: null, outputSpeed: null },
  session: { id: "codex", title: "Inspect settings", status: "ready", mode: "agent", modelReady: false, tools: [], thinkingLevels: [] },
} as unknown as AppState;

function Fixture() {
  const preferences = usePreferences();
  const [live, setLive] = useState(false);
  const [count, setCount] = useState(tools.length);
  const [model, setModel] = useState("gpt-6.1");
  const [settings, setSettings] = useState(false);
  const [chat, setChat] = useState(false);
  Object.assign(window, {
    fixturePreferences: preferences,
    flushFixture: flushSync,
    updateFixture: (patch: { live?: boolean; count?: number; model?: string; settings?: boolean; chat?: boolean }) => flushSync(() => {
      if (patch.live !== undefined) setLive(patch.live);
      if (patch.count !== undefined) setCount(patch.count);
      if (patch.model !== undefined) setModel(patch.model);
      if (patch.settings !== undefined) setSettings(patch.settings);
      if (patch.chat !== undefined) setChat(patch.chat);
    }),
  });
  setActiveLocale(preferences.locale);
  const list = tools.slice(0, count);
  const entries = [
    { type: "thinking" as const, id: "thought", messageId: "message", text: thought },
    ...list.map(tool => ({ type: "tool" as const, id: tool.id, messageId: "message", tool })),
  ];
  const modern = preferences.thinkingGroupMode === "codex-modern";
  if (chat) return <AppLocaleProvider locale={preferences.locale}>
    <ThinkingGroupModeContext.Provider value={preferences.thinkingGroupMode}>
      <div id="main-chat" style={{ display: "flex", height: "100vh" }}>
        <ChatView embedded messages={[
          { id: "user", role: "user", text: "Inspect settings", thinking: "", tools: [] },
          { id: "process", role: "assistant", model, text: "", thinking: thought, tools: list },
          { id: "reply", role: "assistant", model, text: "Settings inspected.", thinking: "", tools: [] },
        ]} state={state} project={project} models={models} toolDisplay={preferences.toolDisplay} sendError={null} platform="darwin"
          leftCollapsed rightCollapsed onToggleLeft={noop} onToggleRight={noop} onSend={ready} onAbort={ready} onMode={noop}
          getQuestion={() => null} onReplyQuestion={noop} onBranch={noop} onRemoveInstruction={ready}
          showNewTab={false} onNewTab={noop} onOpenChanges={noop} />
      </div>
    </ThinkingGroupModeContext.Provider>
  </AppLocaleProvider>;
  return <AppLocaleProvider locale={preferences.locale}>
    {settings ? <ConversationDisplayPage preferences={preferences} copy={settingsCopy(preferences.locale)} catalog={null} /> : null}
    <main className="main-chat-view" data-tool-display={preferences.toolDisplay} style={{ width: "100%", maxWidth: 800, padding: 24, position: "relative", height: "auto" }}>
      <div style={{ position: "relative", zIndex: 2 }}>
      <article className="assistant-block" id="direct">
        <CoherentGroup entries={entries} live={live} showActivityIndicator codex codexModern={modern}>
          <ToolList tools={list} display={preferences.toolDisplay} fold="none" />
        </CoherentGroup>
      </article>
      <ThinkingGroupModeContext.Provider value={preferences.thinkingGroupMode}>
        <div id="agent" className="workbench-panel" style={{ height: 400, display: "flex", position: "relative", inset: "auto", width: "100%" }}>
          <AgentPane agent={agent} agents={[agent]} messages={[
            { id: "agent-message", role: "assistant", model, text: "", thinking: thought, tools: list },
            { id: "agent-reply", role: "assistant", model, text: "Settings inspected.", thinking: "", tools: [] },
          ]} onSwitch={noop} ensureMessages={noop} onControl={noop} toolDisplay={preferences.toolDisplay} />
        </div>
      </ThinkingGroupModeContext.Provider>
      </div>
    </main>
  </AppLocaleProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
