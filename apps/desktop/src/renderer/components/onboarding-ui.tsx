import type { CSSProperties, ReactNode } from "react";

/** 引导里的选项卡：选中时变太阳黄、翘起、贴上勾。 */
export function Opt({ selected, onClick, className, style, children, disabled, label }: {
  selected: boolean;
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={label} disabled={disabled} style={style}
      className={`ob-opt${selected ? " on" : ""}${className ? ` ${className}` : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** 一排互斥的选项（单选）。 */
export function Seg<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ob-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={value === option.id} disabled={disabled}
          className={value === option.id ? "on" : ""} onClick={() => onChange(option.id)}>{option.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (next: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`ob-tog${checked ? " on" : ""}`} onClick={() => onChange(!checked)} />;
}

/** 标题加说明，右边一个开关。 */
export function ToggleRow({ title, hint, checked, onChange, disabled }: { title: string; hint?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`ob-row${disabled ? " dis" : ""}`}>
      <div><b>{title}</b>{hint ? <small>{hint}</small> : null}</div>
      <Toggle checked={checked} label={title} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Label({ title, hint, children, style }: { title: string; hint?: string; children?: ReactNode; style?: CSSProperties }) {
  return <div className="ob-lab" style={style}>{title}{hint ? <small>{hint}</small> : null}{children}</div>;
}

export function Note({ children, tone = "sky", style }: { children: ReactNode; tone?: "sky" | "sun"; style?: CSSProperties }) {
  return <div className={`ob-note${tone === "sun" ? " y" : ""}`} style={style}>{children}</div>;
}

export function fill(template: string, ...values: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
}

/** 文案里的 `\n` 变成换行。 */
export function Lines({ text }: { text: string }) {
  const parts = text.split("\n");
  return <>{parts.map((part, index) => <span key={index}>{index > 0 ? <br /> : null}{part}</span>)}</>;
}
