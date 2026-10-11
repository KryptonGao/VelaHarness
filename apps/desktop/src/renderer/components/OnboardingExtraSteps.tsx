import { isUiPreference, residentModes, type ResidentMode, type ResidentSettings, type ResidentSettingsPatch, type UiPreference, type UpdateState } from "@vela/shared";
import { useEffect, useState } from "react";
import type { InfoLayout, PreferencesApi } from "../hooks/usePreferences";
import { tr } from "../locale";
import { uiCopy } from "./intelligent-ui/copy";
import { publishIntelligentUiState } from "./intelligent-ui/ui-settings-store";
import { modeDescription, modeLabel } from "./resident-agent-model";
import type { OnboardingCopy } from "./onboarding-copy";
import { Label, Note, Opt, Seg, ToggleRow } from "./onboarding-ui";
import type { SettingsCopy } from "./settings-copy";

/** 第 3 步：信息栏位置（边栏或悬浮）与交互式界面偏好。 */
export function LayoutStep({ copy, preferences }: { copy: OnboardingCopy; preferences: PreferencesApi }) {
  const [preference, setPreference] = useState<UiPreference | null>(null);
  const [failed, setFailed] = useState(false);
  const text = uiCopy.setting;

  useEffect(() => {
    let active = true;
    void window.vela?.getIntelligentUi().then(
      (value) => {
        if (!active) return;
        if (isUiPreference(value?.preference)) setPreference(value.preference);
        publishIntelligentUiState(value);
      },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, []);

  function changeUi(next: UiPreference): void {
    const previous = preference;
    setPreference(next);
    setFailed(false);
    void window.vela?.setIntelligentUi(next).then(
      (value) => { setPreference(value.preference); publishIntelligentUiState(value); },
      () => { setPreference(previous); setFailed(true); },
    );
  }

  const hints: Record<UiPreference, string> = { auto: text.autoHint(), text_only: text.textOnlyHint(), visual_first: text.visualFirstHint() };
  const current = preference ?? "auto";
  return (
    <>
      <div className="ob-two" role="radiogroup" aria-label={copy.layoutGroup} style={{ marginTop: 20 }}>
        <LayoutCard value="sidebar" selected={preferences.infoLayout === "sidebar"} title={copy.infoSidebar} hint={copy.infoSidebarHint} chat={copy.layoutChat} info={copy.layoutInfo} onPick={preferences.setInfoLayout} />
        <LayoutCard value="floating" selected={preferences.infoLayout === "floating"} title={copy.infoFloating} hint={copy.infoFloatingHint} chat={copy.layoutChat} info={copy.layoutInfo} onPick={preferences.setInfoLayout} />
      </div>
      <Label title={copy.interactiveGroup} hint={text.description()} style={{ marginTop: 26 }} />
      <Seg<UiPreference>
        label={text.title()}
        value={current}
        options={[
          { id: "auto", label: text.auto() },
          { id: "text_only", label: text.textOnly() },
          { id: "visual_first", label: text.visualFirst() },
        ]}
        onChange={changeUi}
      />
      <p className={failed ? "ob-hint error" : "ob-hint"} role={failed ? "alert" : undefined}>{failed ? uiCopy.cannotSave() : hints[current]}</p>
    </>
  );
}

function LayoutCard({ value, selected, title, hint, chat, info, onPick }: {
  value: InfoLayout;
  selected: boolean;
  title: string;
  hint: string;
  chat: string;
  info: string;
  onPick: (value: InfoLayout) => void;
}) {
  return (
    <Opt selected={selected} onClick={() => onPick(value)} className="pick">
      <b>{title}</b><span>{hint}</span>
      <span className={`ob-lay ${value}`} aria-hidden="true">
        <span className="a" /><span className="b">{chat}</span><span className="c">{info}</span>
      </span>
    </Opt>
  );
}

/** 第 7 步：记忆开关与额外指令。记忆开关立即生效，指令随「继续」保存。 */
export function PersonalizeStep({ copy, settings, instructions, onInstructions, disabled }: {
  copy: OnboardingCopy;
  settings: SettingsCopy;
  instructions: string;
  onInstructions: (value: string) => void;
  disabled: boolean;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.vela?.memory;
    if (!api) { setError(copy.memoryUnavailable); return; }
    let active = true;
    void api.list().then(
      (result) => {
        if (!active) return;
        if (result.ok) setEnabled(result.value.enabled);
        else setError(copy.memoryUnavailable);
      },
      () => { if (active) setError(copy.memoryUnavailable); },
    );
    return () => { active = false; };
  }, [copy.memoryUnavailable]);

  async function toggle(next: boolean): Promise<void> {
    const api = window.vela?.memory;
    if (!api) return;
    const previous = enabled;
    setEnabled(next);
    setError(null);
    try {
      const result = await api.setEnabled({ enabled: next });
      if (result.ok) setEnabled(result.value.enabled);
      else { setEnabled(previous); setError(copy.backgroundSaveError); }
    } catch {
      setEnabled(previous);
      setError(copy.backgroundSaveError);
    }
  }

  return (
    <>
      <Label title={copy.memoryTitle} />
      <div className="ob-sheet tilt-l">
        <ToggleRow title={settings.memory.enabledLabel} hint={copy.memoryHint} checked={enabled === true} disabled={enabled === null || disabled} onChange={(next) => void toggle(next)} />
      </div>
      {error ? <p className="ob-hint error" role="alert">{error}</p> : null}
      <Label title={copy.instructionsTitle} hint={settings.agent.instructionsHint} style={{ marginTop: 26 }} />
      <textarea
        className="ob-lined"
        rows={5}
        value={instructions}
        maxLength={8000}
        placeholder={settings.agent.instructionsPlaceholder}
        aria-label={copy.instructionsTitle}
        disabled={disabled}
        onChange={(event) => onInstructions(event.target.value)}
      />
    </>
  );
}

/** 第 8 步：常驻 Agent、通知、自动更新。每一项改动都立即交给主进程保存。 */
export function BackgroundStep({ copy, settings, resident, onResident, update, onUpdate }: {
  copy: OnboardingCopy;
  settings: SettingsCopy;
  resident: ResidentSettings | null;
  onResident: (value: ResidentSettings) => void;
  update: UpdateState | null;
  onUpdate: (value: UpdateState) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const residentApi = window.vela?.resident;
  const updatesApi = window.vela?.updates;

  async function patchResident(patch: ResidentSettingsPatch): Promise<void> {
    if (!residentApi) return;
    setError(null);
    try { onResident(await residentApi.updateSettings(patch)); }
    catch { setError(copy.backgroundSaveError); }
  }

  async function setAutoUpdate(next: boolean): Promise<void> {
    if (!updatesApi) return;
    setError(null);
    try { onUpdate(await updatesApi.setAutoUpdate(next)); }
    catch { setError(copy.backgroundSaveError); }
  }

  const mode = resident?.mode ?? "standby";
  return (
    <div className="ob-split">
      <div>
        <Label title={copy.residentTitle} hint={copy.residentHint} />
        {residentApi && resident ? (
          <>
            <Seg<ResidentMode> label={copy.residentTitle} value={mode} options={residentModes.map((id) => ({ id, label: modeLabel(id) }))} onChange={(next) => void patchResident({ mode: next })} />
            <p className="ob-hint">{modeDescription(mode)}</p>
            <div className="ob-sheet tilt-l" style={{ marginTop: 14 }}>
              <ToggleRow
                title={tr("在菜单栏显示状态", "Show status in the menu bar")}
                hint={tr("显示待处理数量，并可一键暂停后台任务。", "Shows the pending count and a one-click pause.")}
                checked={resident.showMenuBarIcon} disabled={mode === "disabled"}
                onChange={(next) => void patchResident({ showMenuBarIcon: next })}
              />
              <ToggleRow
                title={tr("登录时自动启动", "Launch at login")}
                hint={tr("开机后在后台启动，不打开窗口。仅安装版有效。", "Starts in the background at login without opening a window. Installed app only.")}
                checked={resident.launchAtLogin} disabled={mode === "disabled"}
                onChange={(next) => void patchResident({ launchAtLogin: next })}
              />
              <ToggleRow
                title={tr("系统通知", "System notifications")}
                hint={tr("有事项需要你处理时提醒；应用在前台时不打扰。", "Alerts you when something needs attention. Stays quiet while the app is in front.")}
                checked={resident.notifications.enabled} disabled={mode === "disabled"}
                onChange={(next) => void patchResident({ notifications: { enabled: next } })}
              />
            </div>
          </>
        ) : <p className="ob-hint">{residentApi ? "…" : copy.residentUnavailable}</p>}
      </div>
      <div>
        <Label title={copy.updatesTitle} />
        {updatesApi && update ? (
          <div className="ob-sheet tilt-r"><ToggleRow title={settings.updates.autoTitle} hint={settings.updates.autoHint} checked={update.autoUpdate} onChange={(next) => void setAutoUpdate(next)} /></div>
        ) : <p className="ob-hint">{updatesApi ? "…" : copy.updatesUnavailable}</p>}
        <Note tone="sun" style={{ marginTop: 30 }}>{copy.permissionsNote}</Note>
        {error ? <p className="ob-hint error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
