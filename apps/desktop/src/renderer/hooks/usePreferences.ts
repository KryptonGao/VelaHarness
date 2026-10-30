import {
  clampHeight,
  defaultThinkingGroupHeight,
  defaultToolDetailHeight,
  thinkingGroupHeightStops,
  toolDetailHeightStops,
} from "../thinking-group-height";
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

export type InfoLayout = "sidebar" | "floating" | "cards";
export type Appearance = "system" | "light" | "dark";
export type { AppLocale };

/** 对话里工具调用的展示方式:卡片可逐个展开,紧凑每行一个、多次调用折叠成摘要。 */
export type ToolDisplay = "card" | "compact";
/** 工具折叠的分组范围:按 Assistant 消息、按界面上的位置关系跨消息合并,或完全不折叠。 */
export type ToolFold = "message" | "position" | "none";
/** 紧凑工具图标的配色:按类型彩色、全部使用主题强调色、或统一灰色。 */
export type ToolIconColor = "color" | "theme" | "gray";
/** 思考总结的展示方式:跟在“思考”后面、替换“思考”作为标题、或跟随回复正文样式。 */
export type ThinkingSummaryStyle = "inline" | "headline" | "prose";
/** 思考分组方式:每次 CoT 总结自成一组(默认),或以正式回复为界、回复之间的过程合成一组。 */
export type ThinkingGroupMode = "single" | "coherent";
/** 半透明玻璃上叠的颜色:当前主题色、按明暗固定的白/黑、或不叠色。 */
export type GlassTint = "theme" | "neutral" | "none";
export type FileIconTheme = "devicon" | "material" | "catppuccin";
export type SendButtonIcon = "paper-plane" | "arrow-up";
/** 字体风格:sans 为无衬线,serif 为明体(衬线);回复字体另有 inherit,表示沿用界面字体。 */
export type UiFontFace = "sans" | "serif";
export type ReplyFontFace = UiFontFace | "inherit";

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
const runViewKey = "vela.runView";
const recommendedActionsKey = "vela.recommendedActions";
const toolIconColorKey = "vela.toolIconColor";
const thinkingGroupModeKey = "vela.thinkingGroupMode";
const thinkingGroupHeightKey = "vela.thinkingGroupHeight";
const toolDetailHeightKey = "vela.toolDetailHeight";
const toolDetailHeightScaleKey = "vela.toolDetailHeightScale";
const thinkingGroupHeightGrowKey = "vela.thinkingGroupHeightGrow";
const replyFadeKey = "vela.replyFade";
const replyPopKey = "vela.replyPop";
const thinkingFadeKey = "vela.thinkingFade";
const thinkingPopKey = "vela.thinkingPop";
const thinkingSummaryKey = "vela.thinkingSummary";
const thinkingSummaryStyleKey = "vela.thinkingSummaryStyle";
const thinkingSummaryModelKey = "vela.thinkingSummaryModel";
const inputPredictionKey = "vela.inputPrediction";
const inputPredictionModelKey = "vela.inputPredictionModel";
const fileIconThemeKey = "vela.fileIconTheme";
const composerCapsulesKey = "vela.composerCapsules";
const glassTintKey = "vela.glassTint";
const sendButtonIconKey = "vela.sendButtonIcon";
const uiFontLatinKey = "vela.font.ui.latin";
const uiFontCjkKey = "vela.font.ui.cjk";
const replyFontLatinKey = "vela.font.reply.latin";
const replyFontCjkKey = "vela.font.reply.cjk";
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

/** 读取高度设置:不是整数或超出档位范围时用默认值。 */
function readStoredHeight(key: string, stops: readonly number[], fallback: number): number {
  const value = Number(readStored(key, (raw): raw is string => typeof raw === "string" && /^\d+$/.test(raw), String(fallback)));
  return clampHeight(stops, value);
}

