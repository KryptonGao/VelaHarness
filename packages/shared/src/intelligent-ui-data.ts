import {
  uiLimits,
  type UiProps,
  type UiScalar,
  type UiSourceRow,
  type UiSourceSnapshot,
} from "./intelligent-ui";
import { resolveUiValue, type UiEvalEnv, type UiEvalErrorCode } from "./intelligent-ui-expression";

/**
 * 图表、饼图、时间轴、差异视图的数据模型（IUI-10 / IUI-15）。
 * 渲染层、「复制文字」和对话导出共用同一份解析，所以屏幕上看到的数据和导出的一致。
 * 全部是纯函数：不读时间、不联网、不执行任何东西。
 */

// ---------- 通用 ----------

function numberOf(value: UiScalar | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function labelOf(value: UiScalar | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, 100);
}

/** 数据源还没有可用数据时的状态：用来决定显示骨架、错误还是空态。 */
export function sourceBlocked(snapshot: UiSourceSnapshot | undefined): "loading" | "error" | "empty" | null {
  if (!snapshot) return "loading";
  if (snapshot.status === "loading") return "loading";
  if (snapshot.status === "error") return "error";
  if (snapshot.status === "empty") return "empty";
  return null;
}

// ---------- 折线 / 柱状图 ----------

export interface ChartSeriesData {
  key: string;
  label: string;
  values: Array<number | null>;
  /** 每个点绑定的 number 状态（仅当它就是一个 {ref}）：可拖动。 */
  bound: Array<string | null>;
}

export interface ChartData {
  labels: string[];
  series: ChartSeriesData[];
  /** 数据点里第一个求值错误，供图表下方提示。 */
  error: UiEvalErrorCode | null;
}

export function resolveChartData(props: UiProps, env: UiEvalEnv, snapshot: UiSourceSnapshot | undefined, receiving = false): ChartData {
  if (typeof props.from === "string") {
    const x = String(props.x);
    const columns = (props.y as string[]) ?? [];
    const rows = (snapshot?.rows ?? []).slice(0, uiLimits.chartPoints);
    return {
      labels: rows.map(row => labelOf(row[x])),
      series: columns.map((column, index) => ({
        key: `s${index + 1}`,
        label: column,
        values: rows.map(row => numberOf(row[column])),
        bound: rows.map(() => null),
      })),
      error: null,
    };
  }
  const labels = (props.labels as string[]) ?? [];
  let error: UiEvalErrorCode | null = null;
  const series = ((props.series as Array<{ key: string; label: string; values: unknown[] }>) ?? []).map(entry => ({
    key: entry.key,
    label: entry.label || (typeof props.title === "string" ? props.title : ""),
    values: entry.values.map(value => {
      const result = resolveUiValue(value, env, receiving);
      if (!result.ok) { error ??= result.error; return null; }
      return typeof result.value === "number" ? result.value : null;
    }),
    bound: entry.values.map(value => value !== null && typeof value === "object" && "ref" in value ? (value as { ref: string }).ref : null),
  }));
  return { labels, series, error };
}

export interface ChartDomain {
  min: number;
  max: number;
  ticks: number[];
}

/** 「好看」的刻度：1/2/5 × 10^n。 */
export function niceScale(min: number, max: number, target = 5): ChartDomain {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 0.5, 1] };
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const span = max - min;
  const rough = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2 && ticks.length < 20; value += step) ticks.push(Number(value.toPrecision(12)));
  return { min: low, max: high, ticks };
}

/**
 * 纵轴范围。模型给了 yMin/yMax 就严格遵守（不做「好看」扩展，避免悄悄改变刻度含义）；
 * 柱状图的基线必须包含 0，否则柱子高度会误导。
 */
