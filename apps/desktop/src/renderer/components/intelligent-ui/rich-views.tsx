import { useMemo, useState } from "react";
import {
  itineraryPlot,
  parseUnifiedDiff,
  resolveTimeline,
  type TimelineStatus,
  type UiDataStatus,
  type UiSourceNote,
} from "@vela/shared";
import { uiCopy } from "./copy";
import { copyToClipboard, DataMeta, InlineText, SourceNotice, useFlash, useSource } from "./shared-views";

type Props = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function Heading({ title }: { title: string }) {
  return title ? <div className="iui-chart-title">{title}</div> : null;
}

// ---------- 媒体（占位） ----------

/** 没有配置媒体 Provider：只显示模型给的说明，不联网、不生成图片或地图。 */
export function MediaPlaceholder({ props }: { props: Props }) {
  const map = props.kind === "map";
  return <figure className="iui-media" aria-label={str(props.alt)}>
    <div className="iui-media-box" role="img" aria-label={str(props.alt)}>
      <span aria-hidden="true" className="iui-media-icon">{map ? "🗺" : "🖼"}</span>
      <div>
        <div className="iui-media-alt">{str(props.alt)}</div>
        <div className="iui-description">{map ? uiCopy.mediaMapMissing() : uiCopy.mediaImageMissing()}</div>
      </div>
    </div>
    {props.caption ? <figcaption className="iui-description">{str(props.caption)}</figcaption> : null}
    <DataMeta source={props.source as UiSourceNote | undefined} />
  </figure>;
}

// ---------- 时间轴 ----------

const statusMark: Record<TimelineStatus, string> = { done: "✓", current: "●", upcoming: "○", blocked: "✕" };

export function Timeline({ props }: { props: Props }) {
  const from = typeof props.from === "string" ? props.from : undefined;
  const { snapshot, blocked } = useSource(from);
  const entries = useMemo(() => resolveTimeline(props, snapshot), [props, snapshot]);
  const statusText: Record<TimelineStatus, string> = {
    done: uiCopy.timelineDone(), current: uiCopy.timelineCurrent(), upcoming: uiCopy.timelineUpcoming(), blocked: uiCopy.timelineBlocked(),
  };
  return <div className="iui-timeline-block">
    <Heading title={str(props.title)} />
    {blocked ? <SourceNotice snapshot={snapshot} />
      : entries.length === 0 ? <div className="iui-muted">{uiCopy.noData()}</div>
      : <ol className="iui-timeline">{entries.map((entry, index) => <li key={index} className={`iui-timeline-item is-${entry.status}`} aria-current={entry.status === "current" ? "step" : undefined}>
        <span className="iui-timeline-mark" aria-hidden="true">{statusMark[entry.status]}</span>
        <div className="iui-timeline-body">
          <div className="iui-timeline-head">
            {entry.date ? <time className="iui-timeline-date">{entry.date}</time> : null}
            <span className="iui-timeline-title">{entry.title}</span>
            <span className="iui-timeline-status">{statusText[entry.status]}</span>
          </div>
          {entry.detail ? <div className="iui-description"><InlineText text={entry.detail} /></div> : null}
        </div>
      </li>)}</ol>}
    <DataMeta status={props.status as UiDataStatus | undefined} source={props.source as UiSourceNote | undefined} from={from} />
  </div>;
}

// ---------- 行程 ----------

interface Day { label: string; stops: Array<{ name: string; time?: string; note?: string; lat?: number; lng?: number }> }

const dayColors = ["var(--accent-blue)", "var(--success)", "var(--warning)", "var(--danger)", "var(--text-secondary)"];

