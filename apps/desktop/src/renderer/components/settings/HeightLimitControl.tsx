import { useState } from "react";
import { clampHeight, heightRange, heightStopIndex } from "../../thinking-group-height";
import { TaskBudgetSlider } from "./TaskBudgetSlider";

/** 高度上限:与任务上限同款的档位滑块,右上角的输入框可填档位之间的精确值(px)。 */
export function HeightLimitControl({ label, stops, value, onChange }: {
  label: string;
  stops: readonly number[];
  value: number;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { min, max } = heightRange(stops);
  const index = heightStopIndex(stops, value);
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) onChange(clampHeight(stops, parsed));
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
            min={min}
            max={max}
            step={20}
            value={draft ?? String(value)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => { if (event.key === "Enter") commitDraft(); }}
          />
          <span aria-hidden="true">px</span>
        </label>
      </div>
      <div className="tb-limit-readout" aria-hidden="true">{value} px</div>
      <TaskBudgetSlider
        label={label}
        valueText={`${value} px`}
        max={stops.length - 1}
        value={index}
        disabled={false}
        onChange={(next) => onChange(stops[next]!)}
        onCommit={() => undefined}
      />
      <div className="tb-ticks" aria-hidden="true">
        {stops.map((stop, tick) => <i key={stop} data-on={tick <= index ? "true" : undefined} />)}
      </div>
      <div className="tb-scale" aria-hidden="true"><span>{min} px</span><span>{max} px</span></div>
    </div>
  );
}
