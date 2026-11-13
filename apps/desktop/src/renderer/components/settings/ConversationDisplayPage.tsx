import { useMemo, useState } from "react";
import type { ModelCatalog } from "@vela/shared";
import type { PreferencesApi, ThinkingGroupMode, ThinkingSummaryStyle, ThinkingTitleStyle, ToolDisplay, ToolFold, ToolIconColor } from "../../hooks/usePreferences";
import type { SettingsCopy } from "../settings-copy";
import { groupAvailable, modelValue, parseModelValue } from "./model-helpers";
import { Segmented, SettingsBlock, SettingsGroup, SettingsSwitch } from "./primitives";
import { SettingsSelect } from "./SettingsSelect";
import { HeightLimitControl } from "./HeightLimitControl";
import { commandDetailHeightStops, thinkingGroupHeightStops, toolDetailHeightStops } from "../../thinking-group-height";
import { clampThinkingActivityDelayMs, maxThinkingActivityDelayMs, minThinkingActivityDelayMs } from "../../thinking-activity-delay";
import { IntelligentUiSetting } from "../intelligent-ui/IntelligentUiSetting";
import {
  ConversationPreview,
  InputPredictionPreview,
  ThinkingPreview,
  ToolDisplayPreview,
  ToolFoldPreview,
  ToolIconColorPreview,
  ToolProcessDetailsPreview,
} from "./display-previews";

