import type { SandboxProjectRecord } from "@vela/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localizeError } from "../../locale";
import type { SettingsCopy } from "../settings-copy";
import { SettingsBlock, SettingsGroup } from "./primitives";

/**
 * 审批记录:在审批卡片上点过「始终允许」「永远拒绝」的选择,按项目列出,可逐条删除或清空整个项目。
 * 数据直接来自主进程读到的记录文件,这里看到的就是实际生效的规则。
 */
export function ApprovalRecordsPage({ copy, workspacePath }: { copy: SettingsCopy; workspacePath: string | null }) {
  const text = copy.approvalRecords;
  const api = window.vela;
  const [records, setRecords] = useState<SandboxProjectRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async (action: () => Promise<SandboxProjectRecord[]>, failure: string) => {
    try {
      const next = await action();
      if (!alive.current) return;
      setRecords(next);
      setError(null);
    } catch (caught) {
      if (alive.current) setError(`${failure}:${localizeError(caught instanceof Error ? caught.message : String(caught))}`);
    }
  }, []);

  useEffect(() => {
    if (api?.listApprovalRecords) void run(() => api.listApprovalRecords(), text.loadError);
    else setRecords([]);
  }, [api, run, text.loadError]);

  // 当前项目排在最前,其余按路径。
  const sorted = useMemo(() => {
    const current = workspacePath?.replace(/\/+$/, "");
    return [...(records ?? [])].sort((a, b) => Number(b.workspace === current) - Number(a.workspace === current) || a.workspace.localeCompare(b.workspace));
  }, [records, workspacePath]);

  return (
    <section className="settings-section">
      <SettingsGroup>
        <SettingsBlock id="approval-records" title={text.title} hint={text.hint}>
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
          {records !== null && sorted.length === 0 ? <p className="settings-note">{text.empty}</p> : null}
          <div className="settings-stack">
            {sorted.map((record) => (
              <div className="approval-record" key={record.workspace}>
                <div className="approval-record-head">
                  <div className="settings-recent-main" title={record.workspace}>
                    <span className="settings-recent-name">{projectName(record.workspace)}</span>
                    <span className="settings-recent-path">{record.workspace}</span>
                  </div>
                  <button
                    type="button"
                    className="settings-secondary"
                    onClick={() => {
                      if (confirming !== record.workspace) { setConfirming(record.workspace); return; }
                      setConfirming(null);
                      void run(() => api!.clearApprovalRecords(record.workspace), text.updateError);
                    }}
                    onBlur={() => setConfirming((current) => (current === record.workspace ? null : current))}
                  >
                    {confirming === record.workspace ? text.confirmClear : text.clear}
                  </button>
                </div>
                <RuleList title={text.allowTitle} rules={record.allow} removeLabel={text.remove}
                  onRemove={(rule) => void run(() => api!.removeApprovalRecord(record.workspace, "allow", rule), text.updateError)} />
                <RuleList title={text.denyTitle} rules={record.deny} removeLabel={text.remove}
                  onRemove={(rule) => void run(() => api!.removeApprovalRecord(record.workspace, "deny", rule), text.updateError)} />
              </div>
            ))}
          </div>
        </SettingsBlock>
      </SettingsGroup>
    </section>
  );
}

function RuleList({ title, rules, removeLabel, onRemove }: { title: string; rules: string[]; removeLabel: string; onRemove: (rule: string) => void }) {
  if (rules.length === 0) return null;
  return (
    <div className="approval-record-list">
      <h4 className="approval-record-title">{title}</h4>
      {rules.map((rule) => (
        <div className="approval-record-rule" key={rule}>
          <code>{rule}</code>
          <button type="button" className="settings-secondary" aria-label={`${removeLabel} ${rule}`} onClick={() => onRemove(rule)}>{removeLabel}</button>
        </div>
      ))}
    </div>
  );
}

function projectName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
