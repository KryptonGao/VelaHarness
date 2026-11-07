import type { TraceNode, TraceRequest, TraceSnapshot, TraceSummaryRequest } from "@vela/shared";
export interface TraceState extends TraceSnapshot {
  requestVersions: Record<string, number>;
  resetVersion?: number;
}
export const emptyTrace: TraceState = {
  version: 0,
  nodes: [],
  requests: [],
  summaries: [],
  warning: null,
  requestVersions: {},
};
export function mergeTrace(
  current: TraceState,
  next: TraceSnapshot & { reset?: boolean },
): TraceState {
  if (next.version < (current.resetVersion ?? 0)) return current;
  if (next.reset && next.version >= current.version) current = { ...emptyTrace, resetVersion: next.version };
  const nodes = new Map(current.nodes.map((n) => [n.id, n]));
  for (const node of next.nodes)
    if (!nodes.has(node.id) || nodes.get(node.id)!.version <= node.version)
      nodes.set(node.id, node);
  const requests = new Map(current.requests.map((r) => [r.id, r]));
  const requestVersions = { ...current.requestVersions };
  for (const r of next.requests)
    if (!requests.has(r.id) || (requestVersions[r.id] ?? -1) <= next.version) {
      requests.set(r.id, r);
      requestVersions[r.id] = next.version;
    }
  return {
    version: Math.max(current.version, next.version),
    nodes: [...nodes.values()].sort((a, b) => a.sequence - b.sequence),
    requests: [...requests.values()].sort((a, b) => a.number - b.number),
    summaries: mergeSummaries(current.summaries, next.summaries),
    requestVersions,
    resetVersion: current.resetVersion,
    warning: next.version >= current.version ? next.warning : current.warning,
  };
}
/** Summary usage records are append-only; incoming copies replace same-id entries. */
function mergeSummaries(current: TraceSummaryRequest[], next: TraceSummaryRequest[]): TraceSummaryRequest[] {
  if (next.length === 0) return current;
  const summaries = new Map(current.map((summary) => [summary.id, summary]));
  for (const summary of next) summaries.set(summary.id, summary);
  return [...summaries.values()];
}
export type TimelineMode = "sequence" | "duration" | "turn" | "request";
export interface TraceBar {
  node: TraceNode;
  /** Request spans use an existing response block to fetch their raw details. */
  sourceNodeId?: string;
  x: number;
  width: number;
  lane: number;
  row: number;
}
/** Nominal marker width; scales down with the timeline when fitting the viewport. */
const minBarWidth = 10;
const sequenceBarWidth = 36;
const sequenceBarGap = 2;
/** Smallest visible gap between neighbouring sequence bars, in pixels. */
const minSequenceGapPx = 2;
/**
 * Fitting compresses at most to this fraction of the natural width. Longer
 * traces keep this floor scale and scroll horizontally instead of shrinking
 * bars below a readable size.
 */
const minFitScale = 0.5;
/**
 * `zoom` multiplies the horizontal scale, starting at `viewportWidth` when given.
 * Insets and minimum bar widths scale with it so fitting preserves proportions.
 * The fit scale never drops below `minFitScale`, so an over-long trace no
 * longer fits without scrolling at the minimum zoom.
 */
