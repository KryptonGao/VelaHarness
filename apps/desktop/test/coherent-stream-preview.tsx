/** A live group with many steps inside a real AgentPane; window.__tick() streams one more thinking delta.
 *  ?steps=300&display=card|compact&mode=coherent|single&tools=1 (tools per message; with mode=single each message folds its tools into one run group) */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { AgentInfo, ToolTrace } from "@vela/shared";
import { AgentPane } from "../src/renderer/components/AgentPane";
import { ThinkingGroupModeContext } from "../src/renderer/components/ThinkingGroupModeContext";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import type { ToolDisplay } from "../src/renderer/hooks/usePreferences";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
const steps = Number(params.get("steps") ?? 300);
const mode = params.get("mode") === "single" ? "single" : "coherent";
const plain = params.has("plain");
const perMessage = Number(params.get("tools") ?? 1);
const display: ToolDisplay = params.get("display") === "card" ? "card" : "compact";
const diff = Array.from({ length: 12 }, (_, i) => `${i % 3 === 0 ? "-" : "+"}${i + 10} const level${i} = compute(${i});`).join("\n");
const output = Array.from({ length: 12 }, (_, i) => `✓ check ${i + 1} passed`).join("\n");

const streamDiff = params.has("streamdiff");
/** A file write still being generated: the diff grows by `lines` rows and `streaming` marks the pending arguments. */
const css = params.get("ext") === "css";
const streamingEdit = (id: string, lines: number): ToolTrace => ({
  id, name: "edit", status: "running",
  activity: {
    path: css ? "src/streamed.css" : "src/streamed.ts", streaming: { added: lines, removed: 0 },
    diff: Array.from({ length: lines }, (_, k) => css
      ? `+${k + 1} .composer-layout-${k} > .slot:nth-child(${k}) { padding: ${k}px calc(var(--gap) * 2); color: color-mix(in srgb, var(--fg) 40%, transparent); }`
      : `+${k + 1} export const value${k} = compute(${k}, "payload-${k}"); // streamed line`).join("\n"),
  },
});

const toolAt = (i: number, running = false, lines = 0): ToolTrace => {
  const id = `t${i}`;
  if (streamDiff && running) return streamingEdit(id, lines);
  const status = running ? "running" : "done";
  switch (i % 4) {
    case 0: return { id, name: "read", status, activity: { path: `src/file-${i}.ts`, body: "const a = 1;" } };
    case 1: return { id, name: "edit", status, activity: { path: `src/file-${i}.ts`, diff } };
    case 2: return { id, name: "bash", status, activity: { command: `pnpm test --filter ${i}`, body: output } };
    default: return { id, name: "grep", status, activity: { command: `pattern${i}`, path: "src" } };
  }
};
const message = (i: number, running = false, extra = "", lines = 0): UiMessage => ({
  id: `m${i}`, role: "assistant", model: plain ? "claude-sonnet-5-5" : "gpt-6.1", text: "",
  tools: Array.from({ length: perMessage }, (_, k) => toolAt(i * perMessage + k, running && k === perMessage - 1, lines)),
  thinking: plain ? "" : `**Step ${i} summary**\n\nReasoning for this step, a couple of lines of detail so the body has height.${extra}`,
});

const agent = {
  id: "agent-1", parentId: "root", path: "/root/w", name: "w", kind: "worker", status: "running", depth: 1, task: "UI",
  steps: [], mutated: false, finalText: null, error: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  activeMs: 0, runningSince: null, pauseRequested: false, createdAt: 1, updatedAt: 1,
} as unknown as AgentInfo;

let base: UiMessage[] = Array.from({ length: steps }, (_, i) => message(i));
let tick = 0;
const root = createRoot(document.getElementById("root")!);
const render = () => root.render(
  <ThinkingGroupModeContext.Provider value={mode}>
    <main className="main-chat-view" data-tool-display={display} style={{ width: 640, height: 760, display: "flex", position: "relative" }}>
      <div id="pane" className="workbench-panel" style={{ display: "flex", position: "relative", inset: "auto", width: "100%", height: "100%" }}>
        <AgentPane agent={agent} agents={[agent]} messages={base} onSwitch={() => {}} ensureMessages={() => {}} onControl={() => {}} toolDisplay={display} toolFold={params.get("fold") === "position" ? "position" : "message"} />
      </div>
    </main>
  </ThinkingGroupModeContext.Provider>,
);
render();
/** Stream one more word into the last message's thinking; every other message keeps its identity. */
(window as unknown as { __tick: () => number }).__tick = () => {
  tick += 1;
  const last = base.length - 1;
  base = [...base.slice(0, last), message(last, true, ` word${tick}`.repeat(tick), tick * 8)];
  const start = performance.now();
  flushSync(render);
  return performance.now() - start;
};
