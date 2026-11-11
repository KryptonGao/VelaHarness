import { useRef, useState } from "react";
import { applyGlassOpacity, clampGlassOpacity, glassOpacityRange } from "../../glass-opacity";
import { TaskBudgetSlider } from "./TaskBudgetSlider";

/**
 * 玻璃叠色不透明度:滑块每档 1%;自定义后出现重设按钮,回到当前染色的默认值。
 * 拖动中只在本地记草稿、直接写根节点的 CSS 变量,松手才提交偏好:
 * 否则每动一档都会重渲染整个界面并写一次本地存储,拖起来会不跟手。
 */
export function GlassOpacityControl({ label, resetLabel, value, isCustom, disabled, onChange, onReset }: {
  label: string;
  resetLabel: string;
  value: number;
  isCustom: boolean;
  disabled: boolean;
  onChange: (next: number) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const shown = draft ?? value;
  const change = (next: number) => {
    const clamped = clampGlassOpacity(glassOpacityRange.min + next);
    draftRef.current = clamped;
    setDraft(clamped);
    applyGlassOpacity(document.documentElement, clamped);
  };
  const commit = () => {
    const pending = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (pending !== null && pending !== value) onChange(pending);
    // 没有真正改动时,把拖动中写入的临时值还原成偏好里的当前值。
    else applyGlassOpacity(document.documentElement, isCustom ? value : null);
  };
  return (
    <div className="tb-limit glass-opacity-control" data-disabled={disabled}>
      <div className="tb-limit-head">
        <span className="tb-limit-label">{label}</span>
        <span className="tb-limit-actions">
          {isCustom && !disabled ? (
            <button type="button" className="tb-reset" onClick={onReset}>{resetLabel}</button>
          ) : null}
          <span className="tb-limit-readout-inline">{shown}%</span>
        </span>
      </div>
      <TaskBudgetSlider
        label={label}
        valueText={`${shown}%`}
        max={glassOpacityRange.max - glassOpacityRange.min}
        value={shown - glassOpacityRange.min}
        disabled={disabled}
        continuous
        onChange={change}
        onCommit={commit}
      />
      <div className="tb-scale" aria-hidden="true"><span>0%</span><span>100%</span></div>
    </div>
  );
}
