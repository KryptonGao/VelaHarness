import {
  collectRefs,
  parseExpression,
} from "./intelligent-ui-expression";
import {
  isForbiddenKey,
  isPlainObject,
  isUiName,
  safeExternalUrl,
  uiDataStatuses,
  uiLimits,
  uiToolNameRe,
  type UiAction,
  type UiDataStatus,
  type UiDynamic,
  type UiExpression,
  type UiProps,
  type UiScalar,
  type UiSourceNote,
  type UiStateKind,
} from "./intelligent-ui";

/**
 * 版本化组件白名单注册表（v1）。
 * 每个组件的校验函数把模型给的原始 props 规整成渲染层可直接使用的结构：
 * 未知字段被丢弃，数值被限幅，字符串被截断检查，动作被限制在注册动作里。
 * 渲染层永远不接触模型的原始 JSON。
 */

export interface UiComponentBinding {
  name: string;
  /** 该控件要求绑定的状态类型。 */
  kind: UiStateKind;
}

export interface UiValidatedProps {
  props: UiProps;
  show?: UiExpression;
  /** 表达式、动作和 bind 引用的名称，commit 时必须都已定义。 */
  refs: string[];
  /** from / refresh_source 引用的数据源名称，commit 时必须都已声明。 */
  sourceRefs: string[];
  /** 控件绑定，commit 时检查状态类型。 */
  bindings: UiComponentBinding[];
  /** 计入 options 总上限的条目数（选项、表格行、列表项）。 */
  optionCount: number;
}

export type UiPropsResult =
  | { ok: true; value: UiValidatedProps }
  | { ok: false; reason: string };

class PropError extends Error {}

function reject(message: string): never {
  throw new PropError(message);
}

interface Collector {
  refs: Set<string>;
  sourceRefs: Set<string>;
  bindings: UiComponentBinding[];
  optionCount: number;
}

type Raw = Record<string, unknown>;

// ---------- 字段读取工具 ----------

function text(raw: Raw, key: string, options: { max?: number; required?: boolean; fallback?: string } = {}): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    if (options.required) reject(`${key} is required`);
    return options.fallback;
  }
  if (typeof value !== "string") reject(`${key} must be a string`);
  if (options.required && !value.trim()) reject(`${key} must not be empty`);
  if (value.length > (options.max ?? uiLimits.stringLength)) reject(`${key} is too long`);
  return value;
}

function number(raw: Raw, key: string, options: { min?: number; max?: number; integer?: boolean; fallback?: number; required?: boolean } = {}): number | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    if (options.required) reject(`${key} is required`);
    return options.fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) reject(`${key} must be a finite number`);
  if (options.integer && !Number.isInteger(value)) reject(`${key} must be an integer`);
  if (options.min !== undefined && value < options.min) reject(`${key} is below ${options.min}`);
  if (options.max !== undefined && value > options.max) reject(`${key} is above ${options.max}`);
  return value;
}

function bool(raw: Raw, key: string, fallback = false): boolean {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") reject(`${key} must be a boolean`);
  return value;
}

function choice<T extends string>(raw: Raw, key: string, allowed: readonly T[], fallback: T): T {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) reject(`${key} must be one of ${allowed.join("|")}`);
  return value as T;
}

function expression(value: unknown, collector: Collector, label: string): UiExpression {
  const parsed = parseExpression(value);
  if (!parsed.ok) reject(`${label}: ${parsed.reason}`);
  for (const ref of collectRefs(parsed.expression)) collector.refs.add(ref);
  return parsed.expression;
}

/** 字符串属性：字面量或表达式。 */
function dynText(raw: Raw, key: string, collector: Collector, options: { max?: number; required?: boolean } = {}): UiDynamic<string> | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    if (options.required) reject(`${key} is required`);
    return undefined;
  }
  if (typeof value === "string") {
    if (value.length > (options.max ?? uiLimits.textLength)) reject(`${key} is too long`);
    return value;
  }
  if (!isPlainObject(value)) reject(`${key} must be a string or an expression`);
  return expression(value, collector, key) as UiDynamic<string>;
}

/** 数值/标量属性：字面量或表达式。 */
function dynScalar(raw: Raw, key: string, collector: Collector, options: { required?: boolean } = {}): UiDynamic | undefined {
  const value = raw[key];
  if (value === undefined) {
    if (options.required) reject(`${key} is required`);
    return undefined;
  }
  if (typeof value === "string" && value.length > uiLimits.stringLength) reject(`${key} is too long`);
  if (value === null || typeof value !== "object") return value as UiScalar;
  return expression(value, collector, key) as UiDynamic;
}

function bind(raw: Raw, collector: Collector, kind: UiStateKind): string {
  const name = raw.bind;
  if (!isUiName(name)) reject("bind must name a state");
  collector.refs.add(name);
  collector.bindings.push({ name, kind });
  return name;
}

