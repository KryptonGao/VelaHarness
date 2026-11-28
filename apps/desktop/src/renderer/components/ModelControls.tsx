import {
  thinkingLevelLabel,
  type AuthNotice,
  type CodexSpeed,
  type ModelCatalog,
  type ModelSummary,
  type SandboxMode,
  type ThinkingLevel,
} from "@vela/shared";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCombinedModelPicker } from "../hooks/useCombinedModelPicker";
import { useEscapeKey } from "../hooks/useDismissable";
import { useReducedMotion } from "../hooks/useMotionPresence";
import type { LoginState } from "../hooks/useModels";
import { modelKey } from "../hooks/usePreferences";
import { quotaProviderId, useUsageLimits } from "../hooks/useUsageLimits";
import { PopoverPresence } from "./MotionPresence";
import { SheetPresence } from "./Presence";
import { UsageLimitMenu } from "./UsageLimitMenu";
import { localizeError, tr, trf } from "../locale";
import { Icon } from "./icons";
import { CodexSpeedControl, SpeedGlyph, speedLabel, useCodexSpeedTiers } from "./CodexSpeedControl";

const thinkingLabelsEn: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
  ultra: "Ultra",
};

export function thinkingLabel(level: ThinkingLevel): string {
  return tr(thinkingLevelLabel[level], thinkingLabelsEn[level]);
}

interface ModelControlsProps {
  modelLabel: string | null;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  disabled: boolean;
  catalog: ModelCatalog | null;
  catalogError: string | null;
  actionError: string | null;
  /** 在输入框模型列表中隐藏的模型，key 为 `provider/id`。 */
  hiddenModels: string[];
  login: LoginState;
  onSelect: (provider: string, id: string) => Promise<unknown>;
  codexSpeed?: CodexSpeed;
  subagentSpeed?: CodexSpeed;
  onSubagentSpeed?: (speed: CodexSpeed) => Promise<unknown>;
  onSpeed: (provider: string, model: string, speed: CodexSpeed) => Promise<unknown>;
  onThinking: (level: ThinkingLevel) => Promise<unknown>;
  onReplyLogin: (promptId: string, value: string | null) => Promise<void>;
  onCancelLogin: () => Promise<void>;
  onDismissLogin: () => void;
  /** 每次值变化（且大于 0）就展开模型菜单；`/model` 命令用它从输入框外部打开。 */
  openRequest?: number;
  /** 每次值变化（且大于 0）就展开思考强度菜单；`/effort` 命令用它从输入框外部打开。 */
  thinkingOpenRequest?: number;
  /** 选用 Ultra 时推荐完全访问：传入当前执行权限和切换方法；不传（如侧边聊天、权限被配方锁定）就不提示。 */
  fullAccess?: { mode: SandboxMode; onEnable: () => unknown };
}

/** Ultra 标签「更快使用算力」替换「Ultra」的停留时间。 */
const ultraFlashMs = 2400;

const gptParticleSpacing: Record<CodexSpeed, number> = { standard: 30, priority: 20, ultrafast: 13 };

function GptParticle({ index }: { index: number }) {
  const [style] = useState(() => ({
    // Space the starting phases apart, then jitter each dot independently.
    "--particle-offset": (0.17 + index * 0.618034 + Math.random() * 0.07) % 1,
    "--size": `${1 + Math.random() * 0.75}px`,
    "--pace": 0.92 + Math.random() * 0.16,
    "--sway-period": `${1.4 + Math.random() * 1.7}s`,
    "--sway-distance": `${0.3 + Math.random() * 0.55}px`,
    "--sway-delay": `${-Math.random() * 6}s`,
    top: `${14 + Math.random() * 64}%`,
  } as CSSProperties));
  return <span className="thinking-particle" style={style} />;
}

function GptParticles({ speed }: { speed: CodexSpeed }) {
  const layer = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const measure = () => setCount(Math.round(element.clientWidth / gptParticleSpacing[speed]));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [speed]);
  return (
    <div ref={layer} className="thinking-particles" data-speed={speed}>
      {Array.from({ length: count }, (_, index) => <GptParticle key={index} index={index} />)}
    </div>
  );
}

