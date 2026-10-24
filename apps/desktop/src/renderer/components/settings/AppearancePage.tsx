import { useMemo, useState } from "react";
import { serifLatinInUse } from "../../font-detect";
import type { Appearance, FileIconTheme, PreferencesApi, ReplyFontFace, UiFontFace } from "../../hooks/usePreferences";
import {
  builtinThemeColors,
  createCustomThemeId,
  darkThemes,
  defaultDarkTheme,
  defaultLightTheme,
  isCustomThemeId,
  lightThemes,
  type ColorScheme,
  type CustomTheme,
  type DarkTheme,
  type LightTheme,
  type SelectedThemeId,
} from "../../themes";
import type { SettingsCopy } from "../settings-copy";
import { CustomThemeEditor } from "./CustomThemeEditor";
import { Segmented, SettingsBlock } from "./primitives";
import { ThemeGroup } from "./ThemeGroup";

export function AppearancePage({ copy, preferences }: { copy: SettingsCopy; preferences: PreferencesApi }) {
  const { appearance, theme, lightTheme, darkTheme, customThemes, fileIconTheme, setAppearance, setFileIconTheme } = preferences;
  const text = copy.appearance;
  const [editing, setEditing] = useState<{ theme: CustomTheme; isNew: boolean } | null>(null);
  // 固定为另一种明暗时,点选主题顺带切过去,否则点了看不到效果。
  const pickTheme = (scheme: ColorScheme, id: SelectedThemeId) => {
    if (scheme === "light") preferences.setLightTheme(id as LightTheme);
    else preferences.setDarkTheme(id as DarkTheme);
    if (appearance !== "system" && appearance !== scheme) setAppearance(scheme);
  };
  // 新主题从该明暗下当前选中的主题取色,改起来比从空白开始顺手。
  const startCreate = (scheme: ColorScheme) => {
    const selected = scheme === "light" ? lightTheme : darkTheme;
    const base = isCustomThemeId(selected)
      ? customThemes.find((item) => item.id === selected)?.colors
      : builtinThemeColors[selected];
    const fallback = builtinThemeColors[scheme === "light" ? defaultLightTheme : defaultDarkTheme];
    setEditing({
      isNew: true,
      theme: { id: createCustomThemeId(), name: "", scheme, colors: { ...(base ?? fallback) } },
    });
  };
  const startEdit = (id: CustomTheme["id"]) => {
    const found = customThemes.find((item) => item.id === id);
    if (found) setEditing({ isNew: false, theme: found });
  };
  const saveTheme = (next: CustomTheme) => {
    preferences.saveCustomTheme(next);
    pickTheme(next.scheme, next.id);
    setEditing(null);
  };
  const themes: { id: Appearance; label: string }[] = [
    { id: "system", label: text.system },
    { id: "light", label: text.light },
    { id: "dark", label: text.dark },
  ];
  const fileIconThemeOptions: { id: FileIconTheme; label: string }[] = [
    { id: "material", label: text.materialIconTheme },
    { id: "devicon", label: text.devicon },
  ];

  const serifNote = useMemo(
    () => (serifLatinInUse() === "anthropic-serif" ? text.fontSerifAnthropic : text.fontSerifGeorgia),
    [text],
  );
  const uiFontOptions: { id: UiFontFace; label: string }[] = [
    { id: "sans", label: text.fontSans },
    { id: "serif", label: text.fontSerif },
  ];
  const replyFontOptions: { id: ReplyFontFace; label: string }[] = [
    { id: "inherit", label: text.fontInherit },
    ...uiFontOptions,
  ];

  const editor = editing ? (
    <CustomThemeEditor
      key={editing.theme.id}
      copy={copy}
      initial={editing.theme}
      isNew={editing.isNew}
      onSave={saveTheme}
      onCancel={() => setEditing(null)}
      onDelete={() => {
        preferences.deleteCustomTheme(editing.theme.id);
        setEditing(null);
      }}
    />
  ) : null;

  return (
    <section className="settings-section">
      <SettingsBlock id="theme" title={text.theme}>
        <Segmented label={text.theme} value={appearance} options={themes} onChange={setAppearance} />
      </SettingsBlock>
      <SettingsBlock id="palette" title={text.palette} hint={text.paletteHint}>
        <ThemeGroup
          copy={copy}
          label={text.lightThemes}
          scheme="light"
          ids={lightThemes}
          customThemes={customThemes.filter((item) => item.scheme === "light")}
          totalCustom={customThemes.length}
          selected={lightTheme}
          active={theme}
          onPick={pickTheme}
          onCreate={startCreate}
          onEdit={startEdit}
        >
          {editing?.theme.scheme === "light" ? editor : null}
        </ThemeGroup>
        <ThemeGroup
          copy={copy}
          label={text.darkThemes}
          scheme="dark"
          ids={darkThemes}
          customThemes={customThemes.filter((item) => item.scheme === "dark")}
          totalCustom={customThemes.length}
          selected={darkTheme}
          active={theme}
          onPick={pickTheme}
          onCreate={startCreate}
          onEdit={startEdit}
        >
          {editing?.theme.scheme === "dark" ? editor : null}
        </ThemeGroup>
      </SettingsBlock>
      <SettingsBlock id="file-icon-theme" title={text.fileIconTheme} hint={text.fileIconThemeHint}>
        <Segmented
          label={text.fileIconTheme}
          value={fileIconTheme}
          options={fileIconThemeOptions}
          onChange={setFileIconTheme}
        />
      </SettingsBlock>
      <SettingsBlock id="ui-font" title={text.uiFont} hint={text.uiFontHint}>
        <div className="settings-font-row">
          <span className="settings-font-label">{text.fontLatin}</span>
          <Segmented label={`${text.uiFont} · ${text.fontLatin}`} value={preferences.uiFontLatin} options={uiFontOptions} onChange={preferences.setUiFontLatin} />
        </div>
        <div className="settings-font-row">
          <span className="settings-font-label">{text.fontCjk}</span>
          <Segmented label={`${text.uiFont} · ${text.fontCjk}`} value={preferences.uiFontCjk} options={uiFontOptions} onChange={preferences.setUiFontCjk} />
        </div>
        <p className="settings-font-note">{serifNote}</p>
      </SettingsBlock>
      <SettingsBlock id="reply-font" title={text.replyFont} hint={text.replyFontHint}>
        <div className="settings-font-row">
          <span className="settings-font-label">{text.fontLatin}</span>
          <Segmented label={`${text.replyFont} · ${text.fontLatin}`} value={preferences.replyFontLatin} options={replyFontOptions} onChange={preferences.setReplyFontLatin} />
        </div>
        <div className="settings-font-row">
          <span className="settings-font-label">{text.fontCjk}</span>
          <Segmented label={`${text.replyFont} · ${text.fontCjk}`} value={preferences.replyFontCjk} options={replyFontOptions} onChange={preferences.setReplyFontCjk} />
        </div>
        <p className="settings-font-note">{serifNote}</p>
      </SettingsBlock>
    </section>
  );
}