function source(raw: Raw): UiSourceNote | undefined {
  const value = raw.source;
  if (value === undefined || value === null) return undefined;
  const note = typeof value === "string" ? { label: value } : value;
  if (!isPlainObject(note)) reject("source must be a string or object");
  const label = text(note, "label", { max: 200, required: true })!;
  const url = note.url === undefined || note.url === null ? undefined : safeExternalUrl(note.url);
  if (note.url !== undefined && note.url !== null && !url) reject("source url must be http(s)");
  return url ? { label, url } : { label };
}

function status(raw: Raw): UiDataStatus | undefined {
  const value = raw.status;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !(uiDataStatuses as readonly string[]).includes(value)) reject("status is not supported");
  return value as UiDataStatus;
}

function options(raw: Raw, key: string, collector: Collector, max: number): Array<{ value: string; label: string; description?: string }> {
  const value = raw[key];
  if (!Array.isArray(value) || value.length === 0) reject(`${key} must be a non-empty array`);
  if (value.length > max) reject(`${key} has too many entries`);
  const seen = new Set<string>();
  const result = value.map((item): { value: string; label: string; description?: string } => {
    const entry = typeof item === "string" ? { value: item, label: item } : item;
    if (!isPlainObject(entry)) reject(`${key} entries must be strings or objects`);
    const optionValue = text(entry, "value", { max: 100, required: true })!;
    const label = text(entry, "label", { max: 200, fallback: optionValue })!;
    const description = text(entry, "description", { max: 500 });
    if (seen.has(optionValue)) reject(`${key} has duplicate value ${optionValue.slice(0, 20)}`);
    seen.add(optionValue);
    return description ? { value: optionValue, label, description } : { value: optionValue, label };
  });
  collector.optionCount += result.length;
  return result;
}

function names(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value)) reject(`${label} must be an array`);
  if (value.length > max) reject(`${label} has too many entries`);
  return value.map(item => {
    if (!isUiName(item)) reject(`${label} entries must be state names`);
    return item;
  });
}

/** 动作只描述意图；外链协议、名称与长度在这里就被收紧。 */
export function parseAction(value: unknown, collector: { refs: Set<string>; sourceRefs?: Set<string> }): UiAction {
  if (!isPlainObject(value)) reject("action must be an object");
  const type = value.type;
  const withCollector = collector as Collector;
  switch (type) {
    case "set_state": {
      if (!isUiName(value.name)) reject("action.name must be a state name");
      const scalar = value.value;
      if (scalar !== null && typeof scalar !== "string" && typeof scalar !== "number" && typeof scalar !== "boolean") reject("action.value must be a scalar");
      if (typeof scalar === "number" && !Number.isFinite(scalar)) reject("action.value must be finite");
      if (typeof scalar === "string" && scalar.length > uiLimits.stringLength) reject("action.value is too long");
      collector.refs.add(value.name);
      return { type, name: value.name, value: scalar };
    }
    case "toggle": {
      if (!isUiName(value.name)) reject("action.name must be a state name");
      collector.refs.add(value.name);
      return { type, name: value.name };
    }
    case "copy": {
      const textValue = dynText(value, "text", withCollector, { max: uiLimits.textLength, required: true })!;
      return { type, text: textValue };
    }
    case "submit_to_agent": {
      const message = text(value, "text", { max: 2_000, required: true })!;
      if (value.include === undefined) return { type, text: message };
      const include = names(value.include, "action.include", 20);
      for (const name of include) collector.refs.add(name);
      return { type, text: message, include };
    }
    case "open_external": {
      const url = safeExternalUrl(value.url);
      if (!url) reject("action.url must be an http(s) or mailto link");
      return { type, url };
    }
    case "refresh_source": {
      if (!isUiName(value.name)) reject("action.name must be a data source name");
      collector.sourceRefs?.add(value.name);
      return { type, name: value.name };
    }
    case "request_tool": {
      const tool = value.tool;
      if (typeof tool !== "string" || !uiToolNameRe.test(tool)) reject("action.tool must be a tool name");
      const summary = text(value, "summary", { max: 300, required: true })!;
      if (value.args === undefined || value.args === null) return { type, tool, summary };
      if (!isPlainObject(value.args)) reject("action.args must be an object");
      const entries = Object.entries(value.args);
      if (entries.length > uiLimits.toolArgs) reject("action.args has too many entries");
      const args: Record<string, UiDynamic> = {};
      for (const [key, argument] of entries) {
        if (!isUiName(key)) reject("action.args keys must be identifiers");
        args[key] = dynScalar({ [key]: argument }, key, withCollector, { required: true })!;
      }
      return { type, tool, summary, args };
    }
    default:
      reject("unknown action type");
  }
}


// ---------- P1/P2 共用的读取工具 ----------

