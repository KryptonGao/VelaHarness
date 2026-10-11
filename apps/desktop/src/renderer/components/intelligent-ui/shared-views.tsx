import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  composeRefreshRequest,
  safeExternalUrl,
  type UiDataStatus,
  type UiSourceNote,
  type UiSourceSnapshot,
} from "@vela/shared";
import { uiCopy } from "./copy";
import { tokenizeInline } from "./inline-text";
import { useUiRuntime } from "./UiRuntime";

/** 渲染文字：Markdown 子集 → React 元素，永远不经过 HTML。 */
export function InlineText({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeInline(text), [text]);
  const { host } = useUiRuntime();
  return <>{tokens.map((token, index) => {
    switch (token.type) {
      case "bold": return <strong key={index}>{token.text}</strong>;
      case "italic": return <em key={index}>{token.text}</em>;
      case "code": return <code key={index}>{token.text}</code>;
      case "link": return <a key={index} href={token.href} target="_blank" rel="noreferrer noopener"
        onClick={event => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (host.openLink(token.href)) event.preventDefault();
        }}>{token.text}</a>;
      default: return <Fragment key={index}>{token.text}</Fragment>;
    }
  })}</>;
}

// ---------- 需要用户确认的外部效果 ----------

/** 有外部效果的动作：先显示将要发生什么，由用户再确认一次。刷新、建议工具、继续都只是一条发给 Agent 的普通消息。 */
export type PendingAction =
  | { kind: "submit"; text: string; title?: string }
  | { kind: "link"; url: string };

export function ConfirmPanel({ pending, id, onClose }: { pending: PendingAction; id: string; onClose: () => void }) {
  const { host } = useUiRuntime();
  return <div className="iui-confirm" id={id} role="group" aria-label={pending.kind === "submit" ? pending.title ?? uiCopy.sendToAgent() : uiCopy.open()}>
    {pending.kind === "submit" ? <>
      <div className="iui-confirm-title">{pending.title ?? uiCopy.willSend()}</div>
      <pre className="iui-confirm-text">{pending.text}</pre>
      {host.agentBusy ? <div className="iui-description">{uiCopy.queueNote()}</div> : null}
      {!host.canSubmit ? <div className="iui-field-error" role="alert">{"⚠ "}{uiCopy.unavailable()}</div> : null}
      <div className="iui-confirm-actions">
        <button type="button" className="iui-button iui-button-primary" disabled={!host.canSubmit}
          onClick={() => { onClose(); void host.submit(pending.text); }}>{uiCopy.send()}</button>
        <button type="button" className="iui-button iui-button-secondary" onClick={onClose}>{uiCopy.cancel()}</button>
      </div>
    </> : <>
      <div className="iui-confirm-title">{uiCopy.openLink(pending.url)}</div>
      <div className="iui-confirm-actions">
        <a className="iui-button iui-button-primary" href={pending.url} target="_blank" rel="noreferrer noopener"
          onClick={event => { if (host.openLink(pending.url)) event.preventDefault(); onClose(); }}>{uiCopy.open()}</a>
        <button type="button" className="iui-button iui-button-secondary" onClick={onClose}>{uiCopy.cancel()}</button>
      </div>
    </>}
  </div>;
}

/** 自带确认面板的小按钮：工具栏和数据来源行共用。 */
export function ConfirmButton({ label, className = "iui-tool", pending }: { label: string; className?: string; pending: () => PendingAction | null }) {
  const [open, setOpen] = useState<PendingAction | null>(null);
  const id = useId();
  return <>
    <button type="button" className={className} aria-expanded={open ? true : undefined} aria-controls={open ? id : undefined}
      onClick={() => setOpen(current => current ? null : pending())}>{label}</button>
    {open ? <ConfirmPanel pending={open} id={id} onClose={() => setOpen(null)} /> : null}
  </>;
}

// ---------- 数据状态与来源 ----------

function statusLabel(status: UiDataStatus | undefined): string | null {
  return status === "loading" ? uiCopy.statusLoading() : status === "stale" ? uiCopy.statusStale()
    : status === "error" ? uiCopy.statusError() : status === "empty" ? uiCopy.statusEmpty() : null;
}

