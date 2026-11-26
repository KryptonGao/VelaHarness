import { maxSubagentModelDescriptionLength, maxSubagentModels, type AgentInfo, type AgentSettings, type CustomSubagentProfile, type ModelCatalog, type ModelRef, type ModelSummary, type SubagentModelRef, type ThinkingLevel } from "@vela/shared";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { modelKey } from "../../hooks/usePreferences";
import { localizeError, tr, trf } from "../../locale";
import { Icon } from "../icons";
import { thinkingLabel } from "../ModelControls";
import type { SettingsCopy } from "../settings-copy";
import { SettingsBlock, SettingsGroup } from "./primitives";
import { CustomSubagentsBlock } from "./CustomSubagentsBlock";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface PoolEntry {
  ref: SubagentModelRef;
  /** 目录里找得到且可用；找不到或已退出登录时为 null,仍留在池里供用户移除。 */
  model: ModelSummary | null;
}

/** 左池:已登录/已配置密钥、没有在模型列表里被隐藏、还没放进右池的模型,按提供方分组。 */
export function availableForPool(catalog: ModelCatalog | null, hiddenModels: readonly string[], pool: readonly ModelRef[], query: string): { provider: string; name: string; models: ModelSummary[] }[] {
  const taken = new Set(pool.map((ref) => modelKey(ref.provider, ref.modelId)));
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, { provider: string; name: string; models: ModelSummary[] }>();
  for (const model of catalog?.models ?? []) {
    if (!model.available) continue;
    const key = modelKey(model.provider, model.id);
    if (taken.has(key) || hiddenModels.includes(key)) continue;
    if (needle && !`${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(needle)) continue;
    const group = groups.get(model.provider) ?? { provider: model.provider, name: model.providerName, models: [] };
    group.models.push(model);
    groups.set(model.provider, group);
  }
  return [...groups.values()];
}

export function SubagentModelsPage({
  copy,
  catalog,
  hiddenModels,
  agents = [],
}: {
  copy: SettingsCopy;
  catalog: ModelCatalog | null;
  hiddenModels: readonly string[];
  agents?: readonly AgentInfo[];
}) {
  const text = copy.subagentModels;
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [profiles, setProfiles] = useState<CustomSubagentProfile[] | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // 与 AgentDefaultsPage 相同的保存策略:请求串行,后发的覆盖先发的,失败回到上次确认的值。
  const target = useRef<AgentSettings | null>(null);
  const confirmed = useRef<AgentSettings | null>(null);
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const api = window.vela;
    if (!api) return;
    let active = true;
    void api.getAgentSettings().then(
      (loaded) => {
        if (!active) return;
        target.current = loaded;
        confirmed.current = loaded;
        setSettings(loaded);
        setProfiles(loaded.customSubagents ?? []);
      },
      (caught: unknown) => {
        if (!active) return;
        setStatus("error");
        setError(caught instanceof Error ? caught.message : text.loadError);
      },
    );
    return () => {
      active = false;
    };
  }, [text.loadError]);

  const persist = useCallback((patch: Partial<AgentSettings>, includeNamingStyle = false) => {
    const api = window.vela;
    const base = target.current;
    if (!api || !base) return;
    const next = { ...base, ...patch };
    const request = { ...next };
    if (!includeNamingStyle) delete request.subagentNamingStyle;
    target.current = next;
    setSettings(next);
    setStatus("saving");
    setError(null);
    pending.current += 1;
    chain.current = chain.current.then(async () => {
      try {
        const saved = await api.saveAgentSettings(request);
        confirmed.current = saved;
        if (pending.current === 1) {
          target.current = saved;
          setSettings(saved);
          setStatus("saved");
        }
      } catch (caught) {
        if (pending.current > 1) return;
        const back = confirmed.current;
        target.current = back;
        setSettings(back);
        setStatus("error");
        setError(caught instanceof Error ? caught.message : text.loadError);
      } finally {
        pending.current -= 1;
      }
    });
  }, [text.loadError]);

  const pool = settings?.subagentModels ?? [];
  const availableModels = useMemo(() => availableForPool(catalog, hiddenModels, [], ""), [catalog, hiddenModels]);
  const left = useMemo(() => availableForPool(catalog, hiddenModels, pool, query), [catalog, hiddenModels, pool, query]);
  const right = useMemo<PoolEntry[]>(() => pool.map((ref) => ({
    ref,
    model: catalog?.models.find((model) => model.provider === ref.provider && model.id === ref.modelId && model.available) ?? null,
  })), [catalog, pool]);
  const editing = right.find(({ ref }) => modelKey(ref.provider, ref.modelId) === editingKey);
  const leftCount = left.reduce((sum, group) => sum + group.models.length, 0);
  const full = pool.length >= maxSubagentModels;

  const add = (models: readonly ModelSummary[]) => {
    const current = target.current?.subagentModels ?? [];
    const currentKeys = new Set(current.map((ref) => modelKey(ref.provider, ref.modelId)));
    const additions = models.filter((model) => !currentKeys.has(modelKey(model.provider, model.id)));
    const room = maxSubagentModels - current.length;
    if (room <= 0 || additions.length === 0) return;
    persist({ subagentModels: [...current, ...additions.slice(0, room).map((model) => ({ provider: model.provider, modelId: model.id }))] });
  };
  const remove = (ref: ModelRef) => {
    const current = target.current?.subagentModels ?? [];
    persist({ subagentModels: current.filter((item) => item.provider !== ref.provider || item.modelId !== ref.modelId) });
  };
  return (
    <section className="settings-section">
      <div className="settings-autosave" role="status" aria-live="polite">
        {status === "saving" ? <span>{copy.agent.saving}</span> : null}
        {status === "saved" ? <span className="settings-saved">{copy.agent.saved}</span> : null}
        {error ? <span className="settings-error">{localizeError(error)}</span> : null}
      </div>

      <CustomSubagentsBlock copy={copy} catalog={catalog} models={availableModels} agents={agents} profiles={profiles} onProfilesChange={setProfiles} />
      <SettingsGroup>
        <SettingsBlock id="subagent-naming-style" title={copy.subagentNamingStyle.title} hint={copy.subagentNamingStyle.hint}>
          <div className="settings-stack" role="radiogroup" aria-label={copy.subagentNamingStyle.title}>
            {([
              ["practical", copy.subagentNamingStyle.practical, copy.subagentNamingStyle.practicalExample],
              ["artistic", copy.subagentNamingStyle.artistic, copy.subagentNamingStyle.artisticExample],
            ] as const).map(([id, label, example]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={(settings?.subagentNamingStyle ?? "practical") === id}
                className={`settings-radio${(settings?.subagentNamingStyle ?? "practical") === id ? " active" : ""}`}
                disabled={!settings}
                onClick={() => persist({ subagentNamingStyle: id }, true)}
              >
                <span className="settings-radio-title">{label}</span>
                <span className="settings-radio-hint">{example}</span>
              </button>
            ))}
          </div>
        </SettingsBlock>
        <SettingsBlock id="subagent-models" title={text.title} hint={text.hint}>
          <div className="subagent-pools">
            <div className="subagent-pool" role="group" aria-label={text.available}>
              <header className="subagent-pool-head">
                <h4>{text.available}</h4>
                <button type="button" className="subagent-pool-action" disabled={!settings || leftCount === 0 || full} onClick={() => add(left.flatMap((group) => group.models))}>
                  {text.addAll}
                </button>
              </header>
              <input
                className="settings-input subagent-pool-search"
                type="text"
                aria-label={text.search}
                placeholder={text.search}
                value={query}
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="subagent-pool-list">
                {leftCount === 0 ? (
                  <p className="subagent-pool-empty">{query.trim() ? text.noMatch : text.availableEmpty}</p>
                ) : left.map((group) => (
                  <div key={group.provider} className="subagent-pool-group">
                    <span className="subagent-pool-group-name">{group.name}</span>
                    {group.models.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className="subagent-pool-row"
                        disabled={!settings || full}
                        title={`${text.add}: ${model.name}`}
                        onClick={() => add([model])}
                      >
                        <span className="subagent-pool-name">{model.name}</span>
                        <span className="subagent-pool-move" aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="subagent-pool" role="group" aria-label={text.allowed}>
              <header className="subagent-pool-head">
                <h4>{text.allowed}<span className="subagent-pool-count">{pool.length}</span></h4>
                <button type="button" className="subagent-pool-action" disabled={!settings || pool.length === 0} onClick={() => persist({ subagentModels: [] })}>
                  {text.clear}
                </button>
              </header>
              <div className="subagent-pool-list">
                {right.length === 0 ? <p className="subagent-pool-empty">{text.allowedEmpty}</p> : right.map(({ ref, model }) => (
                  <div key={modelKey(ref.provider, ref.modelId)} className="subagent-pool-entry">
                    <button
                      type="button"
                      className="subagent-pool-row"
                      data-unavailable={model ? undefined : "true"}
                      title={`${text.remove}: ${model?.name ?? ref.modelId}`}
                      onClick={() => remove(ref)}
                    >
                      <span className="subagent-pool-move" aria-hidden="true">←</span>
                      <span className="subagent-pool-name">{model?.name ?? ref.modelId}</span>
                      <span className="subagent-pool-provider">{model?.providerName ?? ref.provider}</span>
                      {model ? null : <span className="subagent-pool-flag">{text.unavailable}</span>}
                    </button>
                    <button
                      type="button"
                      className="subagent-effort-button"
                      disabled={!model}
                      aria-haspopup="dialog"
                      aria-label={trf("设置 {0} 的模型", "Configure {0} model", model?.name ?? ref.modelId)}
                      title={tr("模型设置", "Model settings")}
                      onClick={() => setEditingKey(modelKey(ref.provider, ref.modelId))}
                    >
                      <Icon name="sliders" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="settings-note">{full ? text.full : pool.length === 0 ? text.emptyNote : text.note}</p>
        </SettingsBlock>
      </SettingsGroup>
      {editing?.model && <EffortDialog
        model={editing.model}
        configured={editing.ref.thinkingLevels}
        description={editing.ref.description}
        onClose={() => setEditingKey(null)}
        onSave={(levels, description) => {
          const current = target.current?.subagentModels ?? [];
          persist({ subagentModels: current.map(item => {
            if (item.provider !== editing.ref.provider || item.modelId !== editing.ref.modelId) return item;
            const next = { ...item };
            if (levels) next.thinkingLevels = levels;
            else delete next.thinkingLevels;
            if (description?.trim()) next.description = description;
            else delete next.description;
            return next;
          }) });
          setEditingKey(null);
        }}
      />}
    </section>
  );
}

function EffortDialog({ model, configured, description: initialDescription, onClose, onSave }: {
  model: ModelSummary;
  configured?: ThinkingLevel[];
  description?: string;
  onClose: () => void;
  onSave: (levels: ThinkingLevel[] | undefined, description: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [selected, setSelected] = useState(configured ?? model.thinkingLevels);
  const [description, setDescription] = useState(initialDescription ?? "");
  const levels = model.thinkingLevels.filter(level => selected.includes(level));

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="workspace-settings-dialog subagent-effort-dialog" aria-labelledby={titleId}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="subagent-effort-content">
        <header className="workspace-settings-head">
          <h2 id={titleId}>{tr("模型设置", "Model settings")}</h2>
          <button type="button" className="workspace-settings-close" aria-label={tr("关闭", "Close")} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="workspace-settings-name subagent-effort-model">
          <Icon name="chip" size={16} />
          <span className="workspace-settings-folder" title={model.name}>{model.name}</span>
          <span className="subagent-pool-provider">{model.providerName}</span>
        </div>
        <div className="workspace-settings-label" id={descriptionId}>{tr("模型简介（可选）", "Model description (optional)")}</div>
        <textarea
          className="settings-input subagent-description-input"
          aria-labelledby={descriptionId}
          rows={3}
          maxLength={maxSubagentModelDescriptionLength}
          value={description}
          onChange={event => setDescription(event.target.value)}
        />
        <div className="workspace-settings-label" id={`${titleId}-levels`}>{tr("可用推理强度", "Allowed reasoning efforts")}</div>
        <div className="workspace-settings-folders" role="group" aria-labelledby={`${titleId}-levels`}>
          {model.thinkingLevels.map(level => (
            <button key={level} type="button" className="workspace-settings-row subagent-effort-option"
              aria-pressed={levels.includes(level)}
              onClick={() => setSelected(current => current.includes(level) ? current.filter(value => value !== level) : [...current, level])}>
              {thinkingLabel(level)}
              {levels.includes(level) && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
        <footer className="workspace-settings-actions">
          <button type="button" className="workspace-settings-cancel" onClick={onClose}>{tr("取消", "Cancel")}</button>
          <button type="button" className="workspace-settings-save" disabled={!levels.length}
            onClick={() => onSave(levels.length === model.thinkingLevels.length ? undefined : levels, description)}>
            {tr("保存", "Save")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
