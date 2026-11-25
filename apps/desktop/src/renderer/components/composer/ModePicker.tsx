import { PopoverPresence } from "../MotionPresence";
import type { InteractionMode, SandboxMode } from "@vela/shared";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useDismissable } from "../../hooks/useDismissable";
import { tr, trf } from "../../locale";
import {
  combinedModeChange,
  combinedModeOptions,
  currentCombinedMode,
  type CombinedModeId,
} from "./combined-mode";
import { Icon } from "../icons";

const labels: Record<CombinedModeId, [string, string]> = {
  auto: ["自动", "Auto"],
  manual: ["手动", "Manual"],
  plan: ["Plan", "Plan"],
  goal: ["Goal", "Goal"],
  full: ["完全访问", "Full access"],
};

const descriptions: Record<CombinedModeId, [string, string]> = {
  auto: ["由模型判断风险，只在有风险时请求批准。", "The model checks each action and asks only when it is risky."],
  manual: ["运行终端命令和修改工作区外的文件前都先询问。", "Ask before running commands or changing files outside the workspace."],
  plan: ["只查阅代码并写出计划。确认后才会开始改文件。", "Inspect the code and draft a plan. Files are changed only after you approve it."],
  goal: ["围绕一个目标自动连续执行，直到完成或你停止。", "Work toward a goal continuously until it is complete or you stop."],
  full: ["在当前工具权限范围内执行命令和文件修改，不再逐项询问。", "Run commands and make file changes within the current tool permissions without asking each time."],
};

/** 紧凑行里的一句话提示；完整说明放在气泡提示里。 */
const hints: Partial<Record<CombinedModeId, [string, string]>> = {
  plan: ["先写计划，确认后再改文件", "Draft a plan first, edit after approval"],
  goal: ["围绕目标持续执行直到完成", "Keep working until the goal is met"],
};

const sandboxNames: Record<SandboxMode, CombinedModeId> = { smart: "auto", ask: "manual", full: "full" };
const permissionOptions = combinedModeOptions.filter((option) => option.sandbox);

function label(id: CombinedModeId): string {
  const [chinese, english] = labels[id];
  return tr(chinese, english);
}

