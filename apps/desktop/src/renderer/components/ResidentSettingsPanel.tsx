import { useEffect, useRef, useState } from "react";
import { residentLimits, thinkingLevels, type ModelCatalog, type ResidentAgentApi, type ResidentSettings, type ResidentSettingsPatch } from "@vela/shared";
import { tr } from "../locale";
import { showToast } from "../toast";
import { thinkingLabel } from "./ModelControls";
import { NotificationSettings, ResidentToggle as Toggle } from "./NotificationSettings";

function NumberRow({ label, hint, value, min, max, unit, disabled, onCommit }: {
  label: string; hint?: string; value: number; min: number; max: number; unit?: string; disabled?: boolean; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <label className="resident-row">
    <span className="resident-row-text"><span>{label}</span>{hint ? <small>{hint}</small> : null}</span>
    <span className="resident-number">
      <input type="number" inputMode="numeric" min={min} max={max} value={draft} disabled={disabled}
        onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} />
      {unit ? <span aria-hidden="true">{unit}</span> : null}
    </span>
  </label>;
}

const modelValue = (model: { provider: string; id: string }) => JSON.stringify([model.provider, model.id]);

/** 常驻对话和它的后台任务用哪个模型、多强的推理。留空表示沿用新对话的默认设置。 */
function ModelFields({ settings, catalog, catalogError, onChange }: {
  settings: ResidentSettings; catalog: ModelCatalog | null; catalogError: string | null; onChange: (patch: ResidentSettingsPatch) => void;
}) {
  const chosen = settings.model;
  const selected = chosen ? catalog?.models.find(item => item.provider === chosen.provider && item.id === chosen.id) : undefined;
  const missing = Boolean(chosen && catalog && !selected?.available);
  const levels = selected ? selected.thinkingLevels : thinkingLevels;
  const effort = settings.thinkingLevel;
  return <>
    <label className="resident-row">
      <span className="resident-row-text"><span>{tr("模型", "Model")}</span></span>
      <select value={chosen ? modelValue(chosen) : ""} onChange={event => {
        const next = event.target.value;
        if (!next) { onChange({ model: null }); return; }
        const [provider, id] = JSON.parse(next) as [string, string];
        // 新模型不支持当前强度时一并清回默认，避免保存一个无效组合。
        const supported = catalog?.models.find(item => item.provider === provider && item.id === id)?.thinkingLevels;
        onChange(effort && supported && !supported.includes(effort) ? { model: { provider, id }, thinkingLevel: null } : { model: { provider, id } });
      }}>
        <option value="">{tr("沿用应用设置", "Use app settings")}</option>
        {chosen && missing ? <option value={modelValue(chosen)}>{chosen.provider} / {chosen.id} · {tr("不可用", "Unavailable")}</option> : null}
        {catalog?.models.filter(item => item.available || (chosen && item.provider === chosen.provider && item.id === chosen.id)).map(item =>
          <option key={modelValue(item)} value={modelValue(item)}>{item.providerName} / {item.name}</option>)}
      </select>
    </label>
    <label className="resident-row">
      <span className="resident-row-text"><span>{tr("推理强度", "Reasoning effort")}</span></span>
      <select value={effort ?? ""} onChange={event => onChange({ thinkingLevel: (event.target.value || null) as ResidentSettings["thinkingLevel"] })}>
        <option value="">{tr("沿用应用设置", "Use app settings")}</option>
        {effort && !levels.includes(effort) ? <option value={effort} disabled>{tr("当前强度不受支持", "Current effort is unsupported")}</option> : null}
        {levels.map(level => <option key={level} value={level}>{thinkingLabel(level)}</option>)}
      </select>
    </label>
    <p className="agent-inbox-muted">{tr("用于常驻对话和它的后台任务。空闲的常驻对话立即换上；正在回复的从下一条消息开始。", "Used by the resident chat and its background tasks. An idle chat switches right away; one that is replying switches on its next message.")}</p>
    {catalogError || catalog?.error ? <p className="agent-inbox-notice" role="alert">{catalogError ?? catalog?.error}</p> : null}
  </>;
}

