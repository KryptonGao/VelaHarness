import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ThinkingSummaryStyle, ToolDisplay, ToolFold, ToolIconColor } from "../../hooks/usePreferences";
import { tr, trf } from "../../locale";
import { EyeIcon, FilePlusIcon, PencilIcon, SubagentIcon, TerminalIcon, ThinkingIcon } from "../icons";
import { formatDuration } from "../tool-duration";

/** 常驻预览里的动画一律静止:只显示终态,选项切换时即时刷新。 */
const StillContext = createContext(false);

/** 周期性递增,用来重放一次性动画;系统要求减少动效时保持静止,直接显示终态。 */
function useReplay(period: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setTick((value) => value + 1), period);
    return () => window.clearInterval(id);
  }, [period]);
  return tick;
}

/** 预览舞台:variant 或周期变化时整体重挂载,让进入动画从头播放;结尾淡出后再循环。 */
function Stage({ variant, period = 5200, previewing, children }: {
  variant: string;
  period?: number;
  previewing: boolean;
  children: ReactNode;
}) {
  const tick = useReplay(period);
  return (
    <div className="dp-stage" aria-hidden="true">
      {previewing ? <span className="dp-badge">{tr("预览", "Preview")}</span> : null}
      <div
        key={`${variant}-${tick}`}
        className="dp-stage-inner"
        style={{ "--dp-period": `${period}ms` } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}

function delay(ms: number): CSSProperties {
  return { "--d": `${ms}ms` } as CSSProperties;
}

const Chevron = ({ className }: { className?: string }) => (
  <svg className={`dp-chevron${className ? ` ${className}` : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

type Kind = "bash" | "read" | "edit" | "write";

const kindIcon: Record<Kind, ReactNode> = {
  bash: <TerminalIcon size={13} />,
  read: <EyeIcon size={13} />,
  edit: <PencilIcon size={13} />,
  write: <FilePlusIcon size={13} />,
};

const kindAction: Record<Kind, () => string> = {
  bash: () => tr("已运行", "Ran"),
  read: () => tr("已读取", "Read"),
  edit: () => tr("已编辑", "Edited"),
  write: () => tr("已创建", "Created"),
};

function summaryLabel(kind: Kind, count: number): string {
  if (kind === "edit") return trf("已编辑 {0} 个文件", count === 1 ? "Edited {0} file" : "Edited {0} files", count);
  if (kind === "write") return trf("已创建 {0} 个文件", count === 1 ? "Created {0} file" : "Created {0} files", count);
  if (kind === "read") return trf("已读取 {0} 个文件", count === 1 ? "Read {0} file" : "Read {0} files", count);
  return trf("已运行 {0} 条命令", count === 1 ? "Ran {0} command" : "Ran {0} commands", count);
}

interface Call {
  kind: Kind;
  name: string;
}

function Line({ call, d, colored = false, extra }: { call: Call; d: number; colored?: boolean; extra?: ReactNode }) {
  return (
    <div className="dp-line dp-in" style={delay(d)}>
      <span className={`dp-ico dp-ico-${call.kind}${colored ? " is-colored" : ""}`}>{kindIcon[call.kind]}</span>
      <span className="dp-act">{kindAction[call.kind]()}</span>
      <span className="dp-name">{call.name}</span>
      {extra}
    </div>
  );
}

function Summary({ parts, d, colored = false, total }: {
  parts: { kind: Kind; count: number }[];
  d: number;
  colored?: boolean;
  /** 给出时在汇总行显示整组耗时。 */
  total?: number;
}) {
  return (
    <div className="dp-summary dp-expand-in" style={delay(d)}>
      <div className="dp-summary-row">
        <span className={`dp-ico dp-ico-group${colored ? " is-colored" : " is-colored-off"}`}>{kindIcon[parts[0].kind]}</span>
        <span className="dp-parts">
          {parts.map((part) => <span key={part.kind}>{summaryLabel(part.kind, part.count)}</span>)}
        </span>
        {total !== undefined ? <span className="dp-duration">· {formatDuration(total)}</span> : null}
        <Chevron />
      </div>
    </div>
  );
}

const calls = {
  test: { kind: "bash", name: "pnpm test" },
  app: { kind: "read", name: "App.tsx" },
  css: { kind: "edit", name: "styles.css" },
  chat: { kind: "edit", name: "ChatView.tsx" },
  notes: { kind: "write", name: "notes.md" },
} satisfies Record<string, Call>;

/* ---------- 工具调用显示 ---------- */

function DiffBody() {
  return (
    <div className="dp-card-body dp-body-in" style={delay(1100)}>
      <div className="dp-diff is-del"><i>−</i><span className="dp-bar" style={{ width: "46%" }} /></div>
      <div className="dp-diff is-add"><i>+</i><span className="dp-bar" style={{ width: "62%" }} /></div>
      <div className="dp-diff is-add"><i>+</i><span className="dp-bar" style={{ width: "38%" }} /></div>
    </div>
  );
}

function Card({ call, d, open }: { call: Call; d: number; open?: boolean }) {
  return (
    <div className={`dp-card dp-in${open ? " is-open" : ""}`} style={delay(d)}>
      <div className="dp-card-head">
        <span className={`dp-ico dp-ico-${call.kind} is-colored-off`}>{kindIcon[call.kind]}</span>
        <span className="dp-card-kind">{kindAction[call.kind]()}</span>
        <span className="dp-name">{call.name}</span>
        <Chevron className={open ? "dp-chevron-open" : undefined} />
      </div>
      {open ? <DiffBody /> : null}
    </div>
  );
}

export function ToolDisplayPreview({ mode, previewing }: { mode: ToolDisplay; previewing: boolean }) {
  return (
    <Stage variant={mode} previewing={previewing}>
      {mode === "card" ? (
        <div className="dp-stack">
          <Card call={calls.test} d={0} />
          <Card call={calls.css} d={220} open />
        </div>
      ) : (
        <div className="dp-stack is-tight">
          <div className="dp-lines-out" style={delay(1900)}>
            <Line call={calls.test} d={0} />
            <Line call={calls.css} d={220} />
            <Line call={calls.chat} d={440} />
          </div>
          <Summary d={1900} parts={[{ kind: "bash", count: 1 }, { kind: "edit", count: 2 }]} />
        </div>
      )}
    </Stage>
  );
}

/* ---------- 工具折叠方式 ---------- */

function MessageMark({ d }: { d: number }) {
  return (
    <div className="dp-mark dp-in" style={delay(d)}>
      <span />
      <em>Assistant</em>
      <span />
    </div>
  );
}

export function ToolFoldPreview({ mode, previewing }: { mode: ToolFold; previewing: boolean }) {
  const first = [calls.test, calls.app];
  const second = [calls.css, calls.chat];
  const group = (items: Call[], d0: number) => items.map((call, index) => <Line key={call.name} call={call} d={d0 + index * 180} />);
  return (
    <Stage variant={mode} previewing={previewing}>
      <div className="dp-stack is-tight">
        {mode === "message" ? (
          <>
            <div className="dp-group">
              <MessageMark d={0} />
              <div className="dp-lines-out" style={delay(1700)}>{group(first, 120)}</div>
              <Summary d={1700} parts={[{ kind: "bash", count: 1 }, { kind: "read", count: 1 }]} />
            </div>
            <div className="dp-group">
              <MessageMark d={500} />
              <div className="dp-lines-out" style={delay(1700)}>{group(second, 620)}</div>
              <Summary d={1700} parts={[{ kind: "edit", count: 2 }]} />
            </div>
          </>
        ) : null}
        {mode === "position" ? (
          <div className="dp-group">
            <div className="dp-lines-out" style={delay(1900)}>
              <MessageMark d={0} />
              {group(first, 120)}
              <MessageMark d={500} />
              {group(second, 620)}
            </div>
            <Summary d={1900} parts={[{ kind: "bash", count: 1 }, { kind: "read", count: 1 }, { kind: "edit", count: 2 }]} />
          </div>
        ) : null}
        {mode === "none" ? (
          <>
            <MessageMark d={0} />
            {group(first, 120)}
            <MessageMark d={500} />
            {group(second, 620)}
          </>
        ) : null}
      </div>
    </Stage>
  );
}

/* ---------- 工具图标配色 ---------- */

const chips: { id: string; icon: ReactNode; label: () => string }[] = [
  { id: "bash", icon: kindIcon.bash, label: () => tr("已运行", "Ran") },
  { id: "read", icon: kindIcon.read, label: () => tr("已读取", "Read") },
  { id: "edit", icon: kindIcon.edit, label: () => tr("已编辑", "Edited") },
  { id: "write", icon: kindIcon.write, label: () => tr("已创建", "Created") },
  { id: "think", icon: <ThinkingIcon size={13} />, label: () => tr("思考", "Thinking") },
  { id: "agent", icon: <SubagentIcon size={13} />, label: () => tr("子代理", "Subagent") },
];

export function ToolIconColorPreview({ mode, previewing }: { mode: ToolIconColor; previewing: boolean }) {
  const colored = mode !== "gray";
  return (
    <Stage variant={colored ? "on" : "off"} previewing={previewing} period={4200}>
      <div className={`dp-chip-grid${mode === "theme" ? " dp-icon-theme" : ""}`}>
        {chips.map((chip, index) => (
          <div className="dp-chip-row" key={chip.id}>
            <span
              className={`dp-ico dp-ico-${chip.id}${colored ? " is-colored dp-color-in" : " is-colored-off dp-pop"}`}
              style={delay(index * 160)}
            >
              {chip.icon}
            </span>
            <span className="dp-act">{chip.label()}</span>
          </div>
        ))}
      </div>
    </Stage>
  );
}

/* ---------- 过程行耗时与折叠记忆 ---------- */

/** 从 0 数到目标耗时,只播放一次;减少动效时直接显示终值。 */
function CountUp({ to, d, failed }: { to: number; d: number; failed?: boolean }) {
  const still = useContext(StillContext) || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [value, setValue] = useState(() => (still ? to : 0));
  const frame = useRef(0);
  useEffect(() => {
    if (still) return;
    const start = performance.now() + d;
    const span = 700;
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / span));
      setValue(to * (1 - (1 - progress) ** 3));
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [to, d, still]);
  return <span className={`dp-duration${failed ? " is-failed" : ""}`}>· {formatDuration(value)}</span>;
}

export function ToolProcessDetailsPreview({ enabled, previewing }: { enabled: boolean; previewing: boolean }) {
  const rows: { call: Call; ms: number; failed?: boolean }[] = [
    { call: calls.test, ms: 4200, failed: true },
    { call: calls.css, ms: 800 },
    { call: calls.test, ms: 3900 },
  ];
  return (
    <Stage variant={enabled ? "on" : "off"} previewing={previewing} period={4600}>
      <div className="dp-stack is-tight">
        {rows.map((row, index) => (
          <Line
            key={index}
            call={row.call}
            d={index * 260}
            extra={enabled ? <CountUp to={row.ms} d={index * 260 + 300} failed={row.failed} /> : null}
          />
        ))}
      </div>
    </Stage>
  );
}

/* ---------- 思考总结 ---------- */

function Dots() {
  return (
    <span className="dp-dots">
      <i /><i /><i />
    </span>
  );
}

function ThinkingBody({ d }: { d: number }) {
  return (
    <div className="dp-think-body dp-body-in" style={delay(d)}>
      <span className="dp-bar" style={{ width: "92%" }} />
      <span className="dp-bar" style={{ width: "78%" }} />
      <span className="dp-bar" style={{ width: "58%" }} />
    </div>
  );
}

/** summary 为 false 表示关闭总结:思考结束后只剩「思考」标题。withBody 为真时依次展开思考内容。 */
function ThinkingContent({ style, summary, withBody }: { style: ThinkingSummaryStyle; summary: boolean; withBody: boolean }) {
  const text = tr("梳理重构思路并确认改动范围", "Outlined the refactor and checked scope");
  const variant = summary ? style : "off";
  const label = (
    <span className="dp-think-label">
      <span>{tr("思考", "Thinking")}</span>
      <Chevron />
    </span>
  );
  const turn = withBody ? "dp-chevron-turn" : undefined;
  return (
    <div className="dp-think">
      {variant === "off" ? (
        <div className="dp-think-row">
          {label}
          <span className="dp-fade-out" style={delay(1300)}><Dots /></span>
        </div>
      ) : null}
      {variant === "inline" ? (
        <div className="dp-think-row">
          {label}
          <span className="dp-fade-out" style={delay(1300)}><Dots /></span>
          <span className="dp-summary-text dp-slide-in" style={delay(1500)}>{text}</span>
        </div>
      ) : null}
      {variant === "headline" ? (
        <>
          <div className="dp-swap">
            <div className="dp-think-row dp-swap-out" style={delay(1300)}>
              {label}
              <Dots />
            </div>
            <div className="dp-think-row dp-swap-in" style={delay(1500)}>
              <span className="dp-think-label is-headline">
                <span className="dp-ico is-colored-off"><ThinkingIcon size={13} /></span>
                <span>{text}</span>
                <Chevron className={turn} />
              </span>
            </div>
          </div>
          {withBody ? <ThinkingBody d={2700} /> : null}
        </>
      ) : null}
      {variant === "prose" ? (
        <>
          <div className="dp-swap">
            <div className="dp-think-row dp-swap-out" style={delay(1300)}>
              {label}
              <Dots />
            </div>
            <div className="dp-prose dp-swap-in" style={delay(1500)}>
              {text}
              <Chevron className={turn} />
            </div>
          </div>
          {withBody ? <ThinkingBody d={2700} /> : null}
        </>
      ) : null}
    </div>
  );
}

export function ThinkingPreview({ style, summary, previewing }: {
  style: ThinkingSummaryStyle;
  summary: boolean;
  previewing: boolean;
}) {
  return (
    <Stage variant={summary ? style : "off"} previewing={previewing} period={6400}>
      <ThinkingContent style={style} summary={summary} withBody />
    </Stage>
  );
}

/* ---------- 输入预测 ---------- */

function ComposerMock({ enabled }: { enabled: boolean }) {
  const ghost = tr("继续，并补上测试", "Keep going and add tests");
  return (
    <div className="dp-composer">
      <div className="dp-composer-input">
        {enabled ? (
          <span className="dp-ghost">{ghost}</span>
        ) : (
          <>
            <span className="dp-caret" />
            <span className="dp-placeholder">{tr("随心输入", "Ask anything or describe a task")}</span>
          </>
        )}
        {enabled ? <kbd className="dp-kbd">Tab</kbd> : null}
      </div>
      <span className="dp-send">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </span>
    </div>
  );
}

export function InputPredictionPreview({ enabled, previewing }: { enabled: boolean; previewing: boolean }) {
  return (
    <Stage variant={enabled ? "on" : "off"} previewing={previewing} period={5600}>
      <ComposerMock enabled={enabled} />
    </Stage>
  );
}

/* ---------- 常驻预览:所有显示设置作用在同一段对话上 ---------- */

export interface ConversationSettings {
  toolDisplay: ToolDisplay;
  toolFold: ToolFold;
  toolIconColor: ToolIconColor;
  toolProcessDetails: boolean;
  thinkingSummary: boolean;
  thinkingSummaryStyle: ThinkingSummaryStyle;
  inputPrediction: boolean;
}

/** 两条 Assistant 消息里共四次工具调用:消息一在思考之后,消息二后接回复正文。 */
const liveCalls: { call: Call; ms: number }[] = [
  { call: calls.test, ms: 4200 },
  { call: calls.app, ms: 300 },
  { call: calls.css, ms: 800 },
  { call: calls.chat, ms: 1100 },
];

function LiveTools({ display, fold, colored, details }: {
  display: ToolDisplay;
  fold: ToolFold;
  colored: boolean;
  details: boolean;
}) {
  if (display === "card") {
    return (
      <div className="dp-card-grid">
        {liveCalls.map(({ call }) => <Card key={call.name} call={call} d={0} />)}
      </div>
    );
  }
  const rows = (items: typeof liveCalls) => items.map(({ call, ms }) => (
    <Line key={call.name} call={call} d={0} colored={colored} extra={details ? <CountUp to={ms} d={0} /> : null} />
  ));
  const sum = (items: typeof liveCalls) => items.reduce((total, item) => total + item.ms, 0);
  const first = liveCalls.slice(0, 2);
  const second = liveCalls.slice(2);
  if (fold === "message") {
    return (
      <div className="dp-stack is-tight">
        <div className="dp-group">
          <MessageMark d={0} />
          <div className="dp-lines-out">{rows(first)}</div>
          <Summary d={0} colored={colored} total={details ? sum(first) : undefined} parts={[{ kind: "bash", count: 1 }, { kind: "read", count: 1 }]} />
        </div>
        <div className="dp-group">
          <MessageMark d={0} />
          <div className="dp-lines-out">{rows(second)}</div>
          <Summary d={0} colored={colored} total={details ? sum(second) : undefined} parts={[{ kind: "edit", count: 2 }]} />
        </div>
      </div>
    );
  }
  if (fold === "position") {
    return (
      <div className="dp-stack is-tight">
        <div className="dp-group">
          <div className="dp-lines-out">{rows(liveCalls)}</div>
          <Summary
            d={0}
            colored={colored}
            total={details ? sum(liveCalls) : undefined}
            parts={[{ kind: "bash", count: 1 }, { kind: "read", count: 1 }, { kind: "edit", count: 2 }]}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="dp-stack is-tight">
      <MessageMark d={0} />
      {rows(first)}
      <MessageMark d={0} />
      {rows(second)}
    </div>
  );
}

const hiddenKey = "vela.settings.conversationPreviewHidden";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(hiddenKey) === "1";
  } catch {
    return false;
  }
}

/** 设置页顶部常驻的对话预览;previewing 为真表示正在悬停预览一个尚未选中的选项。可隐藏,偏好只记在本机浏览器里。 */
export function ConversationPreview({ settings, previewing }: { settings: ConversationSettings; previewing: boolean }) {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = (next: boolean) => {
    setHidden(next);
    try {
      window.localStorage.setItem(hiddenKey, next ? "1" : "0");
    } catch {
      // 存储不可用时本次会话内仍然生效
    }
  };
  if (hidden) {
    return (
      <button type="button" className="dp-live-show" onClick={() => toggle(false)}>
        <EyeIcon size={13} />
        {tr("显示预览", "Show preview")}
      </button>
    );
  }
  return (
    <div className="dp-live">
      <button
        type="button"
        className="dp-live-hide"
        title={tr("隐藏预览", "Hide preview")}
        aria-label={tr("隐藏预览", "Hide preview")}
        onClick={() => toggle(true)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
      {previewing ? <span className="dp-badge dp-live-badge">{tr("预览", "Preview")}</span> : null}
      <StillContext.Provider value>
        <div
          className={`dp-still dp-live-inner${settings.toolIconColor === "theme" ? " dp-icon-theme" : ""}`}
          aria-hidden="true"
          key={JSON.stringify(settings)}
        >
          <ThinkingContent style={settings.thinkingSummaryStyle} summary={settings.thinkingSummary} withBody={false} />
          <LiveTools
            display={settings.toolDisplay}
            fold={settings.toolFold}
            colored={settings.toolIconColor !== "gray"}
            details={settings.toolProcessDetails}
          />
          <div className="dp-reply">
            <span className="dp-bar" style={{ width: "86%" }} />
          </div>
          <ComposerMock enabled={settings.inputPrediction} />
        </div>
      </StillContext.Provider>
    </div>
  );
}