/** 数值属性：有限数字、null，或会算出数字的表达式（图表数据点、扇区）。 */
function dynNumber(value: unknown, collector: Collector, label: string): UiDynamic {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject(`${label} must be finite`);
    return value;
  }
  if (!isPlainObject(value)) reject(`${label} must be a number, null or an expression`);
  return expression(value, collector, label) as UiDynamic;
}

/** `from`：引用一个已声明的数据源，commit 时检查它真的存在。 */
function fromSource(raw: Raw, collector: Collector): string | undefined {
  const value = raw.from;
  if (value === undefined || value === null) return undefined;
  if (!isUiName(value)) reject("from must name a data source");
  collector.sourceRefs.add(value);
  return value;
}

/** 数据源里的列名：JSON 键可以不是标识符，只限制长度和原型污染键。 */
function columnKey(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100 || isForbiddenKey(value)) reject(`${label} must be a column name`);
  return value;
}

function optionalColumn(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  return value === undefined || value === null ? undefined : columnKey(value, key);
}

function coordinate(raw: Raw, key: string, options: { min?: number; max?: number } = {}): number {
  return number(raw, key, { required: true, min: options.min ?? -uiLimits.svgCoordinate, max: options.max ?? uiLimits.svgCoordinate })!;
}

const digitsOf = (raw: Raw) => number(raw, "digits", { min: 0, max: 6, integer: true });

// ---------- 图表（IUI-10） ----------

interface ChartSeries { key: string; label: string; values: UiDynamic[] }

function chartData(raw: Raw, c: Collector, allowDraggable: boolean): UiProps {
  const form = [raw.series, raw.data, raw.from].filter(value => value !== undefined && value !== null).length;
  if (form !== 1) reject("give exactly one of series, data or from");
  if (raw.from !== undefined && raw.from !== null) {
    const y = raw.y;
    if (!Array.isArray(y) || y.length === 0 || y.length > uiLimits.chartSeries) reject("y must list 1-6 column names");
    return { from: fromSource(raw, c), x: columnKey(raw.x, "x"), y: y.map(item => columnKey(item, "y")) };
  }
  let labels: string[];
  let series: ChartSeries[];
  if (raw.data !== undefined && raw.data !== null) {
    const data = raw.data;
    if (!Array.isArray(data) || data.length === 0) reject("data must be a non-empty array");
    if (data.length > uiLimits.chartPoints) reject("data has too many points");
    labels = [];
    const values: UiDynamic[] = [];
    for (const item of data) {
      if (!isPlainObject(item)) reject("data entries must be objects");
      labels.push(text(item, "label", { max: 100, required: true })!);
      values.push(dynNumber(item.value === undefined ? null : item.value, c, "value"));
    }
    series = [{ key: "s1", label: text(raw, "seriesLabel", { max: 100, fallback: "" }) || "", values }];
  } else {
    const rawLabels = raw.labels;
    if (!Array.isArray(rawLabels) || rawLabels.length === 0) reject("labels must be a non-empty array");
    if (rawLabels.length > uiLimits.chartPoints) reject("labels has too many points");
    labels = rawLabels.map(label => {
      if (typeof label !== "string" || label.length > 100) reject("labels must be short strings");
      return label;
    });
    const rawSeries = raw.series;
    if (!Array.isArray(rawSeries) || rawSeries.length === 0 || rawSeries.length > uiLimits.chartSeries) reject("series must list 1-6 entries");
    const keys = new Set<string>();
    series = rawSeries.map((entry, index) => {
      if (!isPlainObject(entry)) reject("series entries must be objects");
      const key = entry.key === undefined || entry.key === null ? `s${index + 1}` : entry.key;
      if (!isUiName(key) || keys.has(key)) reject("series key must be a unique identifier");
      keys.add(key);
      if (!Array.isArray(entry.values) || entry.values.length !== labels.length) reject("series values must match labels");
      return { key, label: text(entry, "label", { max: 100, required: true })!, values: entry.values.map(value => dynNumber(value, c, "value")) };
    });
  }
  if (allowDraggable && raw.draggable === true) {
    // 只有直接引用 number 状态的点可以拖动：拖动只改状态，不触发任何别的东西。
    for (const entry of series) for (const value of entry.values) {
      if (value !== null && typeof value === "object" && "ref" in value) c.bindings.push({ name: value.ref, kind: "number" });
    }
  }
  return { labels, series };
}

function chartCommon(raw: Raw, c: Collector, kind: "bar" | "line"): UiProps {
  const yMin = number(raw, "yMin");
  const yMax = number(raw, "yMax");
  if (yMin !== undefined && yMax !== undefined && yMin >= yMax) reject("yMin must be below yMax");
  const draggable = bool(raw, "draggable", false);
  const data = chartData(raw, c, draggable);
  if (draggable && "from" in data) reject("draggable charts need inline values");
  return {
    title: text(raw, "title", { max: 200 }),
    caption: text(raw, "caption", { max: 300 }),
    unit: text(raw, "unit", { max: 20 }),
    prefix: text(raw, "prefix", { max: 10 }),
    digits: digitsOf(raw),
    yMin,
    yMax,
    horizontal: kind === "bar" ? bool(raw, "horizontal", false) : undefined,
    draggable,
    ...data,
    source: source(raw),
    status: status(raw),
  };
}

