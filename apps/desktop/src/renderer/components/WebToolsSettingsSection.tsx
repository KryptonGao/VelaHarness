/**
 * 设置页「网页工具」：开关、搜索与抓取各自使用的提供商、提供商密钥和自定义接口。
 * 与「模型与账号」完全分开；密钥只写入，保存后界面只显示「已保存」。
 */
import type { WebAuthType, WebCapability, WebProvider, WebProviderView, WebToolsConfig, WebToolsResult, WebToolsState } from "@vela/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppLocale } from "../hooks/usePreferences";
import { localizeError } from "../locale";
import { settingsCopy, type SettingsCopy } from "./settings-copy";
import { Field, SettingsBlock, SettingsSwitch } from "./settings/primitives";
import {
  draftFromProvider, emptyDraft, providerFromDraft,
  type EndpointDraftBase, type FetchDraft, type ProviderDraft, type SearchDraft,
} from "./web-tools-settings-model";
import "../web-tools.css";

type Copy = SettingsCopy["webTools"];

const fill = (template: string, ...args: (string | number)[]): string =>
  template.replace(/\{(\d+)\}/g, (match, index: string) => String(args[Number(index)] ?? match));

function failureText(result: Extract<WebToolsResult<unknown>, { ok: false }>, copy: Copy): string {
  const known = (copy.errors as Record<string, string>)[result.code];
  if (result.code === "invalid") return result.message ? localizeError(result.message) : copy.errors.invalid;
  return known ?? localizeError(result.message);
}

function configOf(state: WebToolsState, patch: Partial<WebToolsConfig> = {}): WebToolsConfig {
  return {
    enabled: state.enabled,
    searchProviderId: state.searchProviderId,
    fetchProviderId: state.fetchProviderId,
    providers: state.providers.filter(provider => !provider.builtin).map(({ hasKey: _hasKey, ...provider }) => provider as WebProvider),
    ...patch,
  };
}

