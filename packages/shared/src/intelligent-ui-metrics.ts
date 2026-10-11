import type { UiArtifact } from "./intelligent-ui";

/**
 * Intelligent UI 的本地可观察指标（IUI-13）。
 *
 * 只记录计数、耗时、状态和拒绝原因，不记录用户输入的值、界面文字或密钥；默认不上传。
 * 纯逻辑，时间由调用方注入，方便测试。渲染层持有一个实例，把聚合计数持久化到本地存储。
 */

export type UiMetricEventType =
  | "begin" | "first_node" | "ready" | "incomplete" | "invalid" | "render_error" | "disposed"
  | "app_run" | "app_stop" | "app_blocked";

export interface UiMetricEvent {
  /** 相对于该界面首次出现的毫秒数。 */
  at: number;
  type: UiMetricEventType;
  /** 状态原因或停止原因这类固定短语，不含用户内容。 */
  detail?: string;
}

export interface UiMetricsSummary {
  assistantMessages: number;
  uiMessages: number;
  /** 含界面的回复占全部助手回复的比例（0..1）。 */
  uiRatio: number;
  /** 流式生成的界面总数及各结局。 */
  artifacts: number;
  ready: number;
  incomplete: number;
  invalid: number;
  /** ready / (ready + incomplete + invalid)；没有样本时为 null。 */
  commitRate: number | null;
  /** 首个合法节点出现的耗时中位数（毫秒）；没有样本时为 null。 */
  medianFirstNodeMs: number | null;
  /** 降级原因计数：invalid 的拒绝原因、incomplete、render_error、app_blocked。 */
  reasons: Record<string, number>;
  renderErrors: number;
  appRuns: number;
  appStops: Record<string, number>;
  averageNodes: number | null;
  averageStates: number | null;
}

interface Counters {
  assistantMessages: number;
  uiMessages: number;
  artifacts: number;
  ready: number;
  incomplete: number;
  invalid: number;
  reasons: Record<string, number>;
  renderErrors: number;
  appRuns: number;
  appStops: Record<string, number>;
  nodeTotal: number;
  stateTotal: number;
  /** 最近的首节点耗时样本（环形，最多 200 个）。 */
  firstNodeSamples: number[];
}

const emptyCounters = (): Counters => ({
  assistantMessages: 0, uiMessages: 0, artifacts: 0, ready: 0, incomplete: 0, invalid: 0, reasons: {},
  renderErrors: 0, appRuns: 0, appStops: {}, nodeTotal: 0, stateTotal: 0, firstNodeSamples: [],
});

interface Record_ {
  firstSeen: number;
  live: boolean;
  firstNodeAt: number | null;
  finalized: boolean;
  events: UiMetricEvent[];
}

export interface UiMetricsOptions {
  now?: () => number;
  maxEventsPerArtifact?: number;
  maxArtifacts?: number;
}

const storageVersion = 1;
const maxSamples = 200;

function bump(table: Record<string, number>, key: string): void {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return;
  table[key] = (table[key] ?? 0) + 1;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function toTable(value: unknown): Record<string, number> {
  const table: Record<string, number> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, count] of Object.entries(value).slice(0, 50)) {
      if (key !== "__proto__" && key !== "constructor" && key !== "prototype") table[key.slice(0, 60)] = toCount(count);
    }
  }
  return table;
}

export class UiMetrics {
  private counters: Counters = emptyCounters();
  private readonly records = new Map<string, Record_>();
  private readonly seenMessages = new Set<string>();
  private readonly now: () => number;
  private readonly maxEvents: number;
  private readonly maxArtifacts: number;
  private listeners = new Set<() => void>();

