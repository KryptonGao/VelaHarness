import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { InteractionMode } from "@vela/shared";
import { activeIntlLocale, tr } from "../locale";
import { BranchIcon, CommitIcon, RefreshIcon, SparkIcon } from "./icons";
import { ComposerSeedContext } from "./composer-seed-context";
import { RecipeActionsContext } from "./recipe-actions-context";
import { useReducedMotion } from "../hooks/useMotionPresence";

type Greeting = [string, string];

const greetings: Record<"morning" | "noon" | "afternoon" | "evening" | "night", Greeting[]> = {
  morning: [
    ["早上好，今天想做点什么？", "Good morning. What shall we work on?"],
    ["早安，从哪里开始？", "Morning. Where do we start?"],
  ],
  noon: [
    ["中午好，来处理点什么？", "Good afternoon. What's on the list?"],
    ["午安，有什么要我帮忙的？", "Hello there. How can I help?"],
  ],
  afternoon: [
    ["下午好，今天想做点什么？", "Good afternoon. What shall we work on?"],
    ["下午好，来推进哪件事？", "Afternoon. What should we move forward?"],
  ],
  evening: [
    ["晚上好，今天想做点什么？", "Good evening. What shall we work on?"],
    ["晚上好，还有什么要收尾的？", "Evening. Anything left to wrap up?"],
  ],
  night: [
    ["夜深了，还在忙什么？", "Burning the midnight oil? What are we doing?"],
    ["这么晚了，来点轻量的任务？", "Late night. Something quick?"],
  ],
};

