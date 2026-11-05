import {
  checkpointRetention, isCleanableStorageCategory, storageCategoryIds,
  type CheckpointSettings, type CheckpointStorageUsage, type CleanableStorageCategory,
  type StorageCleanResult, type StorageDisk, type StorageOverview,
} from "@vela/shared";
import { useCallback, useEffect, useState } from "react";
import { fillTemplate } from "../../hooks/useUpdates";
import { localizeError } from "../../locale";
import "../../storage.css";
import type { SettingsCopy } from "../settings-copy";
import { SettingsBlock, SettingsGroup, SettingsSwitch } from "./primitives";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

type Pending = { kind: "clean"; category: CleanableStorageCategory } | { kind: "trace"; id: string };

export function StoragePage({ copy }: { copy: SettingsCopy }) {
  const text = copy.storage;
  const api = window.vela;
  const storage = api?.storage;
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [disk, setDisk] = useState<StorageDisk | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewNotice, setOverviewNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<CheckpointStorageUsage | null>(null);
  const [settings, setSettings] = useState<CheckpointSettings | null>(null);
  const [confirming, setConfirming] = useState<"clean" | "delete" | false>(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failure = useCallback((reason: unknown) => {
    const message = reason instanceof Error
      ? reason.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
      : text.failed;
    setError(localizeError(message));
  }, [text.failed]);
  const loadOverview = useCallback(async () => {
    if (!storage) return;
    try { setOverview(await storage.getOverview()); }
    catch (reason) { failure(reason); }
  }, [storage, failure]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  // 磁盘容量读取很快，先显示出来，分类明细统计完再补上。
  useEffect(() => {
    let active = true;
    void storage?.getDisk().then(next => { if (active) setDisk(next); }).catch(() => undefined);
    return () => { active = false; };
  }, [storage]);
  useEffect(() => {
    let active = true;
    void api?.getCheckpointStorage?.().then(next => { if (active) setUsage(next); }).catch(reason => { if (active) failure(reason); });
    void api?.getCheckpointSettings().then(next => { if (active) setSettings(next); }).catch(reason => { if (active) failure(reason); });
    return () => { active = false; };
  }, [api, failure]);
  if (!api?.getCheckpointStorage) return <section className="settings-section"><p className="settings-note">{text.unavailable}</p></section>;

  async function clean(removeAll: boolean): Promise<void> {
    if (busy) return;
    setBusy(true); setConfirming(false); setNotice(null); setError(null);
    try {
      const result = await (removeAll ? api!.deleteCheckpointStorage() : api!.cleanCheckpointStorage());
      setUsage(result.usage);
      void loadOverview();
      setNotice(result.freedBytes > 0 || result.removedPoints > 0
        ? fillTemplate(removeAll ? text.deleted : text.cleaned, formatBytes(result.freedBytes), result.removedPoints)
        : removeAll ? text.nothingToDelete : text.nothingToClean);
    } catch (reason) { failure(reason); }
    finally { setBusy(false); }
  }

  async function runOverview(action: () => Promise<StorageCleanResult>): Promise<void> {
    if (overviewBusy || !storage) return;
    setOverviewBusy(true); setPending(null); setOverviewNotice(null); setError(null);
    try {
      const result = await action();
      setOverview(result.overview);
      setOverviewNotice(result.removedFiles === 0 && result.skipped === 0 ? text.nothingToClean
        : result.removedFiles === 0 ? fillTemplate(text.skippedOnly, result.skipped)
        : result.skipped > 0 ? fillTemplate(text.freedSkipped, formatBytes(result.freedBytes), result.removedFiles, result.skipped)
        : fillTemplate(text.freed, formatBytes(result.freedBytes), result.removedFiles));
    } catch (reason) { failure(reason); }
    finally { setOverviewBusy(false); }
  }

  async function reveal(category: StorageOverview["categories"][number]["id"]): Promise<void> {
    try { await storage!.reveal(category); } catch (reason) { failure(reason); }
  }

  async function toggle(enabled: boolean): Promise<void> {
    if (busy) return;
    setError(null);
    try { setSettings(await api!.setCheckpointSettings({ enabled })); }
    catch (reason) { failure(reason); }
  }

  const categories = overview ? [...overview.categories].sort((a, b) => b.bytes - a.bytes) : [];
  const shown = categories.filter(category => category.bytes > 0);

  return <section className="settings-section" aria-busy={busy || overviewBusy}>
    <SettingsGroup>
    {storage ? <>
      <SettingsBlock id="storage-overview" title={text.overviewTitle} hint={text.overviewHint}>
        {disk ? <div className="storage-disk">
          <div className="storage-disk-line">
            <strong>{fillTemplate(text.diskUsed, formatBytes(disk.totalBytes - disk.freeBytes), formatBytes(disk.totalBytes))}</strong>
          </div>
          <div className="storage-bar storage-bar-disk" role="img" aria-label={fillTemplate(text.diskUsed, formatBytes(disk.totalBytes - disk.freeBytes), formatBytes(disk.totalBytes))}>
            <span className="storage-seg storage-c-system" style={{ flexGrow: Math.max(0, disk.totalBytes - disk.freeBytes - (overview?.totalBytes ?? 0)) }} />
            {overview ? <span className="storage-seg storage-c-vela" style={{ flexGrow: overview.totalBytes, minWidth: 4 }} /> : null}
            <span className="storage-seg storage-c-free" style={{ flexGrow: disk.freeBytes }} />
          </div>
        </div> : null}
        <div className="storage-total">
          <strong>{overview ? fillTemplate(text.total, formatBytes(overview.totalBytes)) : text.calculatingVela}</strong>
          <button className="settings-secondary" type="button" disabled={overviewBusy || !overview} onClick={() => { setOverviewNotice(null); void loadOverview(); }}>{text.refresh}</button>
        </div>
        {overview && overview.totalBytes > 0 ? <div className="storage-bar" role="img" aria-label={text.overviewTitle}>
          {shown.map(category => <span key={category.id} className={`storage-seg storage-c-${category.id}`} style={{ flexGrow: category.bytes }} title={`${text.categories[category.id].label} · ${formatBytes(category.bytes)}`} />)}
        </div> : null}
        <ul className="storage-list">
          {overview ? null : storageCategoryIds.map(id => <li key={id} className="storage-row" aria-hidden="true">
            <span className={`storage-dot storage-c-${id}`} />
            <div className="storage-row-main"><span className="storage-row-label">{text.categories[id].label}</span></div>
            <span className="storage-row-size storage-pending">…</span>
          </li>)}
          {categories.map(category => {
            const id = category.id;
            const label = text.categories[id].label;
            const confirming = pending?.kind === "clean" && pending.category === category.id;
            return <li key={category.id} className="storage-row">
              <span className={`storage-dot storage-c-${category.id}`} aria-hidden="true" />
              <div className="storage-row-main">
                <span className="storage-row-label">{label}</span>
                <span className="storage-row-hint">{confirming && pending?.kind === "clean" ? text.cleanConfirms[pending.category] : text.categories[category.id].hint}</span>
              </div>
              <span className="storage-row-size">{formatBytes(category.bytes)}</span>
              <div className="storage-row-actions">
                {confirming && pending?.kind === "clean" ? <>
                  <button className="primary-btn" type="button" disabled={overviewBusy} onClick={() => void runOverview(() => storage.clean(pending.category))}>{text.confirm}</button>
                  <button className="settings-secondary" type="button" disabled={overviewBusy} onClick={() => setPending(null)}>{text.cancel}</button>
                </> : isCleanableStorageCategory(id) ? <>
                  <button className="settings-secondary" type="button" disabled={overviewBusy || category.bytes === 0} aria-label={`${text.clean} ${label}`} onClick={() => { setOverviewNotice(null); setPending({ kind: "clean", category: id }); }}>{text.clean}</button>
                </> : category.id === "checkpoints" ? <span className="storage-row-note">{text.manageBelow}</span>
                  : <button className="settings-secondary" type="button" aria-label={`${text.reveal} ${label}`} onClick={() => void reveal(category.id)}>{text.reveal}</button>}
              </div>
            </li>;
          })}
        </ul>
        {overviewNotice ? <p className="settings-saved" role="status">{overviewNotice}</p> : null}
      </SettingsBlock>
      <SettingsBlock id="storage-conversations" title={text.conversationsTitle} hint={text.conversationsHint}>
        {overview && overview.conversations.length === 0 ? <p className="settings-note">{text.noConversations}</p> : null}
        <ul className="storage-list">
          {(overview?.conversations ?? []).map(item => {
            const confirming = pending?.kind === "trace" && pending.id === item.id;
            return <li key={item.id} className="storage-row">
              <div className="storage-row-main">
                <span className="storage-row-label">{item.title ?? text.untitled}</span>
                <span className="storage-row-hint">
                  {confirming ? text.cleanConfirms.traces : fillTemplate(text.traceSize, formatBytes(item.traceBytes))}
                </span>
              </div>
              <span className="storage-row-size">{formatBytes(item.bytes)}</span>
              <div className="storage-row-actions">
                {confirming ? <>
                  <button className="primary-btn" type="button" disabled={overviewBusy} onClick={() => void runOverview(() => storage.deleteTrace(item.id))}>{text.confirm}</button>
                  <button className="settings-secondary" type="button" disabled={overviewBusy} onClick={() => setPending(null)}>{text.cancel}</button>
                </> : item.traceInUse ? <span className="storage-row-note">{text.inUse}</span>
                  : <button className="settings-secondary" type="button" disabled={overviewBusy || item.traceBytes === 0} onClick={() => { setOverviewNotice(null); setPending({ kind: "trace", id: item.id }); }}>{text.deleteTrace}</button>}
              </div>
            </li>;
          })}
        </ul>
      </SettingsBlock>
    </> : null}
    <SettingsBlock
      id="checkpoint-storage"
      title={text.checkpointsTitle}
      hint={fillTemplate(text.checkpointsHint, checkpointRetention.maxPointsPerConversation, formatBytes(checkpointRetention.maxBytes))}
    >
      <>
        <div className="settings-switch-row">
          <span>{text.enable}</span>
          <SettingsSwitch checked={settings?.enabled ?? true} label={text.enable} disabled={busy || !settings} onChange={next => void toggle(next)} />
        </div>
        <p className="settings-note">{settings?.enabled === false ? text.disabledHint : text.enabledHint}</p>
      </>
      <p className="settings-note" role="status">
        {usage ? fillTemplate(text.usage, formatBytes(usage.bytes), usage.conversations, usage.points) : text.measuring}
      </p>
      {confirming ? <p className="settings-note">{confirming === "delete" ? text.deleteConfirmHint : text.confirmHint}</p> : null}
      <div className="settings-actions">
        {confirming ? <>
          <button className="primary-btn" type="button" disabled={busy} onClick={() => void clean(confirming === "delete")}>
            {confirming === "delete" ? text.deleteConfirm : text.confirm}
          </button>
          <button className="settings-secondary" type="button" disabled={busy} onClick={() => setConfirming(false)}>{text.cancel}</button>
        </> : <>
          <button className="settings-secondary" type="button" disabled={busy || !usage} onClick={() => { setNotice(null); setConfirming("clean"); }}>
            {busy ? text.cleaning : text.clean}
          </button>
          <button className="settings-secondary" type="button" disabled={busy || !usage || usage.points === 0} onClick={() => { setNotice(null); setConfirming("delete"); }}>
            {text.deleteAll}
          </button>
        </>}
      </div>
      {notice ? <p className="settings-saved" role="status">{notice}</p> : null}
    </SettingsBlock>
    </SettingsGroup>
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
  </section>;
}
