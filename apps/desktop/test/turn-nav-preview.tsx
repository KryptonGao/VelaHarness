/** 真实 ChatView + ButtonTooltip 的长对话左侧轮次导航夹具。 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppState, VelaApi } from "@vela/shared";
import { ChatView } from "../src/renderer/components/ChatView";
import { ButtonTooltip } from "../src/renderer/components/ButtonTooltip";
import { FilePreviewProvider } from "../src/renderer/components/preview/FilePreviewContext";
import type { useModels } from "../src/renderer/hooks/useModels";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
const locale = params.has("en") ? "en" : "zh-CN";
setActiveLocale(locale);
document.documentElement.dataset.scheme = params.get("theme") ?? "light";

const noopSubscription = () => () => {};
window.vela = {
  platform: "darwin",
  setLocale() {},
  listOpenTargets: async () => [],
  listSkills: async () => ({ skills: [] }),
  getAgentSettings: async () => ({ provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" }),
  onWorkspaceEvent: noopSubscription,
  onGitEvent: noopSubscription,
  pickAttachments: async () => [],
  hydrateAttachments: async () => [],
  estimateTaskCost: async () => null,
} as unknown as VelaApi;

const models = {
  catalog: { models: [], providers: [] },
  login: { active: false },
  select() {},
  setThinking() {},
  add() {},
  remove() {},
  logout() {},
  loginProvider() {},
  replyLogin() {},
  cancelLogin() {},
  dismissLogin() {},
} as unknown as ReturnType<typeof useModels>;

const project = {
  workspace: { current: "/projects/VelaHarness", recents: [] },
  approval: null,
  environment: null,
  environments: [],
  sandboxMode: "ask",
  git: null,
  openWorkspaceDialog: async () => {},
  replyApproval() {},
  listBranches: async () => [],
} as unknown as ProjectApi;

function makeTurns(count: number): UiMessage[] {
  const base = Date.now() - count * 120_000;
  const list: UiMessage[] = [];
  for (let i = 1; i <= count; i += 1) {
    const prompt = i === 3
      ? "没展开的时候不显示旗帜，也不要胶囊形状的框，也不要深色。"
      : `第 ${i} 轮需求：优化页面布局与交互细节，并补充对应的测试验证（步骤 ${i}）。`;
    const reply = i === 3
      ? "已调整 `footer` 的语言选择器样式与显示逻辑：收起状态不显示旗帜，移除 `index.html` 与 `i18n.js` 中触发按钮的图标，仅在展开后的菜单中展示。"
      : `已完成第 ${i} 轮调整：\n\n- 更新了对应模块逻辑与样式规则\n- 验证了桌面端布局与键盘交互\n- 所有关联单元测试与类型检查均已通过。${" 补充说明细节以便拉长每轮高度，确保长对话可滚动。".repeat(4)}`;
    list.push({
      id: `u${i}`,
      role: "user",
      text: prompt,
      images: [],
      thinking: "",
      tools: [],
      timestamp: base + i * 60_000,
      planIds: [],
    });
    list.push({
      id: `a${i}`,
      role: "assistant",
      text: reply,
      images: [],
      thinking: "",
      tools: [],
      timestamp: base + i * 60_000 + 25_000,
      turnStartedAt: base + i * 60_000 + 1000,
      turnCompletedAt: base + i * 60_000 + 25_000,
      planIds: [],
    });
  }
  return list;
}

const initialCount = Number(params.get("turns")) || 16;

function Fixture() {
  const [count, setCount] = useState(initialCount);
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  const messages = makeTurns(count);
  (window as unknown as { __turnNavFixture?: unknown }).__turnNavFixture = {
    setCount,
    setPaneWidth,
  };
  const state = {
    activeConversationId: `conv-${count}`,
    conversations: [{
      id: `conv-${count}`,
      title: "轮次导航测试",
      cwd: "/projects/VelaHarness",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archivedAt: null,
      status: "ready",
    }],
    session: {
      id: `conv-${count}`,
      title: "轮次导航测试",
      cwd: "/projects/VelaHarness",
      status: "ready",
      model: "Preview",
      modelReady: true,
      modelProvider: "preview",
      modelId: "preview",
      tools: [],
      mode: "agent",
      thinkingLevel: "medium",
      thinkingLevels: ["medium"],
      pendingInstructions: [],
    },
    context: {
      tokens: 1000,
      contextWindow: 100000,
      percent: 1,
      messageCount: messages.length,
      toolCallCount: 0,
      segments: { system: 200, tools: 0, rules: 0, skills: 0, conversation: 800 },
    },
  } as AppState;

  return (
    <div
      className="vela-window platform-darwin left-collapsed right-collapsed"
      style={{ height: "100vh", width: paneWidth ? `${paneWidth}px` : "100vw" }}
    >
      <ChatView
        messages={messages}
        state={state}
        project={project}
        sendError={null}
        platform="darwin"
        leftCollapsed
        rightCollapsed
        models={models}
        onToggleLeft={() => {}}
        onToggleRight={() => {}}
        onSend={async () => {}}
        onRemoveInstruction={async () => {}}
        onAbort={async () => {}}
        onMode={() => {}}
        getQuestion={() => null}
        onReplyQuestion={() => {}}
        onBranch={() => {}}
        showNewTab={false}
        onNewTab={() => {}}
        onOpenChanges={() => {}}
      />
      <ButtonTooltip />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppLocaleProvider locale={locale}>
      <FilePreviewProvider>
        <Fixture />
      </FilePreviewProvider>
    </AppLocaleProvider>
  </React.StrictMode>,
);
