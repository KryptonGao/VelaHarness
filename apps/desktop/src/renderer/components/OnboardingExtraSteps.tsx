import { isUiPreference, residentModes, type ResidentMode, type ResidentSettings, type ResidentSettingsPatch, type UiPreference, type UpdateState } from "@vela/shared";
import { useEffect, useState } from "react";
import type { InfoLayout, PreferencesApi } from "../hooks/usePreferences";
import { tr } from "../locale";
import { setComposerLayout, useComposerLayout, type ComposerLayout } from "../hooks/useComposerLayout";
import { setNavLayout, useNavLayout, type NavLayout } from "../hooks/useNavLayout";
import { uiCopy } from "./intelligent-ui/copy";
import { publishIntelligentUiState } from "./intelligent-ui/ui-settings-store";
import { modeDescription, modeLabel } from "./resident-agent-model";
import type { OnboardingCopy } from "./onboarding-copy";
import { ComposerPreview, InfoPreview, LayoutOption, NavPreview, type InfoLayoutKind } from "./OnboardingLayouts";
import { Label, Note, Seg, ToggleRow } from "./onboarding-ui";
import type { SettingsCopy } from "./settings-copy";

/** 第 2 步：思考总结与输入预测。两者都会额外调用模型，默认关闭，这里只是让新用户知道有这个选项。 */
export function AssistSection({ copy, settings, preferences }: { copy: OnboardingCopy; settings: SettingsCopy; preferences: PreferencesApi }) {
  return (
    <>
      <Label title={copy.assistGroup} style={{ marginTop: 22 }} />
      <div className="ob-sheet tilt-l">
        <ToggleRow title={settings.appearance.thinkingSummary} hint={copy.thinkingSummaryHint} checked={preferences.thinkingSummary} onChange={preferences.setThinkingSummary} />
        <ToggleRow title={settings.appearance.inputPrediction} hint={copy.inputPredictionHint} checked={preferences.inputPrediction} onChange={preferences.setInputPrediction} />
      </div>
    </>
  );
}

/** 第 3 步：信息栏位置（边栏、悬浮或卡片）与导航布局。 */
export function LayoutStep({ copy, settings, preferences }: { copy: OnboardingCopy; settings: SettingsCopy; preferences: PreferencesApi }) {
  const navLayout = useNavLayout();
  const look = settings.appearance;
  const infoOptions: { id: InfoLayout & InfoLayoutKind; title: string; hint: string }[] = [
    { id: "sidebar", title: copy.infoSidebar, hint: copy.infoSidebarHint },
    { id: "floating", title: copy.infoFloating, hint: copy.infoFloatingHint },
    { id: "cards", title: look.infoLayoutCards, hint: copy.infoCardsHint },
  ];
  const navOptions: { id: NavLayout; title: string; hint: string }[] = [
    { id: "classic", title: look.navLayoutClassic, hint: copy.navClassicHint },
    { id: "rail", title: look.navLayoutRail, hint: copy.navRailHint },
  ];
  return (
    <>
      <div className="ob-three" role="radiogroup" aria-label={copy.layoutGroup} style={{ marginTop: 20 }}>
        {infoOptions.map((option) => (
          <LayoutOption key={option.id} selected={preferences.infoLayout === option.id} title={option.title} hint={option.hint} onPick={() => preferences.setInfoLayout(option.id)}>
            <InfoPreview kind={option.id} chat={copy.layoutChat} info={copy.layoutInfo} />
          </LayoutOption>
        ))}
      </div>
      <Label title={copy.navGroup} style={{ marginTop: 22 }} />
      <div className="ob-two" role="radiogroup" aria-label={copy.navGroup}>
        {navOptions.map((option) => (
          <LayoutOption key={option.id} selected={navLayout === option.id} title={option.title} hint={option.hint} onPick={() => setNavLayout(option.id)}>
            <NavPreview kind={option.id} chat={copy.layoutChat} />
          </LayoutOption>
        ))}
      </div>
    </>
  );
}

/** 第 4 步：输入框布局，以及交互式界面偏好。 */
export function ComposerStep({ copy, settings }: { copy: OnboardingCopy; settings: SettingsCopy }) {
  const composerLayout = useComposerLayout();
  const look = settings.appearance;
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

  const composerOptions: { id: ComposerLayout; title: string; hint: string }[] = [
    { id: "classic", title: look.composerLayoutClassic, hint: copy.composerClassicHint },
    { id: "calm", title: look.composerLayoutCalm, hint: copy.composerCalmHint },
    { id: "capsule", title: look.composerLayoutCapsule, hint: copy.composerCapsuleHint },
  ];
  const hints: Record<UiPreference, string> = { auto: text.autoHint(), text_only: text.textOnlyHint(), visual_first: text.visualFirstHint() };
  const current = preference ?? "auto";
  return (
    <>
      <div className="ob-three" role="radiogroup" aria-label={copy.composerGroup} style={{ marginTop: 20 }}>
        {composerOptions.map((option) => (
          <LayoutOption key={option.id} selected={composerLayout === option.id} title={option.title} hint={option.hint} onPick={() => setComposerLayout(option.id)}>
            <ComposerPreview kind={option.id} chat={copy.layoutChat} />
          </LayoutOption>
        ))}
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

/** 第 8 步：记忆开关与额外指令。记忆开关立即生效，指令随「继续」保存。 */
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

/** 第 9 步：常驻 Agent、通知、自动更新。每一项改动都立即交给主进程保存。 */
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