function pieProps(raw: Raw, c: Collector): UiProps {
  const common = {
    title: text(raw, "title", { max: 200 }),
    caption: text(raw, "caption", { max: 300 }),
    unit: text(raw, "unit", { max: 20 }),
    prefix: text(raw, "prefix", { max: 10 }),
    digits: digitsOf(raw),
    donut: bool(raw, "donut", false),
    source: source(raw),
    status: status(raw),
  };
  if (raw.from !== undefined && raw.from !== null) {
    if (raw.slices !== undefined && raw.slices !== null) reject("give either slices or from");
    return { ...common, from: fromSource(raw, c), label: columnKey(raw.label, "label"), value: columnKey(raw.value, "value") };
  }
  const slices = raw.slices;
  if (!Array.isArray(slices) || slices.length === 0) reject("slices must be a non-empty array");
  if (slices.length > uiLimits.pieSlices) reject("too many slices");
  return {
    ...common,
    slices: slices.map(entry => {
      if (!isPlainObject(entry)) reject("slices must be objects");
      return { label: text(entry, "label", { max: 100, required: true })!, value: dynNumber(entry.value, c, "value") };
    }),
  };
}

// ---------- 受限 SVG（IUI-10） ----------

export const uiSvgTones = ["none", "default", "muted", "accent", "success", "warning", "danger", "surface"] as const;
export type UiSvgTone = typeof uiSvgTones[number];

const pathCharacters = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/;

function svgStyle(raw: Raw, defaults: { fill: UiSvgTone; stroke: UiSvgTone }): UiProps {
  return {
    fill: choice(raw, "fill", uiSvgTones, defaults.fill),
    stroke: choice(raw, "stroke", uiSvgTones, defaults.stroke),
    strokeWidth: number(raw, "strokeWidth", { min: 0, max: 12, fallback: 1.5 }),
    opacity: number(raw, "opacity", { min: 0, max: 1, fallback: 1 }),
    dash: bool(raw, "dash", false),
  };
}

function svgPoints(value: unknown, minimum: number): Array<[number, number]> {
  if (!Array.isArray(value) || value.length < minimum) reject(`points needs at least ${minimum} pairs`);
  if (value.length > uiLimits.svgPoints) reject("points has too many pairs");
  return value.map(pair => {
    if (!Array.isArray(pair) || pair.length !== 2) reject("points must be [x,y] pairs");
    const [x, y] = pair as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)
      || Math.abs(x) > uiLimits.svgCoordinate || Math.abs(y) > uiLimits.svgCoordinate) reject("point is out of range");
    return [x, y] as [number, number];
  });
}

function svgPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > uiLimits.svgPathLength) reject("path d must be a short string");
  if (!pathCharacters.test(value) || !/^\s*[Mm]/.test(value)) reject("path d may only hold path commands and numbers");
  for (const token of value.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []) {
    if (!Number.isFinite(Number(token)) || Math.abs(Number(token)) > 100_000) reject("path number is out of range");
  }
  return value;
}

function svgShape(entry: unknown): UiProps {
  if (!isPlainObject(entry)) reject("shapes must be objects");
  switch (entry.type) {
    case "rect": return {
      type: "rect", x: coordinate(entry, "x"), y: coordinate(entry, "y"),
      w: coordinate(entry, "w", { min: 0 }), h: coordinate(entry, "h", { min: 0 }), rx: number(entry, "rx", { min: 0, max: 1000, fallback: 0 }),
      ...svgStyle(entry, { fill: "surface", stroke: "default" }),
    };
    case "circle": return { type: "circle", cx: coordinate(entry, "cx"), cy: coordinate(entry, "cy"), r: coordinate(entry, "r", { min: 0 }), ...svgStyle(entry, { fill: "surface", stroke: "default" }) };
    case "ellipse": return {
      type: "ellipse", cx: coordinate(entry, "cx"), cy: coordinate(entry, "cy"),
      rx: coordinate(entry, "rx", { min: 0 }), ry: coordinate(entry, "ry", { min: 0 }), ...svgStyle(entry, { fill: "surface", stroke: "default" }),
    };
    case "line": return {
      type: "line", x1: coordinate(entry, "x1"), y1: coordinate(entry, "y1"), x2: coordinate(entry, "x2"), y2: coordinate(entry, "y2"),
      ...svgStyle(entry, { fill: "none", stroke: "default" }),
    };
    case "polyline": return { type: "polyline", points: svgPoints(entry.points, 2), ...svgStyle(entry, { fill: "none", stroke: "default" }) };
    case "polygon": return { type: "polygon", points: svgPoints(entry.points, 3), ...svgStyle(entry, { fill: "surface", stroke: "default" }) };
    case "path": return { type: "path", d: svgPath(entry.d), ...svgStyle(entry, { fill: "none", stroke: "default" }) };
    case "text": return {
      type: "text", x: coordinate(entry, "x"), y: coordinate(entry, "y"), text: text(entry, "text", { max: 200, required: true }),
      size: number(entry, "size", { min: 8, max: 48, fallback: 14 }), anchor: choice(entry, "anchor", ["start", "middle", "end"] as const, "start"),
      fill: choice(entry, "fill", uiSvgTones, "default"),
    };
    default: reject("unsupported shape type");
  }
}

