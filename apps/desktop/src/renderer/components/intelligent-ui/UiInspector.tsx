import { useEffect, useId, useState } from "react";
import type { UiArtifact, UiSnapshots, UiValue } from "@vela/shared";
import { uiCopy } from "./copy";
import { uiMetrics } from "./ui-metrics-instance";

type Tab = "ast" | "events" | "state" | "sources" | "rejections";

const tabs: readonly Tab[] = ["ast", "events", "state", "sources", "rejections"];
const maxJson = 20_000;

function json(value: unknown): string {
  let text: string;
  try { text = JSON.stringify(value, null, 2) ?? ""; } catch { text = ""; }
  return text.length > maxJson ? `${text.slice(0, maxJson)}\n… ${uiCopy.inspectorTruncated()}` : text;
}

/**
 * 开发检查器（IUI-13）：AST、事件时间线、状态快照、数据源和拒绝原因。
 * 全部来自本地内存里的解析结果，不上传、不写盘。
 */
export function UiInspector({ artifact, values, snapshots, metricsKey }: {
  artifact: UiArtifact; values: Readonly<Record<string, UiValue>>; snapshots: UiSnapshots; metricsKey: string;
}) {
  const [tab, setTab] = useState<Tab>("ast");
  const id = useId();
  // 事件时间线随指标更新（事件数组原地追加，所以用计数触发重绘）。
  const [, refresh] = useState(0);
  useEffect(() => uiMetrics.subscribe(() => refresh(count => count + 1)), []);
  const events = uiMetrics.timeline(metricsKey);
  const names: Record<Tab, string> = {
    ast: uiCopy.inspectorAst(), events: uiCopy.inspectorEvents(), state: uiCopy.inspectorState(),
    sources: uiCopy.inspectorSources(), rejections: uiCopy.inspectorRejections(),
  };
  const invalidNodes = artifact.nodes.filter(node => node.invalid).map(node => ({ id: node.id, type: node.type, reason: node.invalid }));
  let body: string;
  switch (tab) {
    case "ast":
      body = json({
        artifactId: artifact.artifactId, status: artifact.status, revision: artifact.revision, root: artifact.rootNodeId,
        nodes: artifact.nodes.map(node => ({ id: node.id, type: node.type, parent: node.parentId, children: node.childrenIds, props: node.props, ...(node.show ? { show: node.show } : {}), ...(node.invalid ? { invalid: node.invalid } : {}) })),
        state: artifact.stateDefinitions, derived: artifact.derived, sources: artifact.sources,
      });
      break;
    case "events": body = events.map(event => `${String(event.at).padStart(6, " ")} ms  ${event.type}${event.detail ? `  ${event.detail}` : ""}`).join("\n") || uiCopy.inspectorEmpty(); break;
    case "state": body = json(values); break;
    case "sources":
      body = artifact.sources.length === 0 ? uiCopy.inspectorEmpty()
        : json([...snapshots.values()].map(snapshot => ({
          name: snapshot.name, tool: snapshot.tool, status: snapshot.status, message: snapshot.message, sourceId: snapshot.sourceId,
          subject: snapshot.subject, fetchedAt: snapshot.fetchedAt === null ? null : new Date(snapshot.fetchedAt).toISOString(),
          rows: snapshot.rows.length, columns: snapshot.columns, truncated: snapshot.truncated,
        })));
      break;
    default:
      body = artifact.diagnostics.length === 0 && invalidNodes.length === 0 && !artifact.reason ? uiCopy.inspectorNone()
        : json({ reason: artifact.reason, diagnostics: artifact.diagnostics, invalidNodes });
  }
  return <details className="iui-inspector">
    <summary>{uiCopy.inspector()}</summary>
    <div className="iui-inspector-tabs" role="tablist" aria-label={uiCopy.inspector()}>
      {tabs.map(item => <button key={item} type="button" role="tab" id={`${id}-${item}`} aria-selected={tab === item} aria-controls={`${id}-panel`}
        className={`iui-segment${tab === item ? " is-selected" : ""}`} onClick={() => setTab(item)}>{names[item]}</button>)}
    </div>
    <pre className="iui-source-view" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}><code>{body}</code></pre>
    <div className="iui-description">{uiCopy.inspectorLocal()}</div>
  </details>;
}
