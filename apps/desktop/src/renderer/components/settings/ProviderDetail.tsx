import { customModelApis, type AuthMethodType, type CustomModelApi, type ModelSummary, type ProviderSummary } from "@vela/shared";
import { useState } from "react";
import type { useModels } from "../../hooks/useModels";
import type { PreferencesApi } from "../../hooks/usePreferences";
import { PencilIcon, PlusIcon, TrashIcon } from "../icons";
import type { SettingsCopy } from "../settings-copy";
import {
  ApiSelect,
  countOrNull,
  emptyModelDraft,
  KeyField,
  ModelFields,
  ProviderLogo,
  type ModelDraft,
} from "./models-parts";
import { authSourceKind, formatContext, providerStatus } from "./models-view";
import { SettingsSwitch } from "./primitives";

type ModelsApi = ReturnType<typeof useModels>;
type ModelsCopy = SettingsCopy["models"];

interface ProviderDetailProps {
  copy: SettingsCopy;
  provider: ProviderSummary;
  /** 这个提供方的全部模型(含暂时不可用的)。 */
  providerModels: ModelSummary[];
  models: ModelsApi;
  preferences: PreferencesApi;
  onRemoved: () => void;
}

export function ProviderDetail({ copy, provider, providerModels, models, preferences, onRemoved }: ProviderDetailProps) {
  const text = copy.models;
  const status = providerStatus(provider);
  const listed = providerModels.filter((model) => model.available);
  const shown = listed.some((model) => !preferences.isModelHidden(model.provider, model.id));

  return (
    <div className="models-detail">
      <div className="models-detail-head">
        <h3>
          <ProviderLogo provider={provider} size="lg" />
          <span className="models-detail-name">{provider.name}</span>
          <span className={`models-chip ${status}`}>
            {status === "connected" ? text.connectedStatus : status === "attention" ? text.attentionStatus : text.disconnectedStatus}
          </span>
        </h3>
        <SettingsSwitch
          checked={shown}
          disabled={listed.length === 0}
          label={text.providerSwitch}
          title={text.providerSwitch}
          onChange={(next) => {
            for (const model of listed) preferences.setModelHidden(model.provider, model.id, !next);
          }}
        />
        {provider.custom || provider.stored ? (
          <RemoveProvider text={text} provider={provider} providerModels={providerModels} models={models} onRemoved={onRemoved} />
        ) : null}
      </div>

      {provider.custom ? (
        <CustomConnection key={provider.id} text={text} provider={provider} providerModels={providerModels} models={models} />
      ) : (
        <AccountCard text={text} provider={provider} status={status} models={models} />
      )}

      <ModelList
        key={`${provider.id}:models`}
        text={text}
        provider={provider}
        providerModels={providerModels}
        models={models}
        preferences={preferences}
      />

    </div>
  );
}

