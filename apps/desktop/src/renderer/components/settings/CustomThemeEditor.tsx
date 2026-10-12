import { useState } from "react";
import {
  contrastRatio,
  customThemeColorKeys,
  maxCustomThemeNameLength,
  normalizeHex,
  type CustomTheme,
  type CustomThemeColorKey,
} from "../../themes";
import type { SettingsCopy } from "../settings-copy";
import { ThemePreview } from "./ThemeGroup";

/** 正文和背景低于这个对比度时给出提示(WCAG AA 的大号文字门槛)。 */
const minReadableContrast = 3;

export function CustomThemeEditor({
  copy,
  initial,
  isNew,
  onSave,
  onCancel,
  onDelete,
}: {
  copy: SettingsCopy;
  initial: CustomTheme;
  isNew: boolean;
  onSave: (theme: CustomTheme) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const text = copy.appearance;
  const [name, setName] = useState(initial.name);
  const [colors, setColors] = useState(initial.colors);
  // 文本框允许输入到一半的值,合法后才写入 colors;这里记录每个字段正在输入的草稿。
  const [drafts, setDrafts] = useState<Partial<Record<CustomThemeColorKey, string>>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const labels: Record<CustomThemeColorKey, string> = {
    background: text.colorBackground,
    surface: text.colorSurface,
    text: text.colorText,
    accent: text.colorAccent,
  };

  const clearDraft = (key: CustomThemeColorKey) =>
    setDrafts((current) => {
      const { [key]: _removed, ...rest } = current;
      return rest;
    });

  // 取色器给出的值一定合法,直接采用并丢掉文本框里残留的草稿。
  const setColor = (key: CustomThemeColorKey, value: string) => {
    setColors((current) => ({ ...current, [key]: value }));
    clearDraft(key);
  };

  // 输入过程中保留用户敲的原文,不改写:只有凑够 6 位才即时预览,
  // 否则 #fff 这样的简写会在敲到一半时被展开,后面的字符就没法继续输入。
  const typeColor = (key: CustomThemeColorKey, raw: string) => {
    setDrafts((current) => ({ ...current, [key]: raw }));
    if (/^#?[0-9a-f]{6}$/i.test(raw.trim())) {
      const hex = normalizeHex(raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`);
      if (hex) setColors((current) => ({ ...current, [key]: hex }));
    }
  };

  // 失焦或回车时收尾:能解析(含 3 位简写、缺少 #)就采用,否则恢复为当前有效色。
  const commitColor = (key: CustomThemeColorKey) => {
    const raw = drafts[key]?.trim();
    if (raw) {
      const hex = normalizeHex(raw.startsWith("#") ? raw : `#${raw}`);
      if (hex) setColors((current) => ({ ...current, [key]: hex }));
    }
    clearDraft(key);
  };

  const trimmedName = name.trim();
  const lowContrast = contrastRatio(colors.text, colors.background) < minReadableContrast;
  const draft: CustomTheme = { ...initial, name: trimmedName, colors };

  return (
    <form
      className="theme-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedName) onSave(draft);
      }}
    >
      <h4 className="theme-editor-title">{isNew ? (initial.scheme === "dark" ? text.newDarkThemeTitle : text.newLightThemeTitle) : text.editThemeTitle}</h4>
      <div className="theme-editor-body">
        <div className="theme-editor-fields">
          <label className="field">
            <span>{text.themeName}</span>
            <input
              className="settings-input"
              type="text"
              value={name}
              maxLength={maxCustomThemeNameLength}
              placeholder={text.themeNamePlaceholder}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="theme-editor-colors" role="group" aria-label={text.themeColors}>
            {customThemeColorKeys.map((key) => (
              <div className="theme-color-row" key={key}>
                <span className="theme-color-label">{labels[key]}</span>
                <input
                  className="theme-color-swatch"
                  type="color"
                  aria-label={labels[key]}
                  value={colors[key]}
                  onChange={(event) => setColor(key, event.target.value)}
                />
                <input
                  className="settings-input theme-color-hex"
                  type="text"
                  spellCheck={false}
                  aria-label={`${labels[key]} hex`}
                  value={drafts[key] ?? colors[key]}
                  maxLength={7}
                  onChange={(event) => typeColor(key, event.target.value)}
                  onBlur={() => commitColor(key)}
                  onKeyDown={(event) => {
                    // 回车只用来确认色号,不要顺带提交整个表单。
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitColor(key);
                    }
                  }}
                />
              </div>
            ))}
          </div>
          {lowContrast ? <p className="theme-editor-warning" role="status">{text.contrastLow}</p> : null}
        </div>
        <div className="theme-editor-preview">
          <ThemePreview scheme={initial.scheme} id={initial.id} custom={draft} />
        </div>
      </div>
      <div className="theme-editor-actions">
        <button className="primary-btn" type="submit" disabled={!trimmedName}>{text.saveTheme}</button>
        <button className="settings-secondary-btn" type="button" onClick={onCancel}>{text.cancelTheme}</button>
        {!isNew ? (
          <button
            className={`settings-secondary-btn theme-editor-delete${confirmingDelete ? " confirming" : ""}`}
            type="button"
            onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
            onBlur={() => setConfirmingDelete(false)}
          >
            {confirmingDelete ? text.confirmDeleteTheme : text.deleteTheme}
          </button>
        ) : null}
      </div>
    </form>
  );
}
