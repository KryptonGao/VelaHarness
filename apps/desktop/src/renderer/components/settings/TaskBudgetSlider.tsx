import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

const thumb = 16;

/**
 * 档位滑块：滑块和进度会顺滑地滑向目标档位（点击轨道、拖动、键盘都一样），
 * 拖动时贴着最近的档位走，松手或按键结束后才提交。
 */
export function TaskBudgetSlider({ label, valueText, max, value, disabled, onChange, onCommit }: {
  label: string;
  valueText: string;
  /** 最大档位序号，最小为 0。 */
  max: number;
  value: number;
  disabled: boolean;
  onChange: (index: number) => void;
  onCommit: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  function indexAt(clientX: number): number {
    const box = rail.current?.getBoundingClientRect();
    if (!box || box.width <= thumb) return value;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left - thumb / 2) / (box.width - thumb)));
    return Math.round(ratio * max);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    setDragging(true);
    onChange(indexAt(event.clientX));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!dragging) return;
    const next = indexAt(event.clientX);
    if (next !== value) onChange(next);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (!dragging) return;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const jumps: Record<string, number> = {
      ArrowRight: value + 1, ArrowUp: value + 1, PageUp: value + 3,
      ArrowLeft: value - 1, ArrowDown: value - 1, PageDown: value - 3, Home: 0, End: max,
    };
    const next = jumps[event.key];
    if (disabled || next === undefined) return;
    event.preventDefault();
    onChange(Math.min(max, Math.max(0, next)));
  }

  const keyCommit = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!disabled && ["ArrowRight", "ArrowUp", "PageUp", "ArrowLeft", "ArrowDown", "PageDown", "Home", "End"].includes(event.key)) onCommit();
  };

  return (
    <div
      className="tb-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      data-dragging={dragging ? "true" : undefined}
      data-disabled={disabled ? "true" : undefined}
      style={{ "--r": max > 0 ? value / max : 0 } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={keyCommit}
    >
      <div className="tb-slider-rail" ref={rail}>
        <span className="tb-slider-fill" />
        <span className="tb-slider-thumb" />
      </div>
    </div>
  );
}
