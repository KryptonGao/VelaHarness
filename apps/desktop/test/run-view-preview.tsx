/** 「运行视图」:?theme=dark, ?en。按脚本模拟一轮流式输出,用来核对状态条与命令冷却的显示。 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ToolPlanItem } from "@vela/shared";
import { RunViewDock } from "../src/renderer/components/RunViewDock";
import { AppLocaleProvider, setActiveLocale } from "../src/renderer/locale";
import type { UiMessage } from "../src/renderer/hooks/useSession";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
setActiveLocale(params.has("en") ? "en" : "zh-CN");
document.documentElement.dataset.scheme = params.get("theme") ?? "light";
/** ?quiet=1 时消息改成 700ms 才更新一次,模拟命令在跑但没有任何流式事件的情况。 */
const messageInterval = params.has("quiet") ? 700 : 60;

/** 脚本时间线:60ms 的短命令一闪而过,随后是一条 5s 的长命令。 */
const shortCommandEnds = 900;
const longCommandStarts = 1_800;
const longCommandEnds = 6_800;

const plan: ToolPlanItem[] = [
  { text: "确认状态条闪烁的原因", status: "completed" },
  { text: "给命令加冷却时间", status: "in_progress" },
  { text: "跑测试", status: "pending" },
];

function messagesAt(elapsed: number, startedAt: number): UiMessage[] {
  const turnStartedAt = startedAt;
  const user: UiMessage = { id: "u", role: "user", text: "状态条闪得太快，给命令加个冷却", thinking: "", tools: [], turnStartedAt };
  const first: UiMessage = {
    id: "a1", role: "assistant", text: "", thinking: "", turnStartedAt,
    tools: [
      { id: "todos", name: "update_todos", status: "done", activity: { plan } },
      // 600ms 开始、900ms 结束:只跑了 300ms,不该显示「运行命令」。
      ...(elapsed >= 600
        ? [{ id: "short", name: "bash", status: elapsed < shortCommandEnds ? "running" as const : "done" as const, activity: { command: "ls apps/desktop/src/renderer" } }]
        : []),
    ],
  };
  const messages = [user, first];
  if (elapsed >= longCommandStarts) {
    messages.push({
      id: "a2", role: "assistant", text: "", thinking: "", turnStartedAt,
      tools: [{ id: "long", name: "bash", status: elapsed < longCommandEnds ? "running" : "done", activity: { command: "pnpm --filter @vela/desktop test" } }],
    });
  }
  if (elapsed >= longCommandEnds) messages[messages.length - 1]!.text = "冷却加好了。";
  return messages;
}

function App() {
  const [run, setRun] = useState(0);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const beganRef = useRef(performance.now());

  useEffect(() => {
    const started = Date.now();
    setStartedAt(started);
    setElapsed(0);
    beganRef.current = performance.now();
    (window as unknown as { __runViewLog?: unknown }).__runViewLog = [];
    setReplayKey((value) => value + 1);
    const timer = window.setInterval(() => setElapsed(Date.now() - started), messageInterval);
    return () => window.clearInterval(timer);
  }, [run]);

  const messages = useMemo(() => messagesAt(elapsed, startedAt), [elapsed, startedAt]);
  const dockRef = useRef<HTMLDivElement>(null);

  // 把状态条每次换标签的真实时间记下来（不靠消息刷新），方便查看短命令有没有闪出来。
  useEffect(() => {
    const root = dockRef.current;
    if (!root) return undefined;
    const record = () => {
      const label = root.querySelector(".run-status-label")?.textContent;
      if (!label) return;
      const log = ((window as unknown as { __runViewLog?: { at: number; label: string }[] }).__runViewLog ??= []);
      if (log[log.length - 1]?.label !== label) log.push({ at: Math.round(performance.now() - beganRef.current), label });
    };
    record();
    const observer = new MutationObserver(record);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return (
    <AppLocaleProvider locale={params.has("en") ? "en" : "zh-CN"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 720, padding: 24, background: "var(--bg-chat)", minHeight: "100vh" }}>
        <button type="button" style={{ alignSelf: "flex-start" }} onClick={() => setRun((value) => value + 1)}>
          {params.has("en") ? "Replay" : "重播"}
        </button>
        <div ref={dockRef}>
          <RunViewDock key={replayKey} messages={messages} />
        </div>
      </div>
    </AppLocaleProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