/** 按本地时间划分时段:5–11 早,11–14 午,14–18 下午,18–23 晚,其余深夜。 */
export function dayPeriod(hour: number): keyof typeof greetings {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "noon";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

/** 同一个对话里问候语保持不变,换新对话才轮换另一句。 */
function stableIndex(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % size;
}

interface PresetPrompt {
  id: string;
  icon: ReactNode;
  label: [string, string];
  prompt: [string, string];
  /** 卡片的主题色,图标底、描边和悬停光晕都由它派生。 */
  tone: string;
  needsGit?: boolean;
  /** 只在非 Git 仓库里出现。 */
  needsNoGit?: boolean;
}


/** 预设卡片专用的双色图标:描边 + 一层淡淡的填充,比通用的单线图标更有分量。 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const CompassGlyph = () => (
  <Glyph><circle cx="12" cy="12" r="9" /><path d="m15.8 8.2-2 5.6-5.6 2 2-5.6Z" fill="currentColor" fillOpacity={0.22} /></Glyph>
);
const BookGlyph = () => (
  <Glyph><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H11v15H4.5A1.5 1.5 0 0 0 3 20.5Z" fill="currentColor" fillOpacity={0.22} /><path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H13v15h6.5a1.5 1.5 0 0 1 1.5 1.5Z" /><path d="M3 5.5v15M21 5.5v15" /></Glyph>
);
const ReviewGlyph = () => (
  <Glyph><circle cx="10.5" cy="10.5" r="6.5" fill="currentColor" fillOpacity={0.22} /><path d="m20 20-4.9-4.9M8 10.5l1.8 1.8L13 9" /></Glyph>
);
const BugGlyph = () => (
  <Glyph><path d="M8.5 8.5a3.5 3.5 0 0 1 7 0v1H8.5Z" /><rect x="7" y="9.5" width="10" height="9" rx="5" fill="currentColor" fillOpacity={0.22} /><path d="M12 9.5v9M3.5 11.5H7M17 11.5h3.5M4 18l3.2-1.5M20 18l-3.2-1.5M4.5 6.5 8 8.5M19.5 6.5 16 8.5" /></Glyph>
);
const FlaskGlyph = () => (
  <Glyph><path d="M9.5 3h5M10.5 3v6L5 18.5A2 2 0 0 0 6.7 21.5h10.6a2 2 0 0 0 1.7-3L13.5 9V3" /><path d="M7.6 15h8.8l2 3.5a1 1 0 0 1-.9 1.5H6.5a1 1 0 0 1-.9-1.5Z" fill="currentColor" fillOpacity={0.22} stroke="none" /></Glyph>
);
const DocGlyph = () => (
  <Glyph><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" fill="currentColor" fillOpacity={0.22} /><path d="M14 3v5h5M9 13h6M9 17h4" /></Glyph>
);

const presetPrompts: PresetPrompt[] = [
  {
    id: "explore",
    icon: <CompassGlyph />,
    tone: "#3b82f6",
    label: ["了解项目", "Explore the project"],
    prompt: ["梳理这个项目的目录结构和主要模块，说明它是如何运行的。", "Walk me through this project's structure and main modules, and explain how it runs."],
  },
  {
    id: "git-init",
    icon: <BranchIcon size={16} />,
    tone: "#f97316",
    label: ["初始化 Git", "Initialize Git"],
    prompt: ["为这个项目初始化 Git 仓库：先查看目录，补一份合适的 .gitignore，再完成首次提交。", "Initialize a Git repository for this project: inspect the directory, add a suitable .gitignore, then make the first commit."],
    needsNoGit: true,
  },
  {
    id: "readme",
    icon: <BookGlyph />,
    tone: "#14b8a6",
    label: ["撰写 README", "Write a README"],
    prompt: ["阅读这个项目，写一份清晰的 README，说明用途、安装和使用方法。", "Read this project and write a clear README covering its purpose, setup, and usage."],
    needsNoGit: true,
  },
  {
    id: "review",
    icon: <ReviewGlyph />,
    tone: "#8b5cf6",
    label: ["审查改动", "Review my changes"],
    prompt: ["审查当前未提交的改动，指出潜在问题和可以改进的地方。", "Review my uncommitted changes and point out potential issues and improvements."],
    needsGit: true,
  },
  {
    id: "bugs",
    icon: <BugGlyph />,
    tone: "#f43f5e",
    label: ["排查 Bug", "Hunt for bugs"],
    prompt: ["检查最近改动的代码，找出潜在的 Bug 并给出修复方案。", "Check the recently changed code for potential bugs and propose fixes."],
  },
  {
    id: "tests",
    icon: <FlaskGlyph />,
    tone: "#22c55e",
    label: ["补充测试", "Add tests"],
    prompt: ["为核心逻辑补充单元测试，并运行它们确认全部通过。", "Add unit tests for the core logic and run them to make sure they pass."],
  },
  {
    id: "commit",
    icon: <CommitIcon size={16} />,
    tone: "#f59e0b",
    label: ["撰写提交信息", "Commit message"],
    prompt: ["查看当前的改动，帮我写一条清晰规范的 commit 信息。", "Look at my current changes and write a clear, conventional commit message."],
    needsGit: true,
  },
  {
    id: "refactor",
    icon: <RefreshIcon size={16} />,
    tone: "#6366f1",
    label: ["重构代码", "Refactor code"],
    prompt: ["找出这个项目里最值得重构的部分，先给出方案，确认后再动手。", "Find the part of this project most worth refactoring. Propose a plan first and wait for my go-ahead."],
  },
  {
    id: "docs",
    icon: <DocGlyph />,
    tone: "#0ea5e9",
    label: ["完善文档", "Improve docs"],
    prompt: ["检查 README 和代码注释，补全缺失或过时的说明。", "Review the README and code comments, and fill in anything missing or out of date."],
  },
];

const maxPrompts = 6;

/**
 * 轮廓版 Vela 标:由应用图标(resources/icon.png)的色块描边得到——左臂、带帆的右臂——
 * 所以和应用图标是同一个形状。图标里的四角星由标题旁的星芒图标接替,避免和压在上面的问候语重叠。
 * 进入时两笔依次描出,随后极缓慢地浮动,并随指针轻微视差;淡淡的强调色晕染给轮廓一点体积。
 */
export function VelaMark() {
  const ref = useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    const pane = el?.closest<HTMLElement>(".chat-conversation-pane");
    if (!el || !pane || reduced) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      const box = pane.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty("--px", `${(-x * 22).toFixed(1)}px`);
        el.style.setProperty("--py", `${(-y * 16).toFixed(1)}px`);
      });
    };
    pane.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      pane.removeEventListener("pointermove", onMove);
    };
  }, [reduced]);

  return (
    <svg ref={ref} className="home-logo" viewBox="0 0 510 385" fill="none" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="vela-wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--accent-blue)", stopOpacity: 0.14 }} />
          <stop offset="1" style={{ stopColor: "var(--accent-blue)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <g className="home-logo-float">
        {/* 左臂 */}
        <path className="home-logo-stroke" pathLength={1} d="M12 7L11 10L116 193L165 273L172 273L191 262L208 248L225 230L241 209L242 203L144 33L132 20L123 14L106 8Z" />
        {/* 右臂与帆 */}
        <path className="home-logo-stroke is-second" pathLength={1} d="M497 7L413 7L394 11L377 21L361 40L294 157L250 224L213 262L190 276L172 282L199 320L252 376L254 376L296 332L337 278L498 10Z" />
      </g>
    </svg>
  );
}

