import type { BrowserImportPreview } from "@vela/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fillTemplate } from "../../hooks/useUpdates";
import { showToast } from "../../toast";
import type { SettingsCopy } from "../settings-copy";
import { SettingsBlock } from "./primitives";

const sitePageSize = 100;
type Source = "chrome" | "file";
type Phase = "idle" | Source | "stopping" | "importing";
type ImportError = "fileError" | "tooLarge" | "busyError" | "stale" | "importError" | "chromeUnavailable" | "chromeError";

function describeError(cause: unknown, fallback: ImportError): ImportError {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("BROWSER_CHROME_UNAVAILABLE")) return "chromeUnavailable";
  if (message.includes("BROWSER_IMPORT_TOO_LARGE")) return "tooLarge";
  if (message.includes("BROWSER_IMPORT_BUSY")) return "busyError";
  if (message.includes("BROWSER_IMPORT_STALE")) return "stale";
  return fallback;
}

export function ChromeImportBlock({ text }: { text: SettingsCopy["chromeImport"] }) {
  const api = window.vela?.browser;
  const mounted = useRef(false);
  const pendingId = useRef<string | null>(null);
  const activeCapture = useRef<{ cancelled: boolean } | null>(null);
  const [preview, setPreview] = useState<BrowserImportPreview | null>(null);
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState(new Set<string>());
  const [filter, setFilter] = useState("");
  const [siteLimit, setSiteLimit] = useState(sitePageSize);
  const [phase, setPhase] = useState<Phase>("idle");
  const busy = phase !== "idle";
  const stopChrome = useCallback((errorMessage?: string) => {
    const capture = activeCapture.current;
    if (!api || !capture || capture.cancelled) return;
    capture.cancelled = true;
    if (mounted.current) setPhase("stopping");
    void api.cancelChromeCapture().catch(() => {
      if (mounted.current && activeCapture.current === capture) {
        capture.cancelled = false;
        setPhase("chrome");
        if (errorMessage) showToast(errorMessage, { kind: "error" });
      }
    });
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopChrome();
      if (pendingId.current) void api?.cancelImport(pendingId.current).catch(() => {});
    };
  }, [api, stopChrome]);

  async function choose(source: Source) {
    if (!api || busy || activeCapture.current) return;
    const capture = source === "chrome" ? { cancelled: false } : null;
    activeCapture.current = capture;
    setPhase(source);
    try {
      const next = await (source === "chrome" ? api.captureChrome() : api.chooseImportFile());
      if (!next) return;
      if (!mounted.current || capture?.cancelled) {
        void api.cancelImport(next.id).catch(() => {});
        return;
      }
      pendingId.current = next.id;
      setPreview(next);
      setMode("all");
      setSelected(new Set());
      setFilter("");
      setSiteLimit(sitePageSize);
    } catch (cause) {
      if (mounted.current && !capture?.cancelled) showToast(text[describeError(cause, source === "chrome" ? "chromeError" : "fileError")], { kind: "error" });
    } finally {
      activeCapture.current = null;
      if (mounted.current) setPhase("idle");
    }
  }

  function cancel() {
    if (pendingId.current) void api?.cancelImport(pendingId.current).catch(() => {});
    pendingId.current = null;
    setPreview(null);
  }

  async function apply() {
    if (!api || busy || !preview || !pendingId.current || (mode === "selected" && !selected.size)) return;
    pendingId.current = null;
    setPhase("importing");
    try {
      const imported = await api.importSiteData(preview.id, mode === "all" ? null : [...selected]);
      if (mounted.current) {
        const summary = fillTemplate(text.result, imported.cookies, imported.localStorage);
        showToast(imported.skipped > 0 ? `${summary} ${fillTemplate(text.skipped, imported.skipped)}` : summary);
      }
    } catch (cause) {
      void api.cancelImport(preview.id).catch(() => {});
      if (mounted.current) showToast(text[describeError(cause, "importError")], { kind: "error" });
    } finally {
      if (mounted.current) {
        setPreview(null);
        setPhase("idle");
      }
    }
  }

  function toggleSite(site: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(site)) next.delete(site);
      else next.add(site);
      return next;
    });
  }

  const matchingSites = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const sites = preview?.sites ?? [];
    return query ? sites.filter(site => site.includes(query)) : sites;
  }, [preview, filter]);
  return <SettingsBlock id="chrome-site-data" title={text.title} hint={text.hint}>
    {preview ? <>
      <fieldset className="chrome-import-fields" disabled={busy}>
        <legend>{text.scope}</legend>
        <div className="settings-actions">
          <label><input type="radio" name="chrome-import-scope" checked={mode === "all"} onChange={() => setMode("all")} />
            {fillTemplate(text.allSites, preview.sites.length)}</label>
          <label><input type="radio" name="chrome-import-scope" checked={mode === "selected"} disabled={!preview.sites.length} onChange={() => setMode("selected")} />
            {text.selectedSites}</label>
        </div>
        {mode === "selected" && <>
          <p className="settings-hint">{text.matchHint}</p>
          <input type="search" className="settings-input" aria-label={text.search} placeholder={text.search}
            value={filter} onChange={event => { setFilter(event.target.value); setSiteLimit(sitePageSize); }} />
          <div className="chrome-import-sites">
            {matchingSites.slice(0, siteLimit).map(site => <label key={site}><input type="checkbox" checked={selected.has(site)}
              onChange={() => toggleSite(site)} /><bdi dir="ltr">{site}</bdi></label>)}
            {!matchingSites.length && <p className="settings-hint">{text.noMatches}</p>}
            {matchingSites.length > siteLimit && <button type="button" className="settings-secondary"
              onClick={() => setSiteLimit(limit => limit + sitePageSize)}>{text.showMore}</button>}
          </div>
        </>}
      </fieldset>
      <p className="settings-hint">{text.mergeHint}</p>
      <div className="settings-actions">
        <button type="button" className="primary-btn" disabled={busy || (mode === "selected" && !selected.size)}
          onClick={() => void apply()}>{busy ? text.importing : fillTemplate(text.apply, mode === "all" ? preview.sites.length : selected.size)}</button>
        <button type="button" className="settings-secondary" disabled={busy} onClick={cancel}>{text.cancel}</button>
      </div>
    </> : phase === "chrome" || phase === "stopping" ? <>
      <p className="settings-note" role="status">{phase === "stopping" ? text.stopping : text.waiting}</p>
      <div className="settings-actions"><button type="button" className="settings-secondary" disabled={phase === "stopping"}
        onClick={() => stopChrome(text.chromeError)}>{text.cancel}</button></div>
    </> : <>
      <div className="settings-actions">
        <button type="button" className="primary-btn" disabled={!api?.captureChrome || busy}
          onClick={() => void choose("chrome")}>{text.openChrome}</button>
        <button type="button" className="settings-secondary" disabled={!api?.chooseImportFile || busy}
          onClick={() => void choose("file")}>{phase === "file" ? text.reading : text.choose}</button>
      </div>
    </>}
  </SettingsBlock>;
}
