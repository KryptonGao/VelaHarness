import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  chartDomain,
  chartTable,
  formatUiNumber,
  pieTable,
  resolveChartData,
  resolvePieData,
  toTsv,
  type ChartData,
  type ChartDomain,
  type UiDataStatus,
  type UiSourceNote,
  type UiStateDefinition,
} from "@vela/shared";
import { uiCopy } from "./copy";
import { exportSvgAsPng } from "./image-export";
import { copyToClipboard, DataMeta, SourceNotice, useFlash, useSource } from "./shared-views";
import { useUiRuntime } from "./UiRuntime";

type Props = Record<string, unknown>;

const width = 560;
const height = 300;
const topPad = 14;
const rightPad = 18;
const bottomPad = 46;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function measure(value: number | null, props: Props): string {
  if (value === null) return "—";
  return `${str(props.prefix)}${formatUiNumber(value, props.digits as number | undefined)}${props.unit ? ` ${str(props.unit)}` : ""}`;
}

function shortLabel(label: string, limit = 12): string {
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
}

function seriesClass(index: number): string {
  return `iui-s${(index % 6) + 1}`;
}

function cleanNumber(value: number): number {
  return Number(value.toPrecision(12));
}

// ---------- 通用外壳：标题、数据表、复制、保存图片 ----------