/** 设置面板。每次修改都立刻交给主进程规整并保存，界面始终显示主进程返回的结果。 */
export function ResidentSettingsPanel({ api, settings, onSettings, catalog = null, catalogError = null }: {
  api: ResidentAgentApi; settings: ResidentSettings; onSettings: (settings: ResidentSettings) => void; catalog?: ModelCatalog | null; catalogError?: string | null;
}) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const update = (patch: ResidentSettingsPatch) => {
    // 串行提交：快速连续修改不会因为乱序返回而回退。
    queue.current = queue.current.then(async () => {
      try { onSettings(await api.updateSettings(patch)); }
      catch (reason) { showToast(reason instanceof Error ? reason.message : String(reason), { kind: "error" }); }
    });
  };
  const { limits } = settings;
  return <div className="resident-settings">
    <fieldset>
      <legend>{tr("模型与推理强度", "Model and reasoning effort")}</legend>
      <ModelFields settings={settings} catalog={catalog} catalogError={catalogError} onChange={update} />
    </fieldset>

    <fieldset>
      <legend>{tr("后台运行", "Running in the background")}</legend>
      <Toggle label={tr("在菜单栏显示状态", "Show status in the menu bar")} hint={tr("显示待处理数量，并可一键暂停后台任务。", "Shows the pending count and a one-click pause.")}
        checked={settings.showMenuBarIcon} onChange={value => update({ showMenuBarIcon: value })} />
      <Toggle label={tr("登录时自动启动", "Launch at login")} hint={tr("开机后在后台启动，不打开窗口。仅安装版有效。", "Starts in the background at login without opening a window. Installed app only.")}
        checked={settings.launchAtLogin} onChange={value => update({ launchAtLogin: value })} />
      <Toggle label={tr("关闭所有窗口时退出应用", "Quit when all windows are closed")} hint={tr("关闭后，后台任务、通知和主动规则都会随应用停止。", "When on, background tasks, notifications and rules stop with the app.")}
        checked={settings.quitWhenWindowsClosed} onChange={value => update({ quitWhenWindowsClosed: value })} />
      <p className="agent-inbox-muted">{tr("Vela 只在应用运行时工作：退出应用或电脑休眠时，正在运行的任务会暂停或中断，不会自动重放。", "Vela only works while the app runs. Quitting or sleeping pauses or interrupts running tasks, and they are never replayed automatically.")}</p>
    </fieldset>

    <fieldset>
      <legend>{tr("通知", "Notifications")}</legend>
      <NotificationSettings api={api} layout="resident" />
    </fieldset>

    <fieldset>
      <legend>{tr("资源限制", "Limits")}</legend>
      <NumberRow label={tr("同时运行的任务数", "Concurrent tasks")} value={limits.maxConcurrentTasks} min={residentLimits.maxConcurrentTasks.min} max={residentLimits.maxConcurrentTasks.max}
        onCommit={value => update({ limits: { maxConcurrentTasks: value } })} />
      <NumberRow label={tr("单个任务最长运行时间", "Longest a task may run")} value={limits.maxTaskMinutes} min={residentLimits.maxTaskMinutes.min} max={residentLimits.maxTaskMinutes.max} unit={tr("分钟", "min")}
        hint={tr("超时的任务会被停止，并在收件箱里标记为失败。", "Tasks past the limit are stopped and reported as failures in the Inbox.")}
        onCommit={value => update({ limits: { maxTaskMinutes: value } })} />
      <NumberRow label={tr("每天最多主动运行", "Proactive runs per day")} value={limits.dailyProactiveRuns} min={residentLimits.dailyProactiveRuns.min} max={residentLimits.dailyProactiveRuns.max} unit={tr("次", "runs")}
        hint={tr("每次主动运行都会调用模型。设为 0 则不允许主动触发。", "Each proactive run calls the model. 0 disables proactive triggers.")}
        onCommit={value => update({ limits: { dailyProactiveRuns: value } })} />
      <NumberRow label={tr("每天最多事件唤醒", "Event wakes per day")} value={limits.maxWakesPerDay} min={residentLimits.maxWakesPerDay.min} max={residentLimits.maxWakesPerDay.max}
        hint={tr("限制事件唤醒调用模型的次数。设为 0 可关闭，不影响主动规则。", "Limits model calls triggered by events. 0 disables event wakes without changing proactive rules.")}
        onCommit={value => update({ limits: { maxWakesPerDay: value } })} />
      <Toggle label={tr("电池供电时暂停主动任务", "Pause proactive runs on battery")} checked={limits.pauseProactiveOnBattery}
        onChange={value => update({ limits: { pauseProactiveOnBattery: value } })} />
      <p className="agent-inbox-muted">{tr("后台任务不会使用「完全访问」：即使全局设置为完全访问，也会按「帮我批准」运行。", "Background tasks never run with Full access: even if it's your global setting, they use Smart approval.")}</p>
    </fieldset>
  </div>;
}