/**
 * The dial uses the model's own effort range. Ultra fills the dial with a gradient.
 */
function ThinkingGlyph({ choices, level }: { choices: ThinkingLevel[]; level: ThinkingLevel }) {
  const gradientId = useId();
  const ultra = level === "ultra";
  const scale = choices.filter((choice) => choice !== "ultra");
  const index = ultra ? scale.length - 1 : Math.max(0, scale.indexOf(level));
  const fraction = ultra ? 1 : scale.length > 1 && level !== "off" ? index / (scale.length - 1) : 0;
  return (
    <span className={`thinking-glyph${ultra ? " is-ultra" : ""}`} aria-hidden="true">
      <svg className="thinking-dial" viewBox="0 0 24 24">
        {ultra ? (
          <defs>
            <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="6" y1="0" x2="18" y2="0">
              <stop offset="0" stopColor="#3b82f6" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
        ) : null}
        <circle className="thinking-dial-track" cx="12" cy="12" r="6" />
        <circle
          className="thinking-dial-progress"
          cx="12"
          cy="12"
          r="6"
          strokeDasharray={`${(fraction * 28.27).toFixed(2)} 100`}
          style={ultra ? { stroke: `url(#${gradientId})` } : undefined}
        />
      </svg>
    </span>
  );
}

