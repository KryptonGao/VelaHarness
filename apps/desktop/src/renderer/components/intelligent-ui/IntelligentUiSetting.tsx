import { useEffect, useState } from "react";
import { isUiPreference, type UiPreference } from "@vela/shared";
import { Segmented, SettingsBlock, SettingsSwitch } from "../settings/primitives";
import { uiCopy } from "./copy";
import { publishIntelligentUiState, useMicroAppsEnabled } from "./ui-settings-store";

/** 设置页里的 Intelligent UI 偏好。偏好属于主进程（Agent 运行时按它决定要不要告诉模型可以生成界面）。 */
export function IntelligentUiSetting() {
  const [preference, setPreference] = useState<UiPreference | null>(null);
  const [failed, setFailed] = useState(false);
  const text = uiCopy.setting;
  useEffect(() => {
    let active = true;
    void window.vela?.getIntelligentUi().then(
      value => {
        if (!active) return;
        if (isUiPreference(value?.preference)) setPreference(value.preference);
        publishIntelligentUiState(value);
      },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, []);
  const change = (next: UiPreference) => {
    const previous = preference;
    setPreference(next);
    setFailed(false);
    void window.vela?.setIntelligentUi(next).then(
      value => { setPreference(value.preference); publishIntelligentUiState(value); },
      () => { setPreference(previous); setFailed(true); },
    );
  };
  const hint: Record<UiPreference, string> = { auto: text.autoHint(), text_only: text.textOnlyHint(), visual_first: text.visualFirstHint() };
  return <>
    <SettingsBlock id="intelligent-ui" title={text.title()} hint={text.description()}>
      <Segmented<UiPreference> label={text.title()} value={preference ?? "auto"}
        options={[
          { id: "auto", label: text.auto() },
          { id: "text_only", label: text.textOnly() },
          { id: "visual_first", label: text.visualFirst() },
        ]}
        onChange={change} />
      <p className="settings-note" role={failed ? "alert" : undefined}>{failed ? uiCopy.cannotSave() : hint[preference ?? "auto"]}</p>
    </SettingsBlock>
    <MicroAppsSetting />
  </>;
}

/** 沙盒微应用（IUI-14）：默认关闭，打开前先看风险说明。 */
function MicroAppsSetting() {
  const enabled = useMicroAppsEnabled();
  const [failed, setFailed] = useState(false);
  const text = uiCopy.setting;
  const toggle = (next: boolean) => {
    setFailed(false);
    void window.vela?.setIntelligentUiMicroApps(next).then(
      value => publishIntelligentUiState(value),
      () => setFailed(true),
    );
  };
  return <SettingsBlock id="intelligent-ui-apps" title={text.microAppsTitle()} hint={text.microAppsDescription()}>
    <div className="settings-switch-row">
      <span>{enabled ? text.microAppsOn() : text.microAppsOff()}</span>
      <SettingsSwitch checked={enabled} label={text.microAppsTitle()} onChange={toggle} />
    </div>
    <p className="settings-note" role={failed ? "alert" : undefined}>{failed ? uiCopy.cannotSave() : text.microAppsWarning()}</p>
  </SettingsBlock>;
}
