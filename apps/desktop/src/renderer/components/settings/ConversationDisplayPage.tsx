import { useMemo, useState } from "react";
import type { ModelCatalog } from "@vela/shared";
import type { PreferencesApi } from "../../hooks/usePreferences";
import type { SettingsCopy } from "../settings-copy";
import { groupAvailable, modelValue, parseModelValue } from "./model-helpers";
import { Segmented, SettingsBlock, SettingsGroup, SettingsSwitch } from "./primitives";
import { SettingsSelect } from "./SettingsSelect";
import { IntelligentUiSetting } from "../intelligent-ui/IntelligentUiSetting";
import {
  ConversationPreview,
  InputPredictionPreview,
  ThinkingPreview,
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
    minimalMode,
    recommendedActions,
    toolIconColor,
    thinkingSummary,
    thinkingSummaryStyle,
    thinkingSummaryModel,
    inputPrediction,
    inputPredictionModel,
    setRunView,
    setRecommendedActions,
    setThinkingSummary,
    setThinkingSummaryModel,
    setInputPrediction,
    setInputPredictionModel,
  } = preferences;
  const text = copy.appearance;
  const onOff = (value: boolean) => (value ? "on" : "off");
  const selected: Record<string, string> = {
    thinkingSummary: onOff(thinkingSummary),
    inputPrediction: onOff(inputPrediction),
  };
  // 悬停某个选项时,常驻预览和该项旁的动画都临时显示它;同一时刻只会悬停一个选项。
  const [hover, setHover] = useState<{ key: string; value: string } | null>(null);
  const pick = <T extends string>(key: string): T => (hover?.key === key ? hover.value : selected[key]) as T;
  const peek = <T extends string>(key: string) => (value: T | null) => setHover(value === null ? null : { key, value });
  const previewing = (key: string) => hover?.key === key && hover.value !== selected[key];
  const minimalActive = minimalMode && toolDisplay === "compact";
  const view = {
    toolDisplay,
    minimalMode: minimalActive,
    toolFold,
    toolIconColor,
    toolProcessDetails,
    thinkingSummary: pick("thinkingSummary") === "on",
    thinkingSummaryStyle,
    inputPrediction: pick("inputPrediction") === "on",
  };
  const summaryModelGroups = useMemo(() => groupAvailable(catalog), [catalog]);
  const summaryModelMissing = Boolean(thinkingSummaryModel && !catalog?.models.some(model =>
    model.provider === thinkingSummaryModel.provider && model.id === thinkingSummaryModel.id && model.available,
  ));
  const predictionModelMissing = Boolean(inputPredictionModel && !catalog?.models.some(model =>
    model.provider === inputPredictionModel.provider && model.id === inputPredictionModel.id && model.available,
  ));
  return (
    <section className="settings-section">
      <ConversationPreview settings={view} previewing={hover !== null && previewing(hover.key)} />
      <SettingsGroup title={copy.sections.toolCalls}>
      <SettingsBlock id="run-view" title={text.runView} hint={text.runViewHint} layout="inline">
        <SettingsSwitch label={text.runView} checked={runView} onChange={setRunView} />
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
      </SettingsGroup>
      <SettingsGroup title={copy.sections.replyInput}>
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