function svgHotspot(entry: unknown, ids: Set<string>): UiProps {
  if (!isPlainObject(entry)) reject("hotspots must be objects");
  const id = entry.id;
  if (!isUiName(id) || ids.has(id)) reject("hotspot id must be a unique identifier");
  ids.add(id);
  const base = { id, label: text(entry, "label", { max: 100, required: true })!, description: text(entry, "description", { max: 500 }), value: text(entry, "value", { max: 100, fallback: id })! };
  switch (entry.shape) {
    case "rect": return { ...base, shape: "rect", x: coordinate(entry, "x"), y: coordinate(entry, "y"), w: coordinate(entry, "w", { min: 0 }), h: coordinate(entry, "h", { min: 0 }) };
    case "circle": return { ...base, shape: "circle", cx: coordinate(entry, "cx"), cy: coordinate(entry, "cy"), r: coordinate(entry, "r", { min: 0 }) };
    case "polygon": return { ...base, shape: "polygon", points: svgPoints(entry.points, 3) };
    default: reject("hotspot shape must be rect, circle or polygon");
  }
}

function svgDiagram(raw: Raw, c: Collector): UiProps {
  const shapesRaw = raw.shapes === undefined || raw.shapes === null ? [] : raw.shapes;
  if (!Array.isArray(shapesRaw)) reject("shapes must be an array");
  if (shapesRaw.length > uiLimits.svgShapes) reject("too many shapes");
  const hotspotsRaw = raw.hotspots === undefined || raw.hotspots === null ? [] : raw.hotspots;
  if (!Array.isArray(hotspotsRaw)) reject("hotspots must be an array");
  if (hotspotsRaw.length > uiLimits.svgHotspots) reject("too many hotspots");
  if (shapesRaw.length === 0 && hotspotsRaw.length === 0) reject("a diagram needs shapes or hotspots");
  const ids = new Set<string>();
  const hotspots = hotspotsRaw.map(entry => svgHotspot(entry, ids));
  const hasBind = raw.bind !== undefined && raw.bind !== null;
  if (hotspots.length > 0 && !hasBind) reject("hotspots need bind");
  c.optionCount += hotspots.length;
  return {
    title: text(raw, "title", { max: 200, required: true }),
    description: text(raw, "description", { max: 500 }),
    width: number(raw, "width", { min: 100, max: 2000, fallback: 400 }),
    height: number(raw, "height", { min: 100, max: 2000, fallback: 300 }),
    shapes: shapesRaw.map(svgShape),
    hotspots,
    bind: hasBind ? bind(raw, c, "string") : undefined,
    caption: text(raw, "caption", { max: 300 }),
  };
}

// ---------- 时间轴、行程、差异（IUI-15） ----------

const timelineStatuses = ["done", "current", "upcoming", "blocked"] as const;

function timelineProps(raw: Raw, c: Collector): UiProps {
  const common = { title: text(raw, "title", { max: 200 }), source: source(raw), status: status(raw) };
  if (raw.from !== undefined && raw.from !== null) {
    if (raw.items !== undefined && raw.items !== null) reject("give either items or from");
    return {
      ...common, from: fromSource(raw, c), titleKey: columnKey(raw.titleKey, "titleKey"),
      dateKey: optionalColumn(raw, "dateKey"), detailKey: optionalColumn(raw, "detailKey"), statusKey: optionalColumn(raw, "statusKey"),
    };
  }
  const items = raw.items;
  if (!Array.isArray(items)) reject("items must be an array");
  if (items.length > uiLimits.timelineItems) reject("too many items");
  c.optionCount += items.length;
  return {
    ...common,
    items: items.map(item => {
      if (!isPlainObject(item)) reject("items must be objects");
      return {
        date: text(item, "date", { max: 40 }),
        title: text(item, "title", { max: 200, required: true })!,
        detail: text(item, "detail", { max: 1_000 }),
        status: choice(item, "status", timelineStatuses, "upcoming"),
      };
    }),
  };
}

