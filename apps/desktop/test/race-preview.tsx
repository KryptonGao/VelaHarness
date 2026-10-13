/** 真实的赛马面板与设置对话框，配假的 window.vela.races；供 Electron UI 检查与浏览器预览共用。 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Race, RaceAdoptResult, RaceDraft, RaceLane, VelaApi } from "@vela/shared";
import { RacePanel } from "../src/renderer/components/RacePanel";
import { RaceSetupDialog } from "../src/renderer/components/RaceSetupDialog";
import type { useModels } from "../src/renderer/hooks/useModels";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
const locale = params.has("en") ? "en" : "zh-CN";
setActiveLocale(locale);
document.documentElement.dataset.scheme = params.get("theme") ?? "light";
const scenario = params.get("scenario") ?? "panel";

const lane = (id: string, patch: Partial<RaceLane>): RaceLane => ({
  id, label: id, resolvedExecution: { model: { provider: "p", id: `model-${id}` }, thinkingLevel: "medium", sandboxMode: "smart" },
  extraPrompt: "", branch: `vela/race-aaaa1111-${id === "a" ? 1 : id === "b" ? 2 : 3}`, worktree: `/wt/${id}`, conversationId: `conv-${id}`,
  status: "responded", startedAt: 1_000_000, finishedAt: 1_040_000, tokens: { input: 6000, output: 6300, cacheRead: 0, total: 12_300 },
  diff: { files: 2, added: 10, removed: 3 }, commitSha: "a".repeat(40), changedFiles: ["src/a.ts", "src/b.ts"],
  verification: { state: "passed", exitCode: 0, durationMs: 12_000, outputTail: "ok" }, error: null, ...patch,
});

const initial = (): Race => ({
  id: "race-1", workspace: "/repo", startSha: "b".repeat(40), baseBranch: "main", prompt: "Refactor the parser to stream tokens", verifyCommand: "pnpm test",
  status: "running", createdAt: 1_000_000, finishedAt: null, lanes: [
    lane("a", { label: "Fast · low" }),
    lane("b", { label: "Careful · high", finishedAt: 1_070_000, tokens: { input: 15_000, output: 15_500, cacheRead: 0, total: 30_500 },
      diff: { files: 5, added: 80, removed: 20 }, changedFiles: ["a", "b", "c", "d", "e"], verification: { state: "failed", exitCode: 1, durationMs: 9000, outputTail: "FAIL parser.test.ts\nexpected 3 got 4" } }),
    lane("c", { label: "Default", status: "running", finishedAt: null, tokens: null, diff: null, commitSha: null, changedFiles: [], verification: { state: "skipped" } }),
  ],
});

interface Fixture {
  races: Race[]; calls: { name: string; args: unknown[] }[]; adoptResults: RaceAdoptResult[]; preflight: { git: boolean; branch: string | null; dirty: boolean; sandboxMode: string };
  update(mutate: (races: Race[]) => void): void; started?: Race;
}
const listeners = new Set<() => void>();
const fixture: Fixture = {
  races: [initial()], calls: [], adoptResults: [], preflight: { git: true, branch: "main", dirty: false, sandboxMode: "smart" },
  update(mutate) { mutate(this.races); this.races = structuredClone(this.races); for (const listener of listeners) listener(); },
};
(window as unknown as { raceFixture: Fixture }).raceFixture = fixture;
const record = <T,>(name: string, result: T) => (...args: unknown[]): Promise<T> => { fixture.calls.push({ name, args }); return Promise.resolve(result); };
const noop = () => {};

window.vela = {
  platform: "darwin",
  getMessages: async () => [],
  races: {
    preflight: async (workspace: string) => { fixture.calls.push({ name: "preflight", args: [workspace] }); return fixture.preflight; },
    list: async () => ({ races: fixture.races, error: null }),
    start: async (draft: RaceDraft) => { fixture.calls.push({ name: "start", args: [draft] }); fixture.started = initial(); return fixture.started; },
    stopLane: record("stopLane", undefined),
    adopt: async (raceId: string, laneId: string) => {
      fixture.calls.push({ name: "adopt", args: [raceId, laneId] });
      const result = fixture.adoptResults.shift() ?? { ok: true as const, message: "", commitMessage: "Refactor the parser to stream tokens", files: ["src/a.ts", "src/b.ts"] };
      if (result.ok) fixture.update(races => { races[0].status = "adopted"; races[0].adoptedLaneId = laneId; for (const item of races[0].lanes) item.worktreeRemovedAt = 1; });
      return result;
    },
    discard: async (raceId: string) => { fixture.calls.push({ name: "discard", args: [raceId] }); fixture.update(races => { races[0].status = "discarded"; for (const item of races[0].lanes) item.worktreeRemovedAt = 1; }); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  },
} as unknown as VelaApi;

const models = { catalog: { providers: [], error: null, models: [
  { provider: "p", providerName: "Provider", id: "m1", name: "Model One", reasoning: true, contextWindow: 1, available: true, custom: false, thinkingLevels: ["off", "low", "high"] },
  { provider: "p", providerName: "Provider", id: "m2", name: "Model Two", reasoning: true, contextWindow: 1, available: true, custom: false, thinkingLevels: ["medium"] },
  { provider: "p", providerName: "Provider", id: "gone", name: "Unavailable", reasoning: false, contextWindow: 1, available: false, custom: false, thinkingLevels: [] },
] } } as unknown as ReturnType<typeof useModels>;

function Panel() {
  const [races, setRaces] = useState<Race[]>(fixture.races);
  useEffect(() => { const sync = () => setRaces(fixture.races); listeners.add(sync); return () => { listeners.delete(sync); }; }, []);
  return <div style={{ height: "100vh", display: "flex" }}>
    <RacePanel races={races} onOpenConversation={id => fixture.calls.push({ name: "openConversation", args: [id] })} onOpenAcceptance={noop} />
  </div>;
}

function Dialog() {
  const [open, setOpen] = useState(true);
  return open ? <RaceSetupDialog workspace="/repo" initialPrompt="Add a streaming parser" models={models} onClose={() => { fixture.calls.push({ name: "close", args: [] }); setOpen(false); }}
    onStarted={race => { fixture.calls.push({ name: "started", args: [race.id] }); setOpen(false); }} /> : <p id="closed">closed</p>;
}

if (scenario === "nogit") fixture.preflight = { git: false, branch: null, dirty: false, sandboxMode: "smart" };
if (scenario === "dirty") fixture.preflight = { git: true, branch: "main", dirty: true, sandboxMode: "ask" };
if (scenario === "empty") fixture.races = [];
// 真实应用里对话框位于 pointer-events: none 的输入区容器内。
const dialogHost = (node: React.ReactNode) => <div style={{ pointerEvents: "none", position: "absolute", inset: 0 }}>{node}</div>;
createRoot(document.getElementById("root")!).render(<AppLocaleProvider locale={locale}>{scenario === "panel" || scenario === "empty" ? <Panel /> : dialogHost(<Dialog />)}</AppLocaleProvider>);