function AccountCard({ text, provider, status, models }: { text: ModelsCopy; provider: ProviderSummary; status: ReturnType<typeof providerStatus>; models: ModelsApi }) {
  const kind = authSourceKind(provider.authSource);
  const title = status === "disconnected" ? text.accountNone : status === "attention" ? text.attentionStatus : text.connectedStatus;
  const detail = status === "disconnected"
    ? text.accountNoneHint
    : status === "attention"
      ? text.accountAttention
      : kind ? text.accountSources[kind] : "";
  return (
    <div className="models-section">
      <div className="models-label">{text.account}</div>
      <div className="models-account">
        <div className="models-account-copy">
          <div className="models-account-title">{title}</div>
          {detail ? <div className={`models-account-detail${status === "attention" ? " warn" : ""}`}>{detail}</div> : null}
        </div>
        <div className="models-account-actions">
          {provider.methods.map((method) => (
            <button
              key={method.type}
              type="button"
              className={status !== "connected" && method.type === provider.methods[0].type ? "models-btn primary" : "models-btn"}
              onClick={() => void models.loginProvider(provider.id, method.type as AuthMethodType)}
            >
              {method.type === "oauth" ? (status === "disconnected" ? text.login : text.relogin) : text.apiKey}
            </button>
          ))}
          {provider.stored ? (
            <button type="button" className="models-btn" onClick={() => void models.logout(provider.id)}>
              {text.logout}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function asApi(value: string | undefined): CustomModelApi {
  return (customModelApis as readonly string[]).includes(value ?? "") ? (value as CustomModelApi) : "openai-completions";
}

/**
 * 自定义供应商的接口地址、接口类型和密钥。
 * 这些字段按模型写入 models.json,所以保存时把每个自定义模型都重新登记一遍;
 * 没有填新密钥就保持原样。
 */
function CustomConnection({ text, provider, providerModels, models }: { text: ModelsCopy; provider: ProviderSummary; providerModels: ModelSummary[]; models: ModelsApi }) {
  const endpoint = { baseUrl: provider.endpoint?.baseUrl ?? "", api: asApi(provider.endpoint?.api) };
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl);
  const [api, setApi] = useState<CustomModelApi>(endpoint.api);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const customs = providerModels.filter((model) => model.custom);
  const dirty = baseUrl.trim() !== endpoint.baseUrl || api !== endpoint.api || apiKey.trim() !== "";

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    setSaved(false);
    for (const [index, model] of customs.entries()) {
      const message = await models.register({
        providerId: provider.id,
        providerName: provider.name,
        baseUrl: baseUrl.trim(),
        api,
        apiKey: index === 0 ? apiKey.trim() : "",
        modelId: model.id,
        modelName: model.name,
        reasoning: model.reasoning,
        contextWindow: null,
        maxTokens: null,
      });
      if (typeof message === "string" && message) {
        setError(message);
        setSaving(false);
        return;
      }
    }
    setApiKey("");
    setSaved(true);
    setSaving(false);
  }

  return (
    <div className="models-form">
      <label className="models-field">
        <span>{text.baseUrl}</span>
        <input
          className="mono"
          value={baseUrl}
          placeholder={text.baseUrlPlaceholder}
          spellCheck={false}
          onChange={(event) => { setBaseUrl(event.target.value); setSaved(false); }}
        />
      </label>
      <ApiSelect copy={text} value={api} onChange={(next) => { setApi(next); setSaved(false); }} />
      <KeyField copy={text} value={apiKey} placeholder={text.apiKeySavedPlaceholder} onChange={(next) => { setApiKey(next); setSaved(false); }} />
      {error ? <p className="settings-error">{error}</p> : null}
      {dirty || saved ? (
        <div className="models-form-actions">
          {saved && !dirty ? <span className="settings-saved">{text.saved}</span> : null}
          {dirty ? (
            <>
              <button
                type="button"
                className="models-btn"
                disabled={saving}
                onClick={() => { setBaseUrl(endpoint.baseUrl); setApi(endpoint.api); setApiKey(""); setError(null); }}
              >
                {text.cancel}
              </button>
              <button type="button" className="models-btn primary" disabled={saving || !baseUrl.trim() || customs.length === 0} onClick={() => void save()}>
                {saving ? text.saving : text.save}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type Editing = { mode: "add" } | { mode: "edit"; modelId: string };

function ModelList({
  text,
  provider,
  providerModels,
  models,
  preferences,
}: {
  text: ModelsCopy;
  provider: ProviderSummary;
  providerModels: ModelSummary[];
  models: ModelsApi;
  preferences: PreferencesApi;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<ModelDraft>(emptyModelDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const listed = providerModels.filter((model) => model.available);
  const endpoint = provider.endpoint;

  function startEdit(model: ModelSummary): void {
    setEditing({ mode: "edit", modelId: model.id });
    setDraft({
      modelId: model.id,
      modelName: model.name === model.id ? "" : model.name,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow ? String(model.contextWindow) : "",
      maxTokens: "",
    });
    setError(null);
  }

  async function saveModel(): Promise<void> {
    if (!endpoint) return;
    setSaving(true);
    setError(null);
    const message = await models.register({
      providerId: provider.id,
      providerName: provider.name,
      baseUrl: endpoint.baseUrl,
      api: asApi(endpoint.api),
      apiKey: "",
      modelId: draft.modelId.trim(),
      modelName: draft.modelName.trim(),
      reasoning: draft.reasoning,
      contextWindow: countOrNull(draft.contextWindow),
      maxTokens: countOrNull(draft.maxTokens),
    });
    setSaving(false);
    if (typeof message === "string" && message) {
      setError(message);
      return;
    }
    setEditing(null);
    setDraft(emptyModelDraft);
  }

  async function deleteModel(model: ModelSummary): Promise<void> {
    if (pendingDelete !== model.id) {
      setPendingDelete(model.id);
      return;
    }
    setPendingDelete(null);
    const message = await models.remove(provider.id, model.id);
    if (typeof message === "string" && message) setError(message);
  }

  return (
    <div className="models-section models-models" data-setting-id="model-visibility">
      <div className="models-section-head">
        <div className="models-label">
          <span>{text.visibility}</span>
          {listed.length > 0 ? <span className="models-label-hint">{text.modelCount(listed.length)}</span> : null}
        </div>
        {provider.custom && endpoint ? (
          <button
            type="button"
            className="models-btn small"
            onClick={() => { setEditing({ mode: "add" }); setDraft(emptyModelDraft); setError(null); }}
          >
            <PlusIcon size={13} />
            {text.addModel}
          </button>
        ) : null}
      </div>
      <p className="settings-hint">{text.visibilityHint}</p>

      {editing ? (
        <div className="models-editor">
          <ModelFields copy={text} value={draft} idLocked={editing.mode === "edit"} onChange={setDraft} />
          {error ? <p className="settings-error">{error}</p> : null}
          <div className="models-form-actions">
            <button type="button" className="models-btn" onClick={() => { setEditing(null); setError(null); }}>{text.cancel}</button>
            <button type="button" className="models-btn primary" disabled={saving || !draft.modelId.trim()} onClick={() => void saveModel()}>
              {saving ? text.submitting : editing.mode === "add" ? text.submit : text.save}
            </button>
          </div>
        </div>
      ) : error ? <p className="settings-error">{error}</p> : null}

      <div className="models-list">
        {listed.length === 0 ? (
          <p className="models-list-empty">
            {provider.custom ? text.noModelsCustom : providerStatus(provider) === "connected" ? text.noModels : text.noModelsBuiltin}
          </p>
        ) : null}
        {listed.map((model) => {
          const visible = !preferences.isModelHidden(model.provider, model.id);
          const context = formatContext(model.contextWindow);
          return (
            <div className={`models-row${visible ? "" : " off"}`} key={model.id}>
              <div className="models-row-main">
                <span className="models-row-id" title={model.name === model.id ? model.id : `${model.name} · ${model.id}`}>{model.id}</span>
                {context ? <span className="models-tag">{context}</span> : null}
                {model.reasoning ? (
                  <span className="models-tag soft" title={`${text.reasoningLevels}: ${model.thinkingLevels.join(" / ")}`}>{text.tagReasoning}</span>
                ) : null}
                {model.vision ? <span className="models-tag soft">{text.tagVision}</span> : null}
              </div>
              {model.custom ? (
                <div className="models-row-actions">
                  <button type="button" className="models-icon-btn" aria-label={text.editModel} title={text.editModel} onClick={() => startEdit(model)}>
                    <PencilIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className={`models-icon-btn danger${pendingDelete === model.id ? " armed" : ""}`}
                    aria-label={pendingDelete === model.id ? text.confirmDelete : text.deleteModel}
                    title={pendingDelete === model.id ? text.confirmDelete : text.deleteModel}
                    onBlur={() => setPendingDelete((current) => (current === model.id ? null : current))}
                    onClick={() => void deleteModel(model)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              ) : null}
              <SettingsSwitch
                checked={visible}
                label={visible ? text.visibilityHide : text.visibilityShow}
                title={visible ? text.visibilityHide : text.visibilityShow}
                onChange={(next) => preferences.setModelHidden(model.provider, model.id, !next)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 垃圾桶按钮,点两次才生效。自定义供应商会删掉它的全部自定义模型;
 * 内置提供方只是清掉本机保存的凭据(退出登录),列表里随之消失。失败原因由 models.actionError 在页面顶部显示。
 */
function RemoveProvider({ text, provider, providerModels, models, onRemoved }: { text: ModelsCopy; provider: ProviderSummary; providerModels: ModelSummary[]; models: ModelsApi; onRemoved: () => void }) {
  const [armed, setArmed] = useState(false);
  const label = armed ? text.confirmRemove : provider.custom ? text.remove : text.logout;

  async function remove(): Promise<void> {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    if (!provider.custom) {
      await models.logout(provider.id);
      return;
    }
    for (const model of providerModels.filter((item) => item.custom)) {
      const message = await models.remove(provider.id, model.id);
      if (typeof message === "string" && message) return;
    }
    onRemoved();
  }

  return (
    <button
      type="button"
      className={`models-icon-btn danger${armed ? " armed" : ""}`}
      aria-label={label}
      title={label}
      onBlur={() => setArmed(false)}
      onClick={() => void remove()}
    >
      <TrashIcon size={15} />
    </button>
  );
}