function itineraryProps(raw: Raw, c: Collector): UiProps {
  const days = raw.days;
  if (!Array.isArray(days) || days.length === 0) reject("days must be a non-empty array");
  if (days.length > uiLimits.itineraryDays) reject("too many days");
  let stops = 0;
  const normalized = days.map(day => {
    if (!isPlainObject(day)) reject("days must be objects");
    const list = day.stops;
    if (!Array.isArray(list)) reject("stops must be an array");
    stops += list.length;
    if (stops > uiLimits.itineraryStops) reject("too many stops");
    return {
      label: text(day, "label", { max: 100, required: true })!,
      stops: list.map(stop => {
        if (!isPlainObject(stop)) reject("stops must be objects");
        const hasLat = stop.lat !== undefined && stop.lat !== null;
        const hasLng = stop.lng !== undefined && stop.lng !== null;
        if (hasLat !== hasLng) reject("lat and lng go together");
        return {
          name: text(stop, "name", { max: 200, required: true })!,
          time: text(stop, "time", { max: 40 }),
          note: text(stop, "note", { max: 500 }),
          // 只有模型明确给出坐标才记录；仅有名称的地点永远没有坐标。
          lat: hasLat ? number(stop, "lat", { min: -90, max: 90 }) : undefined,
          lng: hasLng ? number(stop, "lng", { min: -180, max: 180 }) : undefined,
        };
      }),
    };
  });
  c.optionCount += stops;
  return { title: text(raw, "title", { max: 200 }), days: normalized, source: source(raw), status: status(raw) };
}

function diffProps(raw: Raw, c: Collector): UiProps {
  const hasText = raw.diff !== undefined && raw.diff !== null;
  const hasFrom = raw.from !== undefined && raw.from !== null;
  if (hasText === hasFrom) reject("give exactly one of diff or from");
  return {
    caption: text(raw, "caption", { max: 300 }),
    fileName: text(raw, "fileName", { max: 300 }),
    diff: hasText ? text(raw, "diff", { max: uiLimits.diffChars, required: true }) : undefined,
    from: fromSource(raw, c),
    source: source(raw),
    status: status(raw),
  };
}

function children(node: Raw): void {
  if ("children" in node) reject("children are declared with parent, not props");
}

// ---------- 各组件 ----------

const gaps = ["sm", "md", "lg"] as const;
const tones = ["default", "muted", "success", "warning", "danger"] as const;

type Validator = (raw: Raw, collector: Collector) => UiProps;

