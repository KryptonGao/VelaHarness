/** 真实 App 与内存会话服务；聊天标签的 Electron 交互夹具。 */
import React from "react";
import { createRoot } from "react-dom/client";
import type { AgentStreamEvent, AppState, AskUserQuestionEvent, ImageAttachment, SessionSnapshot, TranscriptMessage, VelaApi } from "@vela/shared";
import { defaultContextLimitSettings, defaultTaskBudgetSettings, emptyConflictsState } from "@vela/shared";
import { App } from "../src/renderer/App";
import "../src/renderer/styles.css";
import "../src/renderer/info-cards.css";
import "../src/renderer/components/intelligent-ui/intelligent-ui.css";

const params = new URLSearchParams(location.search);
// A fresh navigation starts an independent fixture with new in-memory conversations.
// A real reload keeps the saved layout for persistence tests.
if ((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)?.type === "navigate") {
  for (const key of Object.keys(localStorage)) if (key.startsWith("vela.workbench.") || key === "vela.filePreviewTabsByWorkspace") localStorage.removeItem(key);
}
for (const [key, value] of Object.entries({ "vela.onboarding.complete": "true", "vela.locale": params.get("locale") ?? "zh-CN",
  "vela.leftCollapsed": "true", "vela.thinkingSummary": "false", "vela.appearance": params.get("theme") ?? "light",
  "vela.infoLayout": params.has("titlebar") ? "cards" : "sidebar", "vela.soundEffects": "false" })) localStorage.setItem(key, value);
if (params.has("titlebar")) {
  localStorage.setItem("vela.conversationWorkbenchTabs", String(params.get("titlebar") !== "ordinary-classic"));
  localStorage.setItem("vela.borderlessInterface", String(params.get("titlebar") === "borderless"));
  localStorage.setItem("vela.environmentCollapsed", "true");
}
const cwd = "/projects/VelaHarness";
const events = new Set<(event: AgentStreamEvent) => void>();
const questions = new Set<(event: AskUserQuestionEvent) => void>();
const sessions = new Map<string, SessionSnapshot>();
const messages = new Map<string, TranscriptMessage[]>();
let active = "main-chat";
let sequence = 0;
const modelThinkingLevels = (modelId: string): SessionSnapshot["thinkingLevels"] => ["off", modelId === "two" ? "minimal" : "low", "medium", "high", "ultra"];
const snapshot = (id: string, title: string): SessionSnapshot => ({ id, title, cwd, status: "ready", mode: "agent",
  model: "Model One", modelProvider: "fixture", modelId: "one", modelReady: true, thinkingLevel: "medium", thinkingLevels: modelThinkingLevels("one"),
  tools: [], proposedPlan: null, planRevisions: [], executionPlan: null, goal: null, memory: [], error: null, pendingInstructions: [] });
