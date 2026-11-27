import { useEffect, useState } from "react";
import type { ResidentAgentApi, ResidentNotificationSettings, ResidentSettingsPatch } from "@vela/shared";
import { SettingsBlock, SettingsSwitch } from "./settings/primitives";
import { tr } from "../locale";
import { showToast } from "../toast";
import { formatMinute, parseMinute } from "./resident-agent-model";

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export function ResidentToggle({ label, hint, checked, disabled, onChange }: ToggleProps) {
  return <label className="resident-row">
    <span className="resident-row-text"><span>{label}</span>{hint ? <small>{hint}</small> : null}</span>
    <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
  </label>;
}

function SettingsToggleRow({ label, hint, ...control }: ToggleProps) {
  return <SettingsBlock title={label} hint={hint} layout="inline">
    <SettingsSwitch label={label} {...control} />
  </SettingsBlock>;
}

export function NotificationSettings({ api, layout }: { api?: ResidentAgentApi; layout: "settings" | "resident" }) {
  const Toggle = layout === "settings" ? SettingsToggleRow : ResidentToggle;
  const [notify, setNotify] = useState<ResidentNotificationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.getSettings().then(settings => { if (live) { setNotify(settings.notifications); setLoadError(null); } },
      reason => { if (live) setLoadError(String(reason)); });
    return () => { live = false; };
  }, [api]);

  if (!api) return <p role="status">{tr("Vela API 不可用", "Vela API unavailable")}</p>;
  if (!notify) return <p role="status">{loadError ?? tr("正在读取…", "Loading…")}</p>;
  const update = async (patch: ResidentSettingsPatch) => {
    try {
      setNotify((await api.updateSettings(patch)).notifications);
    } catch (reason) { showToast(String(reason), { kind: "error" }); }
  };
  const quiet = notify.quietHours;
  const timeFields = quiet.enabled && notify.enabled && (["startMinute", "endMinute"] as const).map(key => {
    const label = key === "startMinute" ? tr("开始", "From") : tr("结束", "To");
    const input = <input type="time" aria-label={label} className={layout === "settings" ? "settings-input" : undefined}
      value={formatMinute(quiet[key])} onChange={event => {
        const minute = parseMinute(event.target.value);
        if (minute !== null) void update({ notifications: { quietHours: { [key]: minute } } });
      }} />;
    return layout === "settings"
      ? <SettingsBlock key={key} title={label} layout="inline">{input}</SettingsBlock>
      : <label key={key}><span>{label}</span>{input}</label>;
  });
  return <>
    {loadError && <p className="agent-inbox-notice" role="alert">{loadError}</p>}
    <Toggle label={tr("系统通知", "System notifications")} hint={tr("离开对应对话时，接收审批请求和其他待处理事项的提醒。", "Get alerts for approvals and other items that need attention when you’re away from their conversation.")}
      checked={notify.enabled} onChange={value => update({ notifications: { enabled: value } })} />
    <Toggle label={tr("隐藏通知内容", "Hide notification previews")} hint={tr("通知里不显示命令、路径和回答，只提示有事项。", "Notifications won't show commands, paths or answers.")}
      checked={notify.hidePreview} disabled={!notify.enabled} onChange={value => update({ notifications: { hidePreview: value } })} />
    <Toggle label={tr("任务完成时也提醒", "Also notify when tasks finish")} hint={tr("只影响普通任务结果，不影响 Resident 的事件回复。", "Applies to regular task results, not Resident event replies.")}
      checked={notify.notifyResults} disabled={!notify.enabled} onChange={value => update({ notifications: { notifyResults: value } })} />
    <Toggle label={tr("静默时段", "Quiet hours")} hint={tr("这段时间不弹通知，事项仍会进入收件箱。", "No notifications in this window. Items still land in the Inbox.")}
      checked={quiet.enabled} disabled={!notify.enabled} onChange={value => update({ notifications: { quietHours: { enabled: value } } })} />
    {timeFields && (layout === "resident" ? <div className="resident-row resident-quiet">{timeFields}</div> : timeFields)}
  </>;
}