export function chartDomain(series: readonly ChartSeriesData[], options: { yMin?: number; yMax?: number; includeZero: boolean }): ChartDomain {
  const values = series.flatMap(entry => entry.values).filter((value): value is number => value !== null);
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  if (options.includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  const scale = niceScale(options.yMin ?? min, options.yMax ?? max);
  const low = options.yMin ?? scale.min;
  const high = options.yMax ?? scale.max;
  const ticks = scale.ticks.filter(tick => tick >= low - 1e-9 && tick <= high + 1e-9);
  return { min: low, max: high, ticks: ticks.length >= 2 ? ticks : [low, high] };
}

// ---------- 饼图 ----------

export interface PieSlice {
  label: string;
  value: number;
  /** 0..1 */
  fraction: number;
}

export interface PieData {
  slices: PieSlice[];
  total: number;
  /** 因为不是非负数而被忽略的扇区数。 */
  skipped: number;
  error: UiEvalErrorCode | null;
}

export function resolvePieData(props: UiProps, env: UiEvalEnv, snapshot: UiSourceSnapshot | undefined, receiving = false): PieData {
  const raw: Array<{ label: string; value: number | null }> = [];
  let error: UiEvalErrorCode | null = null;
  if (typeof props.from === "string") {
    const labelKey = String(props.label);
    const valueKey = String(props.value);
    for (const row of (snapshot?.rows ?? []).slice(0, uiLimits.pieSlices)) raw.push({ label: labelOf(row[labelKey]), value: numberOf(row[valueKey]) });
  } else {
    for (const slice of (props.slices as Array<{ label: string; value: unknown }>) ?? []) {
      const result = resolveUiValue(slice.value, env, receiving);
      if (!result.ok) { error ??= result.error; raw.push({ label: slice.label, value: null }); continue; }
      raw.push({ label: slice.label, value: typeof result.value === "number" ? result.value : null });
    }
  }
  const valid = raw.filter((entry): entry is { label: string; value: number } => entry.value !== null && entry.value >= 0);
  const total = valid.reduce((sum, entry) => sum + entry.value, 0);
  return {
    slices: valid.map(entry => ({ ...entry, fraction: total > 0 ? entry.value / total : 0 })),
    total,
    skipped: raw.length - valid.length,
    error,
  };
}

// ---------- 表格 / 列表（来自数据源） ----------

export function sourceRows(snapshot: UiSourceSnapshot | undefined): UiSourceRow[] {
  return snapshot && (snapshot.status === "ok" || snapshot.status === "stale") ? snapshot.rows : [];
}

// ---------- 时间轴 ----------

export type TimelineStatus = "done" | "current" | "upcoming" | "blocked";
export interface TimelineEntry { date: string | null; title: string; detail: string | null; status: TimelineStatus }
const timelineStatuses: readonly string[] = ["done", "current", "upcoming", "blocked"];

export function resolveTimeline(props: UiProps, snapshot: UiSourceSnapshot | undefined): TimelineEntry[] {
  if (typeof props.from === "string") {
    const titleKey = String(props.titleKey);
    const dateKey = typeof props.dateKey === "string" ? props.dateKey : null;
    const detailKey = typeof props.detailKey === "string" ? props.detailKey : null;
    const statusKey = typeof props.statusKey === "string" ? props.statusKey : null;
    return sourceRows(snapshot).slice(0, uiLimits.timelineItems).map(row => {
      const status = statusKey ? String(row[statusKey] ?? "") : "";
      return {
        date: dateKey ? labelOf(row[dateKey]) || null : null,
        title: labelOf(row[titleKey]),
        detail: detailKey ? String(row[detailKey] ?? "").slice(0, 1_000) || null : null,
        status: (timelineStatuses.includes(status) ? status : "upcoming") as TimelineStatus,
      };
    });
  }
  return ((props.items as Array<{ date?: string; title: string; detail?: string; status: TimelineStatus }>) ?? []).map(item => ({
    date: item.date ?? null, title: item.title, detail: item.detail ?? null, status: item.status,
  }));
}

// ---------- 差异视图 ----------

export type DiffLineKind = "file" | "meta" | "hunk" | "add" | "del" | "ctx";
export interface DiffLine { kind: DiffLineKind; text: string; oldNo: number | null; newNo: number | null }
export interface DiffModel { lines: DiffLine[]; files: number; added: number; removed: number; truncated: boolean }

/** 解析 unified diff。靠 @@ 头里的行数区分「--- 开头的被删行」和文件头，没有头的简易 diff 退回按首字符判断。 */
export function parseUnifiedDiff(text: string, maxLines: number = uiLimits.diffLines): DiffModel {
  const source = text.replace(/\r\n?/g, "\n").split("\n");
  if (source[source.length - 1] === "") source.pop();
  const lines: DiffLine[] = [];
  let files = 0;
  let added = 0;
  let removed = 0;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let truncated = false;
  const push = (line: DiffLine) => {
    if (lines.length >= maxLines) { truncated = true; return; }
    lines.push(line);
  };
  for (const raw of source) {
    if (truncated) break;
    if (oldLeft > 0 || newLeft > 0) {
      const marker = raw[0];
      if (marker === "\\") { push({ kind: "meta", text: raw, oldNo: null, newNo: null }); continue; }
      if (marker === "-" && oldLeft > 0) { removed += 1; oldLeft -= 1; push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, newNo: null }); continue; }
      if (marker === "+" && newLeft > 0) { added += 1; newLeft -= 1; push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ }); continue; }
      if ((marker === " " || raw === "") && oldLeft > 0 && newLeft > 0) {
        oldLeft -= 1; newLeft -= 1;
        push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
        continue;
      }
      // 行数对不上（被截断或格式不规范）：放弃计数，按普通行继续。
      oldLeft = 0;
      newLeft = 0;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      push({ kind: "hunk", text: raw, oldNo: null, newNo: null });
      continue;
    }
    if (raw.startsWith("diff ")) { files += 1; push({ kind: "file", text: raw, oldNo: null, newNo: null }); continue; }
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode|Binary files)/.test(raw)) {
      if (raw.startsWith("--- ") && files === 0) files += 1;
      push({ kind: "meta", text: raw, oldNo: null, newNo: null });
      continue;
    }
    if (raw.startsWith("+")) { added += 1; push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: null }); continue; }
    if (raw.startsWith("-")) { removed += 1; push({ kind: "del", text: raw.slice(1), oldNo: null, newNo: null }); continue; }
    push({ kind: raw.startsWith(" ") ? "ctx" : "meta", text: raw.startsWith(" ") ? raw.slice(1) : raw, oldNo: null, newNo: null });
  }
  return { lines, files, added, removed, truncated: truncated || source.length > lines.length };
}

