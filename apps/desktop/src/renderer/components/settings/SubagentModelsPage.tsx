import { maxSubagentModels, type AgentSettings, type ModelCatalog, type ModelRef, type ModelSummary, type SubagentModelRef, type ThinkingLevel } from "@vela/shared";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { modelKey } from "../../hooks/usePreferences";
import { localizeError, tr, trf } from "../../locale";
import { Icon } from "../icons";
import { thinkingLabel } from "../ModelControls";
import type { SettingsCopy } from "../settings-copy";
import { SettingsBlock, SettingsGroup } from "./primitives";

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
}: {
  copy: SettingsCopy;
  catalog: ModelCatalog | null;
  hiddenModels: readonly string[];
}) {
  const text = copy.subagentModels;
  const [settings, setSettings] = useState<AgentSettings | null>(null);
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

  const persist = useCallback((subagentModels: SubagentModelRef[]) => {
    const api = window.vela;
    const base = target.current;
    if (!api || !base) return;
    const next = { ...base, subagentModels };
    target.current = next;
    setSettings(next);
    setStatus("saving");
    setError(null);
    pending.current += 1;
    chain.current = chain.current.then(async () => {
      try {
        const saved = await api.saveAgentSettings(next);
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
  const left = useMemo(() => availableForPool(catalog, hiddenModels, pool, query), [catalog, hiddenModels, pool, query]);
  const right = useMemo<PoolEntry[]>(() => pool.map((ref) => ({
    ref,
    model: catalog?.models.find((model) => model.provider === ref.provider && model.id === ref.modelId && model.available) ?? null,
  })), [catalog, pool]);
  const editing = right.find(({ ref }) => modelKey(ref.provider, ref.modelId) === editingKey);
  const leftCount = left.reduce((sum, group) => sum + group.models.length, 0);
  const full = pool.length >= maxSubagentModels;

  const add = (models: readonly ModelSummary[]) => {
    const room = maxSubagentModels - pool.length;
    if (room <= 0 || models.length === 0) return;
    persist([...pool, ...models.slice(0, room).map((model) => ({ provider: model.provider, modelId: model.id }))]);
  };
  const remove = (ref: ModelRef) => persist(pool.filter((item) => item.provider !== ref.provider || item.modelId !== ref.modelId));

  return (
    <section className="settings-section">
      <div className="settings-autosave" role="status" aria-live="polite">
        {status === "saving" ? <span>{copy.agent.saving}</span> : null}
        {status === "saved" ? <span className="settings-saved">{copy.agent.saved}</span> : null}
        {error ? <span className="settings-error">{localizeError(error)}</span> : null}
      </div>

      <SettingsGroup>
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
                <button type="button" className="subagent-pool-action" disabled={!settings || pool.length === 0} onClick={() => persist([])}>
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
                      aria-label={trf("设置 {0} 的推理强度", "Configure reasoning effort for {0}", model?.name ?? ref.modelId)}
                      title={tr("可用推理强度", "Allowed reasoning efforts")}
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
        onClose={() => setEditingKey(null)}
        onSave={levels => {
          const ref = { provider: editing.ref.provider, modelId: editing.ref.modelId };
          persist(pool.map(item => item === editing.ref ? { ...ref, ...(levels && { thinkingLevels: levels }) } : item));
          setEditingKey(null);
        }}
      />}
    </section>
  );
}

function EffortDialog({ model, configured, onClose, onSave }: {
  model: ModelSummary;
  configured?: ThinkingLevel[];
  onClose: () => void;
  onSave: (levels?: ThinkingLevel[]) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState(configured ?? model.thinkingLevels);
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
          <h2 id={titleId}>{tr("推理强度", "Reasoning effort")}</h2>
          <button type="button" className="workspace-settings-close" aria-label={tr("关闭", "Close")} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="workspace-settings-name subagent-effort-model">
          <Icon name="chip" size={16} />
          <span className="workspace-settings-folder" title={model.name}>{model.name}</span>
          <span className="subagent-pool-provider">{model.providerName}</span>
        </div>
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
            onClick={() => onSave(levels.length === model.thinkingLevels.length ? undefined : levels)}>
            {tr("保存", "Save")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
