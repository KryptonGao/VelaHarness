import { checkpointRetention, type CheckpointSettings, type CheckpointStorageUsage } from "@vela/shared";
import { useCallback, useEffect, useState } from "react";
import { fillTemplate } from "../../hooks/useUpdates";
import { localizeError } from "../../locale";
import type { SettingsCopy } from "../settings-copy";
import { SettingsBlock, SettingsSwitch } from "./primitives";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function StoragePage({ copy }: { copy: SettingsCopy }) {
  const text = copy.storage;
  const api = window.vela;
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
      setNotice(result.freedBytes > 0 || result.removedPoints > 0
        ? fillTemplate(removeAll ? text.deleted : text.cleaned, formatBytes(result.freedBytes), result.removedPoints)
        : removeAll ? text.nothingToDelete : text.nothingToClean);
    } catch (reason) { failure(reason); }
    finally { setBusy(false); }
  }

  async function toggle(enabled: boolean): Promise<void> {
    if (busy) return;
    setError(null);
    try { setSettings(await api!.setCheckpointSettings({ enabled })); }
    catch (reason) { failure(reason); }
  }

  return <section className="settings-section" aria-busy={busy}>
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
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
  </section>;
}
