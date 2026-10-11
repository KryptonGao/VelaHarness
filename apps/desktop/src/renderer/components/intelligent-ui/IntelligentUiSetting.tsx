import { useEffect, useState } from "react";
import { isUiPreference, type UiPreference } from "@vela/shared";
import { Segmented, SettingsBlock, SettingsSwitch } from "../settings/primitives";
import { uiCopy } from "./copy";
import { resetUiMetrics, setUiInspectorEnabled, uiInspectorPreference, useUiMetricsSummary } from "./ui-metrics-instance";
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
    <MetricsSetting />
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

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** 本地指标与开发检查器（IUI-13）：只有次数和耗时，不含内容，不上传。 */
function MetricsSetting() {
  const summary = useUiMetricsSummary();
  const [inspector, setInspector] = useState(uiInspectorPreference());
  const text = uiCopy.setting;
  const degraded = Object.entries(summary.reasons).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const empty = summary.assistantMessages === 0 && summary.artifacts === 0 && summary.appRuns === 0;
  return <SettingsBlock id="intelligent-ui-metrics" title={text.metricsTitle()} hint={text.metricsDescription()} collapsible={{ defaultOpen: false }}>
    {empty ? <p className="settings-note">{text.metricsEmpty()}</p> : <dl className="iui-metrics">
      <dt>{text.metricsUiRatio()}</dt><dd>{summary.uiMessages} / {summary.assistantMessages} ({percent(summary.uiRatio)})</dd>
      <dt>{text.metricsCommit()}</dt><dd>{summary.commitRate === null ? "—" : `${percent(summary.commitRate)} (${summary.ready} / ${summary.ready + summary.incomplete + summary.invalid})`}</dd>
      <dt>{text.metricsFirstNode()}</dt><dd>{summary.medianFirstNodeMs === null ? "—" : `${Math.round(summary.medianFirstNodeMs)} ms`}</dd>
      <dt>{text.metricsAverage()}</dt><dd>{summary.averageNodes === null ? "—" : `${summary.averageNodes.toFixed(1)} / ${(summary.averageStates ?? 0).toFixed(1)}`}</dd>
      <dt>{text.metricsDegraded()}</dt><dd>{degraded.length === 0 ? "0" : degraded.map(([reason, count]) => `${reason} × ${count}`).join(", ")}</dd>
      <dt>{text.metricsApps()}</dt><dd>{summary.appRuns}</dd>
    </dl>}
    <div className="settings-switch-row">
      <span>{text.inspectorToggle()}</span>
      <SettingsSwitch checked={inspector} label={text.inspectorToggle()} onChange={next => { setInspector(next); setUiInspectorEnabled(next); }} />
    </div>
    <p className="settings-note">{text.inspectorToggleHint()}</p>
    <button type="button" className="settings-secondary" disabled={empty} onClick={resetUiMetrics}>{text.metricsReset()}</button>
  </SettingsBlock>;
}
