import { uiStorage } from "../ui-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  customThemeVars,
  defaultDarkTheme,
  defaultLightTheme,
  isCustomThemeId,
  isDarkTheme,
  isLightTheme,
  maxCustomThemes,
  parseCustomThemes,
  type ColorScheme,
  type CustomTheme,
  type CustomThemeId,
  type DarkTheme,
  type LightTheme,
  type SelectedThemeId,
} from "../themes";
import { isAppLocale, type AppLocale, type ThinkingSummaryModel } from "@vela/shared";
import { isConversationLinkTarget, type ConversationLinkTarget } from "../browser/conversation-link-policy";
import { soundEffectsKey } from "../notification-sounds";

export type InfoLayout = "sidebar" | "floating";
export type Appearance = "system" | "light" | "dark";
export type { AppLocale };

/** 对话里工具调用的展示方式:卡片可逐个展开,紧凑每行一个、多次调用折叠成摘要。 */
export type ToolDisplay = "card" | "compact";
/** 工具折叠的分组范围:按 Assistant 消息,或按界面上的位置关系跨消息合并。 */
export type ToolFold = "message" | "position";
/** 思考总结的展示方式:跟在“思考”后面、替换“思考”作为标题、或跟随回复正文样式。 */
export type ThinkingSummaryStyle = "inline" | "headline" | "prose";
export type FileIconTheme = "devicon" | "material";
export type SendButtonIcon = "paper-plane" | "arrow-up";

const infoLayoutKey = "vela.infoLayout";
const conversationLinkTargetKey = "vela.conversationLinkTarget";
const appearanceKey = "vela.appearance";
const lightThemeKey = "vela.theme.light";
const darkThemeKey = "vela.theme.dark";
const customThemesKey = "vela.theme.custom";
/** 各自定义主题推导出的变量缓存:index.html 首帧前读它上色,避免先闪一下默认主题。 */
const customThemeVarsKey = "vela.theme.customVars";
const localeKey = "vela.locale";
const toolDisplayKey = "vela.toolDisplay";
const toolFoldKey = "vela.toolFold";
const toolProcessDetailsKey = "vela.toolProcessDetails";
const thinkingSummaryKey = "vela.thinkingSummary";
const thinkingSummaryStyleKey = "vela.thinkingSummaryStyle";
const thinkingSummaryModelKey = "vela.thinkingSummaryModel";
const inputPredictionKey = "vela.inputPrediction";
const inputPredictionModelKey = "vela.inputPredictionModel";
const fileIconThemeKey = "vela.fileIconTheme";
const composerCapsulesKey = "vela.composerCapsules";
const sendButtonIconKey = "vela.sendButtonIcon";
const hiddenModelsKey = "vela.hiddenModels";
const darkQuery = "(prefers-color-scheme: dark)";

/** 输入框模型列表里隐藏哪些模型，用 `provider/id` 作为唯一标识。 */
export function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

function readStored<T>(key: string, accept: (value: unknown) => value is T, fallback: T): T {
  try {
    const value = uiStorage.getItem(key);
    if (accept(value)) return value;
  } catch {
    // 隐私模式无法读取本地存储时使用默认值。
  }
  return fallback;
}

function writeStored(key: string, value: string) {
  try {
    uiStorage.setItem(key, value);
  } catch {
    // 写不进去时仍保留本次会话的选择。
  }
}

function readStoredJson<T>(key: string, accept: (value: unknown) => value is T, fallback: T): T {
  try {
    const raw = uiStorage.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    if (accept(value)) return value;
  } catch {
    // 解析失败时使用默认值。
  }
  return fallback;
}

function isHiddenModelList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAppearance(value: unknown): value is Appearance {
  return value === "light" || value === "dark" || value === "system";
}

function isLocale(value: unknown): value is AppLocale {
  return isAppLocale(value);
}

function isToolDisplay(value: unknown): value is ToolDisplay {
  return value === "card" || value === "compact";
}

function isToolFold(value: unknown): value is ToolFold {
  return value === "message" || value === "position";
}

function isThinkingSummaryStyle(value: unknown): value is ThinkingSummaryStyle {
  return value === "inline" || value === "headline" || value === "prose";
}

function isThinkingSummaryModel(value: unknown): value is ThinkingSummaryModel | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return typeof model.provider === "string" && Boolean(model.provider.trim()) && model.provider.length <= 200 &&
    typeof model.id === "string" && Boolean(model.id.trim()) && model.id.length <= 500;
}

function isFileIconTheme(value: unknown): value is FileIconTheme {
  return value === "devicon" || value === "material";
}

function isSendButtonIcon(value: unknown): value is SendButtonIcon {
  return value === "paper-plane" || value === "arrow-up";
}

function systemScheme(): ColorScheme {
  return window.matchMedia(darkQuery).matches ? "dark" : "light";
}