// ---------- 行程示意图 ----------

export interface PlotPoint { x: number; y: number; name: string; day: string; index: number }

/**
 * 只用模型明确给出的坐标做示意图（等距圆柱投影，按纬度修正横向比例）。
 * 没有坐标的地点不会出现，也绝不根据名称猜坐标。少于两个有坐标的点时返回 null。
 */
export function itineraryPlot(days: ReadonlyArray<{ label: string; stops: ReadonlyArray<{ name: string; lat?: number; lng?: number }> }>): { points: PlotPoint[]; width: number; height: number } | null {
  const located: Array<{ name: string; day: string; lat: number; lng: number }> = [];
  for (const day of days) for (const stop of day.stops) {
    if (typeof stop.lat === "number" && typeof stop.lng === "number") located.push({ name: stop.name, day: day.label, lat: stop.lat, lng: stop.lng });
  }
  if (located.length < 2) return null;
  const lats = located.map(stop => stop.lat);
  const lngs = located.map(stop => stop.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const scale = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const width = (Math.max(...lngs) - Math.min(...lngs)) * scale;
  const height = Math.max(...lats) - Math.min(...lats);
  const size = Math.max(width, height, 1e-6);
  const points = located.map((stop, index) => ({
    x: ((stop.lng - Math.min(...lngs)) * scale) / size,
    // 屏幕 y 轴向下，纬度越高越靠上。
    y: (Math.max(...lats) - stop.lat) / size,
    name: stop.name,
    day: stop.day,
    index,
  }));
  // width/height 是点所在范围（0..1，较长的一边为 1），渲染层据此决定画布比例。
  return { points, width: width / size, height: height / size };
}


// ---------- 数据复制 / 导出 ----------

function tsvCell(value: string): string {
  // 制表符和换行会破坏表格结构；以 =、+、-、@ 开头的单元格在表格软件里可能被当作公式，加单引号前缀。
  const flat = value.replace(/[\t\r\n]+/g, " ");
  return /^[=+\-@]/.test(flat) && !/^-?\d+(?:\.\d+)?$/.test(flat) ? `'${flat}` : flat;
}

/** 制表符分隔文本（可直接粘贴进表格软件）。纯文字，不含公式。 */
export function toTsv(head: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return [head, ...rows].map(row => row.map(tsvCell).join("\t")).join("\n");
}

/** 图表数据的表格形式：无障碍数据表、复制 TSV 和导出共用。 */
export function chartTable(data: ChartData, format: (value: number | null) => string): { head: string[]; rows: string[][] } {
  return {
    head: ["", ...data.series.map(entry => entry.label || "—")],
    rows: data.labels.map((label, index) => [label, ...data.series.map(entry => format(entry.values[index] ?? null))]),
  };
}

export function pieTable(data: PieData, head: readonly [string, string], format: (value: number) => string): { head: string[]; rows: string[][] } {
  return {
    head: [head[0], head[1], "%"],
    rows: data.slices.map(slice => [slice.label, format(slice.value), `${(slice.fraction * 100).toFixed(1)}%`]),
  };
}
