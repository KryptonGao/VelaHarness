import { PopoverPresence } from "../MotionPresence";
import type { InteractionMode } from "@vela/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDismissable } from "../../hooks/useDismissable";
import { tr, trf } from "../../locale";
import { Icon } from "../icons";

const modes: InteractionMode[] = ["agent", "plan", "goal"];

const modeLabels: Record<InteractionMode, string> = {
  agent: "Agent",
  plan: "Plan",
  goal: "Goal",
};

const modeIcons: Record<InteractionMode, ReactNode> = {
  agent: <Icon name="terminal" size={14} />,
  plan: <Icon name="plan" size={14} />,
  goal: <Icon name="goal" size={14} />,
};

const modeDescriptions: Record<InteractionMode, [string, string]> = {
  agent: ["直接修改代码、运行命令并完成任务。", "Edit code, run commands, and complete tasks directly."],
  plan: ["只查阅代码并写出计划。确认后才会开始改文件。", "Inspect the code and draft a plan. Files are changed only after you approve it."],
  goal: ["围绕一个目标自动连续执行，直到完成或你停止。", "Work toward a goal continuously until it is complete or you stop."],
};

function modeDescription(mode: InteractionMode): string {
  const [chinese, english] = modeDescriptions[mode];
  return tr(chinese, english);
}

export function ModeChip({
  mode,
  disabled,
  openRequest,
  onChange,
  race,
}: {
  mode: InteractionMode;
  disabled: boolean;
  /** 每次值变化（且大于 0）就展开模式菜单；`/mode` 命令用它从输入框外部打开。 */
  openRequest?: number;
  onChange: (mode: InteractionMode) => void;
  /** 赛马不是对话模式，而是一次性的启动动作，所以单独传入；缺省时菜单里没有这一项。 */
  race?: { onStart: () => void; onShow: () => void; count: number };
}) {
  const [open, setOpen] = useState(false);
  const lastOpenRequest = useRef(openRequest ?? 0);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!openRequest || openRequest === lastOpenRequest.current) return;
    lastOpenRequest.current = openRequest;
    if (!disabled) setOpen(true);
  }, [openRequest, disabled]);

  return (
    <div className="composer-chip-anchor" ref={ref}>
      <button
        type="button"
        className={`mode-pill mode-${mode}`}
        title={modeDescription(mode)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{modeLabels[mode]}</span>
      </button>
      <PopoverPresence present={open}>
        <div className="dock-popover composer-popover up mode-popover">
          <div className="composer-popover-title">{tr("对话模式", "Chat mode")}</div>
          {modes.map((candidate) => (
            <button
              type="button"
              key={candidate}
              className={`mode-option${candidate === mode ? " active" : ""}`}
              onClick={() => {
                onChange(candidate);
                setOpen(false);
              }}
            >
              <span className={`mode-option-icon mode-${candidate}`}>{modeIcons[candidate]}</span>
              <span className="mode-option-text">
                <span className="mode-option-name">{modeLabels[candidate]}</span>
              </span>
              {candidate === mode ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
          {race ? (
            <>
              <div className="mode-popover-divider" role="separator" />
              <button type="button" className="mode-option" onClick={() => { race.onStart(); setOpen(false); }}>
                <span className="mode-option-icon mode-race"><Icon name="race" size={14} /></span>
                <span className="mode-option-text">
                  <span className="mode-option-name">{tr("赛马", "Race")}</span>
                </span>
              </button>
              {race.count > 0 ? (
                <button type="button" className="mode-option mode-option-secondary" onClick={() => { race.onShow(); setOpen(false); }}>
                  <span className="mode-option-text">
                    <span className="mode-option-desc">{trf("查看赛马记录（{0}）", "View races ({0})", race.count)}</span>
                  </span>
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </PopoverPresence>
    </div>
  );
}