const validators: Record<string, Validator> = {
  text: (raw, c) => ({
    text: dynText(raw, "text", c, { required: true }),
    tone: choice(raw, "tone", tones, "default"),
  }),
  heading: (raw, c) => ({
    text: dynText(raw, "text", c, { max: 300, required: true }),
    level: number(raw, "level", { min: 1, max: 3, integer: true, fallback: 2 }),
  }),
  caption: (raw, c) => ({ text: dynText(raw, "text", c, { max: 1_000, required: true }) }),
  code: (raw) => ({
    code: text(raw, "code", { max: uiLimits.codeLength, required: true }),
    language: text(raw, "language", { max: 32 }),
  }),
  column: (raw) => ({ gap: choice(raw, "gap", gaps, "md") }),
  row: (raw) => ({ gap: choice(raw, "gap", gaps, "md"), wrap: bool(raw, "wrap", true) }),
  grid: (raw) => ({
    gap: choice(raw, "gap", gaps, "md"),
    columns: number(raw, "columns", { min: 1, max: 6, integer: true, fallback: 2 }),
  }),
  divider: () => ({}),
  card: (raw) => ({
    title: text(raw, "title", { max: 200 }),
    description: text(raw, "description", { max: 1_000 }),
    tone: choice(raw, "tone", tones, "default"),
  }),
  table: (raw, c) => {
    const columnsRaw = raw.columns;
    if (!Array.isArray(columnsRaw) || columnsRaw.length === 0) reject("columns must be a non-empty array");
    if (columnsRaw.length > uiLimits.tableColumns) reject("too many columns");
    const keys = new Set<string>();
    const columns = columnsRaw.map(item => {
      if (!isPlainObject(item)) reject("columns must be objects");
      if (!isUiName(item.key)) reject("column key must be an identifier");
      if (keys.has(item.key)) reject("duplicate column key");
      keys.add(item.key);
      return {
        key: item.key,
        label: text(item, "label", { max: 100, fallback: item.key })!,
        align: choice(item, "align", ["left", "right", "center"] as const, "left"),
        sortable: bool(item, "sortable", false),
        unit: text(item, "unit", { max: 20 }),
        prefix: text(item, "prefix", { max: 10 }),
        digits: number(item, "digits", { min: 0, max: 6, integer: true }),
      };
    });
    const from = fromSource(raw, c);
    const rowsRaw = raw.rows ?? [];
    if (!Array.isArray(rowsRaw)) reject("rows must be an array");
    if (from && rowsRaw.length > 0) reject("give either rows or from");
    if (rowsRaw.length > uiLimits.tableRows) reject("too many rows");
    const rows = rowsRaw.map(row => {
      if (!isPlainObject(row)) reject("rows must be objects");
      const cells: Record<string, UiScalar> = {};
      for (const key of keys) {
        const cell = row[key];
        if (cell === undefined || cell === null) cells[key] = null;
        else if (typeof cell === "string") {
          if (cell.length > uiLimits.stringLength) reject("cell is too long");
          cells[key] = cell;
        } else if (typeof cell === "number" && Number.isFinite(cell)) cells[key] = cell;
        else if (typeof cell === "boolean") cells[key] = cell;
        else reject("cells must be scalar values");
      }
      const detail = text(row, "detail", { max: 2_000 });
      return { cells, detail: detail ?? null };
    });
    c.optionCount += rows.length;
    let filter: { bind: string; column: string; allValue: string } | undefined;
    if (raw.filter !== undefined && raw.filter !== null) {
      if (!isPlainObject(raw.filter)) reject("filter must be an object");
      const name = bind(raw.filter, c, "string");
      const column = raw.filter.column;
      if (typeof column !== "string" || !keys.has(column)) reject("filter.column must be a column key");
      filter = { bind: name, column, allValue: text(raw.filter, "allValue", { max: 100, fallback: "all" })! };
    }
    let defaultSort: { column: string; direction: "asc" | "desc" } | undefined;
    if (raw.defaultSort !== undefined && raw.defaultSort !== null) {
      if (!isPlainObject(raw.defaultSort)) reject("defaultSort must be an object");
      const column = raw.defaultSort.column;
      if (typeof column !== "string" || !keys.has(column)) reject("defaultSort.column must be a column key");
      defaultSort = { column, direction: choice(raw.defaultSort, "direction", ["asc", "desc"] as const, "asc") };
    }
    return {
      caption: text(raw, "caption", { max: 300 }),
      columns,
      rows,
      from,
      searchable: bool(raw, "searchable", false),
      filter,
      defaultSort,
      emptyText: text(raw, "emptyText", { max: 300 }),
      source: source(raw),
      status: status(raw),
    };
  },
  stat: (raw, c) => {
    const valueKey = raw.derive !== undefined ? "derive" : "value";
    // from：直接展示数据源的标量结果，并带上它的来源与状态。
    const from = fromSource(raw, c);
    const useSource = from !== undefined && raw[valueKey] === undefined;
    if (useSource) c.refs.add(from);
    return {
      label: text(raw, "label", { max: 200, required: true }),
      from,
      value: useSource ? { ref: from } : dynScalar(raw, valueKey, c, { required: true }),
      unit: text(raw, "unit", { max: 20 }),
      prefix: text(raw, "prefix", { max: 10 }),
      digits: number(raw, "digits", { min: 0, max: 10, integer: true }),
      description: text(raw, "description", { max: 500 }),
      emptyText: text(raw, "emptyText", { max: 200 }),
      source: source(raw),
      status: status(raw),
    };
  },
  progress: (raw, c) => ({
    label: text(raw, "label", { max: 200, required: true }),
    value: dynScalar(raw, "value", c, { required: true }),
    max: number(raw, "max", { min: Number.MIN_VALUE, fallback: 100 }),
    unit: text(raw, "unit", { max: 20 }),
    source: source(raw),
    status: status(raw),
  }),
  list: (raw, c) => {
    const from = fromSource(raw, c);
    const items = from && (raw.items === undefined || raw.items === null) ? [] : raw.items;
    if (!Array.isArray(items)) reject("items must be an array");
    if (from && items.length > 0) reject("give either items or from");
    if (items.length > uiLimits.listItems) reject("too many items");
    const normalized = items.map(item => {
      if (typeof item === "string") {
        if (item.length > 500) reject("item is too long");
        return { text: item, detail: null as string | null };
      }
      if (!isPlainObject(item)) reject("items must be strings or objects");
      return { text: text(item, "text", { max: 500, required: true })!, detail: text(item, "detail", { max: 1_000 }) ?? null };
    });
    c.optionCount += normalized.length;
    return {
      items: normalized,
      from,
      textKey: from ? columnKey(raw.textKey ?? "text", "textKey") : undefined,
      detailKey: from ? optionalColumn(raw, "detailKey") : undefined,
      ordered: bool(raw, "ordered", false),
      emptyText: text(raw, "emptyText", { max: 200 }),
      source: source(raw),
      status: status(raw),
    };
  },
  tabs: (raw, c) => ({
    bind: bind(raw, c, "string"),
    label: text(raw, "label", { max: 200, required: true }),
    options: options(raw, "options", c, 12),
  }),
  segmented: (raw, c) => ({
    bind: bind(raw, c, "string"),
    label: text(raw, "label", { max: 200, required: true }),
    description: text(raw, "description", { max: 500 }),
    options: options(raw, "options", c, 8),
  }),
  select: (raw, c) => ({
    bind: bind(raw, c, "string"),
    label: text(raw, "label", { max: 200, required: true }),
    description: text(raw, "description", { max: 500 }),
    options: options(raw, "options", c, 100),
  }),
  radio: (raw, c) => ({
    bind: bind(raw, c, "string"),
    label: text(raw, "label", { max: 200, required: true }),
    description: text(raw, "description", { max: 500 }),
    options: options(raw, "options", c, 20),
  }),
  input: (raw, c) => ({
    bind: bind(raw, c, "string"),
    label: text(raw, "label", { max: 200, required: true }),
    description: text(raw, "description", { max: 500 }),
    placeholder: text(raw, "placeholder", { max: 200 }),
    required: bool(raw, "required", false),
    disabled: bool(raw, "disabled", false),
  }),
  number_input: (raw, c) => ({
    bind: bind(raw, c, "number"),
    label: text(raw, "label", { max: 200, required: true }),
    description: text(raw, "description", { max: 500 }),
    unit: text(raw, "unit", { max: 20 }),
    required: bool(raw, "required", true),
    disabled: bool(raw, "disabled", false),
  }),
  slider: (raw, c) => ({
    bind: bind(raw, c, "number"),
    label: text(raw, "label", { max: 200, required: true }),
    description: text(raw, "description", { max: 500 }),
    unit: text(raw, "unit", { max: 20 }),
    disabled: bool(raw, "disabled", false),
  }),
  checkbox: (raw, c) => ({
    bind: bind(raw, c, "boolean"),
    label: text(raw, "label", { max: 200, required: true }),
    description: text(raw, "description", { max: 500 }),
    disabled: bool(raw, "disabled", false),
  }),
  button: (raw, c) => ({
    label: text(raw, "label", { max: 100, required: true }),
    variant: choice(raw, "variant", ["primary", "secondary"] as const, "secondary"),
    disabled: raw.disabled === undefined || raw.disabled === null || typeof raw.disabled === "boolean"
      ? bool(raw, "disabled", false)
      : expression(raw.disabled, c, "disabled"),
    action: parseAction(raw.action, c),
  }),
  collapsible: (raw) => ({
    title: text(raw, "title", { max: 200, required: true }),
    defaultOpen: bool(raw, "defaultOpen", false),
  }),
  bar_chart: (raw, c) => chartCommon(raw, c, "bar"),
  line_chart: (raw, c) => chartCommon(raw, c, "line"),
  pie_chart: (raw, c) => pieProps(raw, c),
  svg_diagram: (raw, c) => svgDiagram(raw, c),
  media: (raw) => ({
    kind: choice(raw, "kind", ["image", "map"] as const, "image"),
    // 没有配置媒体 Provider 时只显示这段说明；Vela 不会凭空生成图片或地图。
    alt: text(raw, "alt", { max: 300, required: true }),
    caption: text(raw, "caption", { max: 300 }),
    source: source(raw),
  }),
  timeline: (raw, c) => timelineProps(raw, c),
  itinerary: (raw, c) => itineraryProps(raw, c),
  diff_view: (raw, c) => diffProps(raw, c),
  loading: (raw) => ({ label: text(raw, "label", { max: 200 }) }),
  empty: (raw) => ({ title: text(raw, "title", { max: 200, required: true }), description: text(raw, "description", { max: 500 }) }),
  error: (raw) => ({ title: text(raw, "title", { max: 200, required: true }), description: text(raw, "description", { max: 500 }) }),
};

