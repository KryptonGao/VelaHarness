/** Real ThinkingGroup + ToolList: OpenAI CoT titles, grouped tools, height limit with edge fades. Append ?display=card for card tools. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentInfo, ToolTrace } from "@vela/shared";
import { AgentPane } from "../src/renderer/components/AgentPane";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import { ThinkingGroup } from "../src/renderer/components/Thinking";
import { HeightLimitControl } from "../src/renderer/components/settings/HeightLimitControl";
import { defaultThinkingGroupHeight, defaultToolDetailHeight, thinkingGroupHeightStops, toolDetailHeightStops } from "../src/renderer/thinking-group-height";
import { ToolList } from "../src/renderer/components/ToolCard";
import type { ToolDisplay } from "../src/renderer/hooks/usePreferences";
import "../src/renderer/styles.css";

const display: ToolDisplay = new URLSearchParams(location.search).get("display") === "card" ? "card" : "compact";
const output = Array.from({ length: 40 }, (_, i) => `${i % 9 === 4 ? "✗" : "✓"} check ${i + 1} ${i % 9 === 4 ? "failed: expected null" : "passed"}`).join("\n");
const diff = Array.from({ length: 30 }, (_, i) => `${i % 3 === 0 ? "-" : "+"}${i + 10} await page.select('[data-thinking]', 'level-${i}');`).join("\n");

const tools = (prefix: string): ToolTrace[] => [
  { id: `${prefix}-search`, name: "grep", status: "done", activity: { command: "thinkingLevels|thinkingLevel", path: "apps/desktop/test" } },
  { id: `${prefix}-read`, name: "read", status: "done", activity: { path: "apps/desktop/test/workbench-chat-preview.tsx", body: "const levels = [];" } },
  { id: `${prefix}-edit`, name: "edit", status: "done", activity: { path: "apps/desktop/test/workbench-chat-ui.mjs", diff } },
  { id: `${prefix}-bash`, name: "bash", status: "error", activity: { command: "node apps/desktop/test/workbench-chat-ui.mjs", body: output } },
  { id: `${prefix}-bash2`, name: "bash", status: "done", activity: { command: "pnpm --filter @vela/desktop typecheck", body: "ok" } },
];

const bodyText = "I’m thinking we can enhance the fixture by adding ultra to both sets of chat filters on the same side. There’s mention of UI regression inside the workbench, and I need to wait for tests to expire before closing.\n\nPlus, I’ll need to switch back and forth between low and high repeated tests, which means I’ll have about 30 lines to manage.";

function Block({ id, title, tools: list, live = false, open }: { id: string; title: string | null; tools: ToolTrace[]; live?: boolean; open?: boolean }) {
  const text = title === null ? "Plain reasoning without a title line.\n\nSecond paragraph." : `**${title}**\n\n${bodyText}`;
  return (
    <ThinkingGroup messageId={id} text={text} active={false} live={live || Boolean(open)} showActivityIndicator={display === "compact"} tools={list}>
      <ToolList tools={list} display={display} fold="none" />
    </ThinkingGroup>
  );
}

/** 真实消息流:标题思考 + 计划,后续没有思考的一轮只有两次编辑,它们要挂在同一个标题下面。 */
const agent = {
  id: "agent-1", parentId: "root", path: "/root/followers", name: "followers", kind: "worker",
  status: "running", depth: 1, task: "UI", steps: [], mutated: false, finalText: null, error: null,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, activeMs: 0, runningSince: null, pauseRequested: false, createdAt: 1, updatedAt: 1,
} as unknown as AgentInfo;
const streamMessages: UiMessage[] = [
  { id: "m1", role: "assistant", text: "", thinking: `**Considering DOM manipulations**\n\n${bodyText}`, tools: [{ id: "plan", name: "read", status: "done", activity: { path: "apps/desktop/src/renderer/nav-rail.css", body: "x" } }] },
  { id: "m2", role: "assistant", text: "", thinking: "", tools: [
    { id: "e1", name: "edit", status: "done", activity: { path: "apps/desktop/src/renderer/nav-rail.css", diff: "-1 a\n+1 b" } },
    { id: "e2", name: "edit", status: "done", activity: { path: "apps/desktop/test/nav-rail-ui.mjs", diff: "-1 a\n+1 b" } },
  ] },
  { id: "m3", role: "assistant", text: "Both edits are in.", thinking: "", tools: [] },
];

function App() {
  const [live, setLive] = useState(true);
  const [groupHeight, setGroupHeight] = useState(defaultThinkingGroupHeight);
  const [detailHeight, setDetailHeight] = useState(defaultToolDetailHeight);
  document.documentElement.style.setProperty("--thinking-group-height", `${groupHeight}px`);
  document.documentElement.style.setProperty("--tool-detail-height", `${detailHeight}px`);
  document.documentElement.style.setProperty("--tool-detail-ratio", (detailHeight / groupHeight).toFixed(4));
  document.documentElement.dataset.toolDetailScale = "true";
  return (
    <main className="main-chat-view" data-tool-display={display} style={{ width: 640, minHeight: "100vh" }}>
      <div style={{ position: "relative", zIndex: 2, padding: 24 }}>
      <section className="settings-block" style={{ marginBottom: 16 }}>
        <div className="tb-fields">
          <HeightLimitControl label="Group height limit" stops={thinkingGroupHeightStops} value={groupHeight} onChange={setGroupHeight} />
          <HeightLimitControl label="Detail height limit" stops={toolDetailHeightStops} value={detailHeight} onChange={setDetailHeight} />
        </div>
      </section>
      <button id="finish" onClick={() => setLive(false)} style={{ marginBottom: 12 }}>Finish turn</button>
      <article className="assistant-block">
        <Block id="a" title="Considering workbench fixtures" tools={tools("a").slice(0, 2)} />
        <Block id="b" title="Evaluating UI tests" tools={tools("b")} open />
        <Block id="c" title="Rerunning checks" tools={tools("c").slice(3)} />
        <Block id="d" title={null} tools={tools("d").slice(0, 1)} />
        <Block id="e" title="Latest group streaming" tools={tools("e").slice(0, 2)} live={live} />
      </article>
      <h4>Message flow (follower tools attach to the title)</h4>
      <div style={{ height: 360, display: "flex" }} className="workbench-panel">
        <AgentPane agent={agent} agents={[agent]} messages={streamMessages} onSwitch={() => {}} ensureMessages={() => {}} onControl={() => {}} toolDisplay={display} />
      </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
