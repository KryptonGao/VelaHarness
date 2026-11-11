import { emptyHooksConfig, hookEvents, hookMatches, parseHooksConfig, type HookEvent, type HookScope, type HooksCatalog, type HooksConfig, type HooksRunResult } from "@vela/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AppLocale } from "../hooks/usePreferences";
import { hooksCopy } from "./hooks-copy";
import { Field, Segmented, SettingsBlock, SettingsGroup, SettingsSwitch } from "./settings/primitives";
import { SettingsSelect } from "./settings/SettingsSelect";
import "../hooks-settings.css";

// Volatile drafts survive settings navigation, without persisting command credentials to local storage.
const drafts = new Map<string, { text: string; digest: string }>();
const pretty = (config: HooksConfig) => JSON.stringify(config, null, 2);

export function HooksSettingsSection({ locale, workspacePath }: { locale: AppLocale; workspacePath: string | null }) {
  const copy = hooksCopy(locale);
  const api = window.vela;
  const [scope, setScope] = useState<HookScope>("project");
  const [catalog, setCatalog] = useState<HooksCatalog | null>(null);
  const [draft, setDraft] = useState("");
  const [revision, setRevision] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testNotice, setTestNotice] = useState("");
  const [testResult, setTestResult] = useState<HooksRunResult | null>(null);
  const [confirm, setConfirm] = useState<"trust" | "test" | "discard" | null>(null);
  const [event, setEvent] = useState<HookEvent>("PreToolUse");
  const [toolName, setToolName] = useState("write");
  const generation = useRef(0);
  const alive = useRef(true);
  const errorId = useId();
  const key = `${workspacePath ?? ""}:${scope}`;
  const document = catalog?.documents.find(d => d.scope === scope);
  const hasTestMatch = document?.config.hooks.some(hook => hook.enabled !== false && hook.event === event && hookMatches(hook.matcher, toolName));
  const dirty = !!document && (draft !== pretty(document.config) || revision !== document.digest);
  const parsed = useMemo(() => {
    try { return { config: parseHooksConfig(JSON.parse(draft)), error: "" }; }
    catch (e) { return { config: null, error: e instanceof Error ? e.message : "Invalid JSON" }; }
  }, [draft]);

  function updateDraft(text: string): void {
    setDraft(text);
    drafts.set(key, { text, digest: revision });
    setConfirm(null); setNotice(""); setTestNotice(""); setError(""); setTestResult(null);
  }
  function setConfig(config: HooksConfig): void { updateDraft(pretty(config)); }
  function accept(result: HooksCatalog, discard = false): void {
    const next = result.documents.find(d => d.scope === scope)!;
    const saved = discard ? undefined : drafts.get(key);
    setCatalog(result);
    setDraft(saved?.text ?? pretty(next.config));
    setRevision(saved?.digest ?? next.digest);
    if (discard) drafts.delete(key);
  }
  async function reload(discard = false): Promise<void> {
    if (!api || !workspacePath) { setLoading(false); return; }
    const request = ++generation.current;
    setLoading(true); setError(""); setConfirm(null); setTestResult(null);
    try {
      const result = await api.getHooksCatalog({ cwd: workspacePath });
      if (alive.current && generation.current === request) accept(result, discard);
    } catch { if (alive.current && generation.current === request) setError(copy.conflict); }
    finally { if (alive.current && generation.current === request) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    setCatalog(null); setConfirm(null); setNotice(""); setTestNotice(""); setTestResult(null); setBusy(false); setTesting(false);
    void reload();
    return () => { alive.current = false; generation.current++; };
  }, [workspacePath, scope]);
  useEffect(() => {
    if (!api?.onHooksChanged) return;
    return api.onHooksChanged(record => {
      setCatalog(current => {
        if (!current || current.cwd !== record.cwd) return current;
        const history = current.history.filter(r => r.id !== record.id);
        return { ...current, history: [...history, record].slice(-200) };
      });
    });
  }, [api]);

  async function perform(action: "save" | "trust" | "revoke" | "test"): Promise<void> {
    if (!api || !workspacePath || !document || busy) return;
    const request = generation.current;
    setBusy(true); setTesting(action === "test"); setError(""); setNotice(""); setTestNotice(""); setTestResult(null); setConfirm(null);
    try {
      if (action === "test") {
        const result = await api.testHooks({ cwd: workspacePath, scope, digest: document.digest, event, toolName });
        if (alive.current && generation.current === request) {
          setTestNotice(result.allowed ? copy.testPassed : copy.testDenied);
          setTestResult(result);
        }
      } else {
        const result = action === "save"
          ? await api.saveHooksConfig({ cwd: workspacePath, scope, expectedDigest: revision, config: parsed.config! })
          : await api.setHooksTrust({ cwd: workspacePath, scope, digest: document.digest, trusted: action === "trust" });
        if (!alive.current || generation.current !== request) return;
        accept(result, action === "save");
        if (action === "save") setNotice(copy.saved);
      }
    } catch { if (alive.current && generation.current === request) setError(copy.conflict); }
    finally { if (alive.current && generation.current === request) { setBusy(false); setTesting(false); } }
  }
  async function revokeRunningTest(): Promise<void> {
    if (!api || !workspacePath || !document || !testing) return;
    const request = generation.current;
    try {
      const result = await api.setHooksTrust({ cwd: workspacePath, scope, digest: document.digest, trusted: false });
      if (alive.current && generation.current === request) accept(result);
    } catch { if (alive.current && generation.current === request) setError(copy.conflict); }
  }
  function add(): void {
    const config = parsed.config ?? emptyHooksConfig();
    let id = `${event.toLowerCase()}-1`;
    for (let n = 2; config.hooks.some(h => h.id === id); n++) id = `${event.toLowerCase()}-${n}`;
    setConfig({ ...config, hooks: [...config.hooks, { id, event, command: "printf '%s\\n' '{\"decision\":\"allow\"}'", timeoutMs: 10000, enabled: false,
      ...(["PreToolUse", "PostToolUse", "PreCommit"].includes(event) ? { matcher: "*" } : {}) }] });
  }

  const ready = !!document && !loading;
  const enabledRules = document?.config.hooks.filter(h => h.enabled !== false) ?? [];
  const rules = parsed.config?.hooks ?? [];
  const eventOptions = hookEvents.map(value => ({ value, label: value }));
  const approveDisabled = !document || !!document.error || dirty || busy || loading || !document.config.hooks.length;

  if (!workspacePath) return <p className="settings-hint">{copy.unavailable}</p>;
  return <section className="settings-section hooks-settings" aria-busy={loading || busy}>
    <SettingsGroup>
      <SettingsBlock id="hooks-config" title={copy.scope} hint={ready ? document.path : copy.loading} layout="inline">
        <div className="settings-actions">
          <Segmented label={copy.scope} value={scope} options={[{ id: "global", label: copy.global }, { id: "project", label: copy.project }]} onChange={next => { if (!busy) setScope(next); }} />
          <button type="button" className="settings-secondary" disabled={busy || loading} onClick={() => { if (dirty) setConfirm("discard"); else void reload(); }}>{copy.refresh}</button>
        </div>
      </SettingsBlock>
      {confirm === "discard" ? <div className="hooks-confirm" role="group" aria-label={copy.discard}>
        <div className="settings-actions"><button type="button" className="settings-secondary settings-danger" onClick={() => void reload(true)}>{copy.discard}</button><button type="button" className="settings-secondary" onClick={() => setConfirm(null)}>{copy.cancel}</button></div>
      </div> : null}
      {ready ? <>
        <SettingsBlock title={copy.rules} hint={copy.restricted}>
          {document.error ? <p className="settings-error" role="alert">{copy.invalid}{document.error}</p> : null}
          {rules.length === 0 && !parsed.error ? <p className="settings-hint">{copy.empty}</p> : null}
          {rules.length ? <div className="hooks-rules">
            {rules.map((hook, index) => <div className="hooks-rule" key={hook.id}>
              <SettingsSwitch checked={hook.enabled !== false} disabled={busy} label={`${copy.enabled}: ${hook.id}`} onChange={enabled => setConfig({ ...parsed.config!, hooks: parsed.config!.hooks.map((h, i) => i === index ? { ...h, enabled } : h) })} />
              <div className="hooks-rule-text"><span className="hooks-rule-name">{hook.id}</span><span className="settings-hint">{hook.event}{hook.matcher ? ` · ${hook.matcher}` : ""}</span></div>
              <button type="button" className="settings-secondary settings-danger hooks-remove" disabled={busy} aria-label={`${copy.remove}: ${hook.id}`} onClick={() => setConfig({ ...parsed.config!, hooks: parsed.config!.hooks.filter((_, i) => i !== index) })}>{copy.remove}</button>
            </div>)}
          </div> : null}
        </SettingsBlock>
        <SettingsBlock title={copy.add} layout="inline">
          <div className="settings-actions">
            <SettingsSelect label={copy.event} value={event} options={eventOptions} onChange={value => { setEvent(value as HookEvent); setConfirm(null); }} disabled={busy} />
            <button type="button" className="settings-secondary" disabled={busy || !!parsed.error || rules.length >= 64} onClick={add}>{copy.add}</button>
          </div>
        </SettingsBlock>
        <SettingsBlock title={copy.config} hint={copy.schema} collapsible={{ defaultOpen: true }}>
          <textarea className="settings-textarea hooks-config" aria-label={copy.config} spellCheck={false} value={draft} disabled={busy} aria-describedby={parsed.error ? errorId : undefined} aria-invalid={!!parsed.error} onChange={e => updateDraft(e.target.value)} />
          {parsed.error ? <p id={errorId} className="settings-error" role="alert">{copy.invalid}{parsed.error}</p> : null}
        </SettingsBlock>
        <SettingsBlock title={copy.save} hint={dirty ? copy.dirty : notice || undefined} layout="inline">
          <button type="button" className="settings-secondary" disabled={!dirty || busy || !!parsed.error} onClick={() => void perform("save")}>{copy.save}</button>
        </SettingsBlock>
        {error ? <p className="settings-error hooks-message" role="alert">{error}</p> : null}
      </> : null}
    </SettingsGroup>

    <SettingsGroup title={copy.authorization}>
      <SettingsBlock id="hooks-trust" title={document?.trusted ? copy.trusted : copy.untrusted} hint={copy.warning} layout="inline">
        <button type="button" className={`settings-secondary${document?.trusted ? " settings-danger" : ""}`} disabled={document?.trusted ? !document || busy || loading : approveDisabled} onClick={() => document?.trusted ? void perform("revoke") : setConfirm("trust")}>{document?.trusted ? copy.revoke : copy.approve}</button>
      </SettingsBlock>
      {confirm === "trust" && document ? <div className="hooks-confirm" role="group" aria-label={copy.review}>
        <h4>{copy.review}</h4>
        {enabledRules.map(h => <div key={h.id}><p>{h.event} · {h.id}{h.matcher ? ` · ${h.matcher}` : ""} · {h.timeoutMs ?? 10000} ms</p><pre>{h.command}</pre></div>)}
        <p className="settings-hint">SHA-256: {document.digest}</p>
        <div className="settings-actions"><button type="button" className="settings-secondary" onClick={() => void perform("trust")}>{copy.confirm}</button><button type="button" className="settings-secondary" onClick={() => setConfirm(null)}>{copy.cancel}</button></div>
      </div> : null}
      <SettingsBlock title={copy.test} layout="inline">
        <button type="button" className="settings-secondary" disabled={!document?.trusted || dirty || busy || loading} onClick={() => setConfirm("test")}>{copy.test}</button>
      </SettingsBlock>
      {confirm === "test" ? <div className="hooks-confirm" role="group" aria-label={copy.test}>
        <p className="settings-hint">{copy.testWarning}</p>
        <SettingsSelect label={copy.event} value={event} options={eventOptions} onChange={value => setEvent(value as HookEvent)} />
        <Field label={copy.tool}><input className="settings-input" value={toolName} maxLength={256} onChange={e => setToolName(e.target.value)} /></Field>
        <p className="settings-hint">{copy.toolHint}</p>
        {!hasTestMatch ? <p className="settings-hint" role="status">{copy.noMatch}</p> : null}
        <div className="settings-actions"><button type="button" className="settings-secondary" disabled={!hasTestMatch || !/^[a-zA-Z0-9_.:/-]{1,256}$/.test(toolName)} onClick={() => void perform("test")}>{copy.runTest}</button><button type="button" className="settings-secondary" onClick={() => setConfirm(null)}>{copy.cancel}</button></div>
      </div> : null}
      {testing ? <div className="hooks-confirm"><button type="button" className="settings-secondary settings-danger" onClick={() => void revokeRunningTest()}>{copy.stopTest}</button></div> : null}
      {testNotice ? <p className="settings-hint hooks-message" role="status">{testNotice}</p> : null}
      {testResult && (testResult.reason || testResult.additionalContext) ? <details className="hooks-confirm"><summary>{copy.output}</summary><pre>{JSON.stringify({ reason: testResult.reason, additionalContext: testResult.additionalContext }, null, 2)}</pre></details> : null}
    </SettingsGroup>

    <SettingsGroup title={copy.history}>
      <p className="settings-hint hooks-message" data-setting-id="hooks-history">{catalog?.history.length ? copy.historyHint : copy.noHistory}</p>
      {catalog?.history.length ? <div className="hooks-history" role="log" aria-label={copy.history}>
        {[...catalog.history].reverse().map(run => <div className="hooks-run" key={run.id}>
          <div><strong>{run.event}</strong> · {run.scope === "global" ? copy.global : copy.project}/{run.hookId}{run.toolName ? ` · ${run.toolName}` : ""}<br /><span className="settings-hint">{new Date(run.startedAt).toLocaleTimeString(locale)}{run.agentId ? ` · ${run.agentId}` : ""} · {run.code}</span></div>
          <span className={run.status === "error" || run.status === "denied" ? "settings-error" : "settings-hint"}>{copy[run.status]} · {run.durationMs} ms</span>
        </div>)}
      </div> : null}
    </SettingsGroup>
  </section>;
}
