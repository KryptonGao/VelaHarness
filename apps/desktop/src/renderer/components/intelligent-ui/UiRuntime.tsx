import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildUiEnv,
  initialUiValues,
  resolveUiSource,
  restoreUiValues,
  validateStateValue,
  type UiArtifact,
  type UiEvalEnv,
  type UiNode,
  type UiSnapshots,
  type UiToolCall,
  type UiValue,
} from "@vela/shared";
import { uiSourceFingerprint, type UiSavedValues, type UiStateScope } from "./ui-state-store";
import { uiStateStore } from "./ui-state-instance";

export { uiStateStore };

// ---------- 会话级宿主：由聊天页提供 ----------

export interface UiHost {
  conversationId: string | null;
  /** 把聊天里的消息 id 映射成稳定的 UI 回复位置；不含 UI 的消息返回 null。 */
  stableMessageId(messageId: string): string | null;
  /** 现在能不能向 Agent 发消息（模型就绪）。 */
  canSubmit: boolean;
  /** Agent 正在运行时，提交会进入队列。 */
  agentBusy: boolean;
  submit(text: string): Promise<void>;
  openLink(url: string): boolean;
  /**
   * 截至这条回复（含）为止，会话里真实的工具调用。数据源只能从这里取值；
   * 没有提供时（收件箱、Resident）数据源显示「无法获取」，界面本身不会去抓取任何东西。
   */
  toolCalls?(messageId: string): readonly UiToolCall[];
}

const fallbackHost: UiHost = {
  conversationId: null,
  stableMessageId: () => null,
  canSubmit: false,
  agentBusy: false,
  submit: async () => undefined,
  openLink: () => false,
};

const HostContext = createContext<UiHost>(fallbackHost);
export const UiHostProvider = HostContext.Provider;
export function useUiHost(): UiHost {
  return useContext(HostContext);
}

// ---------- 单个 artifact 的运行时：状态、求值、动作 ----------

export interface UiArtifactRuntime {
  artifact: UiArtifact;
  byId: ReadonlyMap<string, UiNode>;
  values: Readonly<Record<string, UiValue>>;
  env: UiEvalEnv;
  /** 数据源快照（IUI-11）：名称 → 来自真实工具结果的只读数据。 */
  snapshots: UiSnapshots;
  receiving: boolean;
  setValue(name: string, value: UiValue): void;
  host: UiHost;
}

const RuntimeContext = createContext<UiArtifactRuntime | null>(null);

export function UiRuntimeProvider({ value, children }: { value: UiArtifactRuntime; children: ReactNode }) {
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useUiRuntime(): UiArtifactRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("UI runtime is missing");
  return runtime;
}

const saveDelayMs = 400;
const staleTickMs = 30_000;

/**
 * 解析这个界面声明的数据源。数据值永远来自会话里真实的工具结果；
 * 「可能已过期」依赖时间，所以有数据源时每 30 秒重新判断一次。
 */
export function useUiSnapshots(artifact: UiArtifact, host: UiHost, messageId: string, streaming = false): UiSnapshots {
  const hasSources = artifact.sources.length > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasSources) return;
    const timer = setInterval(() => setNow(Date.now()), staleTickMs);
    return () => clearInterval(timer);
  }, [hasSources]);
  // 回复还在生成时，找不到工具结果只表示「还没来」，显示加载中；回复结束后仍找不到才是失败。
  const receiving = artifact.status === "receiving" || streaming;
  return useMemo(() => {
    if (!hasSources) return new Map();
    const calls = host.toolCalls?.(messageId) ?? [];
    return new Map(artifact.sources.map(definition => [definition.name, resolveUiSource(definition, calls, { now, receiving })] as const));
  }, [hasSources, artifact.sources, host, messageId, now, receiving]);
}

/**
 * 本地 UI 状态：
 * - `edits` 只记录用户改过的值；没改过的状态始终取最新的 initial，所以流式追加新 state 或
 *   提交 commit 都不会重置已填写的内容。
 * - 有效值 = 初始值 ∪（恢复的快照 + 本次编辑），再按当前定义校验。
 * - 只在定义稳定（不再 receiving）后写盘，并节流，避免拖动滑块时频繁 IO。
 */
export function useUiArtifactState(artifact: UiArtifact, raw: string, scope: UiStateScope | null, snapshots?: UiSnapshots) {
  const fingerprint = useMemo(() => uiSourceFingerprint(artifact.artifactId, raw), [artifact.artifactId, raw]);
  const scopeKey = scope ? `${scope.conversationId}/${scope.messageId}/${scope.artifactId}` : null;
  const settled = artifact.status === "ready" || artifact.status === "incomplete";
  const [edits, setEdits] = useState<UiSavedValues>({});
  const [restored, setRestored] = useState<{ key: string | null; values: UiSavedValues | null }>({ key: null, values: null });
  const editsRef = useRef(edits);
  editsRef.current = edits;

  // 定义稳定后载入快照。流式期间用户已经做的编辑（edits）比快照新，必须保留；
  // 只有换到另一个位置或另一份定义时，旧编辑才作废。
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!scope || !settled) return;
    const key = `${scopeKey}#${fingerprint}`;
    if (loadedKey.current === key) return;
    if (loadedKey.current !== null) setEdits({});
    loadedKey.current = key;
    setRestored({ key, values: uiStateStore.load(scope, fingerprint) });
  }, [scope, scopeKey, settled, fingerprint]);

  const values = useMemo(
    () => restoreUiValues(artifact, { ...restored.values, ...edits }),
    [artifact, restored.values, edits],
  );

  const setValue = useCallback((name: string, value: UiValue) => {
    const definition = artifact.stateDefinitions.find(item => item.name === name);
    if (!definition) return;
    // 数字框允许清空（null）这种中间态；其它类型必须类型正确。
    if (value !== null && validateStateValue({ ...definition, min: undefined, max: undefined }, value) !== null) return;
    if (value === null && definition.kind !== "number") return;
    setEdits(current => current[name] === value ? current : { ...current, [name]: value });
  }, [artifact.stateDefinitions]);

  const pending = useRef<{ timer: ReturnType<typeof setTimeout> | null }>({ timer: null });
  useEffect(() => {
    if (!scope || !settled || Object.keys(edits).length === 0) return;
    const timer = setTimeout(() => {
      pending.current.timer = null;
      uiStateStore.save(scope, fingerprint, { ...restored.values, ...edits });
    }, saveDelayMs);
    pending.current.timer = timer;
    return () => clearTimeout(timer);
  }, [edits, scope, settled, fingerprint, restored.values]);

  // 卸载（滚出、切换会话）时把还没落盘的编辑立刻写下。
  const latest = useRef({ scope, settled, fingerprint, restored: restored.values });
  latest.current = { scope, settled, fingerprint, restored: restored.values };
  useEffect(() => () => {
    const { scope: current, settled: ready, fingerprint: print, restored: saved } = latest.current;
    if (current && ready && Object.keys(editsRef.current).length > 0) uiStateStore.save(current, print, { ...saved, ...editsRef.current });
  }, []);

  const env = useMemo(() => buildUiEnv(artifact, values, snapshots), [artifact, values, snapshots]);
  return { values, env, setValue, initial: useMemo(() => initialUiValues(artifact), [artifact]) };
}
