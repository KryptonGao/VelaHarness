import { customSubagentLimits, subagentKinds, type AgentInfo, type CustomSubagentProfile, type ModelCatalog, type ModelSummary } from "@vela/shared";
import { useMemo, useRef, useState } from "react";
import { localizeError, tr, trf } from "../../locale";
import { showToast } from "../../toast";
import { AgentAvatar } from "../AgentAvatar";
import { ConfirmDeleteButton } from "../ConfirmDeleteButton";
import { Icon } from "../icons";
import type { SettingsCopy } from "../settings-copy";
import { clampChoice, modelValue } from "./model-helpers";
import { Field, SettingsGroup } from "./primitives";
import { SettingsSelect } from "./SettingsSelect";

type Draft = { profile: CustomSubagentProfile; existing: boolean; original: CustomSubagentProfile[] };
type ModelGroup = { name: string; models: ModelSummary[] };
const pageSize = 8;

function IconPicker({ copy, initial, agents, profiles, value, onChange }: {
  copy: SettingsCopy; initial: string; agents: readonly AgentInfo[]; profiles: CustomSubagentProfile[];
  value: string; onChange: (icon: string) => void;
}) {
  const [page, setPage] = useState(0);
  // Keep paging stable if the conversation's roster changes while the editor is open.
  const [existing] = useState(() => [...new Set([initial, ...agents.filter(agent => agent.kind !== "root")
    .map(agent => agent.customProfile?.icon ?? agent.id), ...profiles.map(profile => profile.icon)])]);
  const usedNumbers = existing.flatMap(icon => {
    const match = /^vela-subagent-icon-([1-9]\d*)$/.exec(icon);
    return match ? [Number(match[1])] : [];
  }).sort((a, b) => a - b);
  const first = page * pageSize;
  const icons = Array.from({ length: pageSize }, (_, i) => {
    const index = first + i;
    if (index < existing.length) return existing[index]!;
    let number = index - existing.length + 1;
    for (const used of usedNumbers) {
      if (used > number) break;
      number++;
    }
    return `vela-subagent-icon-${number}`;
  });
  return <div className="custom-agent-field">
    <span>{copy.customSubagents.icon}</span>
    <div className="custom-agent-icon-picker" role="group" aria-label={copy.customSubagents.icon}>
      <div className="custom-agent-icon-options">
        {icons.map((icon, i) => <button key={first + i} type="button" className="custom-agent-icon"
          aria-label={trf("图标 {0}", "Icon {0}", first + i + 1)} aria-pressed={value === icon}
          onClick={() => onChange(icon)}><AgentAvatar agentId={icon} size={30} /></button>)}
      </div>
      <div className="custom-agent-pager">
        <button type="button" className="settings-secondary" disabled={page === 0}
          aria-label={tr("上一页", "Previous page")} onClick={() => setPage(page - 1)}><Icon name="chevron-left" size={16} /></button>
        <button type="button" className="settings-secondary"
          aria-label={tr("下一页", "Next page")} onClick={() => setPage(page + 1)}><Icon name="chevron-right" size={16} /></button>
      </div>
    </div>
  </div>;
}