/** 按字(中文)或按词(英文)拆开,逐个错峰浮现。 */
function splitReveal(text: string): string[] {
  return /\s/.test(text) ? text.split(/(?<=\s)/) : Array.from(text);
}

/** 标题旁的时间,每半分钟刷新一次,让页面不是死的。 */
function useClock(now: Date): string {
  const [time, setTime] = useState(now);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return new Intl.DateTimeFormat(activeIntlLocale(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(time);
}

/** 新对话的问候区。输入框与预设由 ChatView 按首页布局排在它下方,大 Logo 另由 VelaMark 铺在整个对话区后面。 */
export function NewChatGreeting({
  mode,
  hint,
  now = new Date(),
}: {
  mode: InteractionMode;
  hint: string;
  now?: Date;
}) {
  const recipeActions = useContext(RecipeActionsContext);
  const conversationId = recipeActions?.conversationId ?? null;
  const hour = now.getHours();

  const greeting = useMemo(() => {
    const options = greetings[dayPeriod(hour)];
    const [zh, en] = options[stableIndex(conversationId ?? "", options.length)]!;
    return tr(zh, en);
  }, [hour, conversationId]);

  const clock = useClock(now);
  const parts = useMemo(() => splitReveal(greeting), [greeting]);
  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(activeIntlLocale(), { month: "long", day: "numeric", weekday: "long" }).format(now),
    // 日期只在挂载或跨日换新对话时需要刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now.toDateString()],
  );

  return (
    <div className="empty-state is-home" data-mode={mode}>
      <div className="home-eyebrow">{dateLabel} · {clock}</div>
      <h1 className="home-greeting" aria-label={greeting}>
        <span className="home-spark" aria-hidden="true"><SparkIcon size={26} /></span>
        <span aria-hidden="true" className="home-greeting-text">
          {parts.map((part, index) => (
            <span key={index} className="home-greeting-part" style={{ animationDelay: `${160 + index * 38}ms` }}>{part}</span>
          ))}
        </span>
      </h1>
      <p className="home-hint">{hint}</p>
    </div>
  );
}

/** 预设提示词:点击只把文字填进输入框,不自动发送。 */
export function NewChatPrompts({ hasGit }: { hasGit: boolean }) {
  const recipeActions = useContext(RecipeActionsContext);
  const seeds = useContext(ComposerSeedContext);
  const conversationId = recipeActions?.conversationId ?? null;
  const prompts = useMemo(
    () => presetPrompts.filter(item => (hasGit ? !item.needsNoGit : !item.needsGit)).slice(0, maxPrompts),
    [hasGit],
  );
  if (!conversationId || !seeds?.offer) return null;
  const offer = seeds.offer;

  // 按 Git 状态换 key:切换仓库类型时整组重新挂载,所有卡片都重播入场动画,而不只是新出现的那几张。
  return (
    <div key={hasGit ? "git" : "no-git"} className="home-prompts" role="list" aria-label={tr("预设提示词", "Suggested prompts")}>
      {prompts.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="listitem"
          className="home-prompt"
          style={{ animationDelay: `${index * 40 + 120}ms`, "--tone": item.tone } as CSSProperties}
          title={tr(item.prompt[0], item.prompt[1])}
          onClick={() => offer(conversationId, tr(item.prompt[0], item.prompt[1]))}
        >
          <span className="home-prompt-icon" aria-hidden="true">{item.icon}</span>
          <span>{tr(item.label[0], item.label[1])}</span>
        </button>
      ))}
    </div>
  );
}