export function ModelControls(props: ModelControlsProps) {
  const combined = useCombinedModelPicker();
  const reducedMotion = useReducedMotion();
  const [menu, setMenu] = useState<"model" | "thinking" | "usage" | null>(null);
  const [modelSelection, setModelSelection] = useState<{ provider: string; id: string } | null>(null);
  const [sliderLevel, setSliderLevel] = useState(props.thinkingLevel);
  const rootRef = useRef<HTMLDivElement>(null);
  const combinedTriggerRef = useRef<HTMLButtonElement>(null);
  const combinedPopoverRef = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | undefined>(undefined);
  const thinkingRequestRef = useRef(0);
  const thinkingPopoverId = useId();
  const thinkingChoices = props.thinkingLevels.length > 0 ? props.thinkingLevels : (["off"] as ThinkingLevel[]);
  const shownThinking = thinkingChoices.includes(props.thinkingLevel) ? props.thinkingLevel : thinkingChoices[0] ?? "off";
  const sliderThinking = thinkingChoices.includes(sliderLevel) ? sliderLevel : shownThinking;
  const sliderIndex = Math.max(0, thinkingChoices.indexOf(sliderThinking));
  const sliderMax = Math.max(0, thinkingChoices.length - 1);
  const hasOffChoice = thinkingChoices[0] === "off";
  const sliderOffset = hasOffChoice ? 0 : 1;
  const sliderRangeMax = sliderMax + sliderOffset;
  const sliderValue = sliderIndex + sliderOffset;
  const sliderProgress = sliderRangeMax > 0 ? sliderValue / sliderRangeMax : 0;
  const particleDuration = `${(3.4 - sliderProgress * 2.65).toFixed(2)}s`;
  const ultraSelected = sliderThinking === "ultra";
  const [ultraFlash, setUltraFlash] = useState(false);
  const { modelProvider, modelId } = props;
  const codexProvider = quotaProviderId(modelProvider);
  const tiers = useCodexSpeedTiers(codexProvider, modelId, menu === "thinking", props.catalog);
  const speed = codexProvider ? props.codexSpeed ?? "standard" : "standard";
  const isGptSlider = Boolean(codexProvider) || /(?:^|\/)gpt(?:-|$)/i.test(modelId ?? "");
  const speedEnabled = tiers.length > 0 || speed !== "standard";
  // The child may choose a different model/account from the main agent.
  const showSubagentSpeed = Boolean(props.onSubagentSpeed && (codexProvider ||
    props.catalog?.models.some(item => item.available && quotaProviderId(item.provider)) ||
    (props.subagentSpeed && props.subagentSpeed !== "standard")));
  const activeSpeedGlyph = speed !== "standard" && <SpeedGlyph speed={speed} />;
  const usage = useUsageLimits(props.modelProvider);
  const refreshUsage = usage.refresh;

  // 一轮对话结束（输入框从禁用变回可用）后，额度已经变化，补读一次。
  const wasDisabledRef = useRef(props.disabled);
  useEffect(() => {
    if (wasDisabledRef.current && !props.disabled) refreshUsage();
    wasDisabledRef.current = props.disabled;
  }, [props.disabled, refreshUsage]);

  useEffect(() => {
    if (menu !== "thinking" || !ultraSelected) {
      setUltraFlash(false);
      return;
    }
    if (!ultraFlash) return;
    const timer = window.setTimeout(() => setUltraFlash(false), ultraFlashMs);
    return () => window.clearTimeout(timer);
  }, [menu, ultraSelected, ultraFlash]);

  const shownThinkingRef = useRef(shownThinking);
  shownThinkingRef.current = shownThinking;
  const lastThinkingOpenRequest = useRef(props.thinkingOpenRequest ?? 0);
  const pickerOpen = menu === "model" || menu === "thinking";
  const openPicker = useCallback((page: "model" | "thinking") => {
    // Keep the same bottom anchor while the two pages change the panel's height.
    previousHeight.current = combinedPopoverRef.current?.offsetHeight;
    if (page === "thinking") setSliderLevel(shownThinkingRef.current);
    setMenu(page);
  }, []);

  const closePicker = useCallback(() => {
    setMenu(null);
    combinedTriggerRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const from = previousHeight.current;
    previousHeight.current = undefined;
    const panel = combinedPopoverRef.current;
    if (reducedMotion || !pickerOpen || from === undefined || !panel) return;
    const duration = 200;
    const easing = "cubic-bezier(0.2, 0.75, 0.25, 1)";
    const resize = panel.animate([{ height: `${from}px` }, { height: `${panel.offsetHeight}px` }], { duration, easing });
    const slide = panel.firstElementChild?.animate([
      { opacity: 0, transform: `translateX(${menu === "model" ? 12 : -12}px)` },
      { opacity: 1, transform: "none" },
    ], { duration, easing });
    return () => {
      resize.cancel();
      slide?.cancel();
    };
  }, [combined, menu, pickerOpen, reducedMotion]);

  useLayoutEffect(() => {
    if (!modelSelection) return;
    if (!combined || menu !== "model") {
      setModelSelection(null);
      return;
    }
    // The session supplies the new model's supported levels and clamped effort together.
    if (props.modelProvider === modelSelection.provider && props.modelId === modelSelection.id) {
      setModelSelection(null);
      openPicker("thinking");
    }
  }, [combined, menu, modelSelection, openPicker, props.modelId, props.modelProvider]);

  useEffect(() => {
    if (props.openRequest) openPicker("model");
  }, [openPicker, props.openRequest]);

  useEffect(() => {
    const request = props.thinkingOpenRequest ?? 0;
    if (!request || request === lastThinkingOpenRequest.current) return;
    lastThinkingOpenRequest.current = request;
    if (props.disabled) return;
    openPicker("thinking");
  }, [openPicker, props.thinkingOpenRequest, props.disabled]);

  useEffect(() => {
    if (menu !== "thinking") setSliderLevel(shownThinking);
  }, [menu, shownThinking]);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (rootRef.current?.querySelector(".codex-speed-menu:popover-open")) return;
      if (combined && menu === "model") openPicker("thinking");
      else if (combined && menu === "thinking") closePicker();
      else setMenu(null);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [closePicker, combined, menu, openPicker]);

  const reasoningLabel = tr("思考强度", "Reasoning effort");
  const chooseModel = tr("选择模型", "Choose a model");
  const combinedLabel = props.modelLabel
    ? trf("模型与思考强度：{0} · {1}", "Model & reasoning effort: {0} · {1}", props.modelLabel, thinkingLabel(shownThinking))
    : tr("模型与思考强度", "Model & reasoning effort");
  const thinkingHeading = (
    <>
      <span
        key={ultraFlash ? "ultra-flash" : sliderThinking}
        className={`thinking-level-value${ultraSelected ? " is-ultra" : ""}${ultraFlash ? " is-ultra-flash" : ""}`}
        aria-live="polite"
      >
        {ultraFlash ? tr("更快使用算力", "Faster compute") : thinkingLabel(sliderThinking)}
      </span>
      <span className="thinking-heading-model">
        <span className="thinking-model-label">{props.modelLabel ?? chooseModel}</span>
        {combined && <Icon className="combined-thinking-arrow" name="chevron-right" size={12} />}
      </span>
    </>
  );

  const thinkingContent = (
    <>
      <div className={`thinking-heading-row${speedEnabled || showSubagentSpeed ? " thinking-heading-with-speed" : ""}${showSubagentSpeed ? " has-subagent-speed" : ""}`}>
        {speedEnabled && codexProvider && modelId && (
          <CodexSpeedControl key={modelKey(codexProvider, modelId)} speed={speed} tiers={tiers}
            disabled={props.disabled} onChange={value => props.onSpeed(codexProvider, modelId, value)} />
        )}
        {showSubagentSpeed && props.onSubagentSpeed && (
          <CodexSpeedControl subagent speed={props.subagentSpeed ?? "standard"} tiers={["priority", "ultrafast"]}
            disabled={false} onChange={props.onSubagentSpeed} />
        )}
        {combined ? (
          <button
            className="thinking-popover-heading combined-thinking-heading"
            type="button"
            title={chooseModel}
            disabled={props.disabled}
            autoFocus
            onClick={() => openPicker("model")}
          >
            {thinkingHeading}
          </button>
        ) : (
          <div className="thinking-popover-heading">{thinkingHeading}</div>
        )}
      </div>
      <div
        className={`thinking-slider${ultraSelected ? " is-ultra" : ""}`}
        style={{
          "--thinking-progress": `${sliderProgress * 100}%`,
          "--thinking-particle-duration": particleDuration,
        } as CSSProperties}
      >
        <div className="thinking-slider-track" aria-hidden="true">
          <div className="thinking-fill-frame">
            {sliderProgress > 0 ? (
              <div className="thinking-slider-fill">
                {isGptSlider ? (
                  (speed !== "standard" || ultraSelected) && <GptParticles speed={speed} />
                ) : (
                  <div className="thinking-particles">
                    {[0, 1, 2, 3, 4].map((particle) => (
                      <span
                        key={particle}
                        className={`thinking-particle particle-${particle + 1}`}
                        style={{ "--thinking-particle-delay": `${particle * -0.31}s` } as CSSProperties}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <div className="thinking-slider-markers">
            {thinkingChoices.map((level, index) => (
              <span
                key={level}
                className={index <= sliderIndex ? "is-active" : undefined}
                style={{ left: `${sliderRangeMax > 0 ? ((index + sliderOffset) / sliderRangeMax) * 100 : 0}%` }}
              />
            ))}
          </div>
        </div>
        <input
          className="thinking-slider-input"
          aria-label={reasoningLabel}
          aria-valuetext={thinkingLabel(sliderThinking)}
          type="range"
          min={0}
          max={sliderRangeMax}
          step={1}
          value={sliderValue}
          disabled={props.disabled || thinkingChoices.length < 2}
          onChange={(event) => {
            const nextIndex = Number(event.currentTarget.value) - sliderOffset;
            const nextLevel = thinkingChoices[nextIndex];
            if (!nextLevel || nextLevel === sliderThinking) return;
            setSliderLevel(nextLevel);
            // 仅在用户切入 Ultra 时播放提示，打开已选 Ultra 的卡片不重播。
            setUltraFlash(nextLevel === "ultra");
            const request = ++thinkingRequestRef.current;
            void props.onThinking(nextLevel).then((result) => {
              if (request === thinkingRequestRef.current && typeof result === "string") {
                  setSliderLevel(shownThinkingRef.current);
              }
            }).catch(() => {
              if (request === thinkingRequestRef.current) setSliderLevel(shownThinkingRef.current);
            });
          }}
        />
      </div>
      {ultraSelected && props.fullAccess && props.fullAccess.mode !== "full" ? (
        <div className="thinking-ultra-tip">
          <span>{tr("Ultra 会并行启用更多 SubAgent，推荐使用完全访问权限，避免逐项审批打断它们。", "Ultra runs more SubAgents in parallel. Full access is recommended so approvals do not interrupt them.")}</span>
          <button type="button" onClick={() => { void props.fullAccess?.onEnable(); }}>{tr("切换到完全访问", "Switch to full access")}</button>
        </div>
      ) : null}
    </>
  );

  const modelMenu = (
    <ModelMenu
      catalog={props.catalog}
      catalogError={props.catalogError}
      actionError={props.actionError}
      provider={props.modelProvider}
      modelId={props.modelId}
      hiddenModels={props.hiddenModels}
      selecting={modelSelection !== null}
      onBack={combined ? () => openPicker("thinking") : undefined}
      onSelect={(provider, id) => {
        if (!combined) {
          closePicker();
          void props.onSelect(provider, id);
          return;
        }
        if (modelSelection) return;
        if (props.modelProvider === provider && props.modelId === id) {
          openPicker("thinking");
          return;
        }
        const selection = { provider, id };
        setModelSelection(selection);
        const clearSelection = () => setModelSelection(current => current === selection ? null : current);
        void props.onSelect(provider, id).then(result => {
          if (typeof result === "string") clearSelection();
        }, clearSelection);
      }}
    />
  );

  return (
    <div className="model-controls" ref={rootRef}>
      {combined ? (
        <div className="dock-menu">
          <button
            ref={combinedTriggerRef}
            className="model-choice-pill model-pill combined-model-pill"
            type="button"
            title={combinedLabel}
            aria-label={speed === "standard" ? combinedLabel : `${combinedLabel} · ${speedLabel(speed)}`}
            aria-controls={pickerOpen ? thinkingPopoverId : undefined}
            aria-expanded={pickerOpen}
            disabled={props.disabled && !showSubagentSpeed}
            onClick={() => {
              if (pickerOpen) closePicker();
              else openPicker("thinking");
            }}
          >
            {activeSpeedGlyph}
            <span className="model-pill-label">{props.modelLabel ?? combinedLabel}</span>
            {props.modelLabel ? (
              <span className={`combined-effort-label${shownThinking === "ultra" ? " is-ultra" : ""}`}>
                {thinkingLabel(shownThinking)}
              </span>
            ) : null}
            <Chevron />
          </button>
          <PopoverPresence present={pickerOpen}>
            <div
              ref={combinedPopoverRef}
              id={thinkingPopoverId}
              className="dock-popover combined-model-popover"
              role="group"
              aria-label={menu === "model" ? chooseModel : reasoningLabel}
            >
              {menu === "model" ? modelMenu : (
                <div className="combined-thinking-page">{thinkingContent}</div>
              )}
            </div>
          </PopoverPresence>
        </div>
      ) : (
        <>
          <div className="dock-menu">
            <button
              className="model-choice-pill"
              type="button"
              title={thinkingChoices.length < 2 ? tr("当前模型不支持调整思考强度", "The current model does not support adjustable reasoning") : `${reasoningLabel}: ${thinkingLabel(shownThinking)}`}
              aria-controls={thinkingPopoverId}
              aria-expanded={menu === "thinking"}
              disabled={!showSubagentSpeed && (props.disabled || (thinkingChoices.length < 2 && !speedEnabled))}
              onClick={() => {
                if (menu === "thinking") {
                  setMenu(null);
                  return;
                }
                openPicker("thinking");
              }}
            >
              {/* 文字、标记、箭头按顺序紧挨着排，不预留空位；按钮宽度随当前档位的文字变化。 */}
              <span className="thinking-label">
                <span className="thinking-label-text">{thinkingLabel(shownThinking)}</span>
                <ThinkingGlyph choices={thinkingChoices} level={shownThinking} />
                <span className="thinking-chevron"><Chevron /></span>
              </span>
            </button>
            <PopoverPresence present={menu === "thinking"}>
              <div id={thinkingPopoverId} className="dock-popover thinking-popover" role="group" aria-label={reasoningLabel}>
                {thinkingContent}
              </div>
            </PopoverPresence>
          </div>
          <div className="dock-menu">
            <button
              className="model-choice-pill model-pill"
              type="button"
              title={props.modelLabel ? `${tr("模型", "Model")}: ${props.modelLabel}` : tr("选择模型", "Choose a model")}
              aria-haspopup="true"
              aria-expanded={menu === "model"}
              disabled={props.disabled}
              onClick={() => setMenu((current) => (current === "model" ? null : "model"))}
            >
              {activeSpeedGlyph}
              <span className="model-pill-label">{props.modelLabel ?? tr("选择模型", "Choose a model")}</span>
              <Chevron />
            </button>
            <PopoverPresence present={menu === "model"}>
              {modelMenu}
            </PopoverPresence>
          </div>
        </>
      )}

      {usage.limits ? (
        <UsageLimitMenu
          limits={usage.limits}
          open={menu === "usage"}
          onToggle={() => {
            if (menu !== "usage") refreshUsage();
            setMenu((current) => (current === "usage" ? null : "usage"));
          }}
        />
      ) : null}

      <SheetPresence present={props.login.active}>
        <LoginDialog
          login={props.login}
          onReply={props.onReplyLogin}
          onCancel={props.onCancelLogin}
          onDismiss={props.onDismissLogin}
        />
      </SheetPresence>
    </div>
  );
}

function ModelMenu({
  catalog,
  catalogError,
  actionError,
  provider,
  modelId,
  hiddenModels,
  selecting,
  onBack,
  onSelect,
}: {
  catalog: ModelCatalog | null;
  catalogError: string | null;
  actionError: string | null;
  provider: string | null;
  modelId: string | null;
  hiddenModels: string[];
  selecting: boolean;
  onBack?: () => void;
  onSelect: (provider: string, id: string) => void;
}) {
  const groups = useMemo(
    () => groupModels(catalog?.models ?? [], hiddenModels, provider, modelId),
    [catalog, hiddenModels, provider, modelId],
  );
  const hiddenCount = useMemo(() => {
    return (catalog?.models ?? []).filter(
      (model) => model.available && hiddenModels.includes(modelKey(model.provider, model.id)),
    ).length;
  }, [catalog, hiddenModels]);
  const allHidden = useMemo(() => {
    const available = (catalog?.models ?? []).filter((model) => model.available);
    return available.length > 0 && available.every((model) => hiddenModels.includes(modelKey(model.provider, model.id)));
  }, [catalog, hiddenModels]);

  return (
    <div className={onBack ? "combined-model-page" : "dock-popover model-popover"}>
      {onBack ? (
        <button
          className="combined-model-back"
          type="button"
          title={tr("返回思考强度", "Back to reasoning effort")}
          aria-label={tr("返回思考强度", "Back to reasoning effort")}
          autoFocus
          onClick={onBack}
        >
          <Icon name="chevron-left" size={14} />
          {tr("选择模型", "Choose a model")}
        </button>
      ) : null}
      <div className="menu-scroll" aria-busy={selecting || undefined}>
        {catalogError ? <p className="menu-note">{localizeError(catalogError)}</p> : null}
        {actionError ? <p className="menu-note menu-note-error">{localizeError(actionError)}</p> : null}
        {catalog?.error ? <p className="menu-note menu-note-error">{localizeError(catalog.error)}</p> : null}
        {!catalog && !catalogError ? <p className="menu-note">{tr("正在读取模型", "Loading models…")}</p> : null}
        {catalog && provider && modelId && !catalog.models.some((model) => model.available && model.provider === provider && model.id === modelId) ? (
          <p className="menu-note">{tr("当前模型还不能使用，请先在账号里登录。", "This model is unavailable. Sign in to the provider first.")}</p>
        ) : null}
        {catalog && groups.length === 0 && !allHidden ? <p className="menu-note">{tr("还没有可用模型。先登录提供方，或添加一个兼容接口。", "No models are available. Sign in to a provider or add a compatible API.")}</p> : null}
        {catalog && groups.length === 0 && allHidden ? <p className="menu-note">{tr("可用模型都已隐藏，可在设置的「模型与账号」里调整。", "All available models are hidden. Adjust this in Settings → Models & accounts.")}</p> : null}
        {groups.map((group) => (
          <section key={group.provider}>
            <div className="menu-section">{group.name}</div>
            {group.models.map((model) => {
              const selected = model.provider === provider && model.id === modelId;
              return (
                <button
                  key={`${model.provider}/${model.id}`}
                  className={`menu-row${selected ? " active" : ""}`}
                  type="button"
                  autoFocus={!onBack && model === groups[0]?.models[0]}
                  disabled={selecting}
                  aria-current={selected || undefined}
                  onClick={() => onSelect(model.provider, model.id)}
                >
                  <span className="menu-row-title">{model.name?.trim() || model.id}</span>
                  {onBack && selected ? <Icon className="combined-model-check" name="check" size={14} /> : null}
                </button>
              );
            })}
          </section>
        ))}
      </div>
      {hiddenCount > 0 ? (
        <p className="menu-note menu-footer-note">
          {trf("已隐藏 {0} 个模型，可在设置里调整", "{0} hidden · manage in settings", hiddenCount)}
        </p>
      ) : null}
    </div>
  );
}

export function LoginDialog({
  login,
  onReply,
  onCancel,
  onDismiss,
}: {
  login: LoginState;
  onReply: (promptId: string, value: string | null) => Promise<void>;
  onCancel: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [value, setValue] = useState("");
  const prompt = login.prompt;
  const inputId = useId();
  const formId = useId();

  useEffect(() => {
    setValue("");
  }, [prompt?.id]);
  const dialogRef = useEscapeKey<HTMLElement>(true, () => {
    if (login.error) onDismiss();
    else void onCancel();
  });
  const textField = prompt && prompt.prompt.type !== "select" ? prompt.prompt : null;
  const textPrompt = textField ? prompt : null;

  return (
    <div className="sheet-backdrop">
      <section ref={dialogRef} className="modal modal-sm sheet-card login-card" role="dialog" aria-modal="true" aria-labelledby="login-sheet-title">
        <header className="modal-head">
          <h2 id="login-sheet-title">{tr("登录", "Sign in")}</h2>
        </header>
        <div className="modal-body login-body">
          {login.notices.map((notice, index) => (
            <Notice key={`${notice.type}-${index}`} notice={notice} />
          ))}
          {login.progress ? <p className="menu-note">{translate(login.progress)}</p> : null}
          {login.error ? <p className="menu-note menu-note-error">{localizeError(login.error)}</p> : null}
          {prompt?.prompt.type === "select" ? (
            <div className="login-options">
              <p>{translate(prompt.prompt.message)}</p>
              {prompt.prompt.options.map((option) => (
                <button key={option.id} className="menu-row" type="button" onClick={() => void onReply(prompt.id, option.id)}>
                  <span className="menu-row-title">{translate(option.label)}</span>
                  {option.description ? <span className="menu-row-meta">{translate(option.description)}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {textPrompt && textField ? (
            <form
              id={formId}
              className="login-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!value.trim()) return;
                void onReply(textPrompt.id, value);
              }}
            >
              <label htmlFor={inputId}>{translate(textField.message)}</label>
              <input
                id={inputId}
                className="modal-input"
                type={textField.type === "secret" ? "password" : "text"}
                value={value}
                placeholder={textField.placeholder ? translate(textField.placeholder) : ""}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                onChange={(event) => setValue(event.target.value)}
              />
            </form>
          ) : null}
          {!prompt && !login.error ? <p className="menu-note">{tr("正在等待登录完成。", "Waiting for sign-in to complete…")}</p> : null}
        </div>
        <footer className="modal-foot">
          {login.error ? (
            <button className="modal-btn" type="button" onClick={onDismiss}>{tr("关闭", "Close")}</button>
          ) : (
            <button className="modal-btn" type="button" onClick={() => void onCancel()}>{tr("取消", "Cancel")}</button>
          )}
          {textPrompt ? (
            <button className="modal-btn modal-btn-primary" type="submit" form={formId} disabled={!value.trim()}>{tr("继续", "Continue")}</button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function Notice({ notice }: { notice: AuthNotice }) {
  if (notice.type === "device_code") {
    return (
      <div className="login-device">
        <p>{tr("在验证页面输入这组设备码", "Enter this device code on the verification page")}</p>
        <code>{notice.userCode}</code>
        <a href={notice.verificationUri} target="_blank" rel="noreferrer">{tr("打开验证页面", "Open verification page")}</a>
      </div>
    );
  }
  if (notice.type === "auth_url") {
    return (
      <div className="login-link">
        <p>{translate(notice.instructions ?? tr("在浏览器中完成登录。", "Complete sign-in in your browser."))}</p>
        <a href={notice.url} target="_blank" rel="noreferrer">{tr("打开登录页面", "Open sign-in page")}</a>
      </div>
    );
  }
  if (notice.type === "info") {
    return (
      <div className="login-link">
        <p>{translate(notice.message)}</p>
        {notice.links?.map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label ?? tr("打开链接", "Open link")}</a>
        ))}
      </div>
    );
  }
  return null;
}

function Chevron() {
  return (
    <Icon name="chevron-down" size={12} />
  );
}

function groupModels(
  models: ModelSummary[],
  hidden: string[],
  selectedProvider: string | null,
  selectedId: string | null,
): { provider: string; name: string; models: ModelSummary[] }[] {
  const groups = new Map<string, { provider: string; name: string; models: ModelSummary[] }>();
  for (const model of models) {
    if (!model.available) continue;
    const current = model.provider === selectedProvider && model.id === selectedId;
    if (!current && hidden.includes(modelKey(model.provider, model.id))) continue;
    const group = groups.get(model.provider) ?? { provider: model.provider, name: model.providerName, models: [] };
    group.models.push(model);
    groups.set(model.provider, group);
  }
  return [...groups.values()];
}

const knownText: Record<string, [string, string]> = {
  "Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here.": ["在浏览器中完成登录。如果未自动返回，请将最终跳转的网址粘贴到这里。", "Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here."],
  "Complete login in your browser, or paste the final redirect URL here:": ["在浏览器中完成登录，或粘贴最终跳转的网址", "Complete login in your browser, or paste the final redirect URL here:"],
  "Exchanging authorization code for tokens...": ["正在验证授权码…", "Exchanging authorization code for tokens..."],
  "Select OpenAI Codex login method:": ["选择 Codex 登录方式", "Select a Codex sign-in method"],
  "Browser login (default)": ["浏览器登录", "Sign in with browser (default)"],
  "Device code login (headless)": ["设备码登录", "Sign in with device code (headless)"],
  "Complete login in your browser, or paste the authorization code / redirect URL here:": ["在浏览器完成登录，或把授权码 / 回调地址粘贴到这里", "Complete sign-in in your browser, or paste the authorization code / redirect URL here:"],
  "A browser window should open. Complete login to finish.": ["将打开浏览器。完成登录后会自动继续，也可以把回调地址粘贴到下面。", "A browser window should open. Complete sign-in to continue, or paste the redirect URL below."],
};

function translate(message: string): string {
  const known = knownText[message];
  if (known) return tr(known[0], known[1]);
  const enter = /^Enter (.+)$/.exec(message);
  if (enter?.[1]) return trf("输入 {0}", "Enter {0}", enter[1]);
  return message;
}
