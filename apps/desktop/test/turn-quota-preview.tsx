/** 每轮额度消耗显示。?state=live|done, ?plan=pro（只有周额度）, ?theme=dark, ?en。live 约 15 秒后出现第二次读数。 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppState, UsageLimits, VelaApi } from "@vela/shared";
import { ChatView } from "../src/renderer/components/ChatView";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import type { useModels } from "../src/renderer/hooks/useModels";
import { setActiveLocale } from "../src/renderer/locale";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
setActiveLocale(params.has("en") ? "en" : "zh-CN");
document.documentElement.dataset.scheme = params.get("theme") ?? "light";
const pro = params.get("plan") === "pro";
const mode = params.get("state") ?? "done";

const noop = () => {};
const ready = async () => {};
let reads = 0;
window.vela = {
  platform: "darwin", estimateTaskCost: async () => null,
  listOpenTargets: async () => [], listSkills: async () => ({ skills: [] }),
  getAgentSettings: async () => ({ provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" }),
  // 每次读取额度都比上一次多用一点，模拟一轮对话持续消耗。
  getUsageLimits: async (): Promise<UsageLimits> => {
    const n = reads++;
    return {
      provider: "openai-codex", plan: pro ? "pro" : "plus", fetchedAt: Date.now(),
      windows: [
        ...(pro ? [] : [{ windowMinutes: 300, usedPercent: 12 + n * 1.8, resetsAt: Date.now() + 3 * 3600_000 }]),
        { windowMinutes: 10080, usedPercent: 31 + n * 0.1, resetsAt: Date.now() + 80 * 3600_000 },
      ],
    };
  },
} as unknown as VelaApi;
const project = { sandboxMode: "ask", approval: null, workspace: null, git: null, environment: null, environments: [], openWorkspaceDialog: ready } as unknown as ProjectApi;
const models = { catalog: { models: [], providers: [] }, login: { active: false }, select: noop, setThinking: noop, add: noop, remove: noop, logout: noop, loginProvider: noop, replyLogin: noop, cancelLogin: noop, dismissLogin: noop } as unknown as ReturnType<typeof useModels>;
const state = (status: "streaming" | "ready") => ({
  activeConversationId: "q", conversations: [{ id: "q", title: "Quota", status }],
  context: { messageCount: 0, toolCallCount: 0, turnCount: 0, stepCount: 0, tokens: 0, contextWindow: null, percent: null, segments: { system: 0, tools: 0, rules: 0, skills: 0, conversation: 0 }, sessionTokens: null, cacheHitRate: null, outputSpeed: null },
  session: { id: "q", title: "Quota", status, mode: "agent", modelReady: true, model: "GPT-6.1 Sol", modelProvider: "openai-codex", modelId: "gpt-6.1-sol", thinkingLevel: "high", thinkingLevels: ["low", "medium", "high"], tools: [] },
}) as unknown as AppState;

function Fixture() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (mode !== "done") return;
    const timer = setTimeout(() => setDone(true), 3500);
    return () => clearTimeout(timer);
  }, []);
  const startedAt = Date.now() - 72_000;
  const [t0] = useState(startedAt);
  const messages: UiMessage[] = [
    { id: "u", role: "user", text: "重构这个模块并补上测试", thinking: "", tools: [] },
    { id: "p", role: "assistant", text: "先读一下现有实现。", thinking: "", tools: [{ id: "r", name: "read", status: "done", activity: { path: "example.ts", body: "const value = 1;" } }] as never, turnStartedAt: t0 },
    { id: "f", role: "assistant", text: done ? "已经完成重构，测试全部通过。" : "", thinking: "", tools: [], turnStartedAt: t0, ...(done ? { turnCompletedAt: Date.now() } : {}) },
  ];
  return <div style={{ display: "flex", height: 520 }}><ChatView messages={done ? messages : messages.slice(0, 2)} state={state(done ? "ready" : "streaming")}
    toolDisplay="card" toolFold="position" sendError={null} platform="darwin" leftCollapsed rightCollapsed
    project={project} models={models} onToggleLeft={noop} onToggleRight={noop} onSend={ready} onAbort={ready}
    onMode={noop} getQuestion={() => null} onReplyQuestion={noop} onBranch={noop} onRemoveInstruction={ready}
    showNewTab={false} onNewTab={noop} onOpenChanges={noop} /></div>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