export function Itinerary({ props }: { props: Props }) {
  const days = (props.days as Day[]) ?? [];
  const plot = useMemo(() => itineraryPlot(days), [days]);
  // 只要有一站写了时间，就给所有站点预留时间列，名称才会对齐。
  const hasTime = days.some(day => day.stops.some(stop => stop.time));
  const [open, setOpen] = useState(false);
  return <div className="iui-itinerary">
    <Heading title={str(props.title)} />
    {days.map((day, dayIndex) => <section key={dayIndex} className="iui-itinerary-day" aria-label={day.label}>
      <h5 className="iui-heading">{day.label}</h5>
      <ol className="iui-itinerary-stops">{day.stops.map((stop, index) => <li key={index}>
        {hasTime ? <time className="iui-itinerary-time">{stop.time ?? ""}</time> : null}
        <div>
          <div className="iui-itinerary-name">{stop.name}</div>
          {stop.note ? <div className="iui-description">{stop.note}</div> : null}
          {typeof stop.lat === "number" && typeof stop.lng === "number"
            ? <div className="iui-description iui-coords">{stop.lat}, {stop.lng} · {uiCopy.coordsFromModel()}</div> : null}
        </div>
      </li>)}</ol>
    </section>)}
    {plot ? <div className="iui-itinerary-plot">
      <button type="button" className="iui-tool" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? uiCopy.hidePlot() : uiCopy.showPlot()}</button>
      {open ? <figure>
        <svg className="iui-plot-svg" viewBox={`0 0 ${(plot.width * 280 + 40).toFixed(0)} ${(plot.height * 280 + 40).toFixed(0)}`} role="img" aria-label={uiCopy.plotLabel()}>
          {days.map((day, dayIndex) => {
            const points = plot.points.filter(point => point.day === day.label);
            return <polyline key={dayIndex} className="iui-plot-route" stroke={dayColors[dayIndex % dayColors.length]}
              points={points.map(point => `${(20 + point.x * 280).toFixed(1)},${(20 + point.y * 280).toFixed(1)}`).join(" ")} />;
          })}
          {plot.points.map((point, index) => {
            const dayIndex = Math.max(0, days.findIndex(day => day.label === point.day));
            return <g key={index} transform={`translate(${(20 + point.x * 280).toFixed(1)} ${(20 + point.y * 280).toFixed(1)})`}>
              <circle r={7} fill={dayColors[dayIndex % dayColors.length]} className="iui-plot-dot" />
              <text className="iui-plot-num" textAnchor="middle" y={3.5}>{index + 1}</text>
              <title>{point.name}</title>
            </g>;
          })}
        </svg>
        <figcaption className="iui-description">{uiCopy.plotNote()}</figcaption>
        <ol className="iui-plot-legend">{plot.points.map((point, index) => <li key={index}>{point.name}</li>)}</ol>
      </figure> : null}
    </div> : null}
    <DataMeta status={props.status as UiDataStatus | undefined} source={props.source as UiSourceNote | undefined} />
  </div>;
}

// ---------- 差异 ----------

export function DiffView({ props }: { props: Props }) {
  const from = typeof props.from === "string" ? props.from : undefined;
  const { snapshot, blocked } = useSource(from);
  const text = from ? (snapshot?.text ?? "") : str(props.diff);
  const model = useMemo(() => parseUnifiedDiff(text), [text]);
  const [flash, setFlash] = useFlash();
  const sign = { add: "+", del: "−", ctx: " ", hunk: "", file: "", meta: "" } as const;
  return <div className="iui-diff-block">
    {props.caption ? <div className="iui-description">{str(props.caption)}</div> : null}
    {blocked ? <SourceNotice snapshot={snapshot} /> : <>
      <div className="iui-diff-head">
        {props.fileName ? <code>{str(props.fileName)}</code> : null}
        <span className="iui-diff-add" aria-label={uiCopy.diffAdded(model.added)}>+{model.added}</span>
        <span className="iui-diff-del" aria-label={uiCopy.diffRemoved(model.removed)}>−{model.removed}</span>
      </div>
      <div className="iui-diff" role="region" aria-label={uiCopy.diffRegion()} tabIndex={0}>
        {model.lines.map((line, index) => <div key={index} className={`iui-diff-line is-${line.kind}`}>
          <span className="iui-diff-no" aria-hidden="true">{line.oldNo ?? ""}</span>
          <span className="iui-diff-no" aria-hidden="true">{line.newNo ?? ""}</span>
          <span className="iui-diff-sign" aria-hidden="true">{sign[line.kind]}</span>
          <span className="iui-diff-text">{line.kind === "add" ? <span className="iui-sr-only">{uiCopy.diffAddedLine()} </span> : line.kind === "del" ? <span className="iui-sr-only">{uiCopy.diffRemovedLine()} </span> : null}{line.text || " "}</span>
        </div>)}
      </div>
      {model.truncated ? <div className="iui-description">{uiCopy.diffTruncated()}</div> : null}
      <div className="iui-chart-tools">
        <button type="button" className="iui-tool" onClick={() => void copyToClipboard(text).then(ok => setFlash(ok ? uiCopy.copied() : uiCopy.copyFailed()))}>{flash ?? uiCopy.copyDiff()}</button>
      </div>
    </>}
    <DataMeta status={props.status as UiDataStatus | undefined} source={props.source as UiSourceNote | undefined} from={from} />
  </div>;
}
