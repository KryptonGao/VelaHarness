import type { ReactNode } from "react";
import { SettingsSelect } from "./SettingsSelect";

interface SettingsBlockProps {
  /** 设置项锚点:搜索跳转和高亮靠它定位,必须在 settings-registry 里登记。 */
  id?: string;
  title: string;
  hint?: string;
  /** 给出后渲染成可折叠区块;搜索跳转会自动展开祖先 <details>。 */
  collapsible?: { defaultOpen?: boolean };
  /** 与文字同行、排在右侧的装饰内容(如选项预览动画);窄屏时落到文字下方。 */
  aside?: ReactNode;
  /**
   * 放在 SettingsGroup 卡片里时的排版:inline 把控件放在文字右侧(开关、分段按钮、下拉框),
   * stacked(默认)让控件独占文字下方整行(主题卡片、文本框、列表)。
   */
  layout?: "inline" | "stacked";
  children: ReactNode;
}

/** 一组设置项:可选的小标题 + 一张圆角卡片,卡片里每个 SettingsBlock 是一行。 */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      {title ? <h3 className="settings-group-title">{title}</h3> : null}
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function SettingsBlock({ id, title, hint, collapsible, aside, layout = "stacked", children }: SettingsBlockProps) {
  if (collapsible) {
    return (
      <details className="settings-block settings-collapsible" data-setting-id={id} open={collapsible.defaultOpen}>
        <summary>
          <h3>{title}</h3>
        </summary>
        {hint ? <p className="settings-hint">{hint}</p> : null}
        {children}
      </details>
    );
  }
  if (aside) {
    return (
      <section className="settings-block has-aside" data-setting-id={id}>
        <div className="settings-block-main">
          <h3>{title}</h3>
          {hint ? <p className="settings-hint">{hint}</p> : null}
          {children}
        </div>
        <div className="settings-block-aside">{aside}</div>
      </section>
    );
  }
  return (
    <section className="settings-block" data-layout={layout} data-setting-id={id}>
      <div className="settings-block-text">
        <h3>{title}</h3>
        {hint ? <p className="settings-hint">{hint}</p> : null}
      </div>
      <div className="settings-block-body">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  onPreview,
  menu,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  /** 悬停或聚焦某个选项时回调该选项,离开时回调 null,供调用方展示临时预览。 */
  onPreview?: (value: T | null) => void;
  /** 选项多或文字长时改成下拉框,免得分段按钮折成一大块。 */
  menu?: boolean;
}) {
  if (menu) {
    return (
      <SettingsSelect
        label={label}
        value={value}
        options={options.map((option) => ({ value: option.id, label: option.label }))}
        onChange={(next) => onChange(next as T)}
      />
    );
  }
  return (
    <div
      className="settings-segment"
      role="radiogroup"
      aria-label={label}
      onPointerLeave={onPreview ? () => onPreview(null) : undefined}
      onBlur={onPreview ? () => onPreview(null) : undefined}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          className={`settings-segment-item${option.id === value ? " active" : ""}`}
          onClick={() => onChange(option.id)}
          onPointerEnter={onPreview ? () => onPreview(option.id) : undefined}
          onFocus={onPreview ? () => onPreview(option.id) : undefined}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsSwitch({
  checked,
  label,
  title,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  title?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      className={`settings-skill-toggle${checked ? " on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-skill-toggle-knob" />
    </button>
  );
}
