import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildSandboxDocument,
  parseSandboxMessage,
  uiAppHeightRange,
  uiSandboxAttribute,
  uiSandboxLimits,
  type SandboxStopReason,
  type UiAppBlock,
  type UiSandboxCapability,
} from "@vela/shared";
import { createLogger } from "../../logger";
import { uiCopy } from "./copy";
import { stopApp, tryStartApp, useRunningAppCount } from "./running-apps";
import { uiMetrics } from "./ui-metrics-instance";
import { useMicroAppsEnabled } from "./ui-settings-store";
import { useUiHost } from "./UiRuntime";

const log = createLogger("intelligent-ui:app");

interface PendingRequest { id: number; capability: UiSandboxCapability; text: string; token: string }

/** 在聊天里运行的沙盒微应用（IUI-14）。默认不运行：用户必须先在设置里打开，再点「运行」。 */
export const MicroAppView = memo(function MicroAppView({ app, raw, messageId, streaming }: {
  app: UiAppBlock; raw: string; messageId: string; streaming: boolean;
}) {
  const host = useUiHost();
  const enabled = useMicroAppsEnabled();
  const runningCount = useRunningAppCount();
  const instance = useId();
  const stable = host.stableMessageId(messageId) ?? messageId;
  // capability 令牌按这个键限定范围：同一个应用的令牌不能被别的应用兑换。
  const appKey = useMemo(() => `${host.conversationId ?? "-"}/${stable}/${app.appId}/${instance}`, [host.conversationId, stable, app.appId, instance]);
  const metricsKey = `app:${host.conversationId ?? "-"}/${stable}/${app.appId}`;

  const [running, setRunning] = useState(false);
  const [height, setHeight] = useState<number>(app.height);
  const [stopped, setStopped] = useState<SandboxStopReason | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [showCode, setShowCode] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const codeId = useId();
  const requestRef = useRef<PendingRequest | null>(null);
  requestRef.current = request;

  const doc = useMemo(() => running ? buildSandboxDocument(app.source) : "", [running, app.source]);
  const api = window.vela;

  const respond = useCallback((id: number, ok: boolean, error?: string) => {
    try { frame.current?.contentWindow?.postMessage({ vela: 1, type: "response", id, ok, ...(error ? { error } : {}) }, "*"); } catch { /* 框架已经没了 */ }
  }, []);

  const stop = useCallback((reason: SandboxStopReason) => {
    setRunning(false);
    setStopped(reason);
    setRequest(null);
    stopApp(appKey);
    void api?.uiSandboxRevoke(appKey).catch(() => undefined);
    uiMetrics.appStop(metricsKey, reason);
  }, [api, appKey, metricsKey]);

  // 运行期间：消息桥与看门狗。
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    let lastBeat = startedAt;
    let ready = false;
    let errors = 0;
    const onMessage = (event: MessageEvent) => {
      // 只信任这个 iframe 自己发来的消息；其余窗口（含其它微应用）一律忽略。
      if (event.source !== frame.current?.contentWindow) return;
      const message = parseSandboxMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case "ready": ready = true; lastBeat = Date.now(); break;
        case "heartbeat": lastBeat = Date.now(); break;
        case "resize": setHeight(message.height); break;
        case "error":
          errors += 1;
          log.warn("micro-app error", { message: message.message });
          if (errors > uiSandboxLimits.maxErrors) stop("errors");
          break;
        case "request": {
          if (requestRef.current) { respond(message.id, false, "busy"); break; }
          if (!api) { respond(message.id, false, "unavailable"); break; }
          void api.uiSandboxIssue(appKey, message.capability, message.text.length).then(result => {
            if (!result.ok) { respond(message.id, false, result.error); return; }
            // 在用户做决定之前不执行任何事情：令牌只是「可以询问」。
            setRequest({ id: message.id, capability: message.capability, text: message.text, token: result.token });
          }, () => respond(message.id, false, "unavailable"));
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    const timer = setInterval(() => {
      const now = Date.now();
      if (!ready && now - startedAt > uiSandboxLimits.readyTimeoutMs) stop("unresponsive");
      else if (ready && now - lastBeat > uiSandboxLimits.silenceMs) stop("unresponsive");
      else if (now - startedAt > uiSandboxLimits.maxRuntimeMs) stop("timeout");
    }, 1_000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [running, api, appKey, respond, stop]);

  // 卸载（滚出、切换会话）时一定收回令牌并释放名额。
  useEffect(() => () => {
    stopApp(appKey);
    void window.vela?.uiSandboxRevoke(appKey).catch(() => undefined);
  }, [appKey]);

  // 用户在设置里关闭微应用后，正在运行的立即停止。
  useEffect(() => {
    if (!enabled && running) stop("disposed");
  }, [enabled, running, stop]);

  const run = () => {
    setStopped(null);
    setLimitHit(false);
    if (!tryStartApp(appKey)) { setLimitHit(true); return; }
    setHeight(app.height);
    setRunning(true);
    uiMetrics.appRun(metricsKey);
  };

  const decide = async (allow: boolean) => {
    const current = requestRef.current;
    if (!current) return;
    setRequest(null);
    if (!allow || !api) {
      void api?.uiSandboxRevoke(appKey).catch(() => undefined);
      respond(current.id, false, "denied");
      return;
    }
    try {
      // 兑换时 Main 再次核对：令牌有效、属于这个应用、文本大小在授权范围内；令牌随即作废。
      const redeemed = await api.uiSandboxRedeem(current.token, appKey, current.capability, current.text.length);
      if (!redeemed.ok) { respond(current.id, false, "expired"); return; }
      if (current.capability === "agent.submit") await host.submit(current.text);
      else await navigator.clipboard.writeText(current.text);
      respond(current.id, true);
    } catch {
      respond(current.id, false, "failed");
    }
  };

  const title = app.title || uiCopy.appDefaultTitle();
  const label = uiCopy.appRegion(title);
  const canRun = app.status === "ready" && !streaming;

  // 微应用从未进入沙盒：关闭、未完成或不合法时只显示原因和原始文本。
  let blockedReason: string | null = null;
  if (app.status === "invalid") blockedReason = app.reason === "limit_bytes" ? uiCopy.appTooLarge() : uiCopy.appUnsupported();
  else if (!enabled) blockedReason = uiCopy.appDisabled();
  else if (app.status === "incomplete") blockedReason = uiCopy.appIncomplete();
  useEffect(() => {
    if (blockedReason && app.status !== "receiving") uiMetrics.appBlocked(metricsKey, app.status === "invalid" ? "invalid" : !enabled ? "disabled" : "incomplete");
  }, [blockedReason, app.status, enabled, metricsKey]);

  return <div className="iui-frame iui-app" role="group" aria-label={label}>
    <div className="iui-app-head">
      <span className="iui-badge iui-badge-app">{uiCopy.appBadge()}</span>
      <span className="iui-title iui-app-title">{title}</span>
    </div>
    {running ? <>
      <iframe ref={frame} className="iui-app-frame" title={label} sandbox={uiSandboxAttribute} srcDoc={doc}
        referrerPolicy="no-referrer" allow="" style={{ height: Math.min(Math.max(height, uiAppHeightRange.min), uiAppHeightRange.max) }} />
      {request ? <div className="iui-confirm" role="alertdialog" aria-label={uiCopy.appAsk()}>
        <div className="iui-confirm-title">{request.capability === "agent.submit" ? uiCopy.appAskSubmit(title) : uiCopy.appAskCopy(title)}</div>
        <pre className="iui-confirm-text">{request.text}</pre>
        {request.capability === "agent.submit" && host.agentBusy ? <div className="iui-description">{uiCopy.queueNote()}</div> : null}
        {request.capability === "agent.submit" && !host.canSubmit ? <div className="iui-field-error" role="alert">{"⚠ "}{uiCopy.unavailable()}</div> : null}
        <div className="iui-confirm-actions">
          <button type="button" className="iui-button iui-button-primary" disabled={request.capability === "agent.submit" && !host.canSubmit}
            onClick={() => void decide(true)}>{request.capability === "agent.submit" ? uiCopy.send() : uiCopy.copyText()}</button>
          <button type="button" className="iui-button iui-button-secondary" onClick={() => void decide(false)}>{uiCopy.deny()}</button>
        </div>
      </div> : null}
      <div className="iui-toolbar iui-toolbar-visible">
        <button type="button" className="iui-tool" onClick={() => stop("stopped")}>{uiCopy.appStop()}</button>
      </div>
    </> : <>
      {blockedReason ? <div className={`iui-notice${app.status === "invalid" ? " iui-notice-error" : ""}`} role="status">
        <strong>{app.status === "invalid" ? "⚠ " : ""}{blockedReason}</strong>
        {!enabled && app.status !== "invalid" ? <div className="iui-description">{uiCopy.appDisabledHint()}</div> : null}
      </div> : app.status === "receiving" || streaming
        ? <div className="iui-skeleton" role="status"><span className="iui-sr-only">{uiCopy.building()}</span></div>
        : <div className="iui-notice" role="status">
          <div className="iui-description">{uiCopy.appWarning()}</div>
        </div>}
      {stopped && stopped !== "stopped" && stopped !== "disposed" ? <div className="iui-notice iui-notice-warning" role="alert">{"⚠ "}{uiCopy.appStopReason(stopped)}</div> : null}
      {limitHit || (!running && runningCount >= uiSandboxLimits.maxRunning && canRun && enabled)
        ? <div className="iui-description" role="status">{uiCopy.appLimit(uiSandboxLimits.maxRunning)}</div> : null}
      <div className="iui-toolbar iui-toolbar-visible">
        {canRun && enabled ? <button type="button" className="iui-button iui-button-primary" onClick={run}>{stopped ? uiCopy.appRunAgain() : uiCopy.appRun()}</button> : null}
        <button type="button" className="iui-tool" aria-expanded={showCode} aria-controls={codeId} onClick={() => setShowCode(value => !value)}>
          {showCode ? uiCopy.hideSource() : uiCopy.viewSource()}</button>
      </div>
    </>}
    {showCode && !running ? <pre className="iui-source-view" id={codeId} tabIndex={0}><code>{raw || " "}</code></pre> : null}
  </div>;
});
