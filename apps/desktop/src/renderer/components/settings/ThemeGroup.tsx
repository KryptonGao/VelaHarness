import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  customThemeVars,
  maxCustomThemes,
  type ColorScheme,
  type CustomTheme,
  type SelectedThemeId,
  type ThemeId,
} from "../../themes";
import { ScrollFade } from "../ScrollFade";
import type { SettingsCopy } from "../settings-copy";

/** 主题网格最多完整展示的行数,更多的行在容器里滚动。 */
const MAX_VISIBLE_ROWS = 3;

/** 按第一张卡片的实际高度算出三行的总高度,随字号缩放和窗口宽度变化重新计算。 */
function useThemeRowsHeight() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = (): void => {
      const card = grid.firstElementChild as HTMLElement | null;
      if (!card) return;
      const gap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;
      setHeight(card.offsetHeight * MAX_VISIBLE_ROWS + gap * (MAX_VISIBLE_ROWS - 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);
  return { gridRef, height };
}

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
  onRandom,
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
  onRandom: (scheme: ColorScheme) => void;
  onEdit: (id: CustomTheme["id"]) => void;
  /** 渲染在卡片网格下方,编辑器借此贴在所属明暗分组里。 */
  children?: ReactNode;
}) {
  const text = copy.appearance;
  const { gridRef, height } = useThemeRowsHeight();
  return (
    <div className="theme-group">
      <span className="theme-group-label">{label}</span>
      <div
        className="theme-grid-frame"
        style={height == null ? undefined : ({ "--theme-grid-max-height": `${height}px` } as CSSProperties)}
      >
      <ScrollFade className="theme-grid-scroll" ariaLabel={label}>
      <div className="theme-grid" role="radiogroup" aria-label={label} ref={gridRef}>
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
          <>
            <button type="button" className="theme-card theme-card-new" onClick={() => onCreate(scheme)}>
              <span className="theme-new-plus" aria-hidden="true">+</span>
              <span className="theme-card-meta">
                <span className="theme-card-name">{text.newCustomTheme}</span>
                <span className="theme-card-hint">{text.newCustomThemeHint}</span>
              </span>
            </button>
            <button type="button" className="theme-card theme-card-new" onClick={() => onRandom(scheme)}>
              <span className="theme-new-plus" aria-hidden="true">
                <DiceIcon />
              </span>
              <span className="theme-card-meta">
                <span className="theme-card-name">{text.randomTheme}</span>
                <span className="theme-card-hint">{text.randomThemeHint}</span>
              </span>
            </button>
          </>
        ) : null}
      </div>
      </ScrollFade>
      </div>
      {children}
    </div>
  );
}

export function DiceIcon() {
  return (
    <svg viewBox="0 0 16 16" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <circle cx="5.6" cy="5.6" r="0.6" fill="currentColor" />
      <circle cx="10.4" cy="10.4" r="0.6" fill="currentColor" />
      <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    </svg>
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