export function WebToolsSettingsSection({ locale }: { locale: AppLocale }) {
  const copy = settingsCopy(locale).webTools;
  const api = window.vela?.webTools;
  const [state, setState] = useState<WebToolsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, { pending: boolean; text: string | null; failed: boolean }>>({});
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!api) { setLoading(false); return; }
    try {
      const result = await api.get();
      if (!alive.current) return;
      if (result.ok) { setState(result.value); setError(null); } else setError(failureText(result, copy));
    } catch (caught) {
      if (alive.current) setError(localizeError(caught instanceof Error ? caught.message : String(caught)));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [api, copy]);

  useEffect(() => { void load(); }, [load]);

  /** 统一的写入入口：成功后换成主进程返回的最新状态。 */
  async function run(action: () => Promise<WebToolsResult<WebToolsState>>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!alive.current) return false;
      if (!result.ok) { setError(failureText(result, copy)); return false; }
      setState(result.value);
      return true;
    } catch (caught) {
      if (alive.current) setError(localizeError(caught instanceof Error ? caught.message : String(caught)));
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function runTest(provider: WebProviderView, capability: WebCapability): Promise<void> {
    if (!api) return;
    const key = `${provider.id}:${capability}`;
    setTests(current => ({ ...current, [key]: { pending: true, text: null, failed: false } }));
    let text: string;
    let failed = false;
    try {
      const result = await api.test({ providerId: provider.id, capability });
      if (result.ok) {
        text = capability === "search"
          ? fill(copy.testSearchOk, result.value.size, result.value.durationMs)
          : fill(copy.testFetchOk, result.value.size, result.value.durationMs);
      } else {
        failed = true;
        text = failureText(result, copy);
      }
    } catch (caught) {
      failed = true;
      text = localizeError(caught instanceof Error ? caught.message : String(caught));
    }
    if (alive.current) setTests(current => ({ ...current, [key]: { pending: false, text, failed } }));
  }

  async function saveKey(provider: WebProviderView): Promise<void> {
    const value = (keys[provider.id] ?? "").trim();
    if (!api || !value) return;
    if (await run(() => api.setApiKey({ providerId: provider.id, apiKey: value }))) {
      setKeys(current => ({ ...current, [provider.id]: "" }));
    }
  }

  async function saveProvider(): Promise<void> {
    if (!api || !state || !draft) return;
    const built = providerFromDraft(draft, new Set(state.providers.map(provider => provider.id)));
    if (!built.ok) { setDraftError(copy.errors[built.error]); return; }
    setDraftError(null);
    const others = configOf(state).providers.filter(provider => provider.id !== built.provider.id);
    // 编辑时原位替换，保持列表顺序。
    const replaced = configOf(state).providers.some(provider => provider.id === built.provider.id);
    const providers = replaced
      ? configOf(state).providers.map(provider => provider.id === built.provider.id ? built.provider : provider)
      : [...others, built.provider];
    if (await run(() => api.save(configOf(state, { providers })))) setDraft(null);
  }

  async function removeProvider(id: string): Promise<void> {
    if (!api || !state) return;
    const providers = configOf(state).providers.filter(provider => provider.id !== id);
    await run(() => api.save(configOf(state, {
      providers,
      searchProviderId: state.searchProviderId === id ? null : state.searchProviderId,
      fetchProviderId: state.fetchProviderId === id ? null : state.fetchProviderId,
    })));
    setConfirming(null);
  }

  if (!api) {
    return (
      <section className="settings-section web-tools-settings">
        <p className="settings-note">{copy.unavailable}</p>
      </section>
    );
  }

  const providers = state?.providers ?? [];
  const optionLabel = (provider: WebProviderView) => provider.hasKey ? provider.name : fill(copy.providerNoKey, provider.name);

  function select(capability: WebCapability, value: string | null): void {
    if (!api || !state) return;
    void run(() => api.save(configOf(state, capability === "search" ? { searchProviderId: value } : { fetchProviderId: value })));
  }

  return (
    <section className="settings-section web-tools-settings">
      <SettingsBlock id="web-tools-enabled" title={copy.enabledLabel} hint={copy.hint}>
        <div className="web-tools-toggle-row">
          <span className="settings-note" role="status">
            {loading ? copy.loading : busy ? copy.saving : state?.enabled ? copy.enabledStatus : copy.disabledStatus}
          </span>
          <SettingsSwitch
            checked={state?.enabled ?? false}
            label={copy.enabledLabel}
            disabled={!state || busy}
            onChange={(enabled) => state && void run(() => api.save(configOf(state, { enabled })))}
          />
        </div>
        <p className="settings-hint">{copy.enabledHint}</p>
        {error ? <p className="settings-error" role="alert">{error}</p> : null}
        {state && !state.keysAvailable ? <p className="settings-error" role="alert">{copy.keysUnavailable}</p> : null}
      </SettingsBlock>

      <SettingsBlock title={copy.selectionTitle} hint={copy.selectionHint}>
        <div className="settings-form">
          <Field label={copy.searchProvider}>
            <select
              value={state?.searchProviderId ?? ""}
              disabled={!state || busy}
              onChange={(event) => select("search", event.target.value || null)}
            >
              <option value="">{copy.providerNone}</option>
              {providers.filter(provider => provider.search).map(provider => (
                <option key={provider.id} value={provider.id}>{optionLabel(provider)}</option>
              ))}
            </select>
          </Field>
          <Field label={copy.fetchProvider}>
            <select
              value={state?.fetchProviderId ?? ""}
              disabled={!state || busy}
              onChange={(event) => select("fetch", event.target.value || null)}
            >
              <option value="">{copy.providerNone}</option>
              {providers.filter(provider => provider.fetch).map(provider => (
                <option key={provider.id} value={provider.id}>{optionLabel(provider)}</option>
              ))}
            </select>
          </Field>
        </div>
      </SettingsBlock>

      <SettingsBlock id="web-tools-providers" title={copy.providersTitle} hint={copy.keyHint}>
        <div className="settings-stack">
          {providers.map(provider => (
            <article className="settings-provider web-tools-provider" key={provider.id}>
              <div className="settings-provider-copy">
                <div className="settings-provider-name">
                  {provider.name}
                  <span className="web-tools-badge">{provider.builtin ? copy.builtin : copy.custom}</span>
                </div>
                <div className="settings-provider-meta">
                  <span>{[provider.search ? copy.supportsSearch : null, provider.fetch ? copy.supportsFetch : null].filter(Boolean).join(" · ")}</span>
                  <span className={provider.hasKey ? "settings-status connected" : undefined}>{provider.hasKey ? copy.keySaved : copy.keyMissing}</span>
                </div>
                {provider.id === "deepseek" ? <p className="settings-hint">{copy.deepseekNote}</p> : null}
                <form
                  className="web-tools-key-row"
                  onSubmit={(event) => { event.preventDefault(); void saveKey(provider); }}
                >
                  <input
                    type="password"
                    aria-label={`${provider.name} ${copy.keyPlaceholder}`}
                    value={keys[provider.id] ?? ""}
                    placeholder={copy.keyPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy || !state?.keysAvailable}
                    onChange={(event) => setKeys(current => ({ ...current, [provider.id]: event.target.value }))}
                  />
                  <button className="settings-secondary" type="submit" disabled={busy || !(keys[provider.id] ?? "").trim() || !state?.keysAvailable}>
                    {provider.hasKey ? copy.replaceKey : copy.saveKey}
                  </button>
                  {provider.hasKey ? (
                    <button className="settings-secondary settings-danger" type="button" disabled={busy} onClick={() => void run(() => api.setApiKey({ providerId: provider.id, apiKey: null }))}>
                      {copy.removeKey}
                    </button>
                  ) : null}
                </form>
                <div className="settings-actions web-tools-tests">
                  {(["search", "fetch"] as const).filter(capability => provider[capability]).map(capability => {
                    const result = tests[`${provider.id}:${capability}`];
                    return (
                      <span className="web-tools-test" key={capability}>
                        <button
                          className="settings-secondary"
                          type="button"
                          disabled={busy || result?.pending || !provider.hasKey}
                          onClick={() => void runTest(provider, capability)}
                        >
                          {result?.pending ? copy.testing : capability === "search" ? copy.testSearch : copy.testFetch}
                        </button>
                        {result?.text ? (
                          <span className={result.failed ? "settings-error" : "settings-saved"} role="status">{result.text}</span>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              </div>
              {!provider.builtin ? (
                <div className="settings-provider-actions">
                  <button
                    className="settings-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => { setDraft(draftFromProvider(provider)); setDraftError(null); }}
                  >
                    {copy.edit}
                  </button>
                  {confirming === provider.id ? (
                    <>
                      <button className="settings-secondary settings-danger" type="button" disabled={busy} onClick={() => void removeProvider(provider.id)}>
                        {copy.confirmRemove}
                      </button>
                      <button className="settings-secondary" type="button" onClick={() => setConfirming(null)}>{copy.cancel}</button>
                    </>
                  ) : (
                    <button className="settings-secondary settings-danger" type="button" disabled={busy} onClick={() => setConfirming(provider.id)}>
                      {copy.remove}
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        {draft ? null : (
          <div className="settings-actions">
            <button className="settings-secondary" type="button" disabled={!state || busy} onClick={() => { setDraft(emptyDraft()); setDraftError(null); }}>
              {copy.add}
            </button>
          </div>
        )}
      </SettingsBlock>

      {draft ? (
        <ProviderEditor
          copy={copy}
          draft={draft}
          error={draftError}
          busy={busy}
          onChange={setDraft}
          onSave={() => void saveProvider()}
          onCancel={() => { setDraft(null); setDraftError(null); }}
        />
      ) : null}
    </section>
  );
}

function ProviderEditor({ copy, draft, error, busy, onChange, onSave, onCancel }: {
  copy: Copy; draft: ProviderDraft; error: string | null; busy: boolean;
  onChange: (draft: ProviderDraft) => void; onSave: () => void; onCancel: () => void;
}) {
  const setSearch = (patch: Partial<SearchDraft>) => onChange({ ...draft, search: { ...draft.search, ...patch } });
  const setFetch = (patch: Partial<FetchDraft>) => onChange({ ...draft, fetch: { ...draft.fetch, ...patch } });
  return (
    <SettingsBlock title={draft.id ? copy.editorEdit : copy.editorNew} hint={copy.editorHint}>
      <form className="settings-form web-tools-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <Field label={copy.fieldName}>
          <input value={draft.name} placeholder={copy.fieldNamePlaceholder} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </Field>

        <div className="settings-optional">
          <label className="check-row">
            <input type="checkbox" checked={draft.search.enabled} onChange={(event) => setSearch({ enabled: event.target.checked })} />
            <span>{copy.endpointSearch}</span>
          </label>
          {draft.search.enabled ? (
            <>
              <EndpointFields copy={copy} value={draft.search} bodyHint={copy.bodyHintSearch} onChange={setSearch} />
              <Field label={copy.fieldResultsPath}>
                <input value={draft.search.resultsPath} spellCheck={false} onChange={(event) => setSearch({ resultsPath: event.target.value })} />
              </Field>
              <p className="settings-hint">{copy.fieldResultsPathHint}</p>
              <div className="web-tools-grid">
                <Field label={copy.fieldTitle}><input value={draft.search.title} spellCheck={false} onChange={(event) => setSearch({ title: event.target.value })} /></Field>
                <Field label={copy.fieldLink}><input value={draft.search.link} spellCheck={false} onChange={(event) => setSearch({ link: event.target.value })} /></Field>
                <Field label={copy.fieldSnippet}><input value={draft.search.snippet} spellCheck={false} onChange={(event) => setSearch({ snippet: event.target.value })} /></Field>
                <Field label={copy.fieldSummary}><input value={draft.search.summary} spellCheck={false} onChange={(event) => setSearch({ summary: event.target.value })} /></Field>
                <Field label={copy.fieldContent}><input value={draft.search.content} spellCheck={false} onChange={(event) => setSearch({ content: event.target.value })} /></Field>
                <Field label={copy.fieldDate}><input value={draft.search.date} spellCheck={false} onChange={(event) => setSearch({ date: event.target.value })} /></Field>
                <Field label={copy.fieldSource}><input value={draft.search.source} spellCheck={false} onChange={(event) => setSearch({ source: event.target.value })} /></Field>
              </div>
            </>
          ) : null}
        </div>

        <div className="settings-optional">
          <label className="check-row">
            <input type="checkbox" checked={draft.fetch.enabled} onChange={(event) => setFetch({ enabled: event.target.checked })} />
            <span>{copy.endpointFetch}</span>
          </label>
          {draft.fetch.enabled ? (
            <>
              <EndpointFields copy={copy} value={draft.fetch} bodyHint={copy.bodyHintFetch} onChange={setFetch} />
              <div className="web-tools-grid">
                <Field label={copy.fieldTitlePath}><input value={draft.fetch.titlePath} spellCheck={false} onChange={(event) => setFetch({ titlePath: event.target.value })} /></Field>
                <Field label={copy.fieldContentPath}><input value={draft.fetch.contentPath} spellCheck={false} onChange={(event) => setFetch({ contentPath: event.target.value })} /></Field>
              </div>
            </>
          ) : null}
        </div>

        {error ? <p className="settings-error" role="alert">{error}</p> : null}
        <div className="settings-actions">
          <button className="primary-btn" type="submit" disabled={busy}>{busy ? copy.saving : copy.saveProvider}</button>
          <button className="settings-secondary" type="button" disabled={busy} onClick={onCancel}>{copy.cancel}</button>
        </div>
      </form>
    </SettingsBlock>
  );
}

function EndpointFields({ copy, value, bodyHint, onChange }: {
  copy: Copy; value: EndpointDraftBase; bodyHint: string; onChange: (patch: Partial<EndpointDraftBase>) => void;
}) {
  const authOptions: { id: WebAuthType; label: string }[] = [
    { id: "bearer", label: copy.authBearer }, { id: "header", label: copy.authHeader },
    { id: "query", label: copy.authQuery }, { id: "none", label: copy.authNone },
  ];
  return (
    <>
      <Field label={copy.fieldUrl}>
        <input value={value.url} placeholder={copy.fieldUrlPlaceholder} spellCheck={false} onChange={(event) => onChange({ url: event.target.value })} />
      </Field>
      <div className="web-tools-grid">
        <Field label={copy.fieldMethod}>
          <select value={value.method} onChange={(event) => onChange({ method: event.target.value as "GET" | "POST" })}>
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
        </Field>
        <Field label={copy.fieldAuth}>
          <select value={value.authType} onChange={(event) => onChange({ authType: event.target.value as WebAuthType })}>
            {authOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </Field>
        {value.authType === "header" || value.authType === "query" ? (
          <Field label={copy.fieldAuthName}>
            <input value={value.authName} placeholder={copy.fieldAuthNamePlaceholder} spellCheck={false} onChange={(event) => onChange({ authName: event.target.value })} />
          </Field>
        ) : null}
      </div>
      {value.method === "POST" ? (
        <>
          <Field label={copy.fieldBody}>
            <textarea className="settings-textarea web-tools-code" value={value.body} spellCheck={false} onChange={(event) => onChange({ body: event.target.value })} />
          </Field>
          <p className="settings-hint">{bodyHint}</p>
        </>
      ) : null}
      <details className="web-tools-advanced">
        <summary>{copy.advanced}</summary>
        <Field label={copy.fieldHeaders}>
          <textarea className="settings-textarea web-tools-code" value={value.headers} spellCheck={false} onChange={(event) => onChange({ headers: event.target.value })} />
        </Field>
        <Field label={copy.fieldQuery}>
          <textarea className="settings-textarea web-tools-code" value={value.query} spellCheck={false} onChange={(event) => onChange({ query: event.target.value })} />
        </Field>
      </details>
    </>
  );
}
