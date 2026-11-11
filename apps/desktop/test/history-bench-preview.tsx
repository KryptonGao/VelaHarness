/** Real SessionChatView over a long history (no IPC). ?turns=200
 *  window.__ready resolves once the history is in the DOM; window.__stream(n) streams n text deltas into a new turn. */
import { createRoot } from "react-dom/client";
import type { AgentStreamEvent, AppState, VelaApi } from "@vela/shared";
import { useSession } from "../src/renderer/hooks/useSession";
import { SessionChatView } from "../src/renderer/components/SessionChatView";
import type { ProjectApi } from "../src/renderer/hooks/useProject";
import type { useModels } from "../src/renderer/hooks/useModels";
import "../src/renderer/styles.css";

const turns = Number(new URLSearchParams(location.search).get("turns") ?? 200);
const noop = () => {};
const ready = async () => {};
const diff = Array.from({ length: 12 }, (_, i) => `${i % 3 === 0 ? "-" : "+"}${i + 10} const level${i} = compute(${i});`).join("\n");
const reply = (i: number) => `## Result ${i}\n\nI updated the handler and re-ran the checks. Two things changed:\n\n- \`src/file-${i}.ts\` now validates its input\n- the **retry** path no longer swallows errors\n\n\`\`\`ts\nexport function handle${i}(input: string) {\n  if (!input) throw new Error("empty");\n  return input.trim();\n}\n\`\`\`\n\nAll tests pass. Let me know if you want a follow-up.`;

const history = Array.from({ length: turns }, (_, i) => [
  { id: `u${i}`, role: "user", text: `Please fix issue number ${i} in the handler`, thinking: "", tools: [] },
  { id: `a${i}`, role: "assistant", text: reply(i), thinking: `**Plan ${i}**\n\nLook at the file, edit it, run tests.`, model: "claude-sonnet-5-5",
    turnStartedAt: 1_000 + i * 10_000, turnCompletedAt: 6_000 + i * 10_000, timestamp: 6_000 + i * 10_000,
    tools: [
      { id: `r${i}`, name: "read", status: "done", activity: { path: `src/file-${i}.ts`, body: "const a = 1;" } },
      { id: `e${i}`, name: "edit", status: "done", activity: { path: `src/file-${i}.ts`, diff } },
      { id: `b${i}`, name: "bash", status: "done", activity: { command: "pnpm test", body: "✓ all passed" } },
    ] },
]).flat();

const state = { activeConversationId: "c", conversations: [{ id: "c", title: "Fixture", status: "ready" }],
  context: { messageCount: 0, toolCallCount: 0, turnCount: 0, stepCount: 0, tokens: 0, contextWindow: null, percent: null,
    segments: { system: 0, tools: 0, rules: 0, skills: 0, conversation: 0 }, sessionTokens: null, cacheHitRate: null, outputSpeed: null },
  session: { id: "c", title: "Fixture", status: "ready", mode: "agent", modelReady: false, tools: [], thinkingLevels: [] },
} as unknown as AppState;
let emit: (event: AgentStreamEvent) => void = noop;
const api = {
  platform: "darwin", getState: async () => state,
  getMessages: async (id: string) => id === "c" ? history : [],
  getAgentMessages: async () => [],
  onEvent: (listener: typeof emit) => { emit = listener; return noop; },
  onQuestionEvent: () => noop,
  listOpenTargets: async () => [], listSkills: async () => ({ skills: [] }),
  getAgentSettings: async () => ({ provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" }),
} as Record<string, unknown>;
// Anything the composer and cards ask for beyond the fixture resolves to null; `on*` subscriptions return an unsubscribe.
// Namespaces (`taskRecipes.subscribe`, ...) are handled by the same rule, so the stub is recursive.
const stub = (): unknown => new Proxy(async () => null, {
  get: (_target, key: string | symbol) => key === "then" || typeof key === "symbol" ? undefined
    : /^(on|subscribe)/.test(key) ? () => noop : stub(),
});
window.vela = new Proxy(api, {
  get: (target, key: string) => key in target ? target[key] : /^(on|subscribe)/.test(key) ? () => noop : stub(),
}) as unknown as VelaApi;
const project = { sandboxMode: "ask", approval: null, workspace: null, git: null, environment: null, environments: [],
  openWorkspaceDialog: ready } as unknown as ProjectApi;
const models = { catalog: { models: [], providers: [] }, login: { active: false },
  select: noop, setThinking: noop, add: noop, remove: noop, logout: noop, loginProvider: noop,
  replyLogin: noop, cancelLogin: noop, dismissLogin: noop } as unknown as ReturnType<typeof useModels>;

function Fixture() {
  const session = useSession();
  return <div style={{ display: "flex", width: 900, height: 800 }}>
    <SessionChatView messageStore={session.messageStore} state={session.state} question={session.question}
      summaryEnabled={false} summaryStyle="inline" locale="en" sendError={null} platform="darwin"
      leftCollapsed rightCollapsed project={project} models={models} onToggleLeft={noop} onToggleRight={noop}
      onSend={ready} onAbort={ready} onMode={noop} getQuestion={session.getQuestion} onReplyQuestion={noop}
      onBranch={noop} showNewTab={false} onNewTab={noop} onOpenChanges={noop} />
  </div>;
}

const w = window as unknown as Record<string, unknown>;
const t0 = performance.now();
w.__ready = new Promise<number>((resolve) => {
  const poll = () => {
    if (document.querySelectorAll(".user-msg-container").length >= Math.min(turns, 1) && document.querySelector(".assistant-turn")) {
      // let one more frame settle layout
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
    } else setTimeout(poll, 5);
  };
  poll();
});
w.__start = () => {
  emit({ type: "state", state: { ...state, session: { ...state.session, status: "streaming" } } } as AgentStreamEvent);
  emit({ type: "user_message", conversationId: "c", text: "Now do the next thing" } as AgentStreamEvent);
};
let n = 0;
w.__delta = () => emit({ type: "text_delta", conversationId: "c", delta: `word${n++} ` } as AgentStreamEvent);
createRoot(document.getElementById("root")!).render(<Fixture />);