export function CustomSubagentsBlock({ copy, profiles, onProfilesChange, catalog, models, agents }: {
  copy: SettingsCopy;
  profiles: CustomSubagentProfile[] | null;
  onProfilesChange: (profiles: CustomSubagentProfile[]) => void;
  catalog: ModelCatalog | null;
  models: ModelGroup[];
  agents: readonly AgentInfo[];
}) {
  const text = copy.customSubagents;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useRef<HTMLButtonElement>(null);
  const profile = draft?.profile;
  const model = profile?.model;
  const available = useMemo(() => models.flatMap(group => group.models), [models]);
  const modelOptions = useMemo(() => models.flatMap(group => group.models.map(model => ({
    value: modelValue(model.provider, model.id), label: model.name, group: group.name,
  }))), [models]);
  const selectedModel = model && available.find(m => m.provider === model.provider && m.id === model.modelId);
  const efforts = selectedModel?.thinkingLevels ?? [];
  const name = profile?.name.trim() ?? "";
  const normalizedName = name.toLowerCase();
  const conflict = ["root", ...subagentKinds].some(kind => kind === normalizedName)
    || profiles?.some(item => item.id !== profile?.id && item.name.toLowerCase() === normalizedName);
  const full = profiles !== null && profiles.length >= customSubagentLimits.count;
  const original = draft?.original.find(item => item.id === profile?.id);
  const latest = profiles?.find(item => item.id === profile?.id);
  const stale = !!error && draft?.existing && JSON.stringify(original) !== JSON.stringify(latest);

  function start(existing?: CustomSubagentProfile) {
    if (!profiles) return;
    const id = existing?.id ?? crypto.randomUUID();
    setError(null);
    setDraft({ existing: !!existing, original: profiles, profile: existing ?? {
      id, name: "", icon: id, description: "", permission: "general", systemPrompt: "",
    } });
  }
  function update(patch: Partial<CustomSubagentProfile>) {
    if (draft) setDraft({ ...draft, profile: { ...draft.profile, ...patch } });
  }
  function closeEditor() {
    const id = draft?.existing ? draft.profile.id : null;
    setDraft(null);
    setError(null);
    requestAnimationFrame(() => {
      // Editing temporarily replaces the list and its original buttons.
      const target = id ? document.getElementById(`edit-custom-subagent-${id}`) : create.current;
      (target ?? create.current)?.focus({ preventScroll: true });
    });
  }
  async function persist(next: CustomSubagentProfile[], previous: CustomSubagentProfile[]) {
    if (!window.vela || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await window.vela.saveCustomSubagents(next, previous);
      onProfilesChange(saved.customSubagents ?? []);
      closeEditor();
    } catch (caught) {
      const message = caught instanceof Error ? localizeError(caught.message) : String(caught);
      try {
        const settings = await window.vela.getAgentSettings();
        const nextProfiles = settings.customSubagents ?? [];
        onProfilesChange(nextProfiles);
        const latestProfile = nextProfiles.find(item => item.id === profile?.id);
        if (draft?.existing && JSON.stringify(original) !== JSON.stringify(latestProfile)) {
          setError(message);
          return;
        }
      } catch { /* Keep the draft if the host is offline. */ }
      showToast(message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  }
  function submit() {
    if (!draft || !profile || !name || conflict || busy || stale) return;
    const saved: CustomSubagentProfile = { ...profile, name, description: profile.description.trim(), systemPrompt: profile.systemPrompt.trim() };
    const next = draft.existing ? draft.original.map(p => p.id === saved.id ? saved : p) : [...draft.original, saved];
    void persist(next, draft.original);
  }

  return <SettingsGroup>
    <section className="settings-block custom-subagents" data-setting-id="custom-subagents">
      <header className="custom-subagents-head">
        <div className="settings-block-text">
          <h3>{draft ? (draft.existing ? text.edit : text.create) : text.title}</h3>
          {!draft && <p className="settings-hint">{text.hint}</p>}
        </div>
        {!draft && <button ref={create} type="button" className="settings-secondary custom-agent-add"
          disabled={!profiles || full || busy} onClick={() => start()}>
          <Icon name="plus" size={14} />{text.create}
        </button>}
      </header>
      {draft && profile ? (
        <form className="custom-agent-editor" aria-label={draft.existing ? text.edit : text.create}
          onSubmit={event => { event.preventDefault(); submit(); }}>
          <fieldset disabled={busy}>
            <div className="custom-agent-identity">
              <div className="custom-agent-avatar"><AgentAvatar agentId={profile.icon} size={44} /></div>
              <Field label={text.name}>
                <input className="settings-input" autoFocus required maxLength={customSubagentLimits.name} placeholder="code-reviewer"
                  value={profile.name} aria-invalid={!!conflict} aria-describedby={conflict ? "custom-agent-name-error" : undefined}
                  onChange={event => update({ name: event.target.value })} />
              </Field>
            </div>
            {conflict && <p id="custom-agent-name-error" className="settings-error">{text.nameConflict}</p>}
            <IconPicker key={original?.icon ?? profile.id} copy={copy} initial={original?.icon ?? profile.id}
              agents={agents} profiles={draft.original} value={profile.icon} onChange={icon => update({ icon })} />
            <Field label={text.description}>
              <input className="settings-input" maxLength={customSubagentLimits.description} placeholder={text.descriptionPlaceholder}
                value={profile.description} onChange={event => update({ description: event.target.value })} />
            </Field>
            <div className="custom-agent-controls">
              <div className="custom-agent-field"><span>{text.model}</span>
                <SettingsSelect label={text.model} value={model ? modelValue(model.provider, model.modelId) : ""} disabled={busy}
                  options={[
                    { value: "", label: text.inherit },
                    ...(model && !selectedModel ? [{ value: modelValue(model.provider, model.modelId), label: `${model.modelId} · ${copy.subagentModels.unavailable}`, disabled: true }] : []),
                    ...modelOptions,
                  ]}
                  onChange={value => {
                    const next = available.find(m => modelValue(m.provider, m.id) === value);
                    update({ model: next ? { provider: next.provider, modelId: next.id, thinkingLevel: clampChoice(next.thinkingLevels, model?.thinkingLevel ?? "medium") } : undefined });
                  }} />
              </div>
              {model && <div className="custom-agent-field"><span>{text.effort}</span>
                <SettingsSelect label={text.effort} value={model.thinkingLevel} disabled={busy || !selectedModel}
                  options={[
                    ...(!efforts.includes(model.thinkingLevel) ? [{ value: model.thinkingLevel, label: copy.agent.levels[model.thinkingLevel], disabled: true }] : []),
                    ...efforts.map(level => ({ value: level, label: copy.agent.levels[level] })),
                  ]}
                  onChange={value => {
                    const thinkingLevel = selectedModel?.thinkingLevels.find(level => level === value);
                    if (thinkingLevel) update({ model: { ...model, thinkingLevel } });
                  }} />
              </div>}
              <div className="custom-agent-field"><span>{text.permission}</span>
                <SettingsSelect label={text.permission} value={profile.permission} disabled={busy}
                  options={[{ value: "general", label: text.general }, { value: "explore", label: text.explore }]}
                  onChange={value => update({ permission: value === "explore" ? "explore" : "general" })} />
              </div>
            </div>
            <Field label={text.prompt}>
              <textarea className="settings-textarea" rows={4} maxLength={customSubagentLimits.systemPrompt}
                placeholder={text.promptPlaceholder} value={profile.systemPrompt} onChange={event => update({ systemPrompt: event.target.value })} />
            </Field>
          </fieldset>
          <div className="custom-agent-actions">
            <button type="button" className="settings-secondary" disabled={busy} onClick={closeEditor}>{tr("取消", "Cancel")}</button>
            <button type="submit" className="primary-btn" disabled={!name || !!conflict || busy || !!stale}>{busy ? copy.agent.saving : tr("保存", "Save")}</button>
          </div>
        </form>
      ) : (
        <>
          {!!profiles?.length && <ul className="custom-agent-list">
            {profiles.map(item => {
              const fixed = item.model;
              const displayModel = fixed && (catalog?.models.find(m => m.provider === fixed.provider && m.id === fixed.modelId)?.name ?? fixed.modelId);
              return <li key={item.id}>
                <AgentAvatar agentId={item.icon} size={34} />
                <div className="custom-agent-summary">
                  <strong>{item.name}</strong>
                  {item.description && <p>{item.description}</p>}
                  <small>{[item.permission === "explore" ? "Explore" : "General", displayModel ?? text.inherit, fixed && copy.agent.levels[fixed.thinkingLevel]].filter(Boolean).join(" · ")}</small>
                </div>
                <button type="button" id={`edit-custom-subagent-${item.id}`} className="subagent-effort-button"
                  disabled={busy} aria-label={trf("编辑 {0}", "Edit {0}", item.name)} title={text.edit}
                  onClick={() => start(item)}><Icon name="edit" size={16} /></button>
                <fieldset disabled={busy}><ConfirmDeleteButton label={trf("删除 {0}", "Delete {0}", item.name)} className="custom-agent-delete"
                  onConfirm={() => void persist(profiles.filter(p => p.id !== item.id), profiles)} /></fieldset>
              </li>;
            })}
          </ul>}
          {full && <p className="settings-note">{text.limit}</p>}
        </>
      )}
      {error && <div role="alert" className="custom-agent-error">
        <p className="settings-error">{error}</p>
        {stale && <button type="button" className="settings-secondary" disabled={busy}
          onClick={() => latest ? start(latest) : closeEditor()}>{tr("重新加载", "Reload")}</button>}
      </div>}
    </section>
  </SettingsGroup>;
}