export function traceTimeline(
  nodes: TraceNode[],
  requests: TraceRequest[],
  mode: TimelineMode,
  now: number,
  zoom = 1,
  viewportWidth?: number,
) {
  const magnification = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const responseByRequest = new Map<string, TraceNode[]>();
  for (const node of nodes) {
    if (
      node.requestId &&
      (node.kind === "thinking" ||
        node.kind === "assistant" ||
        node.kind === "tool-call")
    ) {
      const response = responseByRequest.get(node.requestId);
      if (response) response.push(node);
      else responseByRequest.set(node.requestId, [node]);
    }
  }
  const sourceNodeIds = new Map<string, string>();
  const modelRequests: TraceNode[] = [];
  for (const request of requests) {
    const response = responseByRequest.get(request.id);
    const first = response?.reduce((a, b) =>
      a.sequence < b.sequence ? a : b,
    );
    if (
      (mode !== "sequence" && request.startedAt === null) ||
      first?.kind !== "tool-call"
    ) continue;
    const firstModel = response!
      .filter((n) => n.kind === "thinking" || n.kind === "assistant")
      .reduce<TraceNode | undefined>(
        (first, n) => !first || n.sequence < first.sequence ? n : first,
        undefined,
      );
    // A tool-first response still spends time waiting for the model and generating
    // arguments. Draw that recorded request interval in the model lane, separately
    // from tool execution. If text/thinking follows, stop at its first block.
    if (firstModel && firstModel.startedAt === null) continue;
    const completedAt = firstModel?.startedAt ?? request.completedAt;
    if (
      mode !== "sequence" &&
      completedAt !== null && completedAt <= request.startedAt!
    ) continue;
    const id = `${request.id}-model`;
    sourceNodeIds.set(id, first.id);
    modelRequests.push({
      ...first,
      id,
      version: response!.reduce((max, n) => Math.max(max, n.version), first.version),
      kind: "assistant",
      toolCallId: null,
      toolName: null,
      status: firstModel ? "Completed" : request.status,
      summary: request.model,
      startedAt: request.startedAt,
      executionStartedAt: null,
      completedAt,
      durationMs: firstModel
        ? request.startedAt === null ? null : completedAt! - request.startedAt
        : request.durationMs,
    });
  }
  const visible = [
    ...nodes.filter(
      (n) => mode === "sequence" || (n.kind !== "system" && !(
        n.kind === "tool-call" && !n.historical && n.executionStartedAt === null
      )),
    ),
    ...modelRequests,
  ];
  const requestMap = new Map(requests.map((r) => [r.id, r]));
  // Use the same request-inclusive start for bounds and bars. Otherwise waiting
  // for the first token can make a model bar spill outside its request segment.
  const startOf = (node: TraceNode) => {
    const request = node.requestId ? requestMap.get(node.requestId) : null;
    return node.id.endsWith("-block-0") &&
      (node.kind === "thinking" || node.kind === "assistant")
      ? (request?.startedAt ?? node.startedAt)
      : (node.executionStartedAt ?? node.startedAt);
  };
  const firstRequestByTurn = new Map<number, number>();
  requests.forEach((r) => {
    if (!firstRequestByTurn.has(r.turn))
      firstRequestByTurn.set(r.turn, r.number);
  });
  const times = visible.flatMap((n) => {
    const t = startOf(n);
    return t === null
      ? []
      : [t, n.completedAt ?? (n.status === "Running" ? now : t)];
  });
  requests.forEach((r) => {
    if (r.startedAt !== null) times.push(r.startedAt);
  });
  const start = times.length
    ? times.reduce((min, t) => Math.min(min, t), Infinity)
    : 0;
  const end = times.length
    ? times.reduce((max, t) => Math.max(max, t), -Infinity)
    : 1;
  const duration = Math.max(1, end - start);
  const groups =
    mode === "request"
      ? Math.max(1, requests.length)
      : nodes.reduce((max, n) => Math.max(max, n.turn), 1);
  const naturalWidth = mode === "sequence"
    ? Math.max(1, visible.length) * (sequenceBarWidth + sequenceBarGap)
    : Math.max(
        900,
        mode === "duration"
          ? Math.min(200000, Math.max(visible.length * 12, (duration / 1000) * 20))
          : groups * 200,
      );
  const width = (
    viewportWidth !== undefined && Number.isFinite(viewportWidth) && viewportWidth > 0
      ? Math.max(viewportWidth, naturalWidth * minFitScale)
      : naturalWidth
  ) * magnification;
  const scale = width / naturalWidth;
  const barMin = minBarWidth * scale;
  if (mode === "sequence") {
    // Equal event slots express recorded order, including prompt/input events.
    // They deliberately ignore elapsed time and concurrency; raw timings remain
    // available in the inspector and the duration view.
    const ordered = [...visible].sort((a, b) =>
      a.sequence - b.sequence ||
      Number(sourceNodeIds.has(b.id)) - Number(sourceNodeIds.has(a.id)),
    );
    const pitch = (sequenceBarWidth + sequenceBarGap) * scale;
    // The gap shrinks with the scale, but neighbours in the same lane (a tool
    // call followed by its result) must stay visibly separate, so it never drops
    // below a couple of pixels; it also never takes more than 40% of a slot.
    const gap = Math.min(Math.max(sequenceBarGap * scale, minSequenceGapPx), pitch * 0.4);
    const bars: TraceBar[] = ordered.map((node, index) => ({
      node,
      sourceNodeId: sourceNodeIds.get(node.id),
      x: index * pitch,
      width: pitch - gap,
      lane: node.kind === "system" || node.kind === "user"
        ? 0
        : node.kind === "tool-call" || node.kind === "tool-result" ? 2 : 1,
      row: 0,
    }));
    return {
      bars,
      width,
      rows: [1, 1, 1], start, duration, groups: Math.max(1, bars.length),
    };
  }
  const bounds = new Map<number, { start: number; end: number }>();
  const groupOf = (n: TraceNode) =>
    mode === "turn"
      ? Math.max(1, n.turn)
      : n.requestId
        ? (requestMap.get(n.requestId)?.number ?? 1)
        : (firstRequestByTurn.get(n.turn) ?? 1);
  for (const n of visible) {
    const group = groupOf(n),
      t = startOf(n) ?? start,
      e = n.completedAt ?? (n.status === "Running" ? now : t);
    const b = bounds.get(group);
    bounds.set(group, {
      start: Math.min(b?.start ?? t, t),
      end: Math.max(b?.end ?? e, e),
    });
  }
  const occupied: number[][][] = [[], [], []];
  const inset = 8 * scale;
  const bars: TraceBar[] = visible.map((node, index) => {
    const lane =
      node.kind === "user"
        ? 0
        : node.kind === "tool-call" || node.kind === "tool-result"
          ? 2
          : 1;
    const t = startOf(node);
    const e = node.completedAt ?? (node.status === "Running" ? now : t);
    let x: number, w: number;
    if (mode === "duration") {
      x =
        t === null
          ? (index / Math.max(1, visible.length)) * width
          : ((t - start) / duration) * width;
      w =
        t === null || e === null
          ? barMin
          : Math.max(barMin, ((e - t) / duration) * width);
    } else {
      const group = groupOf(node),
        b = bounds.get(group)!;
      const size = width / groups;
      x =
        (group - 1) * size +
        inset +
        (t === null
          ? 0
          : ((t - b.start) / Math.max(1, b.end - b.start)) * (size - inset * 2));
      w =
        t === null || e === null
          ? barMin
          : Math.max(
              barMin,
              ((e - t) / Math.max(1, b.end - b.start)) * (size - inset * 2),
            );
    }
    x = Math.min(width - barMin, Math.max(0, x));
    w = Math.max(barMin, Math.min(w, width - x));
    return {
      node, sourceNodeId: sourceNodeIds.get(node.id), x, width: w, lane, row: 0,
    };
  });
  // Request spans can be added after later events. Pack by their displayed start
  // so a non-overlapping span reuses the same row instead of creating a new one.
  for (const bar of [...bars].sort((a, b) => a.x - b.x)) {
    let row = 0;
    while ((occupied[bar.lane]![row]?.[0] ?? -Infinity) > bar.x) row++;
    occupied[bar.lane]![row] = [bar.x + bar.width];
    bar.row = row;
  }
  // Keep recorded gaps: extending to the next event invents execution time and
  // makes alternating model/tool activity appear simultaneous. Unknown or instant
  // events retain only their minimum-width marker.
  const rows = occupied.map((l) => Math.max(1, l.length));
  return { bars, width, rows, start, duration, groups };
}
/** A drag selection on the timeline, as fractions (0–1) of the scale width. */
export interface TraceRange {
  from: number;
  to: number;
}
/**
 * Maps a timeline selection onto the event list. Bars overlapping the range
 * resolve to their list row (model-request spans via their source node); the
 * result is the contiguous row span they cover, or null when nothing overlaps.
 */