function ChartShell({ props, table, tsv, svgRef, children, from }: {
  props: Props;
  table: { head: string[]; rows: string[][] };
  tsv: string;
  svgRef: React.RefObject<SVGSVGElement | null>;
  children: ReactNode;
  from: string | undefined;
}) {
  const id = useId();
  const [flash, setFlash] = useFlash();
  const title = str(props.title);
  return <figure className="iui-chart" aria-labelledby={title ? `${id}-t` : undefined}>
    {title ? <figcaption className="iui-chart-title" id={`${id}-t`}>{title}</figcaption> : null}
    {children}
    {props.caption ? <div className="iui-description">{str(props.caption)}</div> : null}
    <details className="iui-chart-data">
      <summary>{uiCopy.dataTable()}</summary>
      <div className="iui-table-scroll" role="region" aria-label={uiCopy.dataTable()} tabIndex={0}>
        <table className="iui-table">
          <thead><tr>{table.head.map((cell, index) => <th key={index} scope="col">{cell}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0
            ? <th key={column} scope="row">{cell}</th>
            : <td key={column} className="iui-num">{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
    <div className="iui-chart-tools">
      <button type="button" className="iui-tool" onClick={() => void copyToClipboard(tsv).then(ok => setFlash(ok ? uiCopy.copied() : uiCopy.copyFailed()))}>
        {flash ?? uiCopy.copyData()}</button>
      <button type="button" className="iui-tool" onClick={() => {
        const svg = svgRef.current;
        if (!svg) return;
        void exportSvgAsPng(svg, title || "chart").then(ok => setFlash(ok ? uiCopy.imageSaved() : uiCopy.imageFailed()));
      }}>{uiCopy.saveImage()}</button>
    </div>
    <DataMeta status={props.status as UiDataStatus | undefined} source={props.source as UiSourceNote | undefined} from={from} />
  </figure>;
}

// ---------- 柱状图 / 折线图 ----------

interface ActivePoint { series: number; index: number }

interface DragState { name: string; frozen: ChartDomain }

/** 拖动期间让 svg 收到后续指针事件；指针已失效（例如合成事件）时不影响点选。 */
function capture(event: PointerEvent<SVGElement>): void {
  try { (event.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
}

function stateOf(name: string | null, definitions: readonly UiStateDefinition[]): UiStateDefinition | undefined {
  return name ? definitions.find(definition => definition.name === name) : undefined;
}

function CartesianChart({ props, kind }: { props: Props; kind: "bar" | "line" }) {
  const { artifact, env, receiving, setValue } = useUiRuntime();
  const from = typeof props.from === "string" ? props.from : undefined;
  const { snapshot, blocked } = useSource(from);
  const data: ChartData = useMemo(() => resolveChartData(props, env, snapshot, receiving), [props, env, snapshot, receiving]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<ActivePoint | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const horizontal = kind === "bar" && props.horizontal === true;
  const draggable = props.draggable === true && !horizontal;
  const id = useId();

  const visible = data.series.map((entry, index) => ({ entry, index })).filter(({ entry }) => !hidden.has(entry.key));
  const bound = data.series.flatMap(entry => entry.bound).filter((name): name is string => name !== null);
  // 可拖动的图表：纵轴范围固定，拖动时点不会因为重新缩放而「跑掉」。
  const defs = bound.map(name => stateOf(name, artifact.stateDefinitions));
  const defMin = draggable && defs.length > 0 && defs.every(definition => typeof definition?.min === "number") ? Math.min(...defs.map(definition => definition!.min as number)) : undefined;
  const defMax = draggable && defs.length > 0 && defs.every(definition => typeof definition?.max === "number") ? Math.max(...defs.map(definition => definition!.max as number)) : undefined;
  const computed = useMemo(
    () => chartDomain(visible.map(item => item.entry), {
      yMin: (props.yMin as number | undefined) ?? defMin,
      yMax: (props.yMax as number | undefined) ?? defMax,
      includeZero: kind === "bar",
    }),
    [visible.map(item => item.entry.key).join("|"), data, props.yMin, props.yMax, defMin, defMax, kind], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const domain = drag?.frozen ?? computed;

  const count = data.labels.length;
  const leftPad = horizontal ? Math.min(150, 28 + Math.max(0, ...data.labels.map(label => Math.min(label.length, 14))) * 7.5) : 58;
  const plotW = width - leftPad - rightPad;
  const plotH = height - topPad - bottomPad;
  const span = domain.max - domain.min || 1;
  const along = (value: number) => horizontal
    ? leftPad + ((value - domain.min) / span) * plotW
    : topPad + (1 - (value - domain.min) / span) * plotH;
  const band = (horizontal ? plotH : plotW) / Math.max(count, 1);
  const centre = (index: number) => horizontal ? topPad + (index + 0.5) * band : leftPad + (index + 0.5) * band;
  const zero = along(Math.min(Math.max(0, domain.min), domain.max));
  const labelStep = Math.max(1, Math.ceil(count / (horizontal ? 14 : 10)));

  const cell = (seriesIndex: number, index: number): { text: string; value: number | null } => {
    const entry = data.series[seriesIndex];
    const value = entry?.values[index] ?? null;
    const name = entry?.label || str(props.title);
    return { value, text: `${data.labels[index] ?? ""}${name ? ` · ${name}` : ""}: ${measure(value, props)}` };
  };
  const tip = active ? cell(active.series, active.index).text : "";

  const table = chartTable(data, value => measure(value, props));
  const tsv = toTsv(table.head, table.rows);

  const setFromPointer = (event: PointerEvent<SVGSVGElement>, name: string, frozen: ChartDomain) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.height === 0) return;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    const fraction = 1 - (y - topPad) / plotH;
    const definition = stateOf(name, artifact.stateDefinitions);
    const step = definition?.step ?? Math.max((frozen.max - frozen.min) / 200, 1e-9);
    const lo = definition?.min ?? frozen.min;
    const hi = definition?.max ?? frozen.max;
    let next = frozen.min + fraction * (frozen.max - frozen.min);
    next = Math.round(next / step) * step;
    setValue(name, cleanNumber(Math.min(Math.max(next, lo), hi)));
  };

  const nudge = (name: string, current: number, direction: 1 | -1, large: boolean) => {
    const definition = stateOf(name, artifact.stateDefinitions);
    const step = (definition?.step ?? Math.max(span / 50, 1e-9)) * (large ? 10 : 1);
    const lo = definition?.min ?? domain.min;
    const hi = definition?.max ?? domain.max;
    setValue(name, cleanNumber(Math.min(Math.max(current + direction * step, lo), hi)));
  };

  // 键盘：类别方向的方向键切换数据点；另一组方向键切换系列（可拖动图表里改为调整数值，系列用 [ ]）。
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0 || visible.length === 0) return;
    const current = active ?? { series: visible[0].index, index: 0 };
    const visibleIndex = Math.max(0, visible.findIndex(item => item.index === current.series));
    const move = (next: ActivePoint) => { event.preventDefault(); setActive(next); };
    const previousSeries = () => move({ series: visible[Math.max(0, visibleIndex - 1)].index, index: current.index });
    const nextSeries = () => move({ series: visible[Math.min(visible.length - 1, visibleIndex + 1)].index, index: current.index });
    // 第一次按方向键只是选中第一个数据点，不移动、不改值。
    if (!active && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "[", "]"].includes(event.key)) { move(current); return; }
    const [previousKey, nextKey] = horizontal ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    const value = data.series[current.series]?.values[current.index] ?? null;
    const boundName = data.series[current.series]?.bound[current.index] ?? null;
    if (event.key === previousKey) move({ series: current.series, index: Math.max(0, current.index - 1) });
    else if (event.key === nextKey) move({ series: current.series, index: Math.min(count - 1, current.index + 1) });
    else if (draggable && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      if (active && boundName && value !== null) { event.preventDefault(); nudge(boundName, value, event.key === "ArrowUp" ? 1 : -1, event.shiftKey); }
      else move(current);
    } else if (event.key === "[" || (!horizontal && !draggable && event.key === "ArrowUp") || (horizontal && event.key === "ArrowLeft")) previousSeries();
    else if (event.key === "]" || (!horizontal && !draggable && event.key === "ArrowDown") || (horizontal && event.key === "ArrowRight")) nextSeries();
    else if (event.key === "Home") move({ series: current.series, index: 0 });
    else if (event.key === "End") move({ series: current.series, index: count - 1 });
    else if (event.key === "Escape" && active) { event.preventDefault(); setActive(null); }
  };

  if (blocked) return <figure className="iui-chart">
    {props.title ? <figcaption className="iui-chart-title">{str(props.title)}</figcaption> : null}
    <SourceNotice snapshot={snapshot} />
    <DataMeta status={props.status as UiDataStatus | undefined} source={props.source as UiSourceNote | undefined} from={from} />
  </figure>;

  const summary = `${str(props.title) || (kind === "bar" ? uiCopy.barChart() : uiCopy.lineChart())}. ${uiCopy.chartSummary(count, data.series.length)}`;
  const barWidth = Math.max(2, (band * 0.72) / Math.max(visible.length, 1));
  const firstMark = (seriesIndex: number, index: number) => active?.series === seriesIndex && active.index === index;

  const gridLines = domain.ticks.map(tick => {
    const position = along(tick);
    return horizontal
      ? <g key={tick}><line className="iui-grid-line" x1={position} x2={position} y1={topPad} y2={topPad + plotH} />
        <text className="iui-axis-text" x={position} y={topPad + plotH + 16} textAnchor="middle">{formatUiNumber(tick)}</text></g>
      : <g key={tick}><line className="iui-grid-line" x1={leftPad} x2={leftPad + plotW} y1={position} y2={position} />
        <text className="iui-axis-text" x={leftPad - 8} y={position + 4} textAnchor="end">{formatUiNumber(tick)}</text></g>;
  });
  const categoryLabels = data.labels.map((label, index) => index % labelStep === 0
    ? horizontal
      ? <text key={index} className="iui-axis-text" x={leftPad - 8} y={centre(index) + 4} textAnchor="end">{shortLabel(label, 18)}</text>
      : <text key={index} className="iui-axis-text" x={centre(index)} y={topPad + plotH + 16} textAnchor="middle">{shortLabel(label)}</text>
    : null);

  const marks = visible.map(({ entry, index: seriesIndex }, visibleIndex) => {
    if (kind === "bar") {
      return <g key={entry.key} className={seriesClass(seriesIndex)}>{entry.values.map((value, index) => {
        if (value === null) return null;
        const offset = (visibleIndex - (visible.length - 1) / 2) * barWidth;
        const position = along(value);
        const boundName = entry.bound[index];
        const common = {
          className: `iui-bar${firstMark(seriesIndex, index) ? " is-active" : ""}${draggable && boundName ? " is-draggable" : ""}`,
          onPointerEnter: () => setActive({ series: seriesIndex, index }),
          onPointerLeave: () => setActive(current => current?.series === seriesIndex && current.index === index ? null : current),
        };
        const rect = horizontal
          ? { x: Math.min(zero, position), y: centre(index) + offset - barWidth / 2, width: Math.abs(position - zero), height: barWidth }
          : { x: centre(index) + offset - barWidth / 2, y: Math.min(zero, position), width: barWidth, height: Math.abs(position - zero) };
        return <rect key={index} {...common} {...rect} rx={2}
          onPointerDown={draggable && boundName ? (event: PointerEvent<SVGRectElement>) => {
            capture(event);
            setActive({ series: seriesIndex, index });
            setDrag({ name: boundName, frozen: computed });
          } : undefined} />;
      })}</g>;
    }
    const segments: string[] = [];
    let run: string[] = [];
    entry.values.forEach((value, index) => {
      if (value === null) { if (run.length > 1) segments.push(run.join(" ")); run = []; return; }
      run.push(`${centre(index)},${along(value)}`);
    });
    if (run.length > 1) segments.push(run.join(" "));
    return <g key={entry.key} className={seriesClass(seriesIndex)}>
      {segments.map((points, segment) => <polyline key={segment} className="iui-line" points={points} />)}
      {entry.values.map((value, index) => {
        if (value === null) return null;
        const boundName = entry.bound[index];
        const isActive = firstMark(seriesIndex, index);
        return <g key={index}>
          <circle className={`iui-dot${isActive ? " is-active" : ""}${draggable && boundName ? " is-draggable" : ""}`} cx={centre(index)} cy={along(value)} r={isActive ? 6 : 3.5} />
          <circle className="iui-hit" cx={centre(index)} cy={along(value)} r={11}
            onPointerEnter={() => setActive({ series: seriesIndex, index })}
            onPointerLeave={() => setActive(current => current?.series === seriesIndex && current.index === index ? null : current)}
            onPointerDown={draggable && boundName ? (event: PointerEvent<SVGCircleElement>) => {
              capture(event);
              setActive({ series: seriesIndex, index });
              setDrag({ name: boundName, frozen: computed });
            } : undefined} />
        </g>;
      })}
    </g>;
  });

  return <ChartShell props={props} table={table} tsv={tsv} svgRef={svgRef} from={from}>
    {data.series.length > 1 ? <div className="iui-legend" role="group" aria-label={uiCopy.legend()}>
      {data.series.map((entry, index) => <button key={entry.key} type="button" className={`iui-legend-item ${seriesClass(index)}${hidden.has(entry.key) ? " is-off" : ""}`}
        aria-pressed={!hidden.has(entry.key)} onClick={() => setHidden(current => {
          const next = new Set(current);
          if (next.has(entry.key)) next.delete(entry.key);
          else if (visible.length > 1) next.add(entry.key);
          return next;
        })}><span className="iui-swatch" aria-hidden="true" />{entry.label || entry.key}</button>)}
    </div> : null}
    <div className="iui-chart-plot" role="group" aria-label={summary} tabIndex={0} onKeyDown={onKeyDown}
      aria-describedby={`${id}-tip`} aria-roledescription={uiCopy.chartRole()}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(null); }}>
      <svg ref={svgRef} className="iui-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}
        style={{ touchAction: draggable ? "none" : undefined }}
        onPointerMove={drag ? event => setFromPointer(event, drag.name, drag.frozen) : undefined}
        onPointerUp={drag ? () => setDrag(null) : undefined}
        onPointerCancel={drag ? () => setDrag(null) : undefined}>
        {gridLines}
        <line className="iui-axis-line" x1={horizontal ? zero : leftPad} x2={horizontal ? zero : leftPad + plotW}
          y1={horizontal ? topPad : zero} y2={horizontal ? topPad + plotH : zero} />
        {categoryLabels}
        {marks}
      </svg>
    </div>
    <div className="iui-chart-tip" id={`${id}-tip`} role="status" aria-live="polite">
      {tip || (draggable ? uiCopy.dragHint() : " ")}
    </div>
    {data.error ? <div className="iui-field-error" role="status">{"⚠ "}{uiCopy.evalError(data.error)}</div> : null}
  </ChartShell>;
}

