import { useState } from "react";
import { clampFontSize } from "../../font-size";
import { TaskBudgetSlider } from "./TaskBudgetSlider";

/** 字号设置:与高度上限同款的滑块,每档 1px;右上角的输入框可直接填数字,超出范围会收回到边界。 */
export function FontSizeControl({ label, range, value, onChange }: {
  label: string;
  range: { min: number; max: number; fallback: number };
  value: number;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) onChange(clampFontSize(range, parsed));
    setDraft(null);
  };
  return (
    <div className="tb-limit">
      <div className="tb-limit-head">
        <span className="tb-limit-label">{label}</span>
        <label className="tb-number">
          <input
            type="number"
            aria-label={label}
            inputMode="numeric"
            min={range.min}
            max={range.max}
            step={1}
            value={draft ?? String(value)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => { if (event.key === "Enter") commitDraft(); }}
          />
          <span aria-hidden="true">px</span>
        </label>
      </div>
      <TaskBudgetSlider
        label={label}
        valueText={`${value} px`}
        max={range.max - range.min}
        value={value - range.min}
        disabled={false}
        onChange={(next) => onChange(range.min + next)}
        onCommit={() => undefined}
      />
      <div className="tb-scale" aria-hidden="true"><span>{range.min} px</span><span>{range.max} px</span></div>
    </div>
  );
}