export function traceRangeRows(
  bars: TraceBar[],
  width: number,
  range: TraceRange,
  indexById: Map<string, number>,
): { first: number; last: number; count: number } | null {
  const lo = Math.min(range.from, range.to) * width,
    hi = Math.max(range.from, range.to) * width;
  let first = Infinity,
    last = -Infinity;
  for (const bar of bars) {
    if (bar.x > hi || bar.x + bar.width < lo) continue;
    const index = indexById.get(bar.sourceNodeId ?? bar.node.id);
    if (index === undefined) continue;
    first = Math.min(first, index);
    last = Math.max(last, index);
  }
  return last < first ? null : { first, last, count: last - first + 1 };
}
export function traceMetrics(requests: TraceRequest[]) {
  let tokens = 0,
    input = 0,
    cache = 0,
    output = 0,
    generation = 0;
  let hasUsage = false;
  for (const r of requests) {
    if (r.usage) {
      hasUsage = true;
      tokens += r.usage.totalTokens;
      input += r.usage.input + r.usage.cacheRead + r.usage.cacheWrite;
      cache += r.usage.cacheRead;
      if (r.generationMs !== null && r.generationMs > 0) {
        output += r.usage.output;
        generation += r.generationMs;
      }
    }
  }
  return {
    tokens: hasUsage ? tokens : null,
    cache: input > 0 ? cache / input : null,
    speed: generation > 0 ? (output / generation) * 1000 : null,
  };
}
export function slowestTraceNode(
  nodes: TraceNode[],
  requests: TraceRequest[],
): string | null {
  let duration = -1,
    id: string | null = null;
  for (const n of nodes)
    if (
      n.kind === "tool-call" &&
      n.durationMs !== null &&
      n.durationMs > duration
    ) {
      duration = n.durationMs;
      id = n.id;
    }
  for (const r of requests)
    if (r.durationMs !== null && r.durationMs > duration) {
      const n = nodes.find(
        (n) =>
          n.requestId === r.id &&
          (n.kind === "assistant" || n.kind === "thinking"),
      );
      if (n) {
        duration = r.durationMs;
        id = n.id;
      }
    }
  return id;
}