export function ConversationDisplayPage({
  copy,
  preferences,
  catalog,
}: {
  copy: SettingsCopy;
  preferences: PreferencesApi;
  catalog: ModelCatalog | null;
}) {
  const {
    toolDisplay,
    toolFold,
    toolProcessDetails,
    runView,
    filePath,
    minimalMode,
    recommendedActions,
    toolIconColor,
    thinkingGroupMode,
    thinkingActivityDelayEnabled,
    thinkingActivityDelayMs,
    thinkingGroupHeight,
    toolDetailHeight,
    commandDetailHeight,
    toolDetailHeightScale,
    thinkingGroupHeightGrow,
    thinkingTitleStyle,
    replyFade,
    replyPop,
    thinkingFade,
    thinkingPop,
    thinkingSummary,
    thinkingSummaryStyle,
    thinkingSummaryModel,
    inputPrediction,
    inputPredictionModel,
    setToolDisplay,
    setToolFold,
    setToolProcessDetails,
    setRunView,
    setFilePath,
    setMinimalMode,
    setRecommendedActions,
    setToolIconColor,
    setThinkingGroupMode,
    setThinkingActivityDelayEnabled,
    setThinkingActivityDelayMs,
    setThinkingGroupHeight,
    setToolDetailHeight,
    setCommandDetailHeight,
    setToolDetailHeightScale,
    setThinkingGroupHeightGrow,
    setReplyFade,
    setReplyPop,
    setThinkingTitleStyle,
    setThinkingFade,
    setThinkingPop,
    setThinkingSummary,
    setThinkingSummaryStyle,
    setThinkingSummaryModel,
    setInputPrediction,
    setInputPredictionModel,
  } = preferences;
  const text = copy.appearance;
  const [activityDelayDraft, setActivityDelayDraft] = useState<string | null>(null);
  const commitActivityDelay = () => {
    if (activityDelayDraft === null) return;
    const value = Number(activityDelayDraft);
    if (activityDelayDraft.trim() && Number.isFinite(value)) {
      setThinkingActivityDelayMs(clampThinkingActivityDelayMs(value));
    }
    setActivityDelayDraft(null);
  };
  const onOff = (value: boolean) => (value ? "on" : "off");
  const selected: Record<string, string> = {
    toolDisplay,
    toolFold,
    toolIconColor,
    toolProcessDetails: onOff(toolProcessDetails),
    thinkingSummary: onOff(thinkingSummary),
    thinkingSummaryStyle,
    inputPrediction: onOff(inputPrediction),
  };
  // 悬停某个选项时,常驻预览和该项旁的动画都临时显示它;同一时刻只会悬停一个选项。
  const [hover, setHover] = useState<{ key: string; value: string } | null>(null);
  const pick = <T extends string>(key: string): T => (hover?.key === key ? hover.value : selected[key]) as T;
  const peek = <T extends string>(key: string) => (value: T | null) => setHover(value === null ? null : { key, value });
  const previewing = (key: string) => hover?.key === key && hover.value !== selected[key];
  // 极简是紧凑独有的;生效时「文件显示路径」强制关闭且不可打开。
  const minimalActive = minimalMode && toolDisplay === "compact";
  const view = {
    toolDisplay: pick<ToolDisplay>("toolDisplay"),
    minimalMode: minimalActive,
    toolFold: pick<ToolFold>("toolFold"),
    toolIconColor: pick<ToolIconColor>("toolIconColor"),
    toolProcessDetails: pick("toolProcessDetails") === "on",
    thinkingSummary: pick("thinkingSummary") === "on",
    thinkingSummaryStyle: pick<ThinkingSummaryStyle>("thinkingSummaryStyle"),
    inputPrediction: pick("inputPrediction") === "on",
  };
  const summaryModelGroups = useMemo(() => groupAvailable(catalog), [catalog]);
  const summaryModelMissing = Boolean(thinkingSummaryModel && !catalog?.models.some(model =>
    model.provider === thinkingSummaryModel.provider && model.id === thinkingSummaryModel.id && model.available,
  ));
  const predictionModelMissing = Boolean(inputPredictionModel && !catalog?.models.some(model =>
    model.provider === inputPredictionModel.provider && model.id === inputPredictionModel.id && model.available,
  ));
  const toolDisplayOptions: { id: ToolDisplay; label: string }[] = [
    { id: "card", label: text.toolCard },
    { id: "compact", label: text.toolCompact },
  ];
  const toolFoldOptions: { id: ToolFold; label: string }[] = [
    { id: "message", label: text.toolFoldMessage },
    { id: "position", label: text.toolFoldPosition },
    { id: "none", label: text.toolFoldNone },
  ];
  const thinkingTitleStyleOptions: { id: ThinkingTitleStyle; label: string }[] = [
    { id: "bold-dark", label: text.thinkingTitleBoldDark },
    { id: "bold-muted", label: text.thinkingTitleBoldMuted },
    { id: "normal-dark", label: text.thinkingTitleNormalDark },
    { id: "normal-muted", label: text.thinkingTitleNormalMuted },
  ];
  const toolIconColorOptions: { id: ToolIconColor; label: string }[] = [
    { id: "color", label: text.toolIconColorOn },
    { id: "theme", label: text.toolIconColorTheme },
    { id: "gray", label: text.toolIconColorOff },
  ];
  const thinkingGroupModeOptions: { id: ThinkingGroupMode; label: string }[] = [
    { id: "single", label: text.thinkingGroupModeSingle },
    { id: "coherent", label: text.thinkingGroupModeCoherent },
    { id: "codex", label: text.thinkingGroupModeCodex },
  ];
  const thinkingSummaryStyleOptions: { id: ThinkingSummaryStyle; label: string }[] = [
    { id: "inline", label: text.thinkingSummaryStyleInline },
    { id: "headline", label: text.thinkingSummaryStyleHeadline },
    { id: "prose", label: text.thinkingSummaryStyleProse },
  ];
  return (
    <section className="settings-section">
      <ConversationPreview settings={view} previewing={hover !== null && previewing(hover.key)} />
      <SettingsGroup title={copy.sections.toolCalls}>
      <SettingsBlock
        id="tool-display"
        title={text.toolDisplay}
        hint={text.toolDisplayHint}
        aside={<ToolDisplayPreview mode={view.toolDisplay} previewing={previewing("toolDisplay")} />}
      >
        <Segmented label={text.toolDisplay} value={toolDisplay} options={toolDisplayOptions} onChange={setToolDisplay} onPreview={peek("toolDisplay")} />
      </SettingsBlock>
      <SettingsBlock
        id="tool-fold"
        title={text.toolFold}
        hint={text.toolFoldHint}
        aside={<ToolFoldPreview mode={view.toolFold} previewing={previewing("toolFold")} />}
      >
        <Segmented label={text.toolFold} value={toolFold} options={toolFoldOptions} onChange={setToolFold} onPreview={peek("toolFold")} />
      </SettingsBlock>
      <SettingsBlock
        id="tool-icon-color"
        title={text.toolIconColor}
        hint={text.toolIconColorHint}
        aside={<ToolIconColorPreview mode={view.toolIconColor} previewing={previewing("toolIconColor")} />}
      >
        <Segmented
          label={text.toolIconColor}
          value={toolIconColor}
          options={toolIconColorOptions}
          onChange={setToolIconColor}
          onPreview={peek("toolIconColor")}
        />
      </SettingsBlock>
      <SettingsBlock
        id="tool-process-details"
        title={text.toolProcessDetails}
        hint={text.toolProcessDetailsHint}
        aside={<ToolProcessDetailsPreview enabled={view.toolProcessDetails} previewing={previewing("toolProcessDetails")} />}
      >
        <Segmented
          label={text.toolProcessDetails}
          value={onOff(toolProcessDetails)}
          options={[
            { id: "off", label: text.toolProcessDetailsOff },
            { id: "on", label: text.toolProcessDetailsOn },
          ]}
          onChange={(value) => setToolProcessDetails(value === "on")}
          onPreview={peek("toolProcessDetails")}
        />
      </SettingsBlock>
      <SettingsBlock id="run-view" title={text.runView} hint={text.runViewHint} layout="inline">
        <SettingsSwitch label={text.runView} checked={runView} onChange={setRunView} />
      </SettingsBlock>
      <SettingsBlock id="minimal-mode" title={text.minimalMode} hint={text.minimalModeHint} layout="inline">
        <SettingsSwitch
          label={text.minimalMode}
          checked={minimalActive}
          disabled={toolDisplay !== "compact"}
          title={toolDisplay !== "compact" ? text.minimalModeCompactOnly : undefined}
          onChange={setMinimalMode}
        />
      </SettingsBlock>
      <SettingsBlock id="file-path" title={text.filePath} hint={text.filePathHint} layout="inline">
        <SettingsSwitch
          label={text.filePath}
          checked={filePath && !minimalActive}
          disabled={minimalActive}
          title={minimalActive ? text.filePathMinimalNote : undefined}
          onChange={setFilePath}
        />
      </SettingsBlock>
      <SettingsBlock id="recommended-actions" title={text.recommendedActions} hint={text.recommendedActionsHint} layout="inline">
        <SettingsSwitch label={text.recommendedActions} checked={recommendedActions} onChange={setRecommendedActions} />
      </SettingsBlock>
      </SettingsGroup>
      <SettingsGroup title={copy.sections.thinking}>
      <SettingsBlock
        id="thinking-summary"
        title={text.thinkingSummary}
        hint={text.thinkingSummaryHint}
        aside={(
          <ThinkingPreview
            style={thinkingSummaryStyle}
            summary={view.thinkingSummary}
            previewing={previewing("thinkingSummary")}
          />
        )}
      >
        <Segmented
          label={text.thinkingSummary}
          value={onOff(thinkingSummary)}
          options={[
            { id: "off", label: text.thinkingSummaryOff },
            { id: "on", label: text.thinkingSummaryOn },
          ]}
          onChange={(value) => setThinkingSummary(value === "on")}
          onPreview={peek("thinkingSummary")}
        />
      </SettingsBlock>
      <SettingsBlock id="thinking-summary-model" title={text.thinkingSummaryModel} hint={text.thinkingSummaryModelHint}>
        <SettingsSelect
          label={text.thinkingSummaryModel}
          describedBy="thinking-summary-model-hint"
          value={thinkingSummaryModel ? modelValue(thinkingSummaryModel.provider, thinkingSummaryModel.id) : ""}
          options={[
            { value: "", label: text.thinkingSummaryModelCurrent },
            ...(summaryModelMissing && thinkingSummaryModel
              ? [{ value: modelValue(thinkingSummaryModel.provider, thinkingSummaryModel.id), label: `${thinkingSummaryModel.provider} / ${thinkingSummaryModel.id} — ${text.thinkingSummaryModelUnavailable}`, disabled: true }]
              : []),
            ...summaryModelGroups.flatMap((group) => group.models.map((model) => ({
              value: modelValue(model.provider, model.id),
              label: model.name,
              group: group.name,
            }))),
          ]}
          onChange={(value) => {
            const { provider, modelId } = parseModelValue(value);
            setThinkingSummaryModel(provider && modelId ? { provider, id: modelId } : null);
          }}
        />
        <p className="settings-note" id="thinking-summary-model-hint">
          {summaryModelMissing ? text.thinkingSummaryModelMissing : text.thinkingSummaryModelConfigure}
        </p>
      </SettingsBlock>
      <SettingsBlock
        id="thinking-summary-style"
        title={text.thinkingSummaryStyle}
        hint={text.thinkingSummaryStyleHint}
        aside={<ThinkingPreview style={view.thinkingSummaryStyle} summary previewing={previewing("thinkingSummaryStyle")} />}
      >
        <Segmented
          label={text.thinkingSummaryStyle}
          value={thinkingSummaryStyle}
          options={thinkingSummaryStyleOptions}
          onChange={setThinkingSummaryStyle}
          onPreview={peek("thinkingSummaryStyle")}
        />
      </SettingsBlock>
      <SettingsBlock id="thinking-group-mode" title={text.thinkingGroupMode} hint={text.thinkingGroupModeHint} layout="inline">
        <Segmented menu label={text.thinkingGroupMode} value={thinkingGroupMode} options={thinkingGroupModeOptions} onChange={setThinkingGroupMode} />
      </SettingsBlock>
      <SettingsBlock id="thinking-activity-delay" title={text.thinkingActivityDelay} hint={text.thinkingActivityDelayHint} layout="inline">
        <div className="settings-font-row">
          <SettingsSwitch
            label={text.thinkingActivityDelay}
            checked={thinkingActivityDelayEnabled}
            onChange={setThinkingActivityDelayEnabled}
          />
          <div className="tb-limit" data-disabled={!thinkingActivityDelayEnabled ? "true" : undefined}>
            <label className="tb-number">
              <span>{text.thinkingActivityDelayThreshold}</span>
              <input
                type="number"
                aria-label={text.thinkingActivityDelayThreshold}
                inputMode="numeric"
                min={minThinkingActivityDelayMs}
                max={maxThinkingActivityDelayMs}
                step={100}
                value={activityDelayDraft ?? String(thinkingActivityDelayMs)}
                disabled={!thinkingActivityDelayEnabled}
                onChange={(event) => setActivityDelayDraft(event.target.value)}
                onBlur={commitActivityDelay}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitActivityDelay();
                  if (event.key === "Escape") setActivityDelayDraft(null);
                }}
              />
            </label>
          </div>
        </div>
      </SettingsBlock>
      <SettingsBlock id="thinking-title-style" title={text.thinkingTitleStyle} hint={text.thinkingTitleStyleHint} layout="inline">
        <Segmented menu label={text.thinkingTitleStyle} value={thinkingTitleStyle} options={thinkingTitleStyleOptions} onChange={setThinkingTitleStyle} />
      </SettingsBlock>
      <SettingsBlock id="thinking-group-height" title={text.thinkingGroupHeight} hint={text.thinkingGroupHeightHint}>
        <div className="tb-fields">
        <HeightLimitControl
          label={text.thinkingGroupHeightGroup}
          stops={thinkingGroupHeightStops}
          value={thinkingGroupHeight}
          onChange={setThinkingGroupHeight}
        />
        <HeightLimitControl
          label={text.thinkingGroupHeightCommand}
          stops={commandDetailHeightStops}
          value={commandDetailHeight}
          onChange={setCommandDetailHeight}
        />
        <HeightLimitControl
          label={text.thinkingGroupHeightDetail}
          stops={toolDetailHeightStops}
          value={toolDetailHeight}
          onChange={setToolDetailHeight}
        />
        <div className="tb-enable" title={text.thinkingGroupHeightScaleHint}>
          <span>{text.thinkingGroupHeightScale}</span>
          <SettingsSwitch
            checked={toolDetailHeightScale}
            label={text.thinkingGroupHeightScale}
            title={text.thinkingGroupHeightScaleHint}
            onChange={setToolDetailHeightScale}
          />
        </div>
        <p className="tb-limit-hint">{text.thinkingGroupHeightScaleHint}</p>
        <div className="tb-enable" title={text.thinkingGroupHeightGrowHint}>
          <span>{text.thinkingGroupHeightGrow}</span>
          <SettingsSwitch
            checked={thinkingGroupHeightGrow}
            label={text.thinkingGroupHeightGrow}
            title={text.thinkingGroupHeightGrowHint}
            onChange={setThinkingGroupHeightGrow}
          />
        </div>
        <p className="tb-limit-hint">{text.thinkingGroupHeightGrowHint}</p>
        </div>
      </SettingsBlock>
      </SettingsGroup>
      <SettingsGroup title={copy.sections.replyInput}>
      <SettingsBlock id="reply-animation" title={text.replyAnimation} hint={text.replyAnimationHint} layout="inline">
        <div className="settings-font-row">
          <span className="settings-font-label">{text.animationFade}</span>
          <SettingsSwitch label={`${text.replyAnimation} · ${text.animationFade}`} checked={replyFade} onChange={setReplyFade} />
        </div>
        <div className="settings-font-row">
          <span className="settings-font-label">{text.animationPop}</span>
          <SettingsSwitch label={`${text.replyAnimation} · ${text.animationPop}`} checked={replyPop} onChange={setReplyPop} />
        </div>
      </SettingsBlock>
      <SettingsBlock id="thinking-animation" title={text.thinkingAnimation} hint={text.thinkingAnimationHint} layout="inline">
        <div className="settings-font-row">
          <span className="settings-font-label">{text.animationFade}</span>
          <SettingsSwitch label={`${text.thinkingAnimation} · ${text.animationFade}`} checked={thinkingFade} onChange={setThinkingFade} />
        </div>
        <div className="settings-font-row">
          <span className="settings-font-label">{text.animationPop}</span>
          <SettingsSwitch label={`${text.thinkingAnimation} · ${text.animationPop}`} checked={thinkingPop} onChange={setThinkingPop} />
        </div>
      </SettingsBlock>
      <SettingsBlock
        id="input-prediction"
        title={text.inputPrediction}
        hint={text.inputPredictionHint}
        aside={<InputPredictionPreview enabled={view.inputPrediction} previewing={previewing("inputPrediction")} />}
      >
        <Segmented
          label={text.inputPrediction}
          value={onOff(inputPrediction)}
          options={[
            { id: "off", label: text.inputPredictionOff },
            { id: "on", label: text.inputPredictionOn },
          ]}
          onChange={(value) => setInputPrediction(value === "on")}
          onPreview={peek("inputPrediction")}
        />
      </SettingsBlock>
      <SettingsBlock id="input-prediction-model" title={text.inputPredictionModel} hint={text.inputPredictionModelHint}>
        <SettingsSelect
          label={text.inputPredictionModel}
          describedBy="input-prediction-model-hint"
          value={inputPredictionModel ? modelValue(inputPredictionModel.provider, inputPredictionModel.id) : ""}
          options={[
            { value: "", label: text.thinkingSummaryModelCurrent },
            ...(predictionModelMissing && inputPredictionModel
              ? [{ value: modelValue(inputPredictionModel.provider, inputPredictionModel.id), label: `${inputPredictionModel.provider} / ${inputPredictionModel.id} — ${text.thinkingSummaryModelUnavailable}`, disabled: true }]
              : []),
            ...summaryModelGroups.flatMap((group) => group.models.map((model) => ({
              value: modelValue(model.provider, model.id),
              label: model.name,
              group: group.name,
            }))),
          ]}
          onChange={(value) => {
            const { provider, modelId } = parseModelValue(value);
            setInputPredictionModel(provider && modelId ? { provider, id: modelId } : null);
          }}
        />
        <p className="settings-note" id="input-prediction-model-hint">
          {predictionModelMissing ? text.thinkingSummaryModelMissing : text.thinkingSummaryModelConfigure}
        </p>
      </SettingsBlock>
      </SettingsGroup>
      <SettingsGroup title={copy.sections.intelligentUi}>
        <IntelligentUiSetting />
      </SettingsGroup>
    </section>
  );
}
