import type { CustomModelApi } from "@vela/shared";
import { useState } from "react";
import type { useModels } from "../../hooks/useModels";
import type { SettingsCopy } from "../settings-copy";
import { ApiSelect, countOrNull, emptyModelDraft, KeyField, ModelFields, ProviderLogo, type ModelDraft } from "./models-parts";
import { providerIdFromName } from "./model-helpers";

/** 新建自定义供应商:接口信息加第一个模型,提交时一并测试并登记。 */
export function CustomProviderForm({
  copy,
  models,
  onCancel,
  onAdded,
}: {
  copy: SettingsCopy;
  models: ReturnType<typeof useModels>;
  onCancel: () => void;
  onAdded: (providerId: string) => void;
}) {
  const text = copy.models;
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState<CustomModelApi>("openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<ModelDraft>(emptyModelDraft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ready = name.trim() !== "" && baseUrl.trim() !== "" && model.modelId.trim() !== "";

  async function submit(): Promise<void> {
    const providerId = providerIdFromName(name);
    if (!providerId) {
      setError(text.providerInvalid);
      return;
    }
    setSaving(true);
    setError(null);
    const message = await models.register({
      providerId,
      providerName: name.trim(),
      baseUrl: baseUrl.trim(),
      api,
      apiKey: apiKey.trim(),
      modelId: model.modelId.trim(),
      modelName: model.modelName.trim(),
      reasoning: model.reasoning,
      contextWindow: countOrNull(model.contextWindow),
      maxTokens: countOrNull(model.maxTokens),
    });
    setSaving(false);
    if (typeof message === "string" && message) {
      setError(message);
      return;
    }
    onAdded(providerId);
  }

  return (
    <form className="models-detail" onSubmit={(event) => { event.preventDefault(); if (ready && !saving) void submit(); }}>
      <div className="models-detail-head">
        <h3>
          <ProviderLogo provider={{ name, custom: true }} size="lg" />
          <input
            className="models-name-input"
            value={name}
            placeholder={text.providerPlaceholder}
            aria-label={text.providerName}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </h3>
      </div>
      <div className="models-form">
        <label className="models-field">
          <span>{text.baseUrl}</span>
          <input className="mono" value={baseUrl} placeholder={text.baseUrlPlaceholder} spellCheck={false} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <ApiSelect copy={text} value={api} onChange={setApi} />
        <KeyField copy={text} value={apiKey} placeholder={text.apiKeyPlaceholder} onChange={setApiKey} />
      </div>
      <div className="models-section">
        <div className="models-label">{text.firstModel}</div>
        <div className="models-editor">
          <ModelFields copy={text} value={model} onChange={setModel} />
        </div>
      </div>
      {error ? <p className="settings-error">{error}</p> : null}
      <div className="models-form-actions">
        <span className="settings-note models-form-note">{text.keyHint}</span>
        <button type="button" className="models-btn" onClick={onCancel}>{text.cancel}</button>
        <button type="submit" className="models-btn primary" disabled={!ready || saving}>
          {saving ? text.submitting : text.submit}
        </button>
      </div>
    </form>
  );
}