/** Lossless display segments bound both line count and giant single-line payloads. */
export function traceCodePages(
  content: string,
  maxLines = 200,
  maxChars = 40000,
) {
  const pages: { text: string; firstLine: number; lastLine: number }[] = [];
  let start = 0,
    line = 1;
  while (start < content.length) {
    let end = Math.min(content.length, start + maxChars),
      cursor = start,
      count = 0;
    while (count < maxLines) {
      const newline = content.indexOf("\n", cursor);
      if (newline < 0 || newline >= end) break;
      cursor = newline + 1;
      count++;
      if (count === maxLines) end = cursor;
    }
    const last = content.charCodeAt(end - 1);
    if (end < content.length && last >= 0xd800 && last <= 0xdbff) end--;
    const text = content.slice(start, end),
      breaks = (text.match(/\n/g) ?? []).length;
    pages.push({ text, firstLine: line, lastLine: line + breaks });
    line += breaks;
    start = end;
  }
  return pages.length ? pages : [{ text: "", firstLine: 1, lastLine: 1 }];
}

export type TraceFilter = "all" | "user" | "assistant" | "thinking" | "tool" | "error";
export const traceFilters: TraceFilter[] = ["all", "user", "assistant", "thinking", "tool", "error"];
export function matchesTraceFilter(node: TraceNode, filter: TraceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "tool":
      return node.kind === "tool-call" || node.kind === "tool-result";
    case "error":
      return node.kind === "error" || node.status === "Failed";
    default:
      return node.kind === filter;
  }
}

export interface TraceToolSummary {
  /** The argument that best identifies the call, shown prominently. */
  primary: string;
  /** Remaining non-empty arguments, shown dimmed. */
  rest: { key: string; value: string }[];
}
const primaryArgumentKeys = ["command", "path", "file_path", "pattern", "query", "url"];
const pairStart = /\s*,?\s*"((?:[^"\\]|\\.)*)"\s*:\s*/y;
const quoted = /"((?:[^"\\]|\\.)*)"?/y;
const scalar = /[^,}\s]+/y;
/**
 * Reads the leading `"key": value` pairs of a tool-call summary. Summaries are
 * whitespace-collapsed and cut at a fixed length, so they are often invalid
 * JSON; this scans leniently and stops at the first nested value. Returns null
 * when the text is not an argument object.
 */
export function parseToolSummary(summary: string): TraceToolSummary | null {
  const text = summary.trim();
  if (!text.startsWith("{")) return null;
  const entries: { key: string; value: string }[] = [];
  let pos = 1;
  while (pos < text.length) {
    pairStart.lastIndex = pos;
    const pair = pairStart.exec(text);
    if (!pair) break;
    pos = pairStart.lastIndex;
    let value: string;
    if (text[pos] === '"') {
      quoted.lastIndex = pos;
      const match = quoted.exec(text)!;
      pos = quoted.lastIndex;
      try {
        value = JSON.parse(`"${match[1]}"`);
      } catch {
        value = match[1]!;
      }
    } else if (text[pos] === "{" || text[pos] === "[") {
      entries.push({ key: pair[1]!, value: text.slice(pos).replace(/\s*}\s*$/, "") });
      break;
    } else {
      scalar.lastIndex = pos;
      const match = scalar.exec(text);
      if (!match) break;
      value = match[0];
      pos = scalar.lastIndex;
    }
    entries.push({ key: pair[1]!, value });
  }
  if (!entries.length) return null;
  const primary =
    entries.find((e) => primaryArgumentKeys.includes(e.key) && e.value !== "") ??
    entries.find((e) => e.value !== "null" && e.value !== "") ??
    entries[0]!;
  return {
    primary: primary.value,
    rest: entries.filter(
      (e) => e !== primary && e.value !== "null" && e.value !== "false" && e.value !== "",
    ),
  };
}
