/**
 * Real OnboardingView with an in-memory IPC. Open manually (optionally with ?screen=<id>, ?locale=<id>, ?mode=intro) or with ?checks=1
 * to run the end-to-end flow checks. Nothing here touches real settings.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseReleaseNotesFile, selectReleaseNotes, type ReleaseNotes, type VelaApi } from "@vela/shared";
import releaseNotesFile from "../release-notes.json";
import { WhatsNewCard } from "../src/renderer/components/WhatsNewCard";
import { OnboardingView } from "../src/renderer/components/OnboardingView";
import { usePreferences } from "../src/renderer/hooks/usePreferences";
import { setActiveLocale } from "../src/renderer/locale";
import type { useModels } from "../src/renderer/hooks/useModels";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import "../src/renderer/styles.css";
import { runOnboardingChecks } from "./onboarding-checks";

const params = new URLSearchParams(location.search);
const automated = params.has("checks");
if (automated) {
  // 从干净的偏好开始，并固定英文，检查才能按文案找按钮。
  try { localStorage.clear(); localStorage.setItem("vela.locale", "en"); } catch { /* ignore */ }
} else if (params.get("locale")) {
  try { localStorage.setItem("vela.locale", params.get("locale")!); } catch { /* ignore */ }
}
if (params.get("appearance")) { try { localStorage.setItem("vela.appearance", params.get("appearance")!); } catch { /* ignore */ } }

const merge = (base: any, patch: any): any => Object.fromEntries(
  Object.keys({ ...base, ...patch }).map((key) => [key, patch?.[key] && typeof patch[key] === "object" && !Array.isArray(patch[key]) ? merge(base?.[key] ?? {}, patch[key]) : patch && key in patch ? patch[key] : base[key]]),
);

const notesFile = parseReleaseNotesFile(releaseNotesFile)!;

const initialState = () => ({
  notes: undefined as undefined | null,
  sandbox: "ask" as string,
  agent: { provider: null as string | null, modelId: null as string | null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" },
  ui: "auto",
  memory: true,
  resident: { mode: "standby", paused: false, showMenuBarIcon: true, launchAtLogin: false, quitWhenWindowsClosed: false,
    notifications: { enabled: true, hidePreview: false, notifyResults: false, quietHours: { enabled: false, startMinute: 1320, endMinute: 480 } },
    limits: { maxConcurrentTasks: 2, maxTaskMinutes: 60, dailyProactiveRuns: 10, pauseProactiveOnBattery: true } } as any,
  update: { status: "idle", currentVersion: notesFile.version, autoUpdate: true, installable: true } as any,
  skills: [] as any[],
  calls: [] as { name: string; arg?: unknown }[],
  completed: [] as unknown[],
  folderDialogs: 0,
});
type FixtureState = ReturnType<typeof initialState>;
let state = initialState();
const record = (name: string, arg?: unknown) => { state.calls.push({ name, arg }); };

window.vela = {
  platform: "darwin", setLocale() {},
  getAgentSettings: async () => ({ ...state.agent }),
  saveAgentSettings: async (value: any) => { record("saveAgentSettings", value); state.agent = { ...value }; return { ...state.agent }; },
  scanExternalSkills: async () => ({ skills: state.skills }),
  migrateSkills: async (ids: string[]) => { record("migrateSkills", ids); return { copied: ids, replaced: [], skipped: [] }; },
  getIntelligentUi: async () => ({ preference: state.ui, microApps: false }),
  setIntelligentUi: async (value: string) => { record("setIntelligentUi", value); state.ui = value; return { preference: state.ui, microApps: false }; },
  memory: {
    list: async () => ({ ok: true, value: { enabled: state.memory } }),
    setEnabled: async ({ enabled }: { enabled: boolean }) => { record("memory.setEnabled", enabled); state.memory = enabled; return { ok: true, value: { enabled } }; },
  },
  resident: {
    getSettings: async () => state.resident,
    updateSettings: async (patch: unknown) => { record("resident.updateSettings", patch); state.resident = merge(state.resident, patch); return state.resident; },
  },
  updates: {
    getState: async () => state.update,
    setAutoUpdate: async (enabled: boolean) => { record("updates.setAutoUpdate", enabled); state.update = { ...state.update, autoUpdate: enabled }; return state.update; },
  },
  getSandboxMode: async () => state.sandbox,
  releaseNotes: {
    get: async (locale: string) => state.notes === null ? null : selectReleaseNotes(notesFile, locale),
    openPage: async () => { record("releaseNotes.openPage"); },
    shouldAnnounce: async () => true,
  },
} as unknown as VelaApi;

const providers = [
  { id: "demo", name: "Demo AI", authenticated: true, stored: true, custom: false, methods: [{ type: "api_key" }] },
  { id: "later", name: "Later AI", authenticated: false, stored: false, custom: false, methods: [{ type: "api_key" }] },
];
const catalogModels = [
  { provider: "demo", providerName: "Demo AI", id: "demo-fast", name: "Demo Fast", reasoning: true, contextWindow: 1, available: true, custom: false, thinkingLevels: ["low", "medium", "high"] },
  { provider: "demo", providerName: "Demo AI", id: "demo-pro", name: "Demo Pro", reasoning: true, contextWindow: 1, available: true, custom: false, thinkingLevels: ["low", "medium", "high"] },
];
const models = { catalog: { providers, models: catalogModels }, login: { active: false },
  select() {}, setThinking() {}, add() {}, remove() {}, logout() {}, loginProvider() {}, replyLogin() {}, cancelLogin() {}, dismissLogin() {} } as unknown as ReturnType<typeof useModels>;

function Preview() {
  const preferences = usePreferences();
  setActiveLocale(preferences.locale); // App.tsx does the same on every render.
  const [run, setRun] = useState(0);
  const [screen, setScreen] = useState<string>(params.get("screen") ?? "language");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const project = {
    workspace: { current: workspace, recents: [] },
    openWorkspaceDialog: async () => { state.folderDialogs += 1; setWorkspace("/workspace/Vela"); },
    setSandboxMode: async (mode: string) => { record("setSandboxMode", mode); state.sandbox = mode; },
  } as unknown as ProjectApi;
  useEffect(() => {
    (window as any).onboardingFixture = {
      get state(): FixtureState { return state; },
      /** 重置模拟的主进程状态并从欢迎页重新挂载。 */
      reset(patch: Partial<FixtureState> = {}, startScreen = "language") { state = { ...initialState(), ...patch }; setScreen(startScreen); setWorkspace(null); setRun((value) => value + 1); },
    };
  }, []);
  useEffect(() => { if (automated) void runOnboardingChecks(); }, []);
  const [card, setCard] = useState<ReleaseNotes | null>(null);
  useEffect(() => { if (params.get("card")) void window.vela.releaseNotes!.get(preferences.locale).then(setCard); }, [preferences.locale]);
  if (card) return <div className="vela-window platform-darwin" style={{ height: "100vh" }}><WhatsNewCard notes={card} locale={preferences.locale} onClose={() => setCard(null)} /></div>;
  return <div className="vela-window platform-darwin onboarding-window" style={{ height: "100vh" }}>
    <OnboardingView key={run} preferences={preferences} models={models} project={project} mode={params.get("mode") === "intro" ? "intro" : "full"} initialScreen={screen} onScreenChange={setScreen}
      onComplete={(options) => { state.completed.push(options ?? null); }} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
