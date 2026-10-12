import type { CSSProperties, ReactNode } from "react";
import {
  customThemeVars,
  maxCustomThemes,
  type ColorScheme,
  type CustomTheme,
  type SelectedThemeId,
  type ThemeId,
} from "../../themes";
import type { SettingsCopy } from "../settings-copy";

export function ThemeGroup({
  copy,
  label,
  scheme,
  ids,
  customThemes,
  totalCustom,
  selected,
  active,
  onPick,
  onCreate,
  onEdit,
  children,
}: {
  copy: SettingsCopy;
  label: string;
  scheme: ColorScheme;
  ids: readonly ThemeId[];
  /** 属于这一明暗基底的自定义主题。 */
  customThemes: readonly CustomTheme[];
  /** 所有自定义主题的总数,用来判断是否还能新建。 */
  totalCustom: number;
  selected: SelectedThemeId;
  active: SelectedThemeId;
  onPick: (scheme: ColorScheme, id: SelectedThemeId) => void;
  onCreate: (scheme: ColorScheme) => void;
  onEdit: (id: CustomTheme["id"]) => void;
  /** 渲染在卡片网格下方,编辑器借此贴在所属明暗分组里。 */
  children?: ReactNode;
}) {
  const text = copy.appearance;
  return (
    <div className="theme-group">
      <span className="theme-group-label">{label}</span>
      <div className="theme-grid" role="radiogroup" aria-label={label}>
        {ids.map((id) => {
          const meta = text.themes[id];
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === selected}
              className={`theme-card${id === selected ? " selected" : ""}`}
              onClick={() => onPick(scheme, id)}
            >
              <ThemePreview scheme={scheme} id={id} />
              <span className="theme-card-meta">
                <span className="theme-card-name">
                  {meta.name}
                  {id === active ? <span className="theme-card-badge">{text.inUse}</span> : null}
                </span>
                <span className="theme-card-hint">{meta.hint}</span>
              </span>
            </button>
          );
        })}
        {customThemes.map((item) => (
          <div className="theme-card-slot" key={item.id}>
            <button
              type="button"
              role="radio"
              aria-checked={item.id === selected}
              className={`theme-card${item.id === selected ? " selected" : ""}`}
              onClick={() => onPick(scheme, item.id)}
            >
              <ThemePreview scheme={scheme} id={item.id} custom={item} />
              <span className="theme-card-meta">
                <span className="theme-card-name">
                  <span className="theme-card-name-text">{item.name}</span>
                  {item.id === active ? <span className="theme-card-badge">{text.inUse}</span> : null}
                </span>
                <span className="theme-card-hint">{text.customThemeHint}</span>
              </span>
            </button>
            <button
              type="button"
              className="theme-card-edit"
              aria-label={`${text.editTheme}: ${item.name}`}
              title={text.editTheme}
              onClick={() => onEdit(item.id)}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 13.5l.6-3L11 2.6a1.4 1.4 0 012 2L5.1 12.5l-2.6 1z" />
              </svg>
            </button>
          </div>
        ))}
        {totalCustom < maxCustomThemes ? (
          <button type="button" className="theme-card theme-card-new" onClick={() => onCreate(scheme)}>
            <span className="theme-new-plus" aria-hidden="true">+</span>
            <span className="theme-card-meta">
              <span className="theme-card-name">{text.newCustomTheme}</span>
              <span className="theme-card-hint">{text.newCustomThemeHint}</span>
            </span>
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** 迷你窗口示意图;data-scheme / data-theme 让它套用对应主题的 CSS 变量,自定义主题改用内联变量。 */
export function ThemePreview({
  scheme,
  id,
  custom,
}: {
  scheme: ColorScheme;
  id: string;
  custom?: Pick<CustomTheme, "scheme" | "colors">;
}) {
  const style = custom ? (customThemeVars(custom) as CSSProperties) : undefined;
  return (
    <span className="theme-preview" data-scheme={scheme} data-theme={id} style={style} aria-hidden="true">
      <span className="theme-preview-sidebar">
        <span className="theme-preview-line title" />
        <span className="theme-preview-line active" />
        <span className="theme-preview-line" />
        <span className="theme-preview-line" />
      </span>
      <span className="theme-preview-main">
        <span className="theme-preview-bubble" />
        <span className="theme-preview-code">
          <span className="theme-preview-row">
            <span className="tok keyword" />
            <span className="tok function" />
            <span className="tok fg" />
          </span>
          <span className="theme-preview-row">
            <span className="tok indent" />
            <span className="tok type" />
            <span className="tok string" />
          </span>
          <span className="theme-preview-row">
            <span className="tok comment" />
          </span>
        </span>
        <span className="theme-preview-dock">
          <span className="theme-preview-send" />
        </span>
      </span>
    </span>
  );
}
