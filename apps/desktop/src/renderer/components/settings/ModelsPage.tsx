import { providerDisplayName } from "@vela/shared";
import { useRef, useState } from "react";
import type { useModels } from "../../hooks/useModels";
import type { PreferencesApi } from "../../hooks/usePreferences";
import { localizeError } from "../../locale";
import type { SettingsCopy } from "../settings-copy";
import { AddProviderPicker } from "./AddProviderPicker";
import { CustomProviderForm } from "./CustomProviderForm";
import { ProviderLogo } from "./models-parts";
import { groupListed, listedProviders, providerStatus, resolveSelection, builtinTemplates } from "./models-view";
import { ProviderDetail } from "./ProviderDetail";
import { Icon } from "../icons";

type ModelsApi = ReturnType<typeof useModels>;

/** 左侧供应商列表,右侧所选供应商的账号、接口和模型;添加供应商是同页的第二个视图。 */
export function ModelsPage({ copy, models, preferences }: { copy: SettingsCopy; models: ModelsApi; preferences: PreferencesApi }) {
  const text = copy.models;
  const catalog = models.catalog;
  const providers = catalog?.providers ?? [];
  const [view, setView] = useState<"list" | "add">("list");
  const freshAccount = useRef<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [refreshNote, setRefreshNote] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  const listed = listedProviders(providers, picked);
  const activeId = drafting ? null : resolveSelection(listed, selected);
  const active = listed.find((provider) => provider.id === activeId) ?? null;
  const groups = groupListed(listed);

  async function refreshModels(): Promise<void> {
    setRefreshNote(null);
    const result = await models.refreshFromPi();
    if (!result) return;
    if (result.offline) setRefreshNote({ tone: "error", message: text.refreshOffline });
    else if (result.errors.length > 0) {
      setRefreshNote({ tone: "error", message: `${text.refreshPartial}${result.errors.map((item) => `${item.provider}: ${item.message}`).join("; ")}` });
    } else setRefreshNote({ tone: "ok", message: text.refreshDone });
  }

  function select(providerId: string): void {
    freshAccount.current = null;
    setDrafting(false);
    setSelected(providerId);
  }

  async function pickBuiltin(builtinId: string) {
    setAdding(true);
    try {
      const id = await models.addProviderAccount(builtinId);
      if (id) {
        setPicked(current => new Set(current).add(id));
        select(id);
        if (id !== builtinId) freshAccount.current = id;
        setView("list");
      }
      return id;
    } finally {
      setAdding(false);
    }
  }

  if (view === "add") {
    return (
      <section className="settings-section models-page">
        <AddProviderPicker
          copy={copy}
          builtins={builtinTemplates(providers)}
          busy={adding}
          error={models.actionError && localizeError(models.actionError)}
          onBack={() => setView("list")}
          onPick={(id) => void pickBuiltin(id)}
          onCustom={() => {
            setDrafting(true);
            setView("list");
          }}
        />
      </section>
    );
  }

  const row = (provider: (typeof listed)[number]) => {
    const status = providerStatus(provider);
    return (
      <button
        type="button"
        role="option"
        key={provider.id}
        aria-selected={provider.id === activeId}
        className="models-provider"
        onClick={() => select(provider.id)}
      >
        <ProviderLogo provider={provider} />
        <span className="models-provider-copy" title={providerDisplayName(provider)}>
          <span className="models-provider-name">{provider.name}</span>
          {provider.note && <span className="models-provider-note">{provider.note}</span>}
        </span>
        <span
          className={`models-dot ${status}`}
          title={status === "connected" ? text.connectedStatus : status === "attention" ? text.attentionStatus : text.disconnectedStatus}
        />
      </button>
    );
  };

  const empty = listed.length === 0 && !drafting;

  return (
    <section className="settings-section models-page">
      <div className="models-toolbar">
        <p className="models-toolbar-desc">{copy.pages.models.description}</p>
        <button
          type="button"
          className="models-icon-btn bordered"
          aria-label={text.refresh}
          title={models.refreshing ? text.refreshing : `${text.refresh}\n${text.refreshHint}`}
          disabled={models.refreshing}
          onClick={() => void refreshModels()}
        >
          <span className={models.refreshing ? "models-spin" : undefined}><Icon name="refresh" size={16} /></span>
        </button>
        <button type="button" className="models-add-btn" data-setting-id="add-model" onClick={() => setView("add")}>
          <Icon name="plus" size={14} />
          {text.add}
        </button>
      </div>

      {refreshNote ? (
        <p className={refreshNote.tone === "error" ? "settings-error" : "settings-note"} role="status">{refreshNote.message}</p>
      ) : null}
      {models.catalogError ? <p className="settings-error">{localizeError(models.catalogError)}</p> : null}
      {models.actionError ? <p className="settings-error">{localizeError(models.actionError)}</p> : null}
      {catalog?.error ? <p className="settings-error">{catalog.error}</p> : null}

      {empty ? (
        <div className="models-empty">
          <span className="models-empty-ring"><Icon name="plus" size={24} /></span>
          <h3>{text.empty}</h3>
          <p>{text.emptyHint}</p>
          <button type="button" className="models-add-btn" onClick={() => setView("add")}>
            <Icon name="plus" size={14} />
            {text.add}
          </button>
        </div>
      ) : (
        <div className="models-split" data-setting-id="providers">
          <div className="models-list-pane" role="listbox" aria-label={text.list}>
            {groups.builtin.length > 0 ? <div className="models-group-label">{text.groupBuiltin}</div> : null}
            {groups.builtin.map(row)}
            {groups.custom.length > 0 || drafting ? <div className="models-group-label">{text.groupCustom}</div> : null}
            {groups.custom.map(row)}
            {drafting ? (
              <button type="button" role="option" aria-selected className="models-provider">
                <ProviderLogo provider={{ name: "", custom: true }} />
                <span className="models-provider-name">{text.createCustom}</span>
              </button>
            ) : null}
          </div>
          <div className="models-detail-pane">
            {drafting ? (
              <CustomProviderForm
                copy={copy}
                models={models}
                onCancel={() => setDrafting(false)}
                onAdded={(providerId) => {
                  setDrafting(false);
                  setSelected(providerId);
                }}
              />
            ) : active ? (
              <ProviderDetail
                key={active.id}
                copy={copy}
                provider={active}
                providerModels={(catalog?.models ?? []).filter((model) => model.provider === active.id)}
                models={models}
                preferences={preferences}
                onLogin={async (id, method) => {
                  const unused = freshAccount.current === active.id && !active.stored && !active.note;
                  freshAccount.current = null;
                  const target = id === active.id ? id : await pickBuiltin(id);
                  if (!target) return;
                  if (target !== active.id && unused) {
                    await models.removeProviderAccount(active.id);
                  }
                  freshAccount.current = null;
                  void models.loginProvider(target, method);
                }}
                onRemoved={() => {
                  setPicked(current => {
                    const next = new Set(current);
                    next.delete(active.id);
                    return next;
                  });
                  setSelected(null);
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
