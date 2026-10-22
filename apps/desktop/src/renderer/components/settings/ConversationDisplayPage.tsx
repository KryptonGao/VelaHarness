import { useMemo, useState } from "react";
import type { ModelCatalog } from "@vela/shared";
import type { PreferencesApi, ThinkingSummaryStyle, ToolDisplay, ToolFold } from "../../hooks/usePreferences";
import type { SettingsCopy } from "../settings-copy";
import { groupAvailable, modelValue, parseModelValue } from "./model-helpers";
import { Segmented, SettingsBlock } from "./primitives";
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
    toolIconColor,
    thinkingSummary,
    thinkingSummaryStyle,
    thinkingSummaryModel,
    inputPrediction,
    inputPredictionModel,
    setToolDisplay,
    setToolFold,
    setToolProcessDetails,
    setToolIconColor,
    setThinkingSummary,
    setThinkingSummaryStyle,
    setThinkingSummaryModel,
    setInputPrediction,
    setInputPredictionModel,
  } = preferences;
  const text = copy.appearance;
  const onOff = (value: boolean) => (value ? "on" : "off");
  const selected: Record<string, string> = {
    toolDisplay,
    toolFold,
    toolIconColor: onOff(toolIconColor),
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
  const view = {
    toolDisplay: pick<ToolDisplay>("toolDisplay"),
    toolFold: pick<ToolFold>("toolFold"),
    toolIconColor: pick("toolIconColor") === "on",
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
  const thinkingSummaryStyleOptions: { id: ThinkingSummaryStyle; label: string }[] = [
    { id: "inline", label: text.thinkingSummaryStyleInline },
    { id: "headline", label: text.thinkingSummaryStyleHeadline },
    { id: "prose", label: text.thinkingSummaryStyleProse },
  ];

  return (
    <section className="settings-section">
      <ConversationPreview settings={view} previewing={hover !== null && previewing(hover.key)} />
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
        aside={<ToolIconColorPreview colored={view.toolIconColor} previewing={previewing("toolIconColor")} />}
      >
        <Segmented
          label={text.toolIconColor}
          value={onOff(toolIconColor)}
          options={[
            { id: "off", label: text.toolIconColorOff },
            { id: "on", label: text.toolIconColorOn },
          ]}
          onChange={(value) => setToolIconColor(value === "on")}
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
        <select
          className="settings-select"
          aria-label={text.thinkingSummaryModel}
          aria-describedby="thinking-summary-model-hint"
          value={thinkingSummaryModel ? modelValue(thinkingSummaryModel.provider, thinkingSummaryModel.id) : ""}
          onChange={(event) => {
            const { provider, modelId } = parseModelValue(event.target.value);
            setThinkingSummaryModel(provider && modelId ? { provider, id: modelId } : null);
          }}
        >
          <option value="">{text.thinkingSummaryModelCurrent}</option>
          {summaryModelMissing && thinkingSummaryModel ? (
            <option value={modelValue(thinkingSummaryModel.provider, thinkingSummaryModel.id)} disabled>
              {thinkingSummaryModel.provider} / {thinkingSummaryModel.id} — {text.thinkingSummaryModelUnavailable}
            </option>
          ) : null}
          {summaryModelGroups.map((group) => (
            <optgroup key={group.provider} label={group.name}>
              {group.models.map((model) => (
                <option key={modelValue(model.provider, model.id)} value={modelValue(model.provider, model.id)}>
                  {model.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
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
        <select
          className="settings-select"
          aria-label={text.inputPredictionModel}
          aria-describedby="input-prediction-model-hint"
          value={inputPredictionModel ? modelValue(inputPredictionModel.provider, inputPredictionModel.id) : ""}
          onChange={(event) => {
            const { provider, modelId } = parseModelValue(event.target.value);
            setInputPredictionModel(provider && modelId ? { provider, id: modelId } : null);
          }}
        >
          <option value="">{text.thinkingSummaryModelCurrent}</option>
          {predictionModelMissing && inputPredictionModel ? (
            <option value={modelValue(inputPredictionModel.provider, inputPredictionModel.id)} disabled>
              {inputPredictionModel.provider} / {inputPredictionModel.id} — {text.thinkingSummaryModelUnavailable}
            </option>
          ) : null}
          {summaryModelGroups.map((group) => (
            <optgroup key={group.provider} label={group.name}>
              {group.models.map((model) => (
                <option key={modelValue(model.provider, model.id)} value={modelValue(model.provider, model.id)}>
                  {model.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="settings-note" id="input-prediction-model-hint">
          {predictionModelMissing ? text.thinkingSummaryModelMissing : text.thinkingSummaryModelConfigure}
        </p>
      </SettingsBlock>
      <IntelligentUiSetting />
    </section>
  );
}