function description(id: CombinedModeId): string {
  const [chinese, english] = descriptions[id];
  return tr(chinese, english);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

interface CompactRow {
  id: string;
  name: string;
  hint: string;
  title: string;
  active: boolean;
  run: () => void;
}

/**
 * Combines chat mode and execution permissions. Entering Goal keeps the current
 * permission, and the controls under Goal can change it without leaving the mode.
 */
export function ModePicker({
  mode,
  sandboxMode,
  sandboxLocked,
  disabled,
  openRequest,
  onMode,
  onSandboxMode,
  race,
}: {
  mode: InteractionMode;
  sandboxMode: SandboxMode;
  /** 配方启动时固定下来的权限快照；有值时不能在这里改权限。 */
  sandboxLocked?: boolean;
  disabled: boolean;
  /** 每次值变化（且大于 0）就展开模式菜单；`/mode` 命令用它从输入框外部打开。 */
  openRequest?: number;
  onMode: (mode: InteractionMode) => void;
  onSandboxMode: (mode: SandboxMode) => unknown;
  /** 赛马不是对话模式，而是一次性的启动动作，所以单独传入；缺省时菜单里没有这一项。 */
  race?: { onStart: () => void; onShow: () => void; count: number };
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const goalPermissionsId = useId();
  const lastOpenRequest = useRef(openRequest ?? 0);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const current = currentCombinedMode(mode, sandboxMode);
  const permissionLabel = label(sandboxNames[sandboxMode]);
  const goalPermissionsLabel = sandboxLocked
    ? tr("执行权限", "Execution permissions")
    : tr("应用默认权限", "App default permissions");
  const showsPermission = current === "plan" || current === "goal";
  const title = showsPermission ? `${description(current)} · ${permissionLabel}` : description(current);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!openRequest || openRequest === lastOpenRequest.current) return;
    lastOpenRequest.current = openRequest;
    if (!disabled) setOpen(true);
  }, [openRequest, disabled]);

  function finishSelection() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function select(id: CombinedModeId) {
    const change = combinedModeChange(id, { interaction: mode, sandbox: sandboxMode }, { sandboxLocked });
    if (change.sandbox) void onSandboxMode(change.sandbox);
    if (change.interaction) onMode(change.interaction);
    if (id !== "goal" || current === "goal") finishSelection();
  }

  function run(action: () => void) {
    action();
    setOpen(false);
  }

  // Plan / Goal 和赛马用紧凑的单行：赛马不是对话模式而是启动动作，排在模式之后，沿用同样的行样式和数字键。
  const compactRows: CompactRow[] = [
    ...combinedModeOptions
      .filter((option) => !option.sandbox)
      .map((option): CompactRow => ({
        id: option.id,
        name: label(option.id),
        hint: option.id === "goal" && mode === "goal" ? goalPermissionsLabel : tr(...(hints[option.id] ?? ["", ""])),
        title: description(option.id),
        active: option.id === current,
        run: () => select(option.id),
      })),
    ...(race
      ? [
          {
            id: "race",
            name: tr("赛马", "Race"),
            hint: tr("多个模型并行尝试，比较结果", "Try several models in parallel"),
            title: tr("同一个任务在 2–4 个独立工作区里用不同模型并行尝试，再并排比较结果。", "Try one task with different models in 2–4 isolated workspaces, then compare the results side by side."),
            active: false,
            run: () => run(race.onStart),
          },
          ...(race.count > 0
            ? [{
                id: "races",
                name: trf("查看赛马记录（{0}）", "View races ({0})", race.count),
                hint: "",
                title: tr("回看、比较或采用之前的赛马结果。", "Review, compare or adopt the results of earlier races."),
                active: false,
                run: () => run(race.onShow),
              }]
            : []),
        ]
      : []),
  ];
  const firstCompactKey = permissionOptions.length + 1;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.contains(document.activeElement)) {
        trigger.current?.focus({ preventScroll: true });
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (!/^[1-9]$/.test(event.key)) return;
      const option = ref.current?.querySelector<HTMLButtonElement>(`button[aria-keyshortcuts="${event.key}"]`);
      if (!option || option.disabled) return;
      event.preventDefault();
      option.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, ref]);

  return (
    <div className="composer-chip-anchor" ref={ref}>
      <button
        ref={trigger}
        type="button"
        className={`mode-pill mode-combined mode-${current}`}
        title={title}
        aria-label={showsPermission ? `${label(current)} · ${permissionLabel}` : label(current)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label(current)}</span>
        {current === "goal" && <span className="mode-pill-permission">· {permissionLabel}</span>}
      </button>
      <PopoverPresence present={open}>
        <div className="dock-popover composer-popover up mode-popover">
          <div className="composer-popover-title">{tr("模式", "Mode")}</div>
          {permissionOptions.map((option, index) => {
            const lockedOut = Boolean(sandboxLocked && option.sandbox !== sandboxMode);
            return (
              <button
                type="button"
                key={option.id}
                className={`mode-option${option.id === current ? " active" : ""}`}
                disabled={lockedOut}
                aria-keyshortcuts={String(index + 1)}
                onClick={() => select(option.id)}
              >
                <span className="mode-option-text">
                  <span className="mode-option-name">
                    {label(option.id)}
                    {option.badge === "recommended" ? <span className="mode-option-badge">{tr("推荐", "Recommended")}</span> : null}
                  </span>
                  <span className="mode-option-desc">{description(option.id)}</span>
                </span>
                <span className="mode-option-check" aria-hidden="true">{option.id === current ? <Icon name="check" size={14} /> : null}</span>
                <span className="mode-option-key" aria-hidden="true">{index + 1}</span>
              </button>
            );
          })}
          <div className="mode-popover-divider" role="separator" />
          {compactRows.map((row, index) => (
            <Fragment key={row.id}>
              <button
                type="button"
                className={`mode-option mode-option-compact${row.active ? " active" : ""}`}
                title={row.title}
                aria-keyshortcuts={String(firstCompactKey + index)}
                aria-expanded={row.id === "goal" ? row.active : undefined}
                aria-controls={row.id === "goal" && row.active ? goalPermissionsId : undefined}
                onClick={row.run}
              >
                <span className="mode-option-name">{row.name}</span>
                <span className="mode-option-hint">{row.hint}</span>
                <span className="mode-option-check" aria-hidden="true">{row.active ? <Icon name="check" size={14} /> : null}</span>
                <span className="mode-option-key" aria-hidden="true">{firstCompactKey + index}</span>
              </button>
              {row.id === "goal" && row.active && (
                <div id={goalPermissionsId} className="mode-goal-permissions" role="group"
                  aria-label={`${row.name} · ${goalPermissionsLabel}`}>
                  {permissionOptions.map(({ id, sandbox }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={sandbox === sandboxMode}
                      title={description(id)}
                      disabled={sandboxLocked}
                      autoFocus={sandbox === sandboxMode && !sandboxLocked}
                      onClick={() => {
                        if (sandbox && sandbox !== sandboxMode) void onSandboxMode(sandbox);
                        finishSelection();
                      }}
                    >
                      {sandbox === sandboxMode && <Icon name="check" size={12} />}
                      <span>{label(id)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Fragment>
          ))}
          {current === "plan" ? (
            <div className="composer-popover-footnote">{trf("执行权限保持为「{0}」。", "Execution permissions stay on “{0}”.", permissionLabel)}</div>
          ) : null}
          {sandboxLocked ? (
            <div className="composer-popover-footnote">{tr("此对话使用配方启动时的权限快照；应用默认权限不受影响。", "This chat uses the permission snapshot from its recipe launch. App defaults are unchanged.")}</div>
          ) : null}
        </div>
      </PopoverPresence>
    </div>
  );
}