  constructor(options: UiMetricsOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxEvents = options.maxEventsPerArtifact ?? 60;
    this.maxArtifacts = options.maxArtifacts ?? 200;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** 一条助手回复完成渲染：用于「生成比例」。同一条回复只计一次。 */
  assistantMessage(messageKey: string, hasUi: boolean): void {
    if (this.seenMessages.has(messageKey)) return;
    this.seenMessages.add(messageKey);
    this.counters.assistantMessages += 1;
    if (hasUi) this.counters.uiMessages += 1;
    this.changed();
  }

  private record(key: string, live: boolean): Record_ {
    let found = this.records.get(key);
    if (!found) {
      found = { firstSeen: this.now(), live, firstNodeAt: null, finalized: false, events: [] };
      this.records.set(key, found);
      while (this.records.size > this.maxArtifacts) this.records.delete(this.records.keys().next().value as string);
      this.push(found, "begin");
    }
    return found;
  }

  private push(record: Record_, type: UiMetricEventType, detail?: string): void {
    if (record.events.length >= this.maxEvents) return;
    record.events.push({ at: this.now() - record.firstSeen, type, ...(detail ? { detail } : {}) });
  }

  /** 每次界面快照变化都调用；只在状态首次出现时记录一次。live 表示它是在流式生成中到达的（而非历史恢复）。 */
  observe(key: string, artifact: Pick<UiArtifact, "status" | "reason" | "nodes" | "stateDefinitions">, live: boolean): void {
    const record = this.record(key, live);
    let touched = false;
    if (record.firstNodeAt === null && artifact.nodes.some(node => !node.invalid)) {
      record.firstNodeAt = this.now();
      this.push(record, "first_node");
      touched = true;
    }
    if (!record.finalized && (artifact.status === "ready" || artifact.status === "incomplete" || artifact.status === "invalid")) {
      record.finalized = true;
      touched = true;
      const detail = artifact.status === "ready" ? undefined : artifact.reason ?? artifact.status;
      this.push(record, artifact.status, detail);
      // 只有流式生成的界面计入结局统计；历史恢复反复渲染不应抬高数字。
      if (record.live) {
        this.counters.artifacts += 1;
        this.counters[artifact.status] += 1;
        if (artifact.status !== "ready") bump(this.counters.reasons, detail as string);
        if (record.firstNodeAt !== null) {
          this.counters.firstNodeSamples.push(record.firstNodeAt - record.firstSeen);
          if (this.counters.firstNodeSamples.length > maxSamples) this.counters.firstNodeSamples.shift();
        }
        this.counters.nodeTotal += artifact.nodes.length;
        this.counters.stateTotal += artifact.stateDefinitions.length;
      }
    }
    if (artifact.status === "disposed" && !record.events.some(event => event.type === "disposed")) {
      this.push(record, "disposed");
      touched = true;
    }
    if (touched) this.changed();
  }

  renderError(key: string): void {
    const record = this.record(key, false);
    this.push(record, "render_error");
    this.counters.renderErrors += 1;
    bump(this.counters.reasons, "render_error");
    this.changed();
  }

  appRun(key: string): void {
    const record = this.record(key, false);
    this.push(record, "app_run");
    this.counters.appRuns += 1;
    this.changed();
  }

  appStop(key: string, reason: string): void {
    const record = this.record(key, false);
    this.push(record, "app_stop", reason);
    bump(this.counters.appStops, reason);
    if (reason !== "stopped" && reason !== "disposed") bump(this.counters.reasons, `app_${reason}`);
    this.changed();
  }

  appBlocked(key: string, reason: string): void {
    const record = this.record(key, false);
    if (!record.events.some(event => event.type === "app_blocked")) {
      this.push(record, "app_blocked", reason);
      bump(this.counters.reasons, "app_blocked");
      this.changed();
    }
  }

  timeline(key: string): readonly UiMetricEvent[] {
    return this.records.get(key)?.events ?? [];
  }

  summary(): UiMetricsSummary {
    const c = this.counters;
    const decided = c.ready + c.incomplete + c.invalid;
    const samples = [...c.firstNodeSamples].sort((a, b) => a - b);
    const median = samples.length === 0 ? null : samples.length % 2 ? samples[(samples.length - 1) / 2] : (samples[samples.length / 2 - 1] + samples[samples.length / 2]) / 2;
    return {
      assistantMessages: c.assistantMessages,
      uiMessages: c.uiMessages,
      uiRatio: c.assistantMessages > 0 ? c.uiMessages / c.assistantMessages : 0,
      artifacts: c.artifacts,
      ready: c.ready,
      incomplete: c.incomplete,
      invalid: c.invalid,
      commitRate: decided > 0 ? c.ready / decided : null,
      medianFirstNodeMs: median,
      reasons: { ...c.reasons },
      renderErrors: c.renderErrors,
      appRuns: c.appRuns,
      appStops: { ...c.appStops },
      averageNodes: c.artifacts > 0 ? c.nodeTotal / c.artifacts : null,
      averageStates: c.artifacts > 0 ? c.stateTotal / c.artifacts : null,
    };
  }

  reset(): void {
    this.counters = emptyCounters();
    this.records.clear();
    this.seenMessages.clear();
    this.changed();
  }

  /** 只持久化聚合计数；事件时间线、界面内容和输入值都不落盘。 */
  serialize(): string {
    return JSON.stringify({ v: storageVersion, ...this.counters });
  }

  /** 从存储恢复聚合计数；格式不符就保持清空。 */
  restore(raw: string | null | undefined): void {
    if (!raw) return;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== storageVersion) return;
      const record = value as Record<string, unknown>;
      this.counters = {
        assistantMessages: toCount(record.assistantMessages), uiMessages: toCount(record.uiMessages), artifacts: toCount(record.artifacts),
        ready: toCount(record.ready), incomplete: toCount(record.incomplete), invalid: toCount(record.invalid),
        reasons: toTable(record.reasons), renderErrors: toCount(record.renderErrors), appRuns: toCount(record.appRuns),
        appStops: toTable(record.appStops), nodeTotal: toCount(record.nodeTotal), stateTotal: toCount(record.stateTotal),
        firstNodeSamples: Array.isArray(record.firstNodeSamples)
          ? record.firstNodeSamples.filter((sample): sample is number => typeof sample === "number" && Number.isFinite(sample) && sample >= 0).slice(-maxSamples)
          : [],
      };
      this.changed();
    } catch {
      // 损坏的指标不影响使用。
    }
  }
}