function readStoredFlag(key: string, fallback: boolean): boolean {
  return readStored(key, (value): value is string => value === "true" || value === "false", String(fallback)) === "true";
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

/** 旧版本把配色存成 "true" / "false",读取时映射到新的三档。 */
function readToolIconColor(): ToolIconColor {
  const stored = readStored(
    toolIconColorKey,
    (value): value is string => ["color", "theme", "gray", "true", "false"].includes(value as string),
    "color",
  );
  return stored === "true" ? "color" : stored === "false" ? "gray" : (stored as ToolIconColor);
}

function isToolFold(value: unknown): value is ToolFold {
  return value === "message" || value === "position" || value === "none";
}

function isThinkingGroupMode(value: unknown): value is ThinkingGroupMode {
  return value === "single" || value === "coherent";
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

function isGlassTint(value: unknown): value is GlassTint {
  return value === "theme" || value === "neutral" || value === "none";
}

function isFileIconTheme(value: unknown): value is FileIconTheme {
  return value === "devicon" || value === "material" || value === "catppuccin";
}

function isSendButtonIcon(value: unknown): value is SendButtonIcon {
  return value === "paper-plane" || value === "arrow-up";
}

function isUiFontFace(value: unknown): value is UiFontFace {
  return value === "sans" || value === "serif";
}

function isReplyFontFace(value: unknown): value is ReplyFontFace {
  return value === "inherit" || isUiFontFace(value);
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
    readStored(infoLayoutKey, (value): value is InfoLayout => value === "sidebar" || value === "floating" || value === "cards", "sidebar"),
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
  /** 运行视图:运行中在本轮过程末尾显示待办清单与当前步骤状态,并要求模型提交待办清单。默认关闭。 */
  const [runView, setRunView] = useState(() =>
    readStored(runViewKey, (value): value is string => value === "true", "false") === "true",
  );
  /** 推荐操作：模型完成任务后可给出后续操作卡片。默认开启，不额外调用模型。 */
  const [recommendedActions, setRecommendedActions] = useState(() =>
    readStored(recommendedActionsKey, (value): value is string => value === "true" || value === "false", "true") === "true",
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
  const [toolIconColor, setToolIconColor] = useState<ToolIconColor>(readToolIconColor);
  /** 思考分组展开区、以及其中命令/编辑详情的最大高度(px),通过根节点 CSS 变量作用到界面。 */
  const [thinkingGroupMode, setThinkingGroupMode] = useState<ThinkingGroupMode>(() =>
    readStored(thinkingGroupModeKey, isThinkingGroupMode, "single"),
  );
  const [thinkingGroupHeight, setThinkingGroupHeightState] = useState(() =>
    readStoredHeight(thinkingGroupHeightKey, thinkingGroupHeightStops, defaultThinkingGroupHeight),
  );
  const [toolDetailHeight, setToolDetailHeightState] = useState(() =>
    readStoredHeight(toolDetailHeightKey, toolDetailHeightStops, defaultToolDetailHeight),
  );
  const setThinkingGroupHeight = useCallback((value: number) => setThinkingGroupHeightState(clampHeight(thinkingGroupHeightStops, value)), []);
  const setToolDetailHeight = useCallback((value: number) => setToolDetailHeightState(clampHeight(toolDetailHeightStops, value)), []);
  /** 分组实际高度不足设定值时,详情高度按「详情上限 ÷ 分组上限」同比缩小。默认开启。 */
  const [toolDetailHeightScale, setToolDetailHeightScale] = useState(() => readStoredFlag(toolDetailHeightScaleKey, true));
  /** 展开命令或编辑详情时增高分组,优先于按比例缩小。默认关闭,保留旧行为。 */
  const [thinkingGroupHeightGrow, setThinkingGroupHeightGrow] = useState(() => readStoredFlag(thinkingGroupHeightGrowKey, false));
  const [replyFade, setReplyFade] = useState(() => readStoredFlag(replyFadeKey, true));
  const [replyPop, setReplyPop] = useState(() => readStoredFlag(replyPopKey, true));
  const [thinkingFade, setThinkingFade] = useState(() => readStoredFlag(thinkingFadeKey, true));
  const [thinkingPop, setThinkingPop] = useState(() => readStoredFlag(thinkingPopKey, true));
  const [composerCapsules, setComposerCapsules] = useState(() =>
    readStored(composerCapsulesKey, (value): value is string => value === "true", "false") === "true",
  );
  const [glassTint, setGlassTint] = useState<GlassTint>(() => readStored(glassTintKey, isGlassTint, "theme"));
  const [sendButtonIcon, setSendButtonIcon] = useState<SendButtonIcon>(() =>
    readStored(sendButtonIconKey, isSendButtonIcon, "paper-plane"),
  );
  const [uiFontLatin, setUiFontLatin] = useState<UiFontFace>(() => readStored(uiFontLatinKey, isUiFontFace, "sans"));
  const [uiFontCjk, setUiFontCjk] = useState<UiFontFace>(() => readStored(uiFontCjkKey, isUiFontFace, "sans"));
  const [replyFontLatin, setReplyFontLatin] = useState<ReplyFontFace>(() =>
    readStored(replyFontLatinKey, isReplyFontFace, "inherit"),
  );
  const [replyFontCjk, setReplyFontCjk] = useState<ReplyFontFace>(() =>
    readStored(replyFontCjkKey, isReplyFontFace, "inherit"),
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
  useEffect(() => writeStored(thinkingGroupModeKey, thinkingGroupMode), [thinkingGroupMode]);
  useEffect(() => writeStored(toolProcessDetailsKey, String(toolProcessDetails)), [toolProcessDetails]);
  useEffect(() => {
    writeStored(runViewKey, String(runView));
    // 运行时要据此决定是否要求模型提交待办清单;浏览器预览等没有 window.vela 的环境直接跳过。
    void Promise.resolve(window.vela?.setRunView(runView)).catch(() => undefined);
  }, [runView]);
  useEffect(() => {
    writeStored(recommendedActionsKey, String(recommendedActions));
    void Promise.resolve(window.vela?.setRecommendedActions(recommendedActions)).catch(() => undefined);
  }, [recommendedActions]);
  useEffect(() => writeStored(thinkingSummaryKey, String(thinkingSummary)), [thinkingSummary]);
  useEffect(() => writeStored(thinkingSummaryStyleKey, thinkingSummaryStyle), [thinkingSummaryStyle]);
  useEffect(() => writeStored(thinkingSummaryModelKey, JSON.stringify(thinkingSummaryModel)), [thinkingSummaryModel]);
  useEffect(() => writeStored(inputPredictionKey, String(inputPrediction)), [inputPrediction]);
  useEffect(() => writeStored(inputPredictionModelKey, JSON.stringify(inputPredictionModel)), [inputPredictionModel]);
  useEffect(() => writeStored(fileIconThemeKey, fileIconTheme), [fileIconTheme]);
  useEffect(() => writeStored(sendButtonIconKey, sendButtonIcon), [sendButtonIcon]);
  useEffect(() => writeStored(hiddenModelsKey, JSON.stringify(hiddenModels)), [hiddenModels]);
  useEffect(() => {
    // data-tool-icon-color 仍是「是否上色」的开关,主题色模式再叠加 data-tool-icon-theme。
    document.documentElement.dataset.toolIconColor = String(toolIconColor !== "gray");
    document.documentElement.dataset.toolIconTheme = String(toolIconColor === "theme");
    writeStored(toolIconColorKey, toolIconColor);
  }, [toolIconColor]);
  useEffect(() => {
    document.documentElement.style.setProperty("--thinking-group-height", `${thinkingGroupHeight}px`);
    writeStored(thinkingGroupHeightKey, String(thinkingGroupHeight));
  }, [thinkingGroupHeight]);
  useEffect(() => {
    document.documentElement.style.setProperty("--tool-detail-height", `${toolDetailHeight}px`);
    writeStored(toolDetailHeightKey, String(toolDetailHeight));
  }, [toolDetailHeight]);
  useEffect(() => {
    document.documentElement.style.setProperty("--tool-detail-ratio", (toolDetailHeight / thinkingGroupHeight).toFixed(4));
  }, [thinkingGroupHeight, toolDetailHeight]);
  useEffect(() => {
    document.documentElement.dataset.toolDetailScale = String(toolDetailHeightScale);
    writeStored(toolDetailHeightScaleKey, String(toolDetailHeightScale));
  }, [toolDetailHeightScale]);
  useEffect(() => {
    document.documentElement.dataset.thinkingGroupGrow = String(thinkingGroupHeightGrow);
    writeStored(thinkingGroupHeightGrowKey, String(thinkingGroupHeightGrow));
  }, [thinkingGroupHeightGrow]);
  // 流式文字的淡入、弹跳动画由 CSS 按根节点属性切换,不必把开关传到每个 Markdown。
  useEffect(() => {
    document.documentElement.dataset.replyFade = String(replyFade);
    writeStored(replyFadeKey, String(replyFade));
  }, [replyFade]);
  useEffect(() => {
    document.documentElement.dataset.replyPop = String(replyPop);
    writeStored(replyPopKey, String(replyPop));
  }, [replyPop]);
  useEffect(() => {
    document.documentElement.dataset.thinkingFade = String(thinkingFade);
    writeStored(thinkingFadeKey, String(thinkingFade));
  }, [thinkingFade]);
  useEffect(() => {
    document.documentElement.dataset.thinkingPop = String(thinkingPop);
    writeStored(thinkingPopKey, String(thinkingPop));
  }, [thinkingPop]);
  useEffect(() => {
    document.documentElement.dataset.uiFontLatin = uiFontLatin;
    writeStored(uiFontLatinKey, uiFontLatin);
  }, [uiFontLatin]);
  useEffect(() => {
    document.documentElement.dataset.uiFontCjk = uiFontCjk;
    writeStored(uiFontCjkKey, uiFontCjk);
  }, [uiFontCjk]);
  useEffect(() => {
    document.documentElement.dataset.replyFontLatin = replyFontLatin;
    writeStored(replyFontLatinKey, replyFontLatin);
  }, [replyFontLatin]);
  useEffect(() => {
    document.documentElement.dataset.replyFontCjk = replyFontCjk;
    writeStored(replyFontCjkKey, replyFontCjk);
  }, [replyFontCjk]);
  useEffect(() => {
    document.documentElement.dataset.composerCapsules = String(composerCapsules);
    writeStored(composerCapsulesKey, String(composerCapsules));
  }, [composerCapsules]);
  // 窗口失焦时玻璃改为不透明(见 styles.css 的 data-window-focused)。浏览器预览没有 window.vela,视为一直聚焦。
  useEffect(() => {
    const root = document.documentElement;
    const apply = (focused: boolean) => { root.dataset.windowFocused = String(focused); };
    apply(window.vela?.isWindowFocused?.() ?? true);
    return window.vela?.onWindowFocusChange?.(apply);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.glassTint = glassTint;
    writeStored(glassTintKey, glassTint);
  }, [glassTint]);

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
    runView,
    recommendedActions,
    toolIconColor,
    thinkingGroupMode,
    thinkingGroupHeight,
    toolDetailHeight,
    toolDetailHeightScale,
    thinkingGroupHeightGrow,
    replyFade,
    replyPop,
    thinkingFade,
    thinkingPop,
    thinkingSummary,
    thinkingSummaryStyle,
    thinkingSummaryModel,
    inputPrediction,
    inputPredictionModel,
    fileIconTheme,
    hiddenModels,
    composerCapsules,
    setComposerCapsules,
    glassTint,
    setGlassTint,
    sendButtonIcon,
    setSendButtonIcon,
    uiFontLatin,
    setUiFontLatin,
    uiFontCjk,
    setUiFontCjk,
    replyFontLatin,
    setReplyFontLatin,
    replyFontCjk,
    setReplyFontCjk,
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
    setRunView,
    setRecommendedActions,
    setToolIconColor,
    setThinkingGroupMode,
    setThinkingGroupHeight,
    setToolDetailHeight,
    setToolDetailHeightScale,
    setThinkingGroupHeightGrow,
    setReplyFade,
    setReplyPop,
    setThinkingFade,
    setThinkingPop,
    setThinkingSummary,
    setThinkingSummaryStyle,
    setThinkingSummaryModel,
    setInputPrediction,
    setInputPredictionModel,
    setFileIconTheme,
  };
}

export type PreferencesApi = ReturnType<typeof usePreferences>;
