import { formatTaskBudgetTokens, parseTaskBudgetSettings, taskBudgetLimits, type TaskBudgetSettings } from "@vela/shared";
import { useEffect, useState } from "react";
import { localizeError, tr, trf } from "../../locale";
import type { SettingsCopy } from "../settings-copy";
import { SettingsSwitch } from "./primitives";
import { TaskBudgetSlider } from "./TaskBudgetSlider";
import { readLimit, sliderIndex, stopText, taskBudgetMinuteStops, taskBudgetTokenStops } from "./task-budget-stops";

function minutesLabel(text: string): string {
  const value = readLimit(text);
  if (value === null) return tr("不限", "No limit");
  if (value === undefined) return "—";
  return value >= 60 && value % 60 === 0 ? trf("{0} 小时", "{0} h", value / 60) : trf("{0} 分钟", "{0} min", value);
}

function tokensLabel(text: string): string {
  const value = readLimit(text);
  if (value === null) return tr("不限", "No limit");
  if (value === undefined) return "—";
  return `${formatTaskBudgetTokens(value)} Token`;
}

function LimitControl({ label, display, minLabel, stops, value, min, max, step, placeholder, unit, disabled, onChange, onCommit }: {
  label: string;
  display: string;
  minLabel: string;
  stops: readonly number[];
  value: string;
  min: number;
  max: number;
  step: number;
  placeholder: string;
  unit: string;
  disabled: boolean;
  onChange: (next: string) => void;
  onCommit: () => void;
}) {
  const index = sliderIndex(stops, value);
  return (
    <div className="tb-limit" data-disabled={disabled ? "true" : undefined}>
      <div className="tb-limit-head">
        <span className="tb-limit-label">{label}</span>
        <label className="tb-number">
          <input
            type="number"
            aria-label={label}
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onCommit}
          />
          <span aria-hidden="true">{unit}</span>
        </label>
      </div>
      <div className="tb-limit-readout" aria-hidden="true">{display}</div>
      <TaskBudgetSlider
        label={label}
        valueText={display}
        max={stops.length}
        value={index}
        disabled={disabled}
        onChange={(next) => onChange(stopText(stops, next))}
        onCommit={onCommit}
      />
      <div className="tb-ticks" aria-hidden="true">
        {Array.from({ length: stops.length + 1 }, (_, tick) => <i key={tick} data-on={tick <= index ? "true" : undefined} />)}
      </div>
      <div className="tb-scale" aria-hidden="true"><span>{minLabel}</span><span>{tr("不限", "No limit")}</span></div>
    </div>
  );
}

/** 开关加时间、Token 两个可留空的上限（滑块 + 精确输入）；改动后立即提交，校验失败时在下方提示。 */
export function TaskBudgetFields({ text, value, disabled, onCommit }: {
  text: SettingsCopy["agent"];
  value: TaskBudgetSettings | null;
  disabled?: boolean;
  onCommit: (next: TaskBudgetSettings) => Promise<void>;
}) {
  const [minutes, setMinutes] = useState("");
  const [tokens, setTokens] = useState("");
  const [subagents, setSubagents] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    setMinutes(value.maxMinutes === null ? "" : String(value.maxMinutes));
    setTokens(value.maxTokens === null ? "" : String(value.maxTokens));
    setSubagents(String(value.maxSubagents));
  }, [value]);

  async function commit(draft: { enabled: boolean; minutes: string; tokens: string; subagents: string; nested: boolean }): Promise<void> {
    const next = {
      enabled: draft.enabled,
      maxMinutes: readLimit(draft.minutes),
      maxTokens: readLimit(draft.tokens),
      maxSubagents: draft.subagents.trim() ? Number(draft.subagents) : undefined,
      allowNestedSubagents: draft.nested,
    };
    try {
      if (next.maxMinutes === undefined || next.maxTokens === undefined || next.maxSubagents === undefined || Number.isNaN(next.maxSubagents)) {
        throw new Error("请输入数字");
      }
      const parsed = parseTaskBudgetSettings(next);
      // 没有改动就不提交，避免只是点一下滑块或失焦就把「沿用全局」的对话写成自定义。
      if (value && parsed.enabled === value.enabled && parsed.maxMinutes === value.maxMinutes && parsed.maxTokens === value.maxTokens
        && parsed.maxSubagents === value.maxSubagents && parsed.allowNestedSubagents === value.allowNestedSubagents) {
        setError(null);
        return;
      }
      await onCommit(parsed);
      setError(null);
    } catch (caught) {
      setError(localizeError(caught instanceof Error ? caught.message : String(caught)));
    }
  }

  const inactive = disabled || !value;
  const enabled = value?.enabled ?? false;
  const nested = value?.allowNestedSubagents ?? true;
  return (
    <div className="tb-fields">
      <div className="tb-enable">
        <span>{text.taskBudgetEnabled}</span>
        <SettingsSwitch
          checked={enabled}
          label={text.taskBudgetEnabled}
          disabled={inactive}
          onChange={(next) => void commit({ enabled: next, minutes, tokens, subagents, nested })}
        />
      </div>
      <LimitControl
        label={text.taskBudgetMinutes}
        display={minutesLabel(minutes)}
        minLabel={minutesLabel(String(taskBudgetMinuteStops[0]))}
        unit={tr("分钟", "min")}
        stops={taskBudgetMinuteStops}
        value={minutes}
        min={taskBudgetLimits.minMinutes}
        max={taskBudgetLimits.maxMinutes}
        step={5}
        placeholder={text.taskBudgetNoLimit}
        disabled={inactive}
        onChange={setMinutes}
        onCommit={() => void commit({ enabled, minutes, tokens, subagents, nested })}
      />
      <LimitControl
        label={text.taskBudgetTokens}
        display={tokensLabel(tokens)}
        minLabel={tokensLabel(String(taskBudgetTokenStops[0]))}
        unit="Token"
        stops={taskBudgetTokenStops}
        value={tokens}
        min={taskBudgetLimits.minTokens}
        max={taskBudgetLimits.maxTokens}
        step={100_000}
        placeholder={text.taskBudgetNoLimit}
        disabled={inactive}
        onChange={setTokens}
        onCommit={() => void commit({ enabled, minutes, tokens, subagents, nested })}
      />
      <div className="tb-subagents">
        <div className="tb-limit" data-disabled={inactive ? "true" : undefined}>
          <div className="tb-limit-head">
            <span className="tb-limit-label">{text.taskBudgetSubagents}</span>
            <label className="tb-number">
              <input
                type="number"
                aria-label={text.taskBudgetSubagents}
                inputMode="numeric"
                min={taskBudgetLimits.minSubagents}
                max={taskBudgetLimits.maxSubagents}
                step={1}
                value={subagents}
                disabled={inactive}
                onChange={(event) => setSubagents(event.target.value)}
                onBlur={() => void commit({ enabled, minutes, tokens, subagents, nested })}
              />
              <span aria-hidden="true">{tr("个", "agents")}</span>
            </label>
          </div>
          <p className="tb-limit-hint">{text.taskBudgetSubagentsHint}</p>
        </div>
        <div className="tb-enable">
          <span>{text.taskBudgetNested}</span>
          <SettingsSwitch
            checked={nested}
            label={text.taskBudgetNested}
            disabled={inactive}
            onChange={(next) => void commit({ enabled, minutes, tokens, subagents, nested: next })}
          />
        </div>
      </div>
      {error ? <p className="settings-error">{error}</p> : null}
    </div>
  );
}
