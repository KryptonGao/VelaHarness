import { appLocaleNames, type ReleaseNotes } from "@vela/shared";
import {
  customModelApis,
  thinkingLevels,
  type AgentSettings,
  type AuthMethodType,
  type CustomModelInput,
  type ExternalSkillCandidate,
  type ExternalSkillScan,
  type ExternalSkillSource,
  type ProviderSummary,
  type ResidentSettings,
  type SkillMigrationResult,
  type ThinkingLevel,
  type UpdateState,
} from "@vela/shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";
import type { useModels } from "../hooks/useModels";
import type { Appearance, PreferencesApi } from "../hooks/usePreferences";
import type { ProjectApi } from "../hooks/useProject";
import { darkThemes, lightThemes, type ColorScheme, type DarkTheme, type LightTheme, type ThemeId } from "../themes";
import { localizeError } from "../locale";
import { settingsCopy } from "./settings-copy";
import { onboardingCopy, type OnboardingCopy } from "./onboarding-copy";
import { BackgroundStep, LayoutStep, PersonalizeStep } from "./OnboardingExtraSteps";
import { FeatureScreen, HelloScreen, LanguageScreen, NewsScreen, TourScreen, Brand } from "./OnboardingIntro";
import { ObDefs, ObPanel, ObSail, ObSea, obColor } from "./onboarding-art";
import {
  configScreens,
  configStepCount,
  configStepNumber,
  optionalConfigSteps,
  restoreScreen,
  screenOrder,
  type OnboardingMode,
  type OnboardingScreen,
} from "./onboarding-flow";
import { Label, Note, Opt, fill } from "./onboarding-ui";
import { modeLabel } from "./resident-agent-model";
import type { SettingsPageId } from "./settings/settings-registry";
import { LoginDialog } from "./ModelControls";
import { SheetPresence } from "./Presence";
import "../onboarding.css";

type ModelsApi = ReturnType<typeof useModels>;

interface OnboardingViewProps {
  preferences: PreferencesApi;
  models: ModelsApi;
  project: ProjectApi;
  /** full 是首次安装的完整引导；intro 是设置里的「重看介绍」，只看介绍不改任何设置。 */
  mode?: OnboardingMode;
  initialScreen?: string | null;
  onScreenChange?: (screen: OnboardingScreen) => void;
  /** settingsPage 给出时，完成后直接打开设置里的对应页面。 */
  onComplete: (options?: { settingsPage?: SettingsPageId }) => void;
}

const sources: ExternalSkillSource[] = ["codex", "claude"];
const designWidth = 1280;
const designHeight = 800;
const providerColors = [obColor.coral, obColor.green, obColor.cobalt, obColor.ink];

const emptyCustomModel: CustomModelInput = {
  providerId: "",
  providerName: "",
  baseUrl: "",
  api: "openai-completions",
  apiKey: "",
  modelId: "",
  modelName: "",
  reasoning: false,
  contextWindow: null,
  maxTokens: null,
};

/** 引导里的主题预览：只用这里写死的色值，不读应用当前的主题变量。 */
const themeMock: Record<ThemeId, { side: string; chat: string; bubble: string; line: string; input: string; accent: string; edge: string }> = {
  daylight: { side: "#e6ecf5", chat: "#f4f7fb", bubble: "#dfe9fb", line: "#c3cde0", input: "#ffffff", accent: "#2563eb", edge: "#d5dded" },
  paper: { side: "#efe7d6", chat: "#faf8f3", bubble: "#f0eadf", line: "#dcd2c1", input: "#fffdf8", accent: "#c15f3c", edge: "#e3dac9" },
  celadon: { side: "#e1ece6", chat: "#f8fbf9", bubble: "#e9f1ed", line: "#cbdcd4", input: "#ffffff", accent: "#0e7c6b", edge: "#d3e2db" },
  midnight: { side: "#1d222b", chat: "#16181d", bubble: "#2a3140", line: "#3a4252", input: "#1e2128", accent: "#4f8cff", edge: "#2d3442" },
  graphite: { side: "#19191b", chat: "#111112", bubble: "#232325", line: "#38383c", input: "#19191b", accent: "#8e7dff", edge: "#2a2a2d" },
  ember: { side: "#211b17", chat: "#1a1613", bubble: "#2d251f", line: "#43382f", input: "#221d19", accent: "#eb8a5e", edge: "#382e26" },
};
const themeSwatch: Record<ThemeId, string> = {
  daylight: "#f4f7fb", paper: "#f1e6d2", celadon: "#d6ebe4", midnight: "#16233f", graphite: "#1e2128", ember: "#2c211c",
};

