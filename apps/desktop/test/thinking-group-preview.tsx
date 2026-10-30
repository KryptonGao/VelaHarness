/** Real ThinkingGroup + ToolList: OpenAI CoT titles, grouped tools, height limit with edge fades. Append ?display=card for card tools. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentInfo, ToolTrace } from "@vela/shared";
import { AgentPane } from "../src/renderer/components/AgentPane";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import { CoherentGroup, CoherentThought, ThinkingGroup } from "../src/renderer/components/Thinking";
import { ThinkingGroupModeContext } from "../src/renderer/components/ThinkingGroupModeContext";
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

/** 连贯模式:两段回复把过程分成两组,每次回传的总结都留在组内。 */
const coherentMessages: UiMessage[] = [
  { id: "c1", role: "assistant", text: "", thinking: `**Inspecting the grouping code**\n\n${bodyText}`, tools: [{ id: "c-read", name: "read", status: "done", activity: { path: "tool-sequence.ts", body: "x" } }] },
  { id: "c2", role: "assistant", text: "", thinking: `**Planning the boundary rule**\n\nA group ends at the next reply.`, tools: [
    { id: "c-edit", name: "edit", status: "done", activity: { path: "tool-sequence.ts", diff } },
    { id: "c-bash", name: "bash", status: "error", activity: { command: "pnpm test", body: output } },
  ] },
  { id: "c3", role: "assistant", text: "The boundary rule is changed.", thinking: "Plain reasoning without a title line.", tools: [] },
  { id: "c4", role: "assistant", text: "", thinking: "**Wiring the setting**\n\nAdd the preference next to the group height.", tools: [{ id: "c-edit2", name: "edit", status: "done", activity: { path: "ConversationDisplayPage.tsx", diff: "-1 a\n+1 b" } }] },
  { id: "c5", role: "assistant", text: "", thinking: "**Verifying in the preview**\n\nOne header per reply.", tools: [{ id: "c-run", name: "bash", status: "running", activity: { command: "pnpm test:ui" } }] },
];

/** 直接渲染的连贯分组需要一份 entries 来生成标题汇总。 */
const entryOf = (tool: ToolTrace) => ({ type: "tool" as const, id: tool.id, messageId: "k", tool });
const thoughtOf = (id: string, text: string) => ({ type: "thinking" as const, id, messageId: "k", text });
const groupA = [
  thoughtOf("k-t1", "**Inspecting the grouping code**"), ...tools("k").slice(0, 2).map(entryOf),
  thoughtOf("k-t2", "**Planning the boundary rule**"), ...tools("k2").slice(2).map(entryOf),
];
const groupB = [thoughtOf("k-t3", "**Verifying in the preview**\n\nOne header per reply."), entryOf(tools("k3")[1]!)];

function App() {
  const [live, setLive] = useState(true);
  const [groupHeight, setGroupHeight] = useState(defaultThinkingGroupHeight);
  const [detailHeight, setDetailHeight] = useState(defaultToolDetailHeight);
  const [scale, setScale] = useState(true);
  const [grow, setGrow] = useState(false);
  document.documentElement.style.setProperty("--thinking-group-height", `${groupHeight}px`);
  document.documentElement.style.setProperty("--tool-detail-height", `${detailHeight}px`);
  document.documentElement.style.setProperty("--tool-detail-ratio", (detailHeight / groupHeight).toFixed(4));
  document.documentElement.dataset.toolDetailScale = String(scale);
  document.documentElement.dataset.thinkingGroupGrow = String(grow);
  return (
    <main className="main-chat-view" data-tool-display={display} style={{ width: 640, minHeight: "100vh" }}>
      <div style={{ position: "relative", zIndex: 2, padding: 24 }}>
      <section className="settings-block" style={{ marginBottom: 16 }}>
        <div className="tb-fields">
          <HeightLimitControl label="Group height limit" stops={thinkingGroupHeightStops} value={groupHeight} onChange={setGroupHeight} />
          <HeightLimitControl label="Detail height limit" stops={toolDetailHeightStops} value={detailHeight} onChange={setDetailHeight} />
          <label><input type="checkbox" checked={scale} onChange={(event) => setScale(event.target.checked)} />Scale details down</label>
          <label><input type="checkbox" checked={grow} onChange={(event) => setGrow(event.target.checked)} />Grow group with details</label>
        </div>
      </section>
      <button id="finish" onClick={() => setLive(false)} style={{ marginBottom: 12 }}>Finish turn</button>
      <article className="assistant-block">
        <ThinkingGroup messageId="short" text={"**Short group growth**\n\nBrief reasoning."} active={false} live={false} showActivityIndicator={false}>
          <ToolList tools={[
            { id: "short-bash", name: "bash", status: "done", activity: { command: "printf 'one\\ntwo\\nthree'", body: "one\ntwo\nthree" } },
            { id: "short-edit", name: "edit", status: "done", activity: { path: "short.ts", diff: "+1 short\n-2 old" } },
          ]} display={display} fold="none" />
        </ThinkingGroup>
        <Block id="a" title="Considering workbench fixtures" tools={tools("a").slice(0, 2)} />
        <Block id="b" title="Evaluating UI tests" tools={tools("b")} open />
        <Block id="c" title="Rerunning checks" tools={tools("c").slice(3)} />
        <Block id="d" title={null} tools={tools("d").slice(0, 1)} />
        <Block id="e" title="Latest group streaming" tools={tools("e").slice(0, 2)} live={live} />
      </article>
      <h4>Message flow (follower tools attach to the title)</h4>
      <div style={{ height: 360, display: "flex", position: "relative", inset: "auto", width: "100%" }} className="workbench-panel">
        <AgentPane agent={agent} agents={[agent]} messages={streamMessages} onSwitch={() => {}} ensureMessages={() => {}} onControl={() => {}} toolDisplay={display} />
      </div>
      <h4>Coherent mode (grouped between replies)</h4>
      <article className="assistant-block" id="coherent-direct">
        <CoherentGroup entries={groupA} live={false} showActivityIndicator={display === "compact"}>
          <CoherentThought text={`**Inspecting the grouping code**\n\n${bodyText}`} active={false} expanded={false} />
          <ToolList tools={tools("k").slice(0, 2)} display={display} fold="none" />
          <CoherentThought text={`**Planning the boundary rule**\n\nA group ends at the next reply.`} active={false} expanded={false} />
          <ToolList tools={tools("k2").slice(2)} display={display} fold="none" />
          <CoherentThought text="Plain reasoning without a title line." active={false} expanded={false} />
        </CoherentGroup>
        <div className="agent-reply-prose"><p>The boundary rule is changed.</p></div>
        <CoherentGroup entries={groupB} live={live} showActivityIndicator={display === "compact"}>
          <CoherentThought text={"**Verifying in the preview**\n\nOne header per reply."} active={false} expanded={live} />
          <ToolList tools={tools("k3").slice(0, 1)} display={display} fold="none" />
        </CoherentGroup>
      </article>
      <ThinkingGroupModeContext.Provider value="coherent">
        <div style={{ height: 420, display: "flex", position: "relative", inset: "auto", width: "100%" }} className="workbench-panel">
          <AgentPane agent={agent} agents={[agent]} messages={coherentMessages} onSwitch={() => {}} ensureMessages={() => {}} onControl={() => {}} toolDisplay={display} />
        </div>
      </ThinkingGroupModeContext.Provider>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
