/** 完成折叠必须是布局切换，不能重播整轮的消息入场动画。 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { AppState, VelaApi } from "@vela/shared";
import { ChatView } from "../src/renderer/components/ChatView";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import type { ToolDisplay } from "../src/renderer/hooks/usePreferences";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import type { useModels } from "../src/renderer/hooks/useModels";
import "../src/renderer/styles.css";

const noop = () => {};
const ready = async () => {};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
window.vela = {
  platform: "darwin", estimateTaskCost: async () => null,
  listOpenTargets: async () => [], listSkills: async () => ({ skills: [] }),
  getAgentSettings: async () => ({ provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" }),
} as unknown as VelaApi;
const project = { sandboxMode: "ask", approval: null, workspace: null, git: null, environment: null, environments: [],
  openWorkspaceDialog: ready } as unknown as ProjectApi;
const models = { catalog: { models: [], providers: [] }, login: { active: false },
  select: noop, setThinking: noop, add: noop, remove: noop, logout: noop, loginProvider: noop,
  replyLogin: noop, cancelLogin: noop, dismissLogin: noop } as unknown as ReturnType<typeof useModels>;
const baseState = {
  activeConversationId: "fold", conversations: [{ id: "fold", title: "Fold", status: "ready" }],
  context: { messageCount: 0, toolCallCount: 0, turnCount: 0, stepCount: 0, tokens: 0, contextWindow: null, percent: null,
    segments: { system: 0, tools: 0, rules: 0, skills: 0, conversation: 0 }, sessionTokens: null, cacheHitRate: null, outputSpeed: null },
  session: { id: "fold", title: "Fold", status: "ready", mode: "agent", modelReady: false, tools: [], thinkingLevels: [] },
} as unknown as AppState;
interface Frame { messages: UiMessage[]; state: AppState; display: ToolDisplay }
let update: (frame: Frame) => void = noop;
function Fixture() {
  const [frame, setFrame] = useState<Frame>({ messages: [], state: baseState, display: "card" });
  update = next => flushSync(() => setFrame(next));
  return <div style={{ display: "flex", height: 700 }}><ChatView messages={frame.messages} state={frame.state}
    toolDisplay={frame.display} toolFold="position" sendError={null} platform="darwin" leftCollapsed rightCollapsed
    project={project} models={models} onToggleLeft={noop} onToggleRight={noop} onSend={ready} onAbort={ready}
    onMode={noop} getQuestion={() => null} onReplyQuestion={noop} onBranch={noop} onRemoveInstruction={ready}
    showNewTab={false} onNewTab={noop} onOpenChanges={noop} /></div>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
const results: string[] = [];
function check(condition: boolean, description: string) {
  if (!condition) throw new Error(description);
  results.push(`PASS ${description}`);
}
async function checks() {
  await pause(250);
  for (const display of ["card", "compact"] as const) {
    for (const instant of [false, true]) {
      const label = `${display}/${instant ? "instant" : "streamed"}`;
      // 换对话再发送，确保用户与助手都获得正常的新消息入场标记。
      const id = label;
      const initial = { ...baseState, activeConversationId: id, session: { ...baseState.session, id } };
      update({ messages: [], state: initial, display });
      const startedAt = Date.now() - 4000;
      const messages: UiMessage[] = [
        { id: `${id}-user`, role: "user", text: "Check folding", thinking: "", tools: [] },
        { id: `${id}-process`, role: "assistant", text: "Inspecting the file.", thinking: "", tools: [
          { id: `${id}-read`, name: "read", status: "done", activity: { path: "example.ts", body: "const value = 1;" } },
        ], turnStartedAt: startedAt },
        { id: `${id}-reply`, role: "assistant", text: "The fix is complete.", thinking: "", tools: [], turnStartedAt: startedAt },
      ];
      const running = { ...initial, session: { ...initial.session, status: "streaming" as const } };
      update({ messages: messages.slice(0, 2), state: running, display });
      update({ messages, state: running, display });
      check(Boolean(document.querySelector(".assistant-live-turn .message-enter")), `${label}: new messages retain their entrance animation`);
      if (!instant) await pause(350);
      const complete = messages.map((message, index) => index === messages.length - 1 ? { ...message, turnCompletedAt: Date.now() } : message);
      update({ messages: complete, state: initial, display });
      const turn = document.querySelector<HTMLElement>(".assistant-turn")!;
      check(Boolean(turn) && !document.querySelector(".assistant-live-turn"), `${label}: ready state folds the live turn`);
      check(!turn.classList.contains("message-enter") && getComputedStyle(turn).animationName === "none",
        `${label}: completion does not replay entrance animation or flash the turn`);
      const body = turn.querySelector<HTMLElement>(".time-spent-body")!;
      const trigger = turn.querySelector<HTMLButtonElement>(".assistant-turn-trigger")!;
      check(body.getAttribute("aria-hidden") === "true" && body.offsetHeight === 0,
        `${label}: process is folded on the first completed frame`);
      const reply = turn.querySelector(".agent-reply-prose")!;
      check(reply.textContent === "The fix is complete.", `${label}: final reply remains visible`);
      trigger.click();
      await pause(340);
      check(trigger.getAttribute("aria-expanded") === "true" && body.offsetHeight > 0, `${label}: manual expansion still works`);
      trigger.click();
      await pause(340);
      check(body.offsetHeight === 0 && reply.isConnected && getComputedStyle(turn).opacity === "1",
        `${label}: manual folding retains the final reply without fading`);
    }
  }
}
void checks().catch(error => results.push(`FAIL ${error.message}`)).finally(() => {
  const output = document.createElement("pre");
  output.id = "turn-fold-results";
  output.dataset.status = results.some(line => line.startsWith("FAIL")) ? "failed" : "passed";
  output.textContent = results.join("\n");
  document.body.append(output);
});
