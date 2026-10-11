import { useId, useRef, useState, type KeyboardEvent } from "react";
import { type UiSourceNote, type UiDataStatus } from "@vela/shared";
import { uiCopy } from "./copy";
import { exportSvgAsPng } from "./image-export";
import { DataMeta, useFlash } from "./shared-views";
import { useUiRuntime } from "./UiRuntime";

type Props = Record<string, unknown>;

interface Shape { type: string; [key: string]: unknown }
interface Hotspot { id: string; label: string; description?: string; value: string; shape: "rect" | "circle" | "polygon"; [key: string]: unknown }

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function pointString(points: unknown): string {
  return Array.isArray(points) ? (points as Array<[number, number]>).map(pair => `${num(pair[0])},${num(pair[1])}`).join(" ") : "";
}

/** 颜色只能是主题 Token 名，由 CSS 映射成变量；模型给不了任意颜色、渐变或 url()。 */
function tone(shape: Shape, key: "fill" | "stroke"): Record<string, string> {
  return key === "fill" ? { "data-fill": str(shape.fill) || "none" } : { "data-stroke": str(shape.stroke) || "none" };
}

function ShapeView({ shape }: { shape: Shape }) {
  const style = {
    strokeWidth: num(shape.strokeWidth) || undefined,
    opacity: typeof shape.opacity === "number" ? shape.opacity : undefined,
    strokeDasharray: shape.dash === true ? "6 4" : undefined,
  };
  const common = { className: "iui-shape", ...tone(shape, "fill"), ...tone(shape, "stroke"), style };
  switch (shape.type) {
    case "rect": return <rect {...common} x={num(shape.x)} y={num(shape.y)} width={num(shape.w)} height={num(shape.h)} rx={num(shape.rx)} />;
    case "circle": return <circle {...common} cx={num(shape.cx)} cy={num(shape.cy)} r={num(shape.r)} />;
    case "ellipse": return <ellipse {...common} cx={num(shape.cx)} cy={num(shape.cy)} rx={num(shape.rx)} ry={num(shape.ry)} />;
    case "line": return <line {...common} x1={num(shape.x1)} y1={num(shape.y1)} x2={num(shape.x2)} y2={num(shape.y2)} />;
    case "polyline": return <polyline {...common} points={pointString(shape.points)} />;
    case "polygon": return <polygon {...common} points={pointString(shape.points)} />;
    case "path": return <path {...common} d={str(shape.d)} />;
    case "text": return <text className="iui-shape-text" data-fill={str(shape.fill) || "default"} x={num(shape.x)} y={num(shape.y)}
      textAnchor={str(shape.anchor) === "middle" ? "middle" : str(shape.anchor) === "end" ? "end" : "start"} fontSize={num(shape.size) || 14}>{str(shape.text)}</text>;
    default: return null;
  }
}

function HotspotShape({ hotspot, className, onPointerEnter, onPointerLeave, onClick }: {
  hotspot: Hotspot; className: string; onPointerEnter: () => void; onPointerLeave: () => void; onClick: () => void;
}) {
  // 命中区只负责指针交互；键盘和读屏用户使用下方的按钮列表。
  const common = { className, "aria-hidden": true as const, onPointerEnter, onPointerLeave, onClick };
  switch (hotspot.shape) {
    case "rect": return <rect {...common} x={num(hotspot.x)} y={num(hotspot.y)} width={num(hotspot.w)} height={num(hotspot.h)} />;
    case "circle": return <circle {...common} cx={num(hotspot.cx)} cy={num(hotspot.cy)} r={num(hotspot.r)} />;
    default: return <polygon {...common} points={pointString(hotspot.points)} />;
  }
}

/** 受限 SVG 图：只渲染白名单图元；热点只会把绑定的状态设成它声明的值。 */
export function SvgDiagram({ props }: { props: Props }) {
  const { values, setValue } = useUiRuntime();
  const shapes = (props.shapes as Shape[]) ?? [];
  const hotspots = (props.hotspots as Hotspot[]) ?? [];
  const bind = typeof props.bind === "string" ? props.bind : null;
  const selected = bind && typeof values[bind] === "string" ? values[bind] as string : null;
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [flash, setFlash] = useFlash();
  const id = useId();
  const width = num(props.width) || 400;
  const height = num(props.height) || 300;
  const shown = hotspots.find(item => item.id === hover) ?? hotspots.find(item => item.value === selected) ?? null;
  const select = (hotspot: Hotspot) => { if (bind) setValue(bind, hotspot.value); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = hotspots.findIndex(item => item.value === selected);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || hotspots.length === 0) return;
    event.preventDefault();
    const next = hotspots[(Math.max(index, step > 0 ? -1 : 0) + step + hotspots.length) % hotspots.length];
    select(next);
    (event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[hotspots.indexOf(next)])?.focus();
  };
  const labelledBy = `${id}-t`;
  return <figure className="iui-diagram" aria-labelledby={labelledBy}>
    <figcaption className="iui-chart-title" id={labelledBy}>{str(props.title)}</figcaption>
    {props.description ? <div className="iui-description">{str(props.description)}</div> : null}
    <svg ref={svgRef} className="iui-diagram-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={str(props.description) || str(props.title)}>
      <g>{shapes.map((shape, index) => <ShapeView key={index} shape={shape} />)}</g>
      <g>{hotspots.map(hotspot => <HotspotShape key={hotspot.id} hotspot={hotspot}
        className={`iui-hotspot${hotspot.value === selected ? " is-selected" : ""}${hover === hotspot.id ? " is-hover" : ""}`}
        onPointerEnter={() => setHover(hotspot.id)} onPointerLeave={() => setHover(current => current === hotspot.id ? null : current)}
        onClick={() => select(hotspot)} />)}</g>
    </svg>
    {hotspots.length > 0 ? <div className="iui-hotspot-list" role="group" aria-label={uiCopy.diagramParts()} onKeyDown={onKeyDown}>
      {hotspots.map((hotspot, index) => <button key={hotspot.id} type="button" className={`iui-chip${hotspot.value === selected ? " is-selected" : ""}`}
        aria-pressed={hotspot.value === selected} tabIndex={hotspot.value === selected || (selected === null && index === 0) ? 0 : -1}
        onClick={() => select(hotspot)} onFocus={() => setHover(hotspot.id)} onBlur={() => setHover(null)}>{hotspot.label}</button>)}
    </div> : null}
    <div className="iui-chart-tip" role="status" aria-live="polite">
      {shown ? <><strong>{shown.label}</strong>{shown.description ? ` — ${shown.description}` : ""}</> : " "}
    </div>
    {props.caption ? <div className="iui-description">{str(props.caption)}</div> : null}
    <div className="iui-chart-tools">
      <button type="button" className="iui-tool" onClick={() => {
        const svg = svgRef.current;
        if (svg) void exportSvgAsPng(svg, str(props.title) || "diagram").then(ok => setFlash(ok ? uiCopy.imageSaved() : uiCopy.imageFailed()));
      }}>{flash ?? uiCopy.saveImage()}</button>
    </div>
    <DataMeta status={props.status as UiDataStatus | undefined} source={props.source as UiSourceNote | undefined} />
  </figure>;
}