export function BarChart({ props }: { props: Props }) {
  return <CartesianChart props={props} kind="bar" />;
}

export function LineChart({ props }: { props: Props }) {
  return <CartesianChart props={props} kind="line" />;
}

// ---------- 饼图 ----------

function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const point = (radius: number, angle: number) => `${(cx + radius * Math.sin(angle)).toFixed(3)} ${(cy - radius * Math.cos(angle)).toFixed(3)}`;
  const large = end - start > Math.PI ? 1 : 0;
  if (inner > 0) return `M ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;
  return `M ${cx} ${cy} L ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)} Z`;
}

export function PieChart({ props }: { props: Props }) {
  const { env, receiving } = useUiRuntime();
  const from = typeof props.from === "string" ? props.from : undefined;
  const { snapshot, blocked } = useSource(from);
  const data = useMemo(() => resolvePieData(props, env, snapshot, receiving), [props, env, snapshot, receiving]);
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const id = useId();
  const donut = props.donut === true;
  const table = pieTable(data, [uiCopy.category(), uiCopy.value()], value => measure(value, props));
  const tsv = toTsv(table.head, table.rows);

  if (blocked) return <figure className="iui-chart">
    {props.title ? <figcaption className="iui-chart-title">{str(props.title)}</figcaption> : null}
    <SourceNotice snapshot={snapshot} />
    <DataMeta status={props.status as UiDataStatus | undefined} source={props.source as UiSourceNote | undefined} from={from} />
  </figure>;

  const size = 220;
  const radius = 100;
  let angle = 0;
  const arcs = data.slices.map((slice, index) => {
    const start = angle;
    angle += slice.fraction * Math.PI * 2;
    return { slice, index, start, end: index === data.slices.length - 1 ? Math.PI * 2 : angle };
  });
  const summary = `${str(props.title) || uiCopy.pieChart()}. ${uiCopy.pieSummary(data.slices.length)}`;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (data.slices.length === 0) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) { if (event.key === "Escape") setActive(null); return; }
    event.preventDefault();
    setActive(current => ((current ?? (step > 0 ? -1 : 0)) + step + data.slices.length) % data.slices.length);
  };
  const tip = active !== null && data.slices[active]
    ? `${data.slices[active].label}: ${measure(data.slices[active].value, props)} (${(data.slices[active].fraction * 100).toFixed(1)}%)` : "";
  return <ChartShell props={props} table={table} tsv={tsv} svgRef={svgRef} from={from}>
    <div className="iui-pie-layout">
      <div className="iui-chart-plot iui-pie-plot" role="group" aria-label={summary} tabIndex={0} onKeyDown={onKeyDown} aria-describedby={`${id}-tip`}
        aria-roledescription={uiCopy.chartRole()} onBlur={() => setActive(null)}>
        <svg ref={svgRef} className="iui-chart-svg" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={summary}>
          {data.slices.length === 1
            ? <circle className={`iui-slice ${seriesClass(0)}${active === 0 ? " is-active" : ""}`} cx={size / 2} cy={size / 2} r={radius} onPointerEnter={() => setActive(0)} onPointerLeave={() => setActive(null)} />
            : arcs.map(({ slice, index, start, end }) => slice.fraction > 0
              ? <path key={index} className={`iui-slice ${seriesClass(index)}${active === index ? " is-active" : ""}`}
                d={arcPath(size / 2, size / 2, radius, donut ? radius * 0.58 : 0, start, end)}
                onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(current => current === index ? null : current)} />
              : null)}
          {data.slices.length === 1 && donut ? <circle className="iui-donut-hole" cx={size / 2} cy={size / 2} r={radius * 0.58} /> : null}
          {donut ? <text className="iui-donut-total" x={size / 2} y={size / 2 + 5} textAnchor="middle">{measure(data.total, props)}</text> : null}
        </svg>
      </div>
      <ul className="iui-pie-legend">
        {data.slices.map((slice, index) => <li key={index} className={`${seriesClass(index)}${active === index ? " is-active" : ""}`}
          onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(current => current === index ? null : current)}>
          <span className="iui-swatch" aria-hidden="true" />
          <span className="iui-pie-label">{slice.label}</span>
          <span className="iui-pie-value">{measure(slice.value, props)} · {(slice.fraction * 100).toFixed(1)}%</span>
        </li>)}
      </ul>
    </div>
    <div className="iui-chart-tip" id={`${id}-tip`} role="status" aria-live="polite">{tip || " "}</div>
    {data.skipped > 0 ? <div className="iui-description">{uiCopy.pieSkipped(data.skipped)}</div> : null}
    {data.error ? <div className="iui-field-error" role="status">{"⚠ "}{uiCopy.evalError(data.error)}</div> : null}
  </ChartShell>;
}