function formatFetchedAt(time: number | null): string {
  if (time === null) return uiCopy.unknownTime();
  try { return new Date(time).toLocaleString(); } catch { return uiCopy.unknownTime(); }
}

/** 来自真实工具结果的数据来源：工具、对象、获取时间、状态，以及（经 Agent、需确认的）刷新。 */
function SourceProvenance({ snapshot }: { snapshot: UiSourceSnapshot }) {
  const { artifact } = useUiRuntime();
  const definition = artifact.sources.find(item => item.name === snapshot.name);
  const shortId = snapshot.sourceId ? snapshot.sourceId.slice(0, 12) : null;
  return <>
    <span className="iui-source iui-provenance" title={shortId ? `${uiCopy.recordId()}: ${shortId}` : undefined}>
      {uiCopy.dataFrom()}{": "}<code>{snapshot.tool}</code>
      {snapshot.subject ? <> · <span className="iui-subject">{snapshot.subject}</span></> : null}
      {snapshot.fetchedAt !== null || snapshot.status !== "loading" ? <> · <time dateTime={snapshot.fetchedAt !== null ? new Date(snapshot.fetchedAt).toISOString() : undefined}>{formatFetchedAt(snapshot.fetchedAt)}</time></> : null}
    </span>
    {definition && snapshot.status !== "loading"
      ? <ConfirmButton label={uiCopy.refresh()} pending={() => ({ kind: "submit", title: uiCopy.willSendRefresh(), text: composeRefreshRequest(artifact, definition, snapshot) })} />
      : null}
  </>;
}

/** 数据组件底部的状态与来源。`from` 指向数据源时以真实快照为准；模型自己写的来源永远标注「未验证」。 */
export function DataMeta({ status, source, from }: { status?: UiDataStatus; source?: UiSourceNote; from?: string }) {
  const { snapshots } = useUiRuntime();
  const snapshot = from ? snapshots.get(from) : undefined;
  const effective = from ? (snapshot?.status ?? "loading") : status;
  const label = statusLabel(effective === "ok" ? undefined : effective);
  if (!label && !source && !from) return null;
  return <div className="iui-meta">
    {label ? <span className={`iui-badge iui-badge-${effective}`} role={effective === "error" ? "alert" : "status"}>{label}</span> : null}
    {snapshot ? <SourceProvenance snapshot={snapshot} /> : null}
    {snapshot?.truncated ? <span className="iui-badge iui-badge-stale">{uiCopy.truncated()}</span> : null}
    {source ? <span className="iui-source">
      {uiCopy.source()}{": "}
      {source.url && safeExternalUrl(source.url) ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a> : source.label}
      {" · "}<span className="iui-unverified">{uiCopy.unverified()}</span>
    </span> : null}
  </div>;
}

/** 数据组件读取自己的数据源：blocked 为 true 时没有可用数据（加载中、失败、没有内容），组件应显示 SourceNotice 而不是主体。 */
export function useSource(from: string | undefined): { snapshot: UiSourceSnapshot | undefined; blocked: boolean } {
  const { snapshots } = useUiRuntime();
  if (!from) return { snapshot: undefined, blocked: false };
  const snapshot = snapshots.get(from);
  return { snapshot, blocked: !snapshot || (snapshot.status !== "ok" && snapshot.status !== "stale") };
}

/** 数据源还没有可用数据时代替组件主体：加载中显示骨架，失败显示原因，没有内容显示空态。 */
export function SourceNotice({ snapshot }: { snapshot: UiSourceSnapshot | undefined }) {
  const state = snapshot?.status ?? "loading";
  if (state === "loading") return <div className="iui-skeleton" role="status"><span className="iui-sr-only">{uiCopy.statusLoading()}</span></div>;
  const message = uiCopy.sourceMessage(snapshot?.message ?? null, snapshot?.detail ?? null);
  return <div className={`iui-notice${state === "error" ? " iui-notice-error" : ""}`} role={state === "error" ? "alert" : "status"}>
    <strong>{state === "error" ? "⚠ " : ""}{state === "error" ? uiCopy.statusError() : uiCopy.statusEmpty()}</strong>
    <div className="iui-description">{message}</div>
  </div>;
}

/** 复制/导出反馈：短暂显示结果。 */
export function useFlash(): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [text, (next: string) => {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), 1800);
  }];
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
