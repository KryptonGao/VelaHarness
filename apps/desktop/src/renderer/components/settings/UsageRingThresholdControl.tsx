import { useState } from "react";
import { clampUsageRingThreshold, usageRingThresholdRange } from "../../hooks/useUsageRingPrefs";
import { TaskBudgetSlider } from "./TaskBudgetSlider";

/** 额度提醒线：和字号设置同款的滑块加数字框，每档 1%。 */
export function UsageRingThresholdControl({ label, value, disabled, onChange }: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) onChange(clampUsageRingThreshold(parsed));
    setDraft(null);
  };
  const { min, max } = usageRingThresholdRange;
  return (
    <div className="tb-limit">
      <div className="tb-limit-head">
        <span className="tb-limit-label">{label}</span>
        <label className="tb-number">
          <input type="number" aria-label={label} inputMode="numeric" min={min} max={max} step={1} disabled={disabled}
            value={draft ?? String(value)} onChange={(event) => setDraft(event.target.value)} onBlur={commitDraft}
            onKeyDown={(event) => { if (event.key === "Enter") commitDraft(); }} />
          <span aria-hidden="true">%</span>
        </label>
      </div>
      <TaskBudgetSlider label={label} valueText={`${value}%`} max={max - min} value={value - min} disabled={disabled} continuous
        onChange={(next) => onChange(min + next)} onCommit={() => undefined} />
      <div className="tb-scale" aria-hidden="true"><span>{min}%</span><span>{max}%</span></div>
    </div>
  );
}