export function OnboardingView({ preferences, models, project, mode = "full", initialScreen, onScreenChange, onComplete }: OnboardingViewProps) {
  const locale = preferences.locale;
  const copy = onboardingCopy(locale);
  const settings = settingsCopy(locale);
  const settingsCopyAgent = settings.agent;
  const appearanceCopy = settings.appearance;
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: designWidth, height: designHeight });
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const order = screenOrder(mode, Boolean(notes));
  const [screen, setScreen] = useState<OnboardingScreen>(() => (mode === "intro" ? "hello" : restoreScreen(initialScreen, null)));
  const [leaving, setLeaving] = useState<{ screen: OnboardingScreen; key: number } | null>(null);
  const [direction, setDirection] = useState(1);
  const [animate, setAnimate] = useState(false);
  const history = useRef<OnboardingScreen[]>([]);
  const turn = useRef(0);
  const [scan, setScan] = useState<ExternalSkillScan | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set());
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [skillsNotice, setSkillsNotice] = useState<string | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [providerId, setProviderId] = useState("");
  const [providerError, setProviderError] = useState<string | null>(null);
  const [customProviderMode, setCustomProviderMode] = useState(false);
  const [customForm, setCustomForm] = useState<CustomModelInput>(emptyCustomModel);
  const [customBusy, setCustomBusy] = useState(false);
  const [savedAgentSettings, setSavedAgentSettings] = useState<AgentSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [savingAgentSettings, setSavingAgentSettings] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [resident, setResident] = useState<ResidentSettings | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState<boolean | null>(null);
  const [finishing, setFinishing] = useState(false);

  const providers = models.catalog?.providers ?? [];
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const availableModels = useMemo(
    () => (models.catalog?.models ?? []).filter((model) => model.provider === providerId && model.available),
    [models.catalog?.models, providerId],
  );
  const selectedModel = availableModels.find((model) => model.id === selectedModelId) ?? null;
  const modelThinkingLevels = selectedModel?.thinkingLevels.length ? selectedModel.thinkingLevels : [...thinkingLevels];
  const normalizedThinking = clampThinking(modelThinkingLevels, thinkingLevel);
  const connected = Boolean(selectedProvider && (selectedProvider.authenticated || selectedProvider.stored));
  const filteredProviders = providers.filter((provider) =>
    provider.name.toLocaleLowerCase().includes(providerQuery.trim().toLocaleLowerCase()),
  );
  const chosenSkills = scan?.skills.filter((skill) => selectedSkills.has(skill.id)) ?? [];

  // 画面按 1280×800 的设计稿排版，再整体缩放到窗口大小；窗口比设计稿更宽或更高时，多出来的空间由各画面自己吸收。
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(size.width / designWidth, size.height / designHeight);
  const stageStyle: CSSProperties = { width: size.width / scale, height: size.height / scale, transform: `scale(${scale})` };

  // 发布说明读自安装包；语言切换后重新读取。没有对应版本的说明时「新到港」整页略过。
  useEffect(() => {
    let active = true;
    const api = window.vela?.releaseNotes;
    if (!api) { setNotes(null); setNotesLoaded(true); return; }
    const settle = (value: ReleaseNotes | null) => { if (active) { setNotes(value); setNotesLoaded(true); } };
    void api.get(locale).then(settle, () => settle(null));
    return () => { active = false; };
  }, [locale]);

  useEffect(() => {
    const api = window.vela;
    if (!api) return;
    let active = true;
    void api.getAgentSettings().then(
      (value) => {
        if (!active) return;
        setSavedAgentSettings(value);
        setSelectedModelId(value.modelId ?? "");
        setThinkingLevel(value.thinkingLevel);
        setInstructions(value.instructions);
        setSettingsLoaded(true);
      },
      () => {
        if (!active) return;
        setSavedAgentSettings({ provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" });
        setSettingsLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!models.catalog || !settingsLoaded) return;
    setProviderId((current) => {
      if (current && models.catalog?.providers.some((provider) => provider.id === current)) return current;
      const savedProvider = savedAgentSettings?.provider;
      if (savedProvider && models.catalog?.providers.some((provider) => provider.id === savedProvider)) return savedProvider;
      return models.catalog?.providers.find((provider) => provider.authenticated || provider.stored)?.id ?? "";
    });
  }, [models.catalog, savedAgentSettings?.provider, settingsLoaded]);

  useEffect(() => {
    if (!providerId || !settingsLoaded) return;
    setSelectedModelId((current) => {
      if (current && availableModels.some((model) => model.id === current)) return current;
      const savedModel = savedAgentSettings?.provider === providerId ? savedAgentSettings.modelId : null;
      if (savedModel && availableModels.some((model) => model.id === savedModel)) return savedModel;
      return availableModels[0]?.id ?? "";
    });
  }, [availableModels, providerId, savedAgentSettings?.modelId, savedAgentSettings?.provider, settingsLoaded]);

  useEffect(() => {
    setThinkingLevel((current) => clampThinking(modelThinkingLevels, current));
  }, [modelThinkingLevels.join("|")]);

  useEffect(() => {
    if (screen !== "step-4") return;
    const api = window.vela;
    if (!api) return;
    let active = true;
    setScan(null);
    setScanError(null);
    setSkillsNotice(null);
    void api.scanExternalSkills().then(
      (next) => {
        if (!active) return;
        setScan(next);
        setSelectedSkills(new Set(next.skills.filter((skill) => skill.selectable && skill.state === "new").map((skill) => skill.id)));
      },
      (error: unknown) => {
        if (!active) return;
        setScanError(error instanceof Error ? error.message : settingsCopyAgent.migrateLoadError);
      },
    );
    return () => {
      active = false;
    };
  }, [scanAttempt, settingsCopyAgent.migrateLoadError, screen]);

  useEffect(() => {
    if (screen !== "step-8" && screen !== "done") return;
    let active = true;
    const api = window.vela;
    void api?.resident?.getSettings().then((value) => { if (active) setResident(value); }, () => undefined);
    void api?.updates?.getState().then((value) => { if (active) setUpdateState(value); }, () => undefined);
    void api?.memory?.list().then((result) => { if (active && result.ok) setMemoryEnabled(result.value.enabled); }, () => undefined);
    return () => { active = false; };
  }, [screen]);

  // 带着「新到港」停下来的引导，在发布说明消失（例如换到没有译文的版本）时退到下一页。
  useEffect(() => {
    if (screen === "news" && notesLoaded && !notes && order.length) navigate("step-1");
  }, [screen, notes, notesLoaded]);

  // 只看介绍时，按 Esc 随时关闭。
  useEffect(() => {
    if (mode !== "intro") return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onComplete(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onComplete]);

  // 离场的画面在滑入动画结束后移除。
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), 620);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  function navigate(target: OnboardingScreen, options: { back?: boolean } = {}): void {
    if (mode === "intro" && target === "done") { onComplete(); return; }
    if (target === screen) return;
    const forward = !options.back && order.indexOf(target) >= order.indexOf(screen);
    if (!options.back) history.current.push(screen);
    setDirection(options.back || !forward ? -1 : 1);
    setAnimate(true);
    turn.current += 1;
    setLeaving({ screen, key: turn.current });
    setScreen(target);
    setSaveError(null);
    onScreenChange?.(target);
  }

  /** 回到上一个看过的画面；没有记录时回到顺序里的前一页。 */
  function back(): void {
    const previous = history.current.pop() ?? order[Math.max(0, order.indexOf(screen) - 1)]!;
    navigate(previous, { back: true });
  }

  function next(): void {
    const target = order[order.indexOf(screen) + 1];
    if (target) navigate(target);
  }

  function pickTheme(scheme: ColorScheme, id: ThemeId): void {
    if (scheme === "light") preferences.setLightTheme(id as LightTheme);
    else preferences.setDarkTheme(id as DarkTheme);
    if (preferences.appearance !== "system" && preferences.appearance !== scheme) {
      preferences.setAppearance(scheme);
    }
  }

  function pickProvider(provider: ProviderSummary): void {
    setProviderId(provider.id);
    setCustomProviderMode(false);
    setProviderError(null);
    if (savedAgentSettings?.provider === provider.id && savedAgentSettings.modelId) {
      setSelectedModelId(savedAgentSettings.modelId);
    } else {
      const first = models.catalog?.models.find((model) => model.provider === provider.id && model.available);
      setSelectedModelId(first?.id ?? "");
    }
  }

  function toggleSkill(skill: ExternalSkillCandidate): void {
    if (!skill.selectable || skillsBusy) return;
    setSelectedSkills((current) => {
      const nextSet = new Set(current);
      if (nextSet.has(skill.id)) nextSet.delete(skill.id);
      else nextSet.add(skill.id);
      return nextSet;
    });
  }

  function toggleSource(items: ExternalSkillCandidate[]): void {
    const ids = items.filter((skill) => skill.selectable).map((skill) => skill.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedSkills.has(id));
    setSelectedSkills((current) => {
      const nextSet = new Set(current);
      for (const id of ids) {
        if (allSelected) nextSet.delete(id);
        else nextSet.add(id);
      }
      return nextSet;
    });
  }

  async function continueFromSkills(): Promise<void> {
    if (!window.vela || !scan || chosenSkills.length === 0) {
      navigate("step-5");
      return;
    }
    setSkillsBusy(true);
    setScanError(null);
    try {
      const result: SkillMigrationResult = await window.vela.migrateSkills(chosenSkills.map((skill) => skill.id));
      const migrated = result.copied.length + result.replaced.length;
      const suffix = result.skipped.length ? ` ${copy.migrationPartial}` : "";
      setSkillsNotice(`${copy.migrationDone(migrated)}${suffix}`);
      navigate("step-5");
    } catch (error) {
      setScanError(error instanceof Error ? error.message : copy.migrationError);
    } finally {
      setSkillsBusy(false);
    }
  }

  async function addCustomProvider(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!models.register) return;
    const id = providerIdFromName(customForm.providerName);
    if (!id) {
      setProviderError(settings.models.providerInvalid);
      return;
    }
    if (!customForm.baseUrl.trim() || !customForm.modelId.trim()) {
      setProviderError(copy.connectError);
      return;
    }
    setCustomBusy(true);
    setProviderError(null);
    const result = await models.register({
      ...customForm,
      providerId: id,
      providerName: customForm.providerName.trim(),
      baseUrl: customForm.baseUrl.trim(),
      modelId: customForm.modelId.trim(),
      modelName: customForm.modelName.trim(),
    });
    setCustomBusy(false);
    if (typeof result === "string" && result) {
      setProviderError(result);
      return;
    }
    setProviderId(id);
    setSelectedModelId(customForm.modelId.trim());
    setCustomProviderMode(false);
    setProviderError(null);
    setCustomForm(emptyCustomModel);
  }

  async function continueFromModel(): Promise<void> {
    if (!window.vela || !selectedProvider || !selectedModel) return;
    setSavingAgentSettings(true);
    setSaveError(null);
    try {
      const nextSettings: AgentSettings = {
        provider: selectedProvider.id,
        modelId: selectedModel.id,
        thinkingLevel: normalizedThinking,
        newConversationSelection: savedAgentSettings?.newConversationSelection ?? "default",
        instructions: savedAgentSettings?.instructions ?? "",
      };
      setSavedAgentSettings(await window.vela.saveAgentSettings(nextSettings));
      navigate("step-7");
    } catch (error) {
      setSaveError(error instanceof Error ? localizeError(error.message) : copy.saveError);
    } finally {
      setSavingAgentSettings(false);
    }
  }

  async function continueFromPersonalize(): Promise<void> {
    if (!window.vela || !savedAgentSettings || instructions === savedAgentSettings.instructions) {
      navigate("step-8");
      return;
    }
    setSavingAgentSettings(true);
    setSaveError(null);
    try {
      setSavedAgentSettings(await window.vela.saveAgentSettings({ ...savedAgentSettings, instructions }));
      navigate("step-8");
    } catch (error) {
      setSaveError(error instanceof Error ? localizeError(error.message) : copy.saveError);
    } finally {
      setSavingAgentSettings(false);
    }
  }

  async function chooseFolder(): Promise<void> {
    await project.openWorkspaceDialog();
  }

  /** 新用户默认使用「帮我批准」：只在仍是出厂的「每次询问」时改，不覆盖用户已做过的选择。 */
  async function applyDefaultPermissions(): Promise<void> {
    try {
      const current = await window.vela?.getSandboxMode();
      if (current === "ask") await project.setSandboxMode("smart");
    } catch {
      // 权限默认值保存失败不阻止进入应用，仍可在输入框旁手动切换。
    }
  }

  async function finish(settingsPage?: SettingsPageId): Promise<void> {
    setFinishing(true);
    await applyDefaultPermissions();
    setFinishing(false);
    onComplete(settingsPage ? { settingsPage } : undefined);
  }

  const themeSummary = `${appearanceCopy.themes[preferences.lightTheme].name} / ${appearanceCopy.themes[preferences.darkTheme].name}`;
  const selectedProviderName = selectedProvider?.name ?? savedAgentSettings?.provider ?? "";
  const levelLabels = copy.thinkingLevels;
  const skillScopes = settingsCopyAgent.migrateScopes;
  const skillSources = settingsCopyAgent.migrateSources;
  const skillStates = settingsCopyAgent.migrateStates;
  const step = configStepNumber(screen);
  const busy = skillsBusy || customBusy || savingAgentSettings;

  const nav = { go: (target: OnboardingScreen) => navigate(target) };
  const openNotes = () => { void window.vela?.releaseNotes?.openPage().catch(() => undefined); };

  /** 设置步骤的底部：小船队进度、跳过、上一步、继续。 */
  function setupBar(n: number): ReactNode {
    const skippable = optionalConfigSteps.includes(n);
    const continueDisabled =
      busy ||
      (n === 5 && (!connected || availableModels.length === 0)) ||
      (n === 6 && (!selectedModel || !settingsLoaded)) ||
      (n === 7 && !settingsLoaded);
    const label = skillsBusy ? copy.migrating
      : customBusy || savingAgentSettings ? copy.connecting
        : n === 4 ? (chosenSkills.length ? copy.migrateAndContinue : copy.continueWithoutMigration)
          : n === 8 ? copy.finishStep : copy.next;
    return (
      <div className="ob-bar" style={{ left: 424 }}>
        <div className="ob-fleet" aria-hidden="true">
          {configScreens.map((id, index) => index + 1 === n ? <ObSail key={id} size={18} /> : <i key={id} className={index + 1 < n ? "done" : ""} />)}
        </div>
        <span className="ob-r">
          {skippable ? <button type="button" className="ob-link" disabled={busy} onClick={() => navigate(n === 4 ? "step-5" : "step-8")}>{copy.skip}</button> : null}
          <button type="button" className="ob-pill" disabled={busy} onClick={back}>{copy.previous}</button>
          <button
            type="button"
            className={`ob-pill fill${continueDisabled ? " off" : ""}`}
            disabled={continueDisabled}
            onClick={() => {
              if (n === 4) void continueFromSkills();
              else if (n === 6) void continueFromModel();
              else if (n === 7) void continueFromPersonalize();
              else next();
            }}
          >{label}{busy ? "" : " →"}</button>
        </span>
      </div>
    );
  }

  /** 设置步骤外框需要的属性（外框本身是模块级组件，不能在渲染函数里定义，否则每次渲染都会重新挂载）。 */
  const frame = (n: number, title: string, lead: string, wide = false) => ({
    n, title, lead, wide, copy, busy, saveError, bar: setupBar(n),
    onJump: (index: number) => navigate(configScreens[index]!, { back: true }),
  });

  function renderScreen(id: OnboardingScreen): ReactNode {
    switch (id) {
      case "language":
        return <LanguageScreen copy={copy} locale={locale} onPick={preferences.setLocale} onContinue={() => navigate("hello")} />;
      case "hello":
        return <HelloScreen copy={copy} notes={notes} mode={mode} nav={nav} />;
      case "tour":
        return <TourScreen copy={copy} notes={notes} mode={mode} nav={nav} />;
      case "feat-agents":
      case "feat-trace":
      case "feat-compact":
        return <FeatureScreen copy={copy} screen={id} notes={notes} mode={mode} nav={nav} />;
      case "news":
        return notes ? <NewsScreen copy={copy} notes={notes} mode={mode} nav={nav} onOpenNotes={openNotes} /> : null;
      case "step-1": {
        const palette = themeMock[preferences.theme];
        const mock = { "--m-side": palette.side, "--m-chat": palette.chat, "--m-bubble": palette.bubble, "--m-line": palette.line, "--m-input": palette.input, "--m-accent": palette.accent, "--m-edge": palette.edge } as CSSProperties;
        return (
          <SetupFrame {...frame(1, copy.preferencesTitle, copy.preferencesHint)}>
            <div className="ob-appearance">
              <div>
                <Label title={copy.appearance} hint={copy.appearanceHint} />
                <div className="ob-opts" role="radiogroup" aria-label={copy.appearance}>
                  {([["system", appearanceCopy.system], ["light", appearanceCopy.light], ["dark", appearanceCopy.dark]] as const).map(([value, label]) => (
                    <Opt key={value} className="s" selected={preferences.appearance === value} onClick={() => preferences.setAppearance(value as Appearance)}><b>{label}</b></Opt>
                  ))}
                </div>
                <Label title={copy.theme} hint={copy.themeHint} />
                <ThemeDots label={appearanceCopy.light} scheme="light" ids={lightThemes} selected={preferences.lightTheme} copy={appearanceCopy} onPick={pickTheme} />
                <ThemeDots label={appearanceCopy.dark} scheme="dark" ids={darkThemes} selected={preferences.darkTheme} copy={appearanceCopy} onPick={pickTheme} />
              </div>
              <div className="ob-preview-wrap">
                <span className="ob-chip live">{fill(copy.livePreview, appearanceCopy.themes[preferences.theme].name)}</span>
                <div className="ob-mock" style={mock} aria-hidden="true">
                  <div className="side"><u /><u /><u className="s" /></div>
                  <div className="main"><u className="bubble" /><u className="l1" /><u className="l2" /><u className="l3" /><u className="input"><i /></u></div>
                </div>
              </div>
            </div>
          </SetupFrame>
        );
      }
      case "step-2":
        return (
          <SetupFrame {...frame(2, copy.toolTitle, copy.toolHint)}>
            <div className="ob-two" role="radiogroup" aria-label={appearanceCopy.toolDisplay} style={{ marginTop: 26 }}>
              <Opt className="pick" selected={preferences.toolDisplay === "card"} onClick={() => preferences.setToolDisplay("card")}>
                <b>{appearanceCopy.toolCard}</b><span>{copy.toolCardHint}</span>
                <span className="ob-pv" aria-hidden="true">
                  <span className="c"><span>{copy.readFile}</span><em>callback.ts</em></span>
                  <span className="c"><span>{copy.editFile}</span><em>redirect.ts +2 −1</em></span>
                  <span className="c"><span>{copy.runCommand}</span><em>pnpm test</em></span>
                  <span className="c faded"><span>{copy.readFile}</span><em>guards.ts</em></span>
                </span>
              </Opt>
              <Opt className="pick" selected={preferences.toolDisplay === "compact"} onClick={() => preferences.setToolDisplay("compact")}>
                <b>{appearanceCopy.toolCompact}</b><span>{copy.toolCompactHint}</span>
                <span className="ob-pv" aria-hidden="true">
                  <span className="l"><u />{copy.toolCompactRead}<em>callback.ts, guards.ts +1</em></span>
                  <span className="l"><u className="coral" />{copy.toolCompactEdit}<em>+9 −2</em></span>
                  <span className="l"><u className="green" />{copy.toolCompactRun}<em>pnpm test</em></span>
                  <span className="l faded">{copy.moreTools} ›</span>
                </span>
              </Opt>
            </div>
          </SetupFrame>
        );
      case "step-3":
        return <SetupFrame {...frame(3, copy.layoutTitle, copy.layoutHint)}><LayoutStep copy={copy} preferences={preferences} /></SetupFrame>;
      case "step-4":
        return (
          <SetupFrame {...frame(4, copy.migrateTitle, copy.migrateHint)}>
            <Label title={copy.foundSkills} style={{ justifyContent: "space-between", alignItems: "center" }}>
              {scan ? <span className="ob-count">{copy.selectedSkills(chosenSkills.length)}</span> : null}
            </Label>
            {skillsNotice ? <p className="ob-hint">{skillsNotice}</p> : null}
            {!scan && !scanError ? <p className="ob-hint">{settingsCopyAgent.migrateLoading}…</p> : null}
            {scan?.skills.length === 0 ? <p className="ob-hint">{copy.skillsEmpty}</p> : null}
            {scan?.skills.length ? (
              <div className="ob-two top">
                {sources.map((source, index) => {
                  const items = scan.skills.filter((skill) => skill.source === source);
                  if (!items.length) return null;
                  const selectable = items.filter((skill) => skill.selectable);
                  const allSelected = selectable.length > 0 && selectable.every((skill) => selectedSkills.has(skill.id));
                  return (
                    <div key={source} className={`ob-sheet sk ${index ? "tilt-r" : "tilt-l"}`}>
                      <h4>
                        {skillSources[source]}
                        {selectable.length ? <button type="button" disabled={skillsBusy} onClick={() => toggleSource(items)}>{allSelected ? settingsCopyAgent.migrateSelectNone : settingsCopyAgent.migrateSelectAll}</button> : null}
                      </h4>
                      {items.map((skill) => (
                        <label key={skill.id} className={`ob-row skill${skill.selectable ? "" : " dis"}`}>
                          <input type="checkbox" checked={selectedSkills.has(skill.id)} disabled={!skill.selectable || skillsBusy} onChange={() => toggleSkill(skill)} />
                          <i className="ob-box" aria-hidden="true">✓</i>
                          <div>
                            <code>{skill.name}</code>
                            <small>
                              <i>{skillScopes[skill.scope]}</i>
                              <i className={skill.selectable && skill.state === "new" ? "g" : ""}>{skill.state === "new" ? copy.skillNew : skillStates[skill.state]}</i>
                              {!skill.selectable ? <i>{settingsCopyAgent.migrateLocalNote}</i> : null}
                            </small>
                          </div>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {scanError ? (
              <div className="ob-error-row"><p>{localizeError(scanError) || copy.skillsLoadError}</p><button type="button" className="ob-pill" onClick={() => setScanAttempt((attempt) => attempt + 1)}>{copy.retry}</button></div>
            ) : null}
            <Note style={{ width: "max-content", maxWidth: "100%" }}>{copy.migrationNote}</Note>
          </SetupFrame>
        );
      case "step-5":
        return (
          <SetupFrame {...frame(5, copy.providerTitle, copy.providerHint)}>
            <label className="ob-search">
              <input value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder={copy.providerSearch} aria-label={copy.providerSearch} />
            </label>
            {models.catalogError ? (
              <div className="ob-error-row"><p>{localizeError(models.catalogError) || copy.providerLoadError}</p><button type="button" className="ob-pill" onClick={() => void models.reload()}>{copy.retry}</button></div>
            ) : null}
            {!models.catalog && !models.catalogError ? <p className="ob-hint">{copy.providerLoading}</p> : null}
            {models.catalog ? (
              <div className="ob-prov" role="radiogroup" aria-label={copy.providerTitle}>
                {filteredProviders.map((provider, index) => {
                  const isConnected = provider.authenticated || provider.stored;
                  const count = models.catalog?.models.filter((model) => model.provider === provider.id && model.available).length ?? 0;
                  return (
                    <Opt key={provider.id} className="provider" selected={providerId === provider.id} onClick={() => pickProvider(provider)}>
                      <u style={{ background: providerColors[index % providerColors.length] }}>{provider.name.slice(0, 1).toLocaleUpperCase()}</u>
                      <span className="info"><b>{provider.name}</b><span>{copy.providerModelCount(count)}</span></span>
                      <em className={isConnected ? "" : "n"}>{isConnected ? copy.providerConnected : copy.providerNeedsConnection}</em>
                    </Opt>
                  );
                })}
                {filteredProviders.length === 0 ? <p className="ob-hint">{copy.providerEmpty}</p> : null}
              </div>
            ) : null}
            {selectedProvider && !customProviderMode ? (
              <div className="ob-sheet provider-detail tilt-l">
                <div className="head"><b>{selectedProvider.name}</b>{connected ? <span className="ob-count">{copy.providerConnected}</span> : null}</div>
                {!selectedProvider.custom ? (
                  <div className="methods">
                    {selectedProvider.methods.map((method) => (
                      <button key={method.type} type="button" className={`ob-pill${method.type === "oauth" ? " fill" : ""}`} onClick={() => void models.loginProvider(selectedProvider.id, method.type as AuthMethodType)}>
                        {method.type === "oauth" ? settings.models.login : settings.models.apiKey}
                      </button>
                    ))}
                    {selectedProvider.methods.length === 0 && !connected ? <small>{copy.providerNeedsConnection}</small> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {connected && availableModels.length === 0 ? <p className="ob-hint error">{copy.providerNeedsModel}</p> : null}
            {models.login.error ? <p className="ob-hint error">{localizeError(models.login.error)}</p> : null}
            {models.actionError ? <p className="ob-hint error">{localizeError(models.actionError)}</p> : null}
            {!selectedProvider && models.catalog ? <p className="ob-hint">{copy.providerSelectHint}</p> : null}
            {skillsNotice ? <p className="ob-hint">{skillsNotice}</p> : null}
            {models.catalog ? (
              <p className="ob-hint">
                <button type="button" className="ob-link dark" onClick={() => { setCustomProviderMode((open) => !open); setProviderError(null); }}>
                  {customProviderMode ? copy.customProviderClose : copy.customProviderAction}
                </button>
                {copy.customProviderHint}　·　{copy.credentialsHint}
              </p>
            ) : null}
            {customProviderMode ? (
              <div className="ob-sheet tilt-r">
                <Label title={copy.customProviderTitle} style={{ marginTop: 0 }} />
                <CustomProviderForm copy={copy} settingsCopy={settings.models} form={customForm} setForm={setCustomForm} busy={customBusy} onSubmit={addCustomProvider} />
                {providerError ? <p className="ob-hint error">{localizeError(providerError)}</p> : null}
              </div>
            ) : null}
          </SetupFrame>
        );
      case "step-6":
        return (
          <SetupFrame {...frame(6, copy.modelTitle, copy.modelHint)}>
            <div className="ob-form-column">
              <Label title={copy.defaultModel} hint={selectedProviderName} />
              {availableModels.length ? (
                <label className="ob-field">
                  <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)} aria-label={copy.defaultModel}>
                    {availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </select>
                </label>
              ) : <p className="ob-hint">{copy.noModels}</p>}
              {savedAgentSettings?.modelId && savedAgentSettings.provider === providerId && !availableModels.some((model) => model.id === savedAgentSettings.modelId) ? (
                <p className="ob-hint error">{copy.unavailableModel}</p>
              ) : null}
              <Label title={copy.thinkingLevel} hint={copy.thinkingHint} style={{ marginTop: 30 }} />
              <div className="ob-opts sails" role="radiogroup" aria-label={copy.thinkingLevel}>
                {modelThinkingLevels.map((level, index) => (
                  <Opt key={level} selected={normalizedThinking === level} onClick={() => setThinkingLevel(level)}>
                    <ObSail size={10 + (index * 38) / Math.max(1, modelThinkingLevels.length - 1)} /><b>{levelLabels[level]}</b>
                  </Opt>
                ))}
              </div>
            </div>
            <Note style={{ width: "max-content", maxWidth: "100%" }}>{copy.modelNote}</Note>
          </SetupFrame>
        );
      case "step-7":
        return (
          <SetupFrame {...frame(7, copy.personalizeTitle, copy.personalizeHint)}>
            <PersonalizeStep copy={copy} settings={settings} instructions={instructions} onInstructions={setInstructions} disabled={savingAgentSettings} />
          </SetupFrame>
        );
      case "step-8":
        return (
          <SetupFrame {...frame(8, copy.backgroundTitle, copy.backgroundHint, true)}>
            <BackgroundStep copy={copy} settings={settings} resident={resident} onResident={setResident} update={updateState} onUpdate={setUpdateState} />
          </SetupFrame>
        );
      case "done":
        return (
          <section className="ob-scr-body ob-done" aria-labelledby="ob-done-title">
            <ObPanel width={560} fill={obColor.sun} edge={470} />
            <Brand small dark />
            <div className="ob-done-text">
              <span className="ob-chip">{copy.completeChip}</span>
              <h2 id="ob-done-title">{copy.completeTitle.split("\n").map((line, index) => <span key={index}>{index ? <br /> : null}{line}</span>)}</h2>
              <p>{copy.completeHint}</p>
              <button type="button" className="ob-go blue" disabled={finishing} onClick={() => void finish()}>{copy.enterApp} →</button>
            </div>
            <ObSea />
            <div className="ob-ticket">
              <h4><span>{copy.ticketTitle}</span><span className="muted">{copy.savedOnDevice}</span></h4>
              <dl>
                <SummaryRow label={copy.summaryLanguage} value={appLocaleNames[locale]} />
                <SummaryRow label={copy.summaryProvider} value={selectedProvider?.name ?? "—"} />
                <SummaryRow label={copy.summaryTheme} value={`${appearanceCopy[preferences.appearance]} · ${themeSummary}`} />
                <SummaryRow label={copy.summaryModel} value={selectedModel ? `${selectedModel.name} · ${levelLabels[normalizedThinking]}` : "—"} />
                <SummaryRow label={copy.summaryTools} value={preferences.toolDisplay === "card" ? appearanceCopy.toolCard : appearanceCopy.toolCompact} />
                <SummaryRow label={copy.summaryPermissions} value={settings.permissions.smart} />
                <SummaryRow label={copy.summaryLayout} value={preferences.infoLayout === "sidebar" ? copy.infoSidebar : copy.infoFloating} />
                <SummaryRow label={copy.summaryMemory} value={memoryEnabled === null ? "—" : memoryEnabled ? copy.on : copy.off} />
                <SummaryRow label={copy.summaryResident} value={resident ? modeLabel(resident.mode) : "—"} />
                <SummaryRow label={copy.summaryUpdates} value={updateState ? (updateState.autoUpdate ? copy.on : copy.off) : "—"} />
              </dl>
            </div>
            <div className="ob-nexts">
              <Label title={copy.nextTitle} />
              <div className="ob-tiles two">
                <button type="button" className="ob-tile" style={{ background: obColor.cobalt, color: obColor.cream, transform: "rotate(-.8deg)" }} disabled={finishing} onClick={() => void chooseFolder()}>
                  <b>{copy.openFolder}</b>
                  <span>{project.workspace?.current ? `${copy.folderSelected}: ${project.workspace.current}` : copy.openFolderHint}</span>
                </button>
                <button type="button" className="ob-tile" style={{ background: obColor.coral, color: obColor.cream, transform: "rotate(.9deg)" }} disabled={finishing} onClick={() => void finish("mcp")}>
                  <b>{copy.connectTools}</b><span>{copy.connectToolsHint}</span>
                </button>
              </div>
            </div>
            <div className="ob-bar" style={{ left: 600 }}>
              <button type="button" className="ob-link dark" disabled={finishing} onClick={back}>{copy.backToSettings}</button>
              <span className="ob-where">{copy.afterNote}</span>
            </div>
          </section>
        );
    }
  }

  // 输入框与按钮在滑入前不能被点到，离场的画面只作背景。
  const dir = direction < 0 ? "back" : "";
  return (
    <div
      ref={rootRef}
      className={`ob-root${mode === "intro" ? " intro" : ""}`}
      // 引导固定使用明亮色纸，不随应用的深色模式变化；这两个属性让复用的组件（弹窗、输入控件）也取浅色变量。
      data-scheme="light"
      data-theme="daylight"
      lang={locale}
    >
      <ObDefs />
      <div className="ob-drag" />
      <div className="ob-stage" style={stageStyle} data-screen={screen} data-step={step ?? undefined}>
        {leaving && animate ? <div key={`leave-${leaving.key}`} className="ob-scr under" inert aria-hidden="true">{renderScreen(leaving.screen)}</div> : null}
        <div key={`screen-${screen}`} className={`ob-scr on ${animate ? dir : "first"}`} data-screen={screen} data-tone={screen}>
          {renderScreen(screen)}
        </div>
      </div>
      <SheetPresence present={models.login.active} light>
        <LoginDialog login={models.login} onReply={models.replyLogin} onCancel={models.cancelLogin} onDismiss={models.dismissLogin} />
      </SheetPresence>
    </div>
  );
}

function SetupFrame({ n, title, lead, wide, copy, busy, saveError, bar, onJump, children }: {
  n: number;
  title: string;
  lead: string;
  wide: boolean;
  copy: OnboardingCopy;
  busy: boolean;
  saveError: string | null;
  bar: ReactNode;
  onJump: (index: number) => void;
  children: ReactNode;
}) {
  const optional = optionalConfigSteps.includes(n);
  return (
    <section className="ob-scr-body ob-setup" aria-label={copy.steps[n - 1]}>
      <ObPanel width={380} fill={obColor.cobalt} edge={318} />
      <div className="ob-rail-in">
        <Brand small />
        <div className="ob-bigno">{n}<small>/ {configStepCount}</small></div>
        <ol className="ob-route">
          {copy.steps.map((name, index) => {
            const at = index + 1;
            const done = at < n;
            return (
              <li key={name} className={done ? "done" : at === n ? "on" : ""}>
                <button type="button" disabled={!done || busy} aria-current={at === n ? "step" : undefined} onClick={() => onJump(index)}>
                  <u>{done ? "✓" : at}</u>{name}{optionalConfigSteps.includes(at) ? <em>{copy.optional}</em> : null}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="ob-rail-note">{copy.railNote}</p>
      </div>
      <div className={`ob-body${wide ? " wide" : ""}`}>
        <span className="ob-chip">{fill(copy.stepChip, n)} · {copy.steps[n - 1]}{optional ? ` · ${copy.optional}` : ""}</span>
        <h3>{title}</h3>
        <p className="ob-lead">{lead}</p>
        {children}
        {saveError ? <p className="ob-hint error" role="alert">{saveError}</p> : null}
      </div>
      {bar}
    </section>
  );
}

function ThemeDots({ label, scheme, ids, selected, copy, onPick }: {
  label: string;
  scheme: ColorScheme;
  ids: readonly ThemeId[];
  selected: ThemeId;
  copy: ReturnType<typeof settingsCopy>["appearance"];
  onPick: (scheme: ColorScheme, id: ThemeId) => void;
}) {
  return (
    <div className="ob-dots" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      {ids.map((id) => (
        <button key={id} type="button" role="radio" aria-checked={selected === id} className={selected === id ? "on" : ""} onClick={() => onPick(scheme, id)}>
          <i style={{ background: themeSwatch[id] }} />{copy.themes[id].name}
        </button>
      ))}
    </div>
  );
}

function CustomProviderForm({
  copy,
  settingsCopy: modelCopy,
  form,
  setForm,
  busy,
  onSubmit,
}: {
  copy: OnboardingCopy;
  settingsCopy: ReturnType<typeof settingsCopy>["models"];
  form: CustomModelInput;
  setForm: Dispatch<SetStateAction<CustomModelInput>>;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="ob-custom-form" onSubmit={onSubmit}>
      <label><span>{copy.providerName}</span><input value={form.providerName} placeholder={copy.providerNamePlaceholder} onChange={(event) => setForm({ ...form, providerName: event.target.value })} required /></label>
      <label><span>{copy.baseUrl}</span><input value={form.baseUrl} placeholder={modelCopy.baseUrlPlaceholder} spellCheck={false} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} required /></label>
      <label><span>{copy.apiType}</span><select value={form.api} onChange={(event) => setForm({ ...form, api: event.target.value as CustomModelInput["api"] })}>{customModelApis.map((api) => <option key={api} value={api}>{modelCopy.apis[api]}</option>)}</select></label>
      <label><span>{copy.apiKeyField}</span><input type="password" value={form.apiKey} placeholder={copy.apiKeyPlaceholder} autoComplete="off" spellCheck={false} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></label>
      <label><span>{copy.modelId}</span><input value={form.modelId} placeholder={modelCopy.modelIdPlaceholder} spellCheck={false} onChange={(event) => setForm({ ...form, modelId: event.target.value })} required /></label>
      <label><span>{copy.modelName}</span><input value={form.modelName} placeholder={copy.modelNamePlaceholder} onChange={(event) => setForm({ ...form, modelName: event.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={form.reasoning} onChange={(event) => setForm({ ...form, reasoning: event.target.checked })} /><span>{copy.supportsReasoning}</span></label>
      <button type="submit" className="ob-pill fill" disabled={busy}>{busy ? copy.connecting : `${copy.addProvider} →`}</button>
    </form>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="ob-summary-row"><dt>{label}</dt><dd>{value}</dd></div>;
}

function clampThinking(choices: readonly ThinkingLevel[], level: ThinkingLevel): ThinkingLevel {
  if (choices.includes(level)) return level;
  if (choices.includes("medium")) return "medium";
  return choices[0] ?? "off";
}

function providerIdFromName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) return slug;
  return `custom-${Math.random().toString(36).slice(2, 8)}`;
}
