import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from "react";
import type { ToolTrace } from "@vela/shared";
import { useTrace } from "../hooks/useTrace";
import { tr, trf } from "../locale";
import { formatDuration, indexToolDurations, readRunningStart, readToolDuration, readTurnDuration, runningSeconds, type ToolDurationSource } from "./tool-duration";
import type { ToolFoldStore } from "./tool-fold-state";
import { forgetToolStart, toolStart } from "./tool-running-clock";

const ToolProcessContext = createContext<{ store: ToolFoldStore; timings: Map<string, ToolDurationSource> } | null>(null);
const noopSubscribe = () => () => {};

/** Session-owned state; useTrace hides stale snapshots during a scope change. */
export function ToolProcessProvider({ sessionId, store, compact, enabled = true, children }: {
  sessionId: string | null; store: ToolFoldStore; compact: boolean; enabled?: boolean; children: ReactNode;
}) {
  // Disabled means no trace read and no persisted fold state; rows fall back to local state.
  const { trace } = useTrace(enabled && compact ? sessionId : null);
  const timings = useMemo(() => indexToolDurations(trace.nodes), [trace.nodes]);
  const value = useMemo(() => enabled ? { store, timings } : null, [enabled, store, timings]);
  useEffect(() => {
    const flush = () => store.flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [store]);
  return <ToolProcessContext.Provider value={value}>{children}</ToolProcessContext.Provider>;
}

/** Card mode and calls without an ID keep their existing local state. */
export function useToolExpanded(id: string | null, compact = true, fallback = false): [boolean, (value: SetStateAction<boolean>) => void] {
  const context = useContext(ToolProcessContext);
  const store = compact && id ? context?.store : undefined;
  const [local, setLocal] = useState(fallback);
  useEffect(() => { setLocal(fallback); }, [context?.store, id, fallback]);
  const snapshot = useCallback(() => store?.peekExpanded(id, fallback) ?? local, [store, id, fallback, local]);
  const expanded = useSyncExternalStore(store?.subscribe ?? noopSubscribe, snapshot, snapshot);
  useEffect(() => { store?.isExpanded(id, fallback); }, [store, id, fallback, expanded]);
  const setExpanded = useCallback((value: SetStateAction<boolean>) => {
    if (store) store.setExpanded(id, typeof value === "function" ? value(store.peekExpanded(id, fallback)) : value);
    else setLocal(value);
  }, [store, id, fallback]);
  return [expanded, setExpanded];
}

export function useToolsDuration(tools: readonly ToolTrace[]): number | null {
  const context = useContext(ToolProcessContext);
  return readTurnDuration(tools.map(tool => tool.status === "running" ? tool : context?.timings.get(tool.id) ?? tool));
}

/** 单个工具的耗时(毫秒);未完成或没有记录时为 null。 */
export function useToolDuration(tool: ToolTrace): number | null {
  const context = useContext(ToolProcessContext);
  if (!context || tool.status === "running") return null;
  return readToolDuration(context.timings.get(tool.id) ?? tool);
}

/** 运行中工具已用的整秒数,每半秒校准一次;不在运行或不足 1 秒时为 null。 */
export function useRunningSeconds(tool: ToolTrace): number | null {
  const context = useContext(ToolProcessContext);
  const running = tool.status === "running";
  const recordedStart = running ? readRunningStart(context?.timings.get(tool.id), Date.now()) : null;
  const [seconds, setSeconds] = useState<number | null>(null);
  const id = tool.id;
  useEffect(() => {
    if (!running) {
      forgetToolStart(id);
      setSeconds(null);
      return;
    }
    // 没有主进程记录的起点时,用渲染层第一次收到 tool_start 的时间;切换会话再回来行会重建,起点不能随行丢失。
    const start = recordedStart ?? toolStart(id);
    const tick = () => setSeconds(runningSeconds(Date.now() - start));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [running, recordedStart, id]);
  return running ? seconds : null;
}

export function ToolDurationLabel({ tool }: { tool: ToolTrace }) {
  const context = useContext(ToolProcessContext);
  if (!context) return null;
  const duration = tool.status === "running" ? null : readToolDuration(context.timings.get(tool.id) ?? tool);
  return <DurationLabel duration={duration} failed={tool.status === "error"} />;
}

/** Whether the optional duration labels and fold memory are active for this subtree. */
export function useToolProcessDetails(): boolean {
  return useContext(ToolProcessContext) !== null;
}

/** 失败时「· 耗时」整段转为淡红色,字体和大小不变;仅计时开启(有 ToolProcessContext)时生效。 */
export function DurationLabel({ duration, failed = false }: { duration: number | null; failed?: boolean }) {
  const label = duration === null ? null : formatDuration(duration);
  const visible = label !== null || failed;
  const ariaLabel = [failed ? tr("失败", "Failed") : null, label ? trf("耗时 {0}", "Duration {0}", label) : null].filter(Boolean).join(" · ");
  return <span className={`tool-duration${failed ? " is-failed" : ""}`} aria-hidden={!visible} aria-label={ariaLabel || undefined}>
    {visible ? "· " : null}
    {label}
  </span>;
}