sessions.set(active, snapshot(active, "主聊天"));
messages.set(active, [
  { id: "u-main", role: "user", text: "继续完善工作面板，保留这里的任务上下文。", thinking: "", tools: [], timestamp: 1 },
  { id: "a-main", role: "assistant", text: "主聊天的上下文会保留。你可以在右侧面板开启独立对话，同时查看文件、终端和浏览器。", thinking: "", tools: [], timestamp: 2 },
]);
if (params.has("microApp")) messages.get(active)![1].text = ["```vela-app", '{"op":"app","id":"timer","title":"计时器","version":1,"icon":"clock"}', '<input id="note" value="initial">', "```"].join("\n");
const state = (id = active): AppState => structuredClone({ activeConversationId: id, session: sessions.get(id)!, agents: [],
  conversations: [...sessions.values()].map(session => ({ id: session.id!, title: session.title, status: session.status, cwd,
    hasWorkspace: true, messageCount: messages.get(session.id!)?.length ?? 0, createdAt: 1, updatedAt: 2, archivedAt: null })),
  context: { messageCount: messages.get(id)?.length ?? 0, toolCallCount: 0, turnCount: 0, stepCount: 0, tokens: 0, contextWindow: 100000,
    percent: 0, segments: { system: 0, tools: 0, rules: 0, skills: 0, conversation: 0 }, sessionTokens: null, cacheHitRate: null, outputSpeed: null },
});
const emit = (event: AgentStreamEvent) => { for (const listener of events) listener(event); };
const broadcast = () => emit({ type: "state", state: state() });
const titlebarHistory = (id: string): TranscriptMessage[] => [
  { id: `first-${id}`, role: "user", text: "First transcript message", thinking: "", tools: [] },
  { id: `reply-${id}`, role: "assistant", thinking: "", tools: [], text: [
    "[Before](https://example.test/before)", "[Focus target](https://example.test/target)",
    ...Array.from({ length: 36 }, (_, i) => `Transcript paragraph ${i + 1}`),
  ].join("\n\n") },
];
if (params.has("titlebar")) messages.set(active, titlebarHistory(active));
if (params.has("liveChanges")) {
  Object.assign(sessions.get(active)!, { status: "streaming", turnStartedAt: Date.now() });
  messages.get(active)![1].tools.push({ id: "edit", name: "edit", status: "done", activity: { path: "chat.ts", diff: "+1 updated" } });
}
const calls: { name: string; id?: string; text?: string; images?: ImageAttachment[]; options?: unknown }[] = [];
const conflictListeners = new Set<() => void>();
let conflictState = emptyConflictsState;
const fixture = {
  setOverlaps(files: string[]) {
    conflictState = { ...emptyConflictsState, overlaps: files.map(file => ({ path: `${cwd}/${file}`, relativePath: file,
      conversations: [active, "other-chat"].map(id => ({ conversationId: id, title: id, editedAt: 1 })) })) };
    for (const listener of conflictListeners) listener();
  },
  calls, active: () => active, state,
  loadTitlebarHistory(id: string) { messages.set(id, titlebarHistory(id)); broadcast(); },
  failCreate: false, deferCreate: false, releaseCreate: () => {},
  emit,
  finish(id: string) {
    sessions.get(id)!.status = "ready";
    sessions.get(id)!.turnCompletedAt = Date.now();
    broadcast();
  },
  changeMain() { active = "other-main"; sessions.set(active, snapshot(active, "另一条主聊天")); messages.set(active, []); broadcast(); },
};
(window as unknown as { chatFixture: typeof fixture }).chatFixture = fixture;
const subscribe = () => () => {};
window.vela = {
  conflicts: { list: async () => conflictState, subscribe: listener => { conflictListeners.add(listener); return () => { conflictListeners.delete(listener); }; },
    moveToWorktree: async () => { throw new Error("Not implemented"); } },
  platform: "darwin", setLocale() {}, setAppearance: async () => {}, setRunView: async () => {}, setRecommendedActions: async () => {}, setShortcuts() {},
  getState: async id => state(id), getMessages: async id => structuredClone(messages.get(id) ?? []), getAgentMessages: async () => [],
  getTrace: async () => ({ version: 1, nodes: [], requests: [], summaries: [], warning: null }),
  onEvent: listener => { events.add(listener); return () => { events.delete(listener); }; },
  onQuestionEvent: listener => { questions.add(listener); return () => { questions.delete(listener); }; },
  onModelEvent: subscribe, onWorkspaceEvent: subscribe, onGitEvent: subscribe, onApprovalEvent: subscribe, onMenuAction: subscribe,
  getWorkspaceState: async () => ({ current: cwd, folders: [], recents: [{ path: cwd, name: "VelaHarness", lastUsedAt: 1 }] }), getEnvironment: async () => null, listEnvironments: async () => [],
  getGitStatus: async () => null, listBranches: async () => [], getPullRequest: async () => null, getSandboxMode: async () => "ask",
  getCatalog: async () => ({ error: null, providers: [], models: [["one", "Model One"], ["two", "Model Two"], ["unnamed", "  "]].map(([id, name]) => ({ provider: "fixture", providerName: "Fixture",
    id, name, reasoning: true, contextWindow: 100000, available: true, custom: false, thinkingLevels: modelThinkingLevels(id) })) }),
  getAgentSettings: async () => ({ provider: "fixture", modelId: "one", thinkingLevel: "medium", newConversationSelection: "default", instructions: "" }),
  getContextLimit: async () => defaultContextLimitSettings, getTaskBudget: async () => defaultTaskBudgetSettings,
  getIntelligentUi: async () => ({ preference: "auto", microApps: params.has("microApp") }),
  uiSandboxIssue: async () => ({ ok: true, token: "fixture" }),
  uiSandboxRevoke: async () => {},
  estimateTaskCost: async () => null,
  listSkills: async () => ({ skills: [] }), listOpenTargets: async () => [],
  createConversation: async (_cwd, options) => {
    calls.push({ name: "create", options });
    if (fixture.deferCreate) await new Promise<void>(resolve => { fixture.releaseCreate = resolve; });
    if (fixture.failCreate) throw new Error("新建对话失败");
    const id = `panel-${++sequence}`;
    sessions.set(id, snapshot(id, "新对话")); messages.set(id, []);
    if (options?.activate !== false) active = id;
    broadcast(); return state(id);
  },
  prompt: async (text, images, id = active, deliverAs) => {
    calls.push({ name: deliverAs ?? "prompt", id, text, ...(images && { images }) });
    const session = sessions.get(id)!;
    if (!deliverAs) {
      messages.set(id, [...messages.get(id) ?? [], { id: `u-${id}`, role: "user", text, thinking: "", tools: [] }]);
      session.title = text; session.status = "streaming"; session.turnStartedAt = Date.now();
    }
    broadcast(); return state();
  },
  abort: async (id = active) => { calls.push({ name: "abort", id }); fixture.finish(id); return state(); },
  setInteractionMode: async (mode, id = active) => { calls.push({ name: "mode", id }); sessions.get(id)!.mode = mode; broadcast(); return state(); },
  selectModel: async (_provider, model, id = active) => {
    const session = sessions.get(id)!;
    const thinkingLevels = modelThinkingLevels(model);
    const thinkingLevel = thinkingLevels.includes(session.thinkingLevel) ? session.thinkingLevel : "medium";
    calls.push({ name: "model", id });
    Object.assign(session, { modelId: model, model: model === "one" ? "Model One" : "Model Two", thinkingLevels, thinkingLevel });
    broadcast(); return state(id);
  },
  setThinkingLevel: async (thinkingLevel, id = active) => { calls.push({ name: "thinking", id }); sessions.get(id)!.thinkingLevel = thinkingLevel; broadcast(); return state(id); },
  switchConversation: async id => { calls.push({ name: "switch", id }); active = id; broadcast(); return state(); },
  renameConversation: async (id, title) => { sessions.get(id)!.title = title; broadcast(); return state(); },
  rewindConversation: async (id, turnIndex) => {
    calls.push({ name: "rewind", id });
    const history = messages.get(id)!;
    const turn = history.map((message, index) => message.role === "user" ? index : -1).filter(index => index >= 0)[turnIndex];
    messages.set(id, history.slice(0, turn));
    return { state: state(), messages: structuredClone(messages.get(id)!) };
  },
  listWorkspaceFiles: async () => ({ root: cwd, files: [] }),
} as VelaApi;
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
