import type { AgentSettings, ModelCatalog, NewConversationSelection, SandboxMode, ThinkingLevel } from "@vela/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectApi } from "../../hooks/useProject";
import { localizeError } from "../../locale";
import type { SettingsCopy } from "../settings-copy";
import { clampChoice, groupAvailable, levelsFor, modelValue, parseModelValue } from "./model-helpers";
import { Segmented, SettingsBlock, SettingsGroup } from "./primitives";
import { SettingsSelect } from "./SettingsSelect";
import { ContextLimitBlock } from "./ContextLimitBlock";
import { TaskBudgetBlock } from "./TaskBudgetBlock";

/** 停止输入这么久后自动保存额外指令;失焦时立即保存。 */
const instructionsDebounceMs = 800;

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function AgentDefaultsPage({
  copy,
  catalog,
  project,
}: {
  copy: SettingsCopy;
  catalog: ModelCatalog | null;
  project: ProjectApi;
}) {
  const text = copy.agent;
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // 最近一次发起的目标值(含尚未落盘的乐观修改)与最近一次落盘确认的值。
  const target = useRef<AgentSettings | null>(null);
  const confirmed = useRef<AgentSettings | null>(null);
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instructionsRef = useRef("");

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
        setInstructions(loaded.instructions);
        instructionsRef.current = loaded.instructions;
        setError(null);
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

  /** 以「最新目标值 + 本次修改」保存;请求串行执行,后发的覆盖先发的,失败则回到上次确认的值。 */
  const persist = useCallback((patch: Partial<AgentSettings>) => {
    const api = window.vela;
    const base = target.current;
    if (!api || !base) return;
    const next = { ...base, ...patch };
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
        }
        setStatus("saved");
      } catch (caught) {
        const back = confirmed.current;
        target.current = back;
        setSettings(back);
        if (back) {
          setInstructions(back.instructions);
          instructionsRef.current = back.instructions;
        }
        setStatus("error");
        setError(caught instanceof Error ? caught.message : text.loadError);
      } finally {
        pending.current -= 1;
      }
    });
  }, [text.loadError]);

  const flushInstructions = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (target.current && instructionsRef.current !== target.current.instructions) {
      persist({ instructions: instructionsRef.current });
    }
  }, [persist]);

  // 关闭设置页时把还没保存的指令写下去。
  useEffect(() => () => flushInstructions(), [flushInstructions]);

  const choices = useMemo(
    () => levelsFor(catalog, settings?.provider ?? null, settings?.modelId ?? null),
    [catalog, settings?.provider, settings?.modelId],
  );
  const thinking: ThinkingLevel = settings ? clampChoice(choices, settings.thinkingLevel) : "medium";
  const groups = useMemo(() => groupAvailable(catalog), [catalog]);
  const selectedMissing = Boolean(
    settings?.provider &&
      settings.modelId &&
      !catalog?.models.some((model) => model.provider === settings.provider && model.id === settings.modelId && model.available),
  );
  const newConversationChoices: { id: NewConversationSelection; label: string }[] = [
    { id: "default", label: text.newConversationDefault },
    { id: "lastUsed", label: text.newConversationLastUsed },
  ];

  const permissions = copy.permissions;
  const mode = project.sandboxMode;
  const sandboxOptions: { id: SandboxMode; title: string; hint: string }[] = [
    { id: "ask", title: permissions.ask, hint: permissions.askHint },
    { id: "smart", title: permissions.smart, hint: permissions.smartHint },
    { id: "full", title: permissions.full, hint: permissions.fullHint },
  ];

  return (
    <section className="settings-section">
      <div className="settings-autosave" role="status" aria-live="polite">
        {status === "saving" ? <span>{text.saving}</span> : null}
        {status === "saved" ? <span className="settings-saved">{text.saved}</span> : null}
        {error ? <span className="settings-error">{localizeError(error)}</span> : null}
      </div>

      <SettingsGroup title={copy.sections.model}>
      <SettingsBlock id="default-model" title={text.model} hint={text.modelHint} layout="inline">
        {groups.length === 0 && !selectedMissing ? <p className="settings-note">{text.modelMissing}</p> : null}
        <SettingsSelect
          label={text.model}
          value={settings?.provider && settings.modelId ? modelValue(settings.provider, settings.modelId) : ""}
          disabled={!settings}
          options={[
            { value: "", label: text.modelEmpty },
            ...(selectedMissing && settings?.provider && settings.modelId
              ? [{ value: modelValue(settings.provider, settings.modelId), label: text.modelUnavailable }]
              : []),
            ...groups.flatMap((group) => group.models.map((model) => ({
              value: modelValue(model.provider, model.id),
              label: model.name,
              group: group.name,
            }))),
          ]}
          onChange={(value) => {
            const parsed = parseModelValue(value);
            const nextChoices = levelsFor(catalog, parsed.provider, parsed.modelId);
            persist({
              provider: parsed.provider,
              modelId: parsed.modelId,
              thinkingLevel: clampChoice(nextChoices, settings?.thinkingLevel ?? "medium"),
            });
          }}
        />
      </SettingsBlock>

      <SettingsBlock id="default-thinking" title={text.thinking} hint={text.thinkingHint} layout="inline">
        {choices.length > 4 ? (
          <SettingsSelect
            label={text.thinking}
            value={thinking}
            disabled={!settings}
            options={choices.map((level) => ({ value: level, label: text.levels[level] }))}
            onChange={(value) => persist({ thinkingLevel: value as ThinkingLevel })}
          />
        ) : (
        <div className="settings-choice-row" role="radiogroup" aria-label={text.thinking}>
          {choices.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={level === thinking}
              className={`settings-choice${level === thinking ? " active" : ""}`}
              disabled={!settings}
              onClick={() => persist({ thinkingLevel: level })}
            >
              {text.levels[level]}
            </button>
          ))}
        </div>
        )}
      </SettingsBlock>

      <SettingsBlock id="new-conversation" title={text.newConversation} hint={text.newConversationHint} layout="inline">
        <Segmented
          label={text.newConversation}
          value={settings?.newConversationSelection ?? "default"}
          options={newConversationChoices}
          onChange={(value) => persist({ newConversationSelection: value })}
        />
      </SettingsBlock>

      </SettingsGroup>

      <SettingsGroup title={copy.sections.instructionsPermissions}>
      <SettingsBlock id="instructions" title={text.instructions} hint={text.instructionsHint}>
        <textarea
          className="settings-textarea"
          aria-label={text.instructions}
          value={instructions}
          maxLength={4000}
          placeholder={text.instructionsPlaceholder}
          disabled={!settings}
          onChange={(event) => {
            const value = event.target.value;
            setInstructions(value);
            instructionsRef.current = value;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flushInstructions, instructionsDebounceMs);
          }}
          onBlur={flushInstructions}
        />
        <p className="settings-note">{text.autosaveNote}</p>
      </SettingsBlock>

      <SettingsBlock id="permissions" title={permissions.title}>
        <div className="settings-stack" role="radiogroup" aria-label={permissions.title}>
          {sandboxOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={mode === option.id}
              className={`settings-radio${mode === option.id ? " active" : ""}`}
              onClick={() => void project.setSandboxMode(option.id)}
            >
              <span className="settings-radio-title">{option.title}</span>
              <span className="settings-radio-hint">{option.hint}</span>
            </button>
          ))}
        </div>
        <p className="settings-note">{permissions.note}</p>
        {project.error ? <p className="settings-error">{localizeError(project.error)}</p> : null}
      </SettingsBlock>

      </SettingsGroup>

      <SettingsGroup title={copy.sections.limits}>
        <ContextLimitBlock copy={copy} />
        <TaskBudgetBlock copy={copy} />
      </SettingsGroup>
    </section>
  );
}
