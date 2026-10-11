/** 真实 ChatView、Workbench 和保存的验收记录，供浏览器预览与 Electron 检查共用。 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppState, ToolTrace, VelaApi } from "@vela/shared";
import { ChatView } from "../src/renderer/components/ChatView";
import { WorkbenchPanel, type WorkbenchTab } from "../src/renderer/components/WorkbenchPanel";
import { FilePreviewProvider } from "../src/renderer/components/preview/FilePreviewContext";
import { useAcceptance } from "../src/renderer/hooks/useAcceptance";
import { useTurnReview } from "../src/renderer/hooks/useTurnReview";
import { outcomeByFinalMessage, type AcceptanceRequest } from "../src/renderer/components/acceptance";
import type { TurnReviewTarget } from "../src/renderer/components/TurnReviewView";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import type { useModels } from "../src/renderer/hooks/useModels";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import type { ToolDisplay, ToolFold } from "../src/renderer/hooks/usePreferences";
import { AppLocaleProvider, setActiveLocale, tr } from "../src/renderer/locale";
import "../src/renderer/styles.css";
import "../src/renderer/version-control.css";
import "../src/renderer/acceptance.css";

const params = new URLSearchParams(location.search);
const locale = params.has("en") ? "en" : "zh-CN";
setActiveLocale(locale);
document.documentElement.dataset.scheme = params.get("theme") ?? "light";
const noop = () => {};
let reads = 0;
window.vela = {
  platform: "darwin", listOpenTargets: async () => [], listSkills: async () => ({ skills: [] }),
  getAgentSettings: async () => ({ provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" }),
  onWorkspaceEvent: () => noop, onGitEvent: () => noop, onEvent: () => noop,
  pickAttachments: async () => [], hydrateAttachments: async () => [],
  readWorkspaceFile: async () => { reads++; throw new Error("Review must use saved records"); },
} as unknown as VelaApi;
const models = { catalog: { models: [], providers: [] }, login: { active: false }, select: noop, setThinking: noop } as unknown as ReturnType<typeof useModels>;
const edit = (id: string, path: string, diff: string): ToolTrace => ({ id, name: "edit", status: "done", activity: { path, diff } });
const tools: ToolTrace[] = [
  edit("intro", "README.md", Array.from({ length: 70 }, (_, i) => `+${i + 1} ${i === 0 ? "# Parser" : "Saved documentation line"}`).join("\n")),
  edit("parser-first", "src/parser.ts", Array.from({ length: 70 }, (_, i) => `+${i + 1} export const token${i} = ${i};`).join("\n")),
  edit("parser-second", "src/parser.ts", "-1 export const token0 = 0;\n+1 export const token0 = 1;"),
  { id: "test-passed", name: "bash", status: "done", activity: { command: "pnpm test:parser", body: "FULL_OUTPUT_START\n" + "PASS parser input\n".repeat(60) + "All 60 checks passed." } },
  { id: "build-failed", name: "bash", status: "error", activity: { command: "pnpm build", body: "Build failed: missing fixture type\nCommand exited with code 2" } },
  edit("after-test", "src/late.ts", "+1 export const changedAfterVerification = true;"),
  { id: "submit", name: "submit_outcome", status: "done", activity: { outcome: { items: [
    { requirement: "支持增量解析并保留公开 API", status: "done", files: ["src/parser.ts"], verificationIds: ["test-passed", "build-failed"], toConfirm: ["请确认旧格式仍满足你的使用场景"] },
    { requirement: "补充使用说明", status: "partial", files: ["README.md", "missing.md"], verificationIds: ["fake-id"], toConfirm: [] },
  ] } } },
];
const messages: UiMessage[] = [
  { id: "u1", role: "user", text: "支持增量解析，保持公开 API 并补充使用说明。", thinking: "", tools: [] },
  { id: "step1", role: "assistant", text: "", thinking: "", tools: tools.slice(0, 2) },
  { id: "r1", role: "assistant", text: "解析器已更新，构建问题需要继续确认。", thinking: "", tools: tools.slice(2) },
  { id: "u2", role: "user", text: "添加下一步说明。", thinking: "", tools: [] },
  { id: "r2", role: "assistant", text: "说明已保存。", thinking: "", tools: [edit("next", "docs/next.md", "+1 # Next steps")] },
];
declare global {
  interface Window {
    acceptanceFixture: {
      scope(chat: string, workspace?: string): void; width(value: number): void;
      variant(display: ToolDisplay, fold: ToolFold, noReply: boolean): void;
      streaming(value: boolean): void; open(index?: number): void; reads(): number;
      records(): { messages: UiMessage[]; tools: ToolTrace[] };
      aggregate: typeof outcomeByFinalMessage;
    };
  }
}

function Fixture() {
  const [chat, setChat] = useState("a");
  const [workspace, setWorkspace] = useState("/fixture");
  const [width, setWidth] = useState(params.has("compact") ? 420 : 780);
  const [display, setDisplay] = useState<ToolDisplay>("compact");
  const [fold, setFold] = useState<ToolFold>("message");
  const [noReply, setNoReply] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const acceptance = useAcceptance(workspace, chat);
  const review = useTurnReview(workspace, chat);
  const [targets, setTargets] = useState<Record<string, TurnReviewTarget>>({});
  const tabs: WorkbenchTab[] = [
    ...(acceptance.acceptance ? [{ id: acceptance.tabId, kind: "acceptance" as const, label: tr("验收", "Acceptance"), acceptance: acceptance.acceptance }] : []),
    ...(review.review ? [{ id: review.tabId, kind: "turn-review" as const, label: tr("变更审查", "Change review"), review: review.review, target: targets[review.tabId] }] : []),
  ];
  const openAcceptance = (request: AcceptanceRequest) => { acceptance.open(request); setActive(acceptance.tabId); };
  window.acceptanceFixture = {
    scope(nextChat, nextWorkspace = workspace) { setChat(nextChat); setWorkspace(nextWorkspace); setActive(null); },
    width: setWidth, variant(nextDisplay, nextFold, nextNoReply) { setDisplay(nextDisplay); setFold(nextFold); setNoReply(nextNoReply); },
    streaming: setStreaming, reads: () => reads, records: () => ({ messages, tools }), aggregate: outcomeByFinalMessage,
    open(index = 0) { const request = [...outcomeByFinalMessage(messages, false, workspace).values()][index]; openAcceptance(request); },
  };
  const project = { workspace: { current: workspace, recents: [] }, git: null, approval: null, sandboxMode: "ask", listBranches: async () => [] } as unknown as ProjectApi;
  const state = {
    activeConversationId: chat,
    session: { id: chat, title: "解析器成果验收", cwd: workspace, status: streaming ? "streaming" : "ready", model: "Fixture", modelReady: true,
      modelProvider: "fixture", modelId: "fixture", tools: [], mode: "agent", thinkingLevel: "medium", thinkingLevels: ["medium"] },
    agents: [], context: { tokens: 100, contextWindow: 10000, percent: 1, messageCount: 4, toolCallCount: 6,
      segments: { system: 0, tools: 0, rules: 0, skills: 0, conversation: 100 } },
  } as unknown as AppState;
  const source = noReply ? messages.map(message => message.role === "assistant" ? { ...message, text: "" } : message) : messages;
  return <>
    <div className="fixture-controls"><button onClick={() => setWidth(value => value < 600 ? 780 : 420)}>Panel {width}px</button>
      <button onClick={() => { document.documentElement.dataset.scheme = document.documentElement.dataset.scheme === "light" ? "dark" : "light"; }}>Theme</button>
      <button onClick={() => setChat(value => value === "a" ? "b" : "a")}>Chat {chat}</button></div>
    <div className="vela-window platform-darwin left-collapsed right-collapsed layout-floating"
      style={{ height: "calc(100vh - 36px)", "--workbench-width": `${width}px` } as React.CSSProperties}>
      <div className="main-stage"><div className="main-stage-pane">
        <ChatView messages={source} state={state} project={project} sendError={null} platform="darwin"
          leftCollapsed rightCollapsed floatingInfo environmentCollapsed toolDisplay={display} toolFold={fold}
          models={models} onToggleLeft={noop} onToggleRight={noop} onSend={async () => {}} onAbort={async () => {}}
          onMode={async () => {}} getQuestion={() => null} onReplyQuestion={noop} onBranch={noop}
          showNewTab={false} onNewTab={noop} onOpenChanges={noop} onOpenAcceptance={openAcceptance}
          onReviewTurn={request => { review.open(request); setActive(review.tabId); }} />
        <WorkbenchPanel tabs={tabs} activeTabId={active ?? tabs[0]?.id ?? null} contextOpen={false} leftOpen={false}
          resize={{ widths: { left: 250, right: 340, workbench: width }, startResize: noop, nudge: noop, reset: noop }}
          project={project} busy={false} execution={null} onRevise={noop} onExecutePlan={noop}
          initialDiffPath={null} initialDiffPathRequestKey={0} selectedChangePath={null} onSelectedChangePath={noop}
          onShowDiff={noop} agents={[]} ensureAgentMessages={noop} onControlAgent={noop} onOpenAgent={noop} onNewTab={noop}
          onStartAction={noop} gitAvailable={false} onActivateTab={tab => setActive(tab.id)}
          onAcceptanceDiff={(request, path, diffToolId) => {
            if (!request.changes) return;
            review.open({ turnId: request.turnId, changes: request.changes });
            setTargets(current => ({ ...current, [review.tabId]: { path, diffToolId, requestKey: (current[review.tabId]?.requestKey ?? 0) + 1 } }));
            setActive(review.tabId);
          }}
          onCloseTab={tab => { if (tab.kind === "acceptance") acceptance.close(); else review.close(); setActive(null); }} />
      </div></div>
    </div>
  </>;
}
const style = document.createElement("style");
style.textContent = ".fixture-controls{height:36px;display:flex;align-items:center;gap:12px;padding:0 12px;font-size:12px}.fixture-controls button{padding:4px 8px;border:1px solid var(--border-subtle);border-radius:4px}.vela-window .workbench-panel{width:var(--workbench-width)!important;min-width:var(--workbench-width)!important}.main-chat-view{min-width:0}";
document.head.append(style);
createRoot(document.getElementById("root")!).render(<AppLocaleProvider locale={locale}><FilePreviewProvider><Fixture /></FilePreviewProvider></AppLocaleProvider>);
if (params.has("open")) setTimeout(() => window.acceptanceFixture.open(), 300);