export function usePreferences() {
  const [soundEffects, setSoundEffects] = useState(() =>
    readStored(soundEffectsKey, (value): value is string => value === "true" || value === "false", "true") === "true",
  );
  const [conversationLinkTarget, setConversationLinkTarget] = useState<ConversationLinkTarget>(() =>
    readStored(conversationLinkTargetKey, isConversationLinkTarget, "embedded"),
  );
  const [infoLayout, setInfoLayout] = useState<InfoLayout>(() =>
    readStored(infoLayoutKey, (value): value is InfoLayout => value === "sidebar" || value === "floating", "sidebar"),
  );
  const [appearance, setAppearance] = useState<Appearance>(() => readStored(appearanceKey, isAppearance, "system"));
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() =>
    parseCustomThemes(readStoredJson(customThemesKey, (value): value is unknown[] => Array.isArray(value), [])),
  );
  const [lightTheme, setLightTheme] = useState<LightTheme | CustomThemeId>(() => {
    const saved = readStored(lightThemeKey, (value): value is string => typeof value === "string", "");
    if (isLightTheme(saved)) return saved;
    return customThemes.some((item) => item.id === saved && item.scheme === "light") && isCustomThemeId(saved)
      ? saved
      : defaultLightTheme;
  });
  const [darkTheme, setDarkTheme] = useState<DarkTheme | CustomThemeId>(() => {
    const saved = readStored(darkThemeKey, (value): value is string => typeof value === "string", "");
    if (isDarkTheme(saved)) return saved;
    return customThemes.some((item) => item.id === saved && item.scheme === "dark") && isCustomThemeId(saved)
      ? saved
      : defaultDarkTheme;
  });
  const [system, setSystem] = useState<ColorScheme>(systemScheme);
  const [locale, setLocale] = useState<AppLocale>(() => {
    const value = readStored(localeKey, isLocale, "zh-CN");
    document.documentElement.lang = value;
    return value;
  });
  const [toolDisplay, setToolDisplay] = useState<ToolDisplay>(() =>
    readStored(toolDisplayKey, isToolDisplay, "compact"),
  );
  const [toolFold, setToolFold] = useState<ToolFold>(() =>
    readStored(toolFoldKey, isToolFold, "message"),
  );
  /** 紧凑过程行的耗时标签与折叠记忆:默认关闭,与开启前的行为一致。 */
  const [toolProcessDetails, setToolProcessDetails] = useState(() =>
    readStored(toolProcessDetailsKey, (value): value is string => value === "true", "false") === "true",
  );
  const [thinkingSummary, setThinkingSummary] = useState(() =>
    readStored(thinkingSummaryKey, (value): value is string => value === "true", "false") === "true",
  );
  const [thinkingSummaryStyle, setThinkingSummaryStyle] = useState<ThinkingSummaryStyle>(() =>
    readStored(thinkingSummaryStyleKey, isThinkingSummaryStyle, "inline"),
  );
  const [thinkingSummaryModel, setThinkingSummaryModel] = useState<ThinkingSummaryModel | null>(() =>
    readStoredJson(thinkingSummaryModelKey, isThinkingSummaryModel, null),
  );
  /** 输入预测：默认关闭，开启后每轮回复结束会额外请求一次模型。 */
  const [inputPrediction, setInputPrediction] = useState(() =>
    readStored(inputPredictionKey, (value): value is string => value === "true", "false") === "true",
  );
  const [inputPredictionModel, setInputPredictionModel] = useState<ThinkingSummaryModel | null>(() =>
    readStoredJson(inputPredictionModelKey, isThinkingSummaryModel, null),
  );
  const [fileIconTheme, setFileIconTheme] = useState<FileIconTheme>(() =>
    readStored(fileIconThemeKey, isFileIconTheme, "material"),
  );
  const [hiddenModels, setHiddenModels] = useState<string[]>(() =>
    readStoredJson(hiddenModelsKey, isHiddenModelList, []),
  );
  const [composerCapsules, setComposerCapsules] = useState(() =>
    readStored(composerCapsulesKey, (value): value is string => value === "true", "false") === "true",
  );
  const [sendButtonIcon, setSendButtonIcon] = useState<SendButtonIcon>(() =>
    readStored(sendButtonIconKey, isSendButtonIcon, "paper-plane"),
  );

  const isModelHidden = useCallback(
    (provider: string, id: string) => hiddenModels.includes(modelKey(provider, id)),
    [hiddenModels],
  );

  const setModelHidden = useCallback((provider: string, id: string, hidden: boolean) => {
    setHiddenModels((current) => {
      const key = modelKey(provider, id);
      if (hidden) return current.includes(key) ? current : [...current, key];
      if (!current.includes(key)) return current;
      return current.filter((item) => item !== key);
    });
  }, []);

  const showAllModels = useCallback(() => setHiddenModels([]), []);

  useEffect(() => {
    const media = window.matchMedia(darkQuery);
    const update = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const scheme: ColorScheme = appearance === "system" ? system : appearance;
  const theme: SelectedThemeId = scheme === "dark" ? darkTheme : lightTheme;
  const activeCustomTheme = customThemes.find((item) => item.id === theme && item.scheme === scheme) ?? null;

  const appliedVars = useRef<string[]>([]);
  useEffect(() => {
    const root = document.documentElement;
    // 先写内联变量再改 data-*:终端等观察者在 data-* 变化时重新读取变量。
    for (const name of appliedVars.current) root.style.removeProperty(name);
    const vars = activeCustomTheme ? customThemeVars(activeCustomTheme) : {};
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    appliedVars.current = Object.keys(vars);
    root.dataset.scheme = scheme;
    // 选中的自定义主题已不存在(数据被改动或清理)时退回默认,避免挂着没有样式的 id。
    root.dataset.theme = activeCustomTheme
      ? activeCustomTheme.id
      : isCustomThemeId(theme)
        ? scheme === "dark" ? defaultDarkTheme : defaultLightTheme
        : theme;
  }, [scheme, theme, activeCustomTheme]);

  const saveCustomTheme = useCallback((next: CustomTheme) => {
    setCustomThemes((current) => {
      const index = current.findIndex((item) => item.id === next.id);
      if (index >= 0) return current.map((item, i) => (i === index ? next : item));
      return current.length >= maxCustomThemes ? current : [...current, next];
    });
  }, []);

  const deleteCustomTheme = useCallback((id: CustomThemeId) => {
    setCustomThemes((current) => current.filter((item) => item.id !== id));
    setLightTheme((current) => (current === id ? defaultLightTheme : current));
    setDarkTheme((current) => (current === id ? defaultDarkTheme : current));
  }, []);

  useEffect(() => writeStored(infoLayoutKey, infoLayout), [infoLayout]);
  useEffect(() => writeStored(soundEffectsKey, String(soundEffects)), [soundEffects]);
  useEffect(() => writeStored(conversationLinkTargetKey, conversationLinkTarget), [conversationLinkTarget]);
  useEffect(() => writeStored(appearanceKey, appearance), [appearance]);
  useEffect(() => writeStored(lightThemeKey, lightTheme), [lightTheme]);
  useEffect(() => writeStored(darkThemeKey, darkTheme), [darkTheme]);
  useEffect(() => writeStored(customThemesKey, JSON.stringify(customThemes)), [customThemes]);
  useEffect(() => {
    const cache: Record<string, Record<string, string>> = {};
    for (const item of customThemes) cache[item.id] = customThemeVars(item);
    writeStored(customThemeVarsKey, JSON.stringify(cache));
  }, [customThemes]);

  useEffect(() => {
    document.documentElement.lang = locale;
    writeStored(localeKey, locale);
  }, [locale]);

  useEffect(() => writeStored(toolDisplayKey, toolDisplay), [toolDisplay]);
  useEffect(() => writeStored(toolFoldKey, toolFold), [toolFold]);
  useEffect(() => writeStored(toolProcessDetailsKey, String(toolProcessDetails)), [toolProcessDetails]);
  useEffect(() => writeStored(thinkingSummaryKey, String(thinkingSummary)), [thinkingSummary]);
  useEffect(() => writeStored(thinkingSummaryStyleKey, thinkingSummaryStyle), [thinkingSummaryStyle]);
  useEffect(() => writeStored(thinkingSummaryModelKey, JSON.stringify(thinkingSummaryModel)), [thinkingSummaryModel]);
  useEffect(() => writeStored(inputPredictionKey, String(inputPrediction)), [inputPrediction]);
  useEffect(() => writeStored(inputPredictionModelKey, JSON.stringify(inputPredictionModel)), [inputPredictionModel]);
  useEffect(() => writeStored(fileIconThemeKey, fileIconTheme), [fileIconTheme]);
  useEffect(() => writeStored(sendButtonIconKey, sendButtonIcon), [sendButtonIcon]);
  useEffect(() => writeStored(hiddenModelsKey, JSON.stringify(hiddenModels)), [hiddenModels]);
  useEffect(() => {
    document.documentElement.dataset.composerCapsules = String(composerCapsules);
    writeStored(composerCapsulesKey, String(composerCapsules));
  }, [composerCapsules]);

  return {
    soundEffects,
    setSoundEffects,
    conversationLinkTarget,
    setConversationLinkTarget,
    infoLayout,
    setInfoLayout,
    appearance,
    scheme,
    theme,
    lightTheme,
    darkTheme,
    customThemes,
    saveCustomTheme,
    deleteCustomTheme,
    locale,
    toolDisplay,
    toolFold,
    toolProcessDetails,
    thinkingSummary,
    thinkingSummaryStyle,
    thinkingSummaryModel,
    inputPrediction,
    inputPredictionModel,
    fileIconTheme,
    hiddenModels,
    composerCapsules,
    setComposerCapsules,
    sendButtonIcon,
    setSendButtonIcon,
    isModelHidden,
    setModelHidden,
    showAllModels,
    setAppearance,
    setLightTheme,
    setDarkTheme,
    setLocale,
    setToolDisplay,
    setToolFold,
    setToolProcessDetails,
    setThinkingSummary,
    setThinkingSummaryStyle,
    setThinkingSummaryModel,
    setInputPrediction,
    setInputPredictionModel,
    setFileIconTheme,
  };
}

export type PreferencesApi = ReturnType<typeof usePreferences>;