/** 注册表里有这个组件吗。 */
export function hasComponent(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(validators, type);
}

/**
 * 校验一个节点的 props。未知字段会被丢弃，因为输出只包含各组件显式读取的字段。
 * `show` 是所有组件共有的显示条件表达式。
 */
export function validateNodeProps(type: string, rawProps: unknown): UiPropsResult {
  if (!hasComponent(type)) return { ok: false, reason: `unsupported component ${type.slice(0, 40)}` };
  const raw = rawProps === undefined || rawProps === null ? {} : rawProps;
  if (!isPlainObject(raw)) return { ok: false, reason: "props must be an object" };
  const collector: Collector = { refs: new Set(), sourceRefs: new Set(), bindings: [], optionCount: 0 };
  try {
    children(raw);
    const props = validators[type](raw, collector);
    const show = raw.show === undefined || raw.show === null ? undefined : expression(raw.show, collector, "show");
    // 去掉值为 undefined 的键，保证规整结果可序列化且稳定。
    const normalized = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
    return {
      ok: true,
      value: { props: normalized, show, refs: [...collector.refs], sourceRefs: [...collector.sourceRefs], bindings: collector.bindings, optionCount: collector.optionCount },
    };
  } catch (error) {
    if (error instanceof PropError) return { ok: false, reason: error.message };
    throw error;
  }
}
