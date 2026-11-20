import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GitCommitSummary, GitFileChange, InteractionMode, TaskRecipe } from "@vela/shared";
import type { ProjectApi } from "../hooks/useProject";
import { activeIntlLocale, tr, trf, useAppLocale } from "../locale";
import { modKeyLabel } from "../platform";
import { ComposerSeedContext } from "./composer-seed-context";
import { RecipeActionsContext } from "./recipe-actions-context";
import { useReducedMotion } from "../hooks/useMotionPresence";
import { workspaceTitle } from "./workspace-names";
import { VelaLogoMark } from "./VelaLogo";
import { Icon, type IconName } from "./icons";

type Greeting = [string, string];

const greetings: Record<"morning" | "noon" | "afternoon" | "evening" | "night", Greeting[]> = {
  morning: [
    ["早上好，今天想做点什么？", "Good morning. What shall we work on?"],
    ["早安，从哪里开始？", "Morning. Where do we start?"],
    ["早安，今天有什么新想法？", "Morning. Any new ideas today?"],
    ["早上好，先从一件小事开始？", "Good morning. Start with something small?"],
    ["新的一天，想先解决什么？", "A new day. What should we tackle first?"],
  ],
  noon: [
    ["中午好，来处理点什么？", "Good afternoon. What's on the list?"],
    ["午安，有什么要我帮忙的？", "Hello there. How can I help?"],
    ["中午好，有什么想一起琢磨的？", "Hello. Anything to think through together?"],
    ["午安，来把一个想法变成现实？", "Hello. Shall we bring an idea to life?"],
    ["中午好，接下来想做什么？", "Hello. What would you like to do next?"],
  ],
  afternoon: [
    ["下午好，今天想做点什么？", "Good afternoon. What shall we work on?"],
    ["下午好，来推进哪件事？", "Afternoon. What should we move forward?"],
    ["下午好，有什么难题要一起看看？", "Good afternoon. Any puzzles to work through?"],
    ["午后好，想试试什么新点子？", "Afternoon. Any new ideas to try?"],
    ["下午好，从你最想做的开始。", "Good afternoon. Let's start with what you have in mind."],
  ],
  evening: [
    ["晚上好，今天想做点什么？", "Good evening. What shall we work on?"],
    ["晚上好，还有什么要收尾的？", "Evening. Anything left to wrap up?"],
    ["晚上好，有什么想法想聊聊？", "Good evening. Any ideas to talk through?"],
    ["晚上好，来理一理今天的思路？", "Evening. Shall we sort through today's ideas?"],
    ["忙了一天，有什么我能帮忙的？", "A busy day. How can I help?"],
  ],
  night: [
    ["夜深了，还在忙什么？", "Burning the midnight oil? What are we doing?"],
    ["这么晚了，来点轻量的任务？", "Late night. Something quick?"],
    ["夜深了，想记下什么灵感？", "Late-night inspiration. Anything to jot down?"],
    ["夜里安静，来慢慢理理思路？", "A quiet night. Shall we think things through?"],
    ["还没休息？有什么我能搭把手的？", "Still up? Anything I can lend a hand with?"],
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

const presetPrompts: PresetPrompt[] = [
  {
    id: "explore",
    icon: <Icon name="compass" size={16} />,
    tone: "#3b82f6",
    label: ["了解项目", "Explore the project"],
    prompt: ["梳理这个项目的目录结构和主要模块，说明它是如何运行的。", "Walk me through this project's structure and main modules, and explain how it runs."],
  },
  {
    id: "git-init",
    icon: <Icon name="branch" size={16} />,
    tone: "#f97316",
    label: ["初始化 Git", "Initialize Git"],
    prompt: ["为这个项目初始化 Git 仓库：先查看目录，补一份合适的 .gitignore，再完成首次提交。", "Initialize a Git repository for this project: inspect the directory, add a suitable .gitignore, then make the first commit."],
    needsNoGit: true,
  },
  {
    id: "readme",
    icon: <Icon name="book" size={16} />,
    tone: "#14b8a6",
    label: ["撰写 README", "Write a README"],
    prompt: ["阅读这个项目，写一份清晰的 README，说明用途、安装和使用方法。", "Read this project and write a clear README covering its purpose, setup, and usage."],
    needsNoGit: true,
  },
  {
    id: "review",
    icon: <Icon name="file-search" size={16} />,
    tone: "#8b5cf6",
    label: ["审查改动", "Review my changes"],
    prompt: ["审查当前未提交的改动，指出潜在问题和可以改进的地方。", "Review my uncommitted changes and point out potential issues and improvements."],
    needsGit: true,
  },
  {
    id: "bugs",
    icon: <Icon name="bug" size={16} />,
    tone: "#f43f5e",
    label: ["排查 Bug", "Hunt for bugs"],
    prompt: ["检查最近改动的代码，找出潜在的 Bug 并给出修复方案。", "Check the recently changed code for potential bugs and propose fixes."],
  },
  {
    id: "tests",
    icon: <Icon name="flask" size={16} />,
    tone: "#22c55e",
    label: ["补充测试", "Add tests"],
    prompt: ["为核心逻辑补充单元测试，并运行它们确认全部通过。", "Add unit tests for the core logic and run them to make sure they pass."],
  },
  {
    id: "commit",
    icon: <Icon name="commit" size={16} />,
    tone: "#f59e0b",
    label: ["撰写提交信息", "Commit message"],
    prompt: ["查看当前的改动，帮我写一条清晰规范的 commit 信息。", "Look at my current changes and write a clear, conventional commit message."],
    needsGit: true,
  },
  {
    id: "refactor",
    icon: <Icon name="refresh" size={16} />,
    tone: "#6366f1",
    label: ["重构代码", "Refactor code"],
    prompt: ["找出这个项目里最值得重构的部分，先给出方案，确认后再动手。", "Find the part of this project most worth refactoring. Propose a plan first and wait for my go-ahead."],
  },
  {
    id: "docs",
    icon: <Icon name="document" size={16} />,
    tone: "#0ea5e9",
    label: ["完善文档", "Improve docs"],
    prompt: ["检查 README 和代码注释，补全缺失或过时的说明。", "Review the README and code comments, and fill in anything missing or out of date."],
  },
];

const maxPrompts = 6;

/**
 * 轮廓版 Vela 标:由旧版应用图标的色块描边得到——左臂、带帆的右臂——是首页专用的背景水印,
 * 有意保留原来的形状,与现在的应用图标和侧边栏标识不同。图标里的四角星由标题旁的星芒图标接替,避免和压在上面的问候语重叠。
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
        <span className="home-spark" aria-hidden="true"><Icon name="sparkles" size={28} /></span>
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

/* ============================================================================
 * 公共数据钩子与工具（供「静纸稿台」与「星航指挥舱」读取真实工作区实况）
 * ============================================================================ */

type RepoKind = "dirty" | "clean" | "nogit";

function repoKindOf(project: ProjectApi): RepoKind {
  if (!project.git?.repo) return "nogit";
  return project.git.files.length > 0 ? "dirty" : "clean";
}

function currentWorkspaceName(project: ProjectApi): string {
  const current = project.workspace?.current ?? null;
  if (!current) return tr("未选择工作区", "No workspace");
  return workspaceTitle(project.workspace?.recents ?? [], current);
}

function statusLetter(file: GitFileChange): string {
  switch (file.status) {
    case "added":
    case "untracked":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "conflicted":
      return "U";
    default:
      return "M";
  }
}

function compactFilePath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 2) return path;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function formatRelativeTime(timestampMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return tr("刚刚", "now");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return trf("{0} 分钟前", "{0}m ago", diffMin);
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return trf("{0} 小时前", "{0}h ago", diffHour);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return trf("{0} 天前", "{0}d ago", diffDay);
  return new Intl.DateTimeFormat(activeIntlLocale(), { month: "short", day: "numeric" }).format(new Date(timestampMs));
}

function useRecentCommits(enabled: boolean, workspace: string | null, branch: string | null): GitCommitSummary[] {
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  useEffect(() => {
    if (!enabled || !workspace || !window.vela?.getCommitGraph) {
      setCommits([]);
      return;
    }
    let active = true;
    void window.vela.getCommitGraph({ scope: "current", limit: 3, skip: 0 })
      .then((slice) => { if (active) setCommits(slice.commits.slice(0, 3)); })
      .catch(() => { if (active) setCommits([]); });
    return () => { active = false; };
  }, [enabled, workspace, branch]);
  return commits;
}

function useHomeRecipes(enabled: boolean): TaskRecipe[] {
  const locale = useAppLocale();
  const [recipes, setRecipes] = useState<TaskRecipe[]>([]);
  useEffect(() => {
    if (!enabled || !window.vela?.taskRecipes) return;
    let active = true;
    void window.vela.taskRecipes.list(locale)
      .then((state) => { if (active) setRecipes(state.recipes.slice(0, 6)); })
      .catch(() => { if (active) setRecipes([]); });
    return () => { active = false; };
  }, [enabled, locale]);
  return recipes;
}

function useHarnessTelemetry(enabled: boolean, cwd: string | null, conversationId: string | null): {
  skillCount: number | null;
  mcpCount: number | null;
} {
  const [skillCount, setSkillCount] = useState<number | null>(null);
  const [mcpCount, setMcpCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !window.vela) return;
    let active = true;
    void window.vela.listSkills?.()
      .then((catalog) => {
        if (!active) return;
        setSkillCount(catalog.skills.filter((skill) => skill.enabled !== false).length);
      })
      .catch(() => { if (active) setSkillCount(null); });

    if (cwd && window.vela.getMcpCatalog) {
      void window.vela.getMcpCatalog({ cwd, conversationId })
        .then((catalog) => {
          if (!active) return;
          setMcpCount(catalog.servers.filter((server) => server.enabled && server.effective).length);
        })
        .catch(() => { if (active) setMcpCount(null); });
    } else {
      setMcpCount(null);
    }

    return () => { active = false; };
  }, [enabled, cwd, conversationId]);

  return { skillCount, mcpCount };
}

function periodGreetingPrefix(hour: number): [string, string] {
  const period = dayPeriod(hour);
  if (period === "morning") return ["早上好", "Good morning"];
  if (period === "noon") return ["中午好", "Good afternoon"];
  if (period === "afternoon") return ["下午好", "Good afternoon"];
  if (period === "evening") return ["晚上好", "Good evening"];
  return ["夜深了", "Late night"];
}

/* ============================================================================
 * 方案一：静纸 · 叙事稿台 (Editorial Atelier)
 * ============================================================================ */

export function AtelierBackdrop() {
  return (
    <div className="atelier-backdrop" aria-hidden="true">
      <div className="atelier-arc">
        <VelaLogoMark height={185} />
      </div>
    </div>
  );
}

const atelierModes: { id: InteractionMode; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "plan", label: "Plan" },
  { id: "goal", label: "Goal" },
];

function AtelierModeRail({
  mode,
  disabled,
  onMode,
}: {
  mode: InteractionMode;
  disabled: boolean;
  onMode: (mode: InteractionMode) => void;
}) {
  return (
    <div className="atelier-mode-rail" data-mode={mode} role="group" aria-label={tr("交互模式", "Interaction mode")}>
      <span className="atelier-mode-thumb" aria-hidden="true" />
      {atelierModes.map((item) => (
        <button
          key={item.id}
          type="button"
          className="atelier-mode-btn"
          data-mode={item.id}
          aria-pressed={mode === item.id}
          disabled={disabled}
          onClick={() => { if (mode !== item.id) onMode(item.id); }}
        >
          <span className="atelier-mode-dot" aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function NewChatAtelierHeader({
  project,
  mode,
  hint,
  showHint,
  onMode,
  modeDisabled,
  now = new Date(),
}: {
  project: ProjectApi;
  mode: InteractionMode;
  hint: string;
  showHint: boolean;
  onMode: (mode: InteractionMode) => void;
  modeDisabled: boolean;
  now?: Date;
}) {
  const recipeActions = useContext(RecipeActionsContext);
  const seeds = useContext(ComposerSeedContext);
  const conversationId = recipeActions?.conversationId ?? null;
  const clock = useClock(now);
  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(activeIntlLocale(), { month: "short", day: "numeric", weekday: "short" }).format(now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now.toDateString()],
  );

  const wsName = currentWorkspaceName(project);
  const kind = repoKindOf(project);
  const branch = project.git?.branch ?? null;
  const filesCount = project.git?.files.length ?? 0;
  const added = project.git?.addedLines ?? 0;
  const deleted = project.git?.deletedLines ?? 0;
  const [periodZh, periodEn] = periodGreetingPrefix(now.getHours());

  const headline = mode === "plan"
    ? { lead: tr("先定脉络，", "Shape the plan,"), em: tr("再落一笔", "then build"), tail: tr("。", ".") }
    : mode === "goal"
      ? { lead: tr("立好目标，", "Set the target,"), em: tr("持续推进", "ship steadily"), tail: tr("。", ".") }
      : { lead: tr(`${periodZh}，`, `${periodEn}.`), prefix: tr("从", "Where shall we "), em: tr("哪里落笔", "begin"), tail: tr("？", "?") };

  return (
    <div className="empty-state is-home is-atelier" data-mode={mode}>
      <div className="atelier-masthead">
        <div className="atelier-masthead-left">
          <span className="atelier-brand-seal" aria-hidden="true">
            <VelaLogoMark height={12} />
          </span>
          <div className="atelier-crumb">
            <strong className="atelier-ws-name" title={project.workspace?.current ?? undefined}>{wsName}</strong>
            {project.workspace?.current ? <span className="atelier-sep">/</span> : null}
            {kind !== "nogit" && branch ? (
              <span className="atelier-git-pill">{branch}</span>
            ) : project.workspace?.current ? (
              <span className="atelier-git-pill">{tr("普通目录", "Folder")}</span>
            ) : null}
            {kind === "dirty" ? (
              <button
                type="button"
                className="atelier-diff-badge"
                title={tr("填入审查当前改动的提示词", "Fill a prompt to review uncommitted changes")}
                onClick={() => {
                  if (conversationId && seeds?.offer) {
                    seeds.offer(
                      conversationId,
                      trf(
                        "审查当前未提交的 {0} 个文件改动（+{1} -{2}），指出潜在问题和可优化点。",
                        "Review the {0} uncommitted files (+{1} -{2}) and point out potential issues or improvements.",
                        filesCount,
                        added,
                        deleted,
                      ),
                    );
                  }
                }}
              >
                <span className="is-add">+{added}</span>
                <span className="is-del">-{deleted}</span>
                <span>· {trf("{0} 个文件", filesCount === 1 ? "{0} file" : "{0} files", filesCount)}</span>
              </button>
            ) : kind === "clean" ? (
              <span className="atelier-clean-badge">{tr("工作区干净", "Clean")}</span>
            ) : null}
          </div>
        </div>
        <div className="atelier-time">{dateLabel} · {clock}</div>
      </div>

      <div className="atelier-hero-row">
        <h1 className="atelier-greeting">
          {headline.lead}<br />
          {headline.prefix}<em>{headline.em}</em>{headline.tail}
        </h1>
        <AtelierModeRail mode={mode} disabled={modeDisabled} onMode={onMode} />
      </div>

      {showHint ? <p className="atelier-notice">{hint}</p> : null}
    </div>
  );
}

interface LedgerEntry {
  key: string;
  title: string;
  meta: string;
  tag: string;
  onSelect: () => void;
}

type AtelierTab = "starters" | "recipes" | "workspace";

export function NewChatAtelierLedger({
  project,
  conversationId,
}: {
  project: ProjectApi;
  conversationId: string | null;
}) {
  const seeds = useContext(ComposerSeedContext);
  const recipeActions = useContext(RecipeActionsContext);
  const [tab, setTab] = useState<AtelierTab>("starters");

  const kind = repoKindOf(project);
  const workspace = project.workspace?.current ?? null;
  const branch = project.git?.branch ?? null;
  const recipes = useHomeRecipes(tab === "recipes");
  const commits = useRecentCommits(tab === "workspace" && kind === "clean", workspace, branch);

  if (!conversationId || !seeds?.offer) return null;
  const offer = seeds.offer;

  const entries: LedgerEntry[] = (() => {
    if (tab === "recipes") {
      if (recipes.length > 0) {
        return recipes.map((recipe) => ({
          key: recipe.id,
          title: recipe.name,
          meta: recipe.description || tr("按配方步骤推进当前任务", "Run this structured workflow"),
          tag: recipe.stages?.length ? trf("{0} 阶段", "{0} stages", recipe.stages.length) : recipe.defaultMode,
          onSelect: () => {
            if (recipeActions?.useRecipe) recipeActions.useRecipe(recipe);
            else offer(conversationId, recipe.description || recipe.name);
          },
        }));
      }
      return [
        {
          key: "fallback-bug",
          title: tr("缺陷定位与最小修复", "Root-cause bug fix"),
          meta: tr("复现 → 定位根因 → 最小修复 → 回归测试", "Reproduce, isolate root cause, fix minimally, add tests"),
          tag: "debug",
          onSelect: () => offer(conversationId, tr("先复现并定位问题根因，给出最小修复方案并补充回归测试。", "Reproduce the issue, isolate the root cause, propose a minimal fix, and add regression tests.")),
        },
        {
          key: "fallback-review",
          title: tr("变更深度审查清单", "Deep change review"),
          meta: tr("检查正确性、边界条件、性能与测试覆盖", "Audit correctness, edge cases, performance, and tests"),
          tag: "review",
          onSelect: () => offer(conversationId, tr("按深度审查清单检查当前改动，重点指出边界条件、潜在回归和缺失测试。", "Audit the current changes for correctness, edge cases, regressions, and test coverage.")),
        },
        {
          key: "fallback-refactor",
          title: tr("渐进式重构评审", "Incremental refactor plan"),
          meta: tr("测绘耦合点 → 给出方案对比 → 确认后实施", "Map coupling, compare options, apply after approval"),
          tag: "plan",
          onSelect: () => offer(conversationId, tr("找出这个项目里最值得重构的部分，先给出分步迁移方案，确认后再动手。", "Identify the highest-value refactoring opportunity, outline an incremental plan, and wait for approval.")),
        },
        {
          key: "fallback-open",
          title: tr("打开任务配方库", "Open Task Recipes"),
          meta: tr("管理、创建或运行已保存的多阶段工作流", "Browse, create, or run saved multi-stage recipes"),
          tag: "recipes",
          onSelect: () => recipeActions?.open(),
        },
      ];
    }

    if (tab === "workspace") {
      if (kind === "dirty" && project.git) {
        const fileRows: LedgerEntry[] = project.git.files.slice(0, 5).map((file) => ({
          key: file.path,
          title: compactFilePath(file.path),
          meta: file.addedLines || file.deletedLines
            ? `${file.path} · +${file.addedLines} -${file.deletedLines}`
            : file.path,
          tag: statusLetter(file),
          onSelect: () => offer(
            conversationId,
            trf("审查 {0} 的当前未提交改动，指出潜在问题和改进建议。", "Review the uncommitted changes in {0} and point out potential issues or improvements.", file.path),
          ),
        }));
        fileRows.push({
          key: "run-tests",
          title: tr("运行测试验证当前改动", "Run tests on current changes"),
          meta: tr("执行项目测试并汇总失败原因", "Run the project test suite and summarize any failures"),
          tag: "test",
          onSelect: () => offer(conversationId, tr("运行当前项目的测试套件，汇报结果；如有失败请定位原因。", "Run this project's test suite and summarize results, investigating any failures.")),
        });
        return fileRows;
      }

      if (kind === "clean") {
        if (commits.length > 0) {
          return [
            ...commits.map((commit) => ({
              key: commit.sha,
              title: commit.subject,
              meta: `${commit.shortSha} · ${formatRelativeTime(commit.authorAt)}`,
              tag: "commit",
              onSelect: () => offer(
                conversationId,
                trf("查看提交 {0}（{1}）的改动，确认是否有遗漏的边界情况或需要补充的测试。", "Inspect commit {0} ({1}) for edge cases or missing tests.", commit.shortSha, commit.subject),
              ),
            })),
            {
              key: "clean-test",
              title: tr("运行项目测试巡检", "Run project test suite"),
              meta: tr("确认当前主干构建与单元测试状态", "Verify typecheck and unit tests on the current branch"),
              tag: "test",
              onSelect: () => offer(conversationId, tr("运行当前项目的测试套件，汇报类型检查和单元测试状态。", "Run this project's test suite and report typecheck and test status.")),
            },
          ];
        }
        return [
          {
            key: "clean-status",
            title: tr("检查分支与提交历史", "Inspect branch & history"),
            meta: tr("梳理近期提交脉络与待推进事项", "Review recent commits and identify next priorities"),
            tag: "git",
            onSelect: () => offer(conversationId, tr("查看当前分支与近期提交状态，帮我梳理接下来最值得优先推进的工作。", "Inspect the current branch and recent commits, and help prioritize next steps.")),
          },
          {
            key: "clean-test",
            title: tr("运行项目测试巡检", "Run project test suite"),
            meta: tr("确认当前工作区的构建与测试状态", "Verify build and unit test health"),
            tag: "test",
            onSelect: () => offer(conversationId, tr("运行当前项目的测试套件，汇报类型检查和单元测试状态。", "Run this project's test suite and report typecheck and test status.")),
          },
        ];
      }

      return [
        {
          key: "nogit-init",
          title: tr("初始化 Git 仓库", "Initialize Git repository"),
          meta: tr("生成合适的 .gitignore 并完成首次提交", "Create a suitable .gitignore and make the first commit"),
          tag: "init",
          onSelect: () => offer(conversationId, tr("为这个项目初始化 Git 仓库：先查看目录，补一份合适的 .gitignore，再完成首次提交。", "Initialize a Git repository for this project: inspect the directory, add a suitable .gitignore, then make the first commit.")),
        },
        {
          key: "nogit-scan",
          title: tr("扫描目录结构与技术栈", "Scan structure & stack"),
          meta: tr("识别依赖、入口文件与可用脚本", "Identify dependencies, entrypoints, and available scripts"),
          tag: "scan",
          onSelect: () => offer(conversationId, tr("扫描当前目录的技术栈、依赖与可用脚本，给出简明概览。", "Scan this folder's tech stack, dependencies, and available scripts for a concise overview.")),
        },
      ];
    }

    // 默认 Tab：快速起点
    if (kind === "dirty") {
      return [
        {
          key: "review",
          title: tr("审查当前未提交改动", "Review uncommitted changes"),
          meta: tr("检查变更文件中的边界问题与潜在回归", "Spot edge cases and potential regressions in modified files"),
          tag: "/review",
          onSelect: () => offer(conversationId, tr("审查当前未提交的改动，指出潜在问题和可以改进的地方。", "Review my uncommitted changes and point out potential issues and improvements.")),
        },
        {
          key: "explore",
          title: tr("梳理项目结构与运行链路", "Explore architecture & flow"),
          meta: tr("快速定位入口、核心模块与依赖关系", "Map entrypoints, core modules, and how pieces fit together"),
          tag: "explore",
          onSelect: () => offer(conversationId, tr("梳理这个项目的目录结构和主要模块，说明它是如何运行的。", "Walk me through this project's structure and main modules, and explain how it runs.")),
        },
        {
          key: "commit",
          title: tr("撰写规范的提交信息", "Draft commit message"),
          meta: tr("根据当前 diff 生成清晰规范的提交说明", "Write a clear conventional commit message from the diff"),
          tag: "git",
          onSelect: () => offer(conversationId, tr("查看当前的改动，帮我写一条清晰规范的 commit 信息。", "Look at my current changes and write a clear, conventional commit message.")),
        },
        {
          key: "tests",
          title: tr("为核心改动补充单元测试", "Add unit tests"),
          meta: tr("补全关键用例并运行确认全部通过", "Add focused tests for core logic and verify they pass"),
          tag: "test",
          onSelect: () => offer(conversationId, tr("为核心逻辑补充单元测试，并运行它们确认全部通过。", "Add unit tests for the core logic and run them to make sure they pass.")),
        },
        {
          key: "bugs",
          title: tr("排查近期代码里的隐患", "Hunt for subtle bugs"),
          meta: tr("聚焦最近修改路径，提出最小修复方案", "Inspect recent changes for bugs and propose minimal fixes"),
          tag: "debug",
          onSelect: () => offer(conversationId, tr("检查最近改动的代码，找出潜在的 Bug 并给出修复方案。", "Check the recently changed code for potential bugs and propose fixes.")),
        },
        {
          key: "refactor",
          title: tr("寻找最值得重构的模块", "Plan a refactoring"),
          meta: tr("先给重构方案与收益评估，确认后再改", "Propose a refactoring plan first and wait for approval"),
          tag: "plan",
          onSelect: () => offer(conversationId, tr("找出这个项目里最值得重构的部分，先给出方案，确认后再动手。", "Find the part of this project most worth refactoring. Propose a plan first and wait for my go-ahead.")),
        },
      ];
    }

    if (kind === "clean") {
      return [
        {
          key: "explore",
          title: tr("梳理项目结构与运行链路", "Explore architecture & flow"),
          meta: tr("快速定位入口、核心模块与依赖关系", "Map entrypoints, core modules, and how pieces fit together"),
          tag: "explore",
          onSelect: () => offer(conversationId, tr("梳理这个项目的目录结构和主要模块，说明它是如何运行的。", "Walk me through this project's structure and main modules, and explain how it runs.")),
        },
        {
          key: "bugs",
          title: tr("排查近期提交里的隐患", "Hunt for subtle bugs"),
          meta: tr("分析最近几次改动，识别潜在边界问题", "Inspect recent changes for edge cases and bugs"),
          tag: "debug",
          onSelect: () => offer(conversationId, tr("检查最近改动的代码，找出潜在的 Bug 并给出修复方案。", "Check the recently changed code for potential bugs and propose fixes.")),
        },
        {
          key: "tests",
          title: tr("为核心逻辑补充单元测试", "Add unit tests"),
          meta: tr("识别测试盲区并运行验证通过", "Cover untested core paths and run the suite"),
          tag: "test",
          onSelect: () => offer(conversationId, tr("为核心逻辑补充单元测试，并运行它们确认全部通过。", "Add unit tests for the core logic and run them to make sure they pass.")),
        },
        {
          key: "refactor",
          title: tr("寻找最值得重构的模块", "Plan a refactoring"),
          meta: tr("先给重构方案与收益评估，确认后再改", "Propose a plan first and wait for go-ahead"),
          tag: "plan",
          onSelect: () => offer(conversationId, tr("找出这个项目里最值得重构的部分，先给出方案，确认后再动手。", "Find the part of this project most worth refactoring. Propose a plan first and wait for my go-ahead.")),
        },
        {
          key: "docs",
          title: tr("核对文档与代码注释", "Improve documentation"),
          meta: tr("补全缺失或已经过时的使用说明", "Review README and comments for stale or missing details"),
          tag: "docs",
          onSelect: () => offer(conversationId, tr("检查 README 和代码注释，补全缺失或过时的说明。", "Review the README and code comments, and fill in anything missing or out of date.")),
        },
        {
          key: "next",
          title: tr("审视分支与近期提交状态", "Review branch status"),
          meta: tr("汇总仓库现状与接下来值得推进的工作", "Summarize repository state and suggest next priorities"),
          tag: "git",
          onSelect: () => offer(conversationId, tr("查看当前分支与近期提交状态，帮我梳理接下来最值得优先推进的工作。", "Inspect the current branch and recent commits, and help prioritize next steps.")),
        },
      ];
    }

    return [
      {
        key: "explore",
        title: tr("了解目录结构与模块职责", "Explore folder structure"),
        meta: tr("通读文件并说明启动与构建方式", "Walk through the directory and explain how it runs"),
        tag: "explore",
        onSelect: () => offer(conversationId, tr("梳理这个项目的目录结构和主要模块，说明它是如何运行的。", "Walk me through this project's structure and main modules, and explain how it runs.")),
      },
      {
        key: "git-init",
        title: tr("初始化 Git 仓库与首提", "Initialize Git"),
        meta: tr("补齐合适的 .gitignore 并完成首次提交", "Add a suitable .gitignore and create the first commit"),
        tag: "git",
        onSelect: () => offer(conversationId, tr("为这个项目初始化 Git 仓库：先查看目录，补一份合适的 .gitignore，再完成首次提交。", "Initialize a Git repository for this project: inspect the directory, add a suitable .gitignore, then make the first commit.")),
      },
      {
        key: "readme",
        title: tr("撰写一份清晰的 README", "Write a README"),
        meta: tr("整理项目用途、安装步骤与日常命令", "Document purpose, setup, and usage"),
        tag: "docs",
        onSelect: () => offer(conversationId, tr("阅读这个项目，写一份清晰的 README，说明用途、安装和使用方法。", "Read this project and write a clear README covering its purpose, setup, and usage.")),
      },
      {
        key: "tests",
        title: tr("补充关键逻辑的测试", "Add unit tests"),
        meta: tr("为核心代码补齐测试并跑通验证", "Add tests for core logic and run them"),
        tag: "test",
        onSelect: () => offer(conversationId, tr("为核心逻辑补充单元测试，并运行它们确认全部通过。", "Add unit tests for the core logic and run them to make sure they pass.")),
      },
    ];
  })();

  return (
    <section className="atelier-ledger" aria-label={tr("快速起点", "Quick starters")}>
      <div className="atelier-ledger-tabs">
        <div className="atelier-tab-group" role="tablist">
          <button type="button" role="tab" className="atelier-tab" aria-selected={tab === "starters"} onClick={() => setTab("starters")}>
            {tr("快速起点", "Quick starters")}
          </button>
          <button type="button" role="tab" className="atelier-tab" aria-selected={tab === "recipes"} onClick={() => setTab("recipes")}>
            {tr("工作流配方", "Recipes")}
          </button>
          <button type="button" role="tab" className="atelier-tab" aria-selected={tab === "workspace"} onClick={() => setTab("workspace")}>
            {tr("当前工作区", "Workspace")}
          </button>
        </div>
        <span className="atelier-ledger-hint">{tr("点击填入输入框", "Click to fill composer")}</span>
      </div>

      <div key={`${tab}-${kind}`} className="atelier-ledger-grid" role="list">
        {entries.map((entry, idx) => (
          <button key={entry.key} type="button" role="listitem" className="atelier-ledger-row" onClick={entry.onSelect}>
            <span className="atelier-row-num">{String(idx + 1).padStart(2, "0")}</span>
            <span className="atelier-row-body">
              <span className="atelier-row-title">
                <span className="atelier-row-title-text">{entry.title}</span>
                <span className="atelier-row-tag">{entry.tag}</span>
              </span>
              <span className="atelier-row-meta">{entry.meta}</span>
            </span>
            <span className="atelier-row-arrow" aria-hidden="true">
              <Icon name="arrow-right" size={14} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ============================================================================
 * 方案二：星航 · 指挥舱 (Spatial Command Deck)
 * ============================================================================ */

const deckModes: { id: InteractionMode; icon: IconName; label: [string, string] }[] = [
  { id: "agent", icon: "terminal", label: ["Agent 执行", "Agent"] },
  { id: "plan", icon: "plan", label: ["Plan 规划", "Plan"] },
  { id: "goal", icon: "goal", label: ["Goal 目标", "Goal"] },
];

export function NewChatDeckHeader({
  project,
  mode,
  hint,
  showHint,
  onMode,
  modeDisabled,
  canRace,
  onOpenRace,
  now = new Date(),
}: {
  project: ProjectApi;
  mode: InteractionMode;
  hint: string;
  showHint: boolean;
  onMode: (mode: InteractionMode) => void;
  modeDisabled: boolean;
  canRace: boolean;
  onOpenRace: () => void;
  now?: Date;
}) {
  const wsName = currentWorkspaceName(project);
  const kind = repoKindOf(project);
  const branch = project.git?.branch ?? null;
  const filesCount = project.git?.files.length ?? 0;
  const [periodZh, periodEn] = periodGreetingPrefix(now.getHours());

  const title = mode === "plan"
    ? tr("先拆解方案，再开始改动。", "Map the plan before changing code.")
    : mode === "goal"
      ? tr("设定目标，交给 Vela 持续推进。", "Set the goal. Vela drives it forward.")
      : tr(`${periodZh}，准备推进哪一项？`, `${periodEn}. What are we shipping?`);

  return (
    <div className="empty-state is-home is-deck" data-mode={mode}>
      <div className="deck-telemetry-bar">
        <span className="deck-telemetry-logo" aria-hidden="true">
          <VelaLogoMark height={10} />
        </span>
        <span className="deck-telemetry-ws" title={project.workspace?.current ?? undefined}>{wsName}</span>
        {project.workspace?.current ? <span className="deck-telemetry-sep" aria-hidden="true" /> : null}
        {kind !== "nogit" && branch ? (
          <span className="deck-telemetry-branch">{branch}</span>
        ) : null}
        {project.workspace?.current ? (
          <span className={`deck-telemetry-pulse is-${kind}`}>
            <i aria-hidden="true" />
            {kind === "dirty"
              ? trf("{0} 未提交", "{0} modified", filesCount)
              : kind === "clean"
                ? tr("工作区干净", "Clean")
                : tr("非 Git 目录", "No Git")}
          </span>
        ) : null}
      </div>

      <h1 className="deck-title">{title}</h1>

      <div className="deck-mode-lenses" role="group" aria-label={tr("执行姿态", "Execution mode")}>
        {deckModes.map((item) => (
          <button
            key={item.id}
            type="button"
            className="deck-lens"
            data-mode={item.id}
            aria-pressed={mode === item.id}
            disabled={modeDisabled}
            onClick={() => onMode(item.id)}
          >
            <Icon name={item.icon} size={14} />
            <span>{tr(item.label[0], item.label[1])}</span>
          </button>
        ))}
        {canRace ? (
          <>
            <span className="deck-lens-divider" aria-hidden="true" />
            <button
              type="button"
              className="deck-lens"
              disabled={modeDisabled}
              title={tr("同时让多个模型竞速对比", "Run multiple models side by side")}
              onClick={onOpenRace}
            >
              <Icon name="race" size={14} />
              <span>{tr("Race 竞速", "Race")}</span>
            </button>
          </>
        ) : null}
      </div>

      {showHint ? <p className="deck-notice">{hint}</p> : null}
    </div>
  );
}

interface DeckTile {
  id: string;
  icon: IconName;
  label: [string, string];
  prompt: [string, string];
}

const deckTilesByKind: Record<RepoKind, DeckTile[]> = {
  dirty: [
    { id: "explore", icon: "compass", label: ["了解项目架构", "Explore architecture"], prompt: ["梳理这个项目的目录结构和主要模块，说明它是如何运行的。", "Walk me through this project's structure and main modules, and explain how it runs."] },
    { id: "bugs", icon: "bug", label: ["排查近期 Bug", "Hunt for bugs"], prompt: ["检查最近改动的代码，找出潜在的 Bug 并给出修复方案。", "Check the recently changed code for potential bugs and propose fixes."] },
    { id: "tests", icon: "flask", label: ["补充单元测试", "Add unit tests"], prompt: ["为核心逻辑补充单元测试，并运行它们确认全部通过。", "Add unit tests for the core logic and run them to make sure they pass."] },
    { id: "refactor", icon: "refresh", label: ["制定重构方案", "Plan refactoring"], prompt: ["找出这个项目里最值得重构的部分，先给出方案，确认后再动手。", "Find the part of this project most worth refactoring. Propose a plan first and wait for my go-ahead."] },
  ],
  clean: [
    { id: "explore", icon: "compass", label: ["了解项目架构", "Explore architecture"], prompt: ["梳理这个项目的目录结构和主要模块，说明它是如何运行的。", "Walk me through this project's structure and main modules, and explain how it runs."] },
    { id: "bugs", icon: "bug", label: ["排查近期隐患", "Hunt for bugs"], prompt: ["检查最近改动的代码，找出潜在的 Bug 并给出修复方案。", "Check the recently changed code for potential bugs and propose fixes."] },
    { id: "tests", icon: "flask", label: ["补充单元测试", "Add unit tests"], prompt: ["为核心逻辑补充单元测试，并运行它们确认全部通过。", "Add unit tests for the core logic and run them to make sure they pass."] },
    { id: "docs", icon: "book", label: ["核对文档说明", "Improve docs"], prompt: ["检查 README 和代码注释，补全缺失或过时的说明。", "Review the README and code comments, and fill in anything missing or out of date."] },
  ],
  nogit: [
    { id: "explore", icon: "compass", label: ["了解目录结构", "Explore folder"], prompt: ["梳理这个项目的目录结构和主要模块，说明它是如何运行的。", "Walk me through this project's structure and main modules, and explain how it runs."] },
    { id: "readme", icon: "book", label: ["撰写 README", "Write a README"], prompt: ["阅读这个项目，写一份清晰的 README，说明用途、安装和使用方法。", "Read this project and write a clear README covering its purpose, setup, and usage."] },
    { id: "tests", icon: "flask", label: ["搭建测试验证", "Add unit tests"], prompt: ["为核心逻辑补充单元测试，并运行它们确认全部通过。", "Add unit tests for the core logic and run them to make sure they pass."] },
    { id: "refactor", icon: "refresh", label: ["优化代码结构", "Plan refactoring"], prompt: ["找出这个项目里最值得重构的部分，先给出方案，确认后再动手。", "Find the part of this project most worth refactoring. Propose a plan first and wait for my go-ahead."] },
  ],
};

export function NewChatDeckBento({
  project,
  conversationId,
  platform,
  onMode,
  modeDisabled,
  now = new Date(),
}: {
  project: ProjectApi;
  conversationId: string | null;
  platform: string;
  onMode: (mode: InteractionMode) => void;
  modeDisabled: boolean;
  now?: Date;
}) {
  const seeds = useContext(ComposerSeedContext);
  const kind = repoKindOf(project);
  const workspace = project.workspace?.current ?? null;
  const branch = project.git?.branch ?? null;
  const commits = useRecentCommits(kind === "clean", workspace, branch);
  const telemetry = useHarnessTelemetry(true, workspace, conversationId);
  const clock = useClock(now);
  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(activeIntlLocale(), { month: "short", day: "numeric" }).format(now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now.toDateString()],
  );
  const mod = modKeyLabel(platform);
  const tiles = deckTilesByKind[kind];

  // ⌘1–⌘4（或 Ctrl+1–Ctrl+4）快捷填入矩阵中的对应提示词。
  useEffect(() => {
    if (!conversationId || !seeds?.offer) return;
    const offer = seeds.offer;
    const onKeyDown = (event: KeyboardEvent) => {
      const hasMod = platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!hasMod || event.shiftKey || event.altKey) return;
      const num = Number(event.key);
      if (num < 1 || num > 4) return;
      const tile = tiles[num - 1];
      if (!tile) return;
      event.preventDefault();
      offer(conversationId, tr(tile.prompt[0], tile.prompt[1]));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversationId, seeds, platform, tiles]);

  if (!conversationId || !seeds?.offer) return null;
  const offer = seeds.offer;

  const added = project.git?.addedLines ?? 0;
  const deleted = project.git?.deletedLines ?? 0;
  const dirtyFiles = project.git?.files.slice(0, 3) ?? [];

  return (
    <div className="deck-lower">
      <section className="deck-bento" aria-label={tr("工作区实况与快捷指令", "Workspace signals and quick actions")}>
        {/* 左舱：实时仓库实况卡 */}
        <div className="deck-signal-card">
          {kind === "dirty" ? (
            <>
              <div className="deck-signal-head">
                <span className="deck-signal-title">
                  <Icon name="branch" size={14} />
                  <span>{tr("未提交改动", "Uncommitted changes")}</span>
                </span>
                <span className="deck-signal-stat">
                  <span className="is-add">+{added}</span>
                  <span className="is-del">-{deleted}</span>
                </span>
              </div>
              <div className="deck-signal-list">
                {dirtyFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className="deck-signal-row"
                    title={file.path}
                    onClick={() => offer(
                      conversationId,
                      trf("审查 {0} 的当前未提交改动，指出潜在问题和改进建议。", "Review the uncommitted changes in {0} and point out potential issues or improvements.", file.path),
                    )}
                  >
                    <span className="deck-file-status">{statusLetter(file)}</span>
                    <span className="deck-file-name">{compactFilePath(file.path)}</span>
                    <span className="deck-file-delta">
                      {file.addedLines || file.deletedLines ? `+${file.addedLines} -${file.deletedLines}` : file.status}
                    </span>
                  </button>
                ))}
              </div>
              <div className="deck-signal-actions">
                <button
                  type="button"
                  className="deck-signal-cta is-primary"
                  onClick={() => offer(conversationId, tr("审查当前未提交的改动，指出潜在问题和可以改进的地方。", "Review my uncommitted changes and point out potential issues and improvements."))}
                >
                  {tr("审查改动", "Review changes")}
                </button>
                <button
                  type="button"
                  className="deck-signal-cta"
                  onClick={() => offer(conversationId, tr("查看当前的改动，帮我写一条清晰规范的 commit 信息。", "Look at my current changes and write a clear, conventional commit message."))}
                >
                  {tr("撰写提交信息", "Commit message")}
                </button>
              </div>
            </>
          ) : kind === "clean" ? (
            <>
              <div className="deck-signal-head">
                <span className="deck-signal-title">
                  <Icon name="check-circle" size={14} />
                  <span>{tr("最近提交", "Recent commits")}</span>
                </span>
                <span className="deck-signal-stat">
                  {project.git?.ahead ? trf("领先 {0}", "{0} ahead", project.git.ahead) : tr("工作区干净", "Clean tree")}
                </span>
              </div>
              <div className="deck-signal-list">
                {commits.length > 0 ? commits.map((commit) => (
                  <button
                    key={commit.sha}
                    type="button"
                    className="deck-signal-row"
                    title={`${commit.shortSha} ${commit.subject}`}
                    onClick={() => offer(
                      conversationId,
                      trf("查看提交 {0}（{1}）的改动，确认是否有遗漏的边界情况或需要补充的测试。", "Inspect commit {0} ({1}) for edge cases or missing tests.", commit.shortSha, commit.subject),
                    )}
                  >
                    <span className="deck-file-status is-ok">
                      <Icon name="commit" size={10} />
                    </span>
                    <span className="deck-file-name">{commit.subject}</span>
                    <span className="deck-file-delta">{formatRelativeTime(commit.authorAt)}</span>
                  </button>
                )) : (
                  <button
                    type="button"
                    className="deck-signal-row"
                    onClick={() => offer(conversationId, tr("查看当前分支与近期提交状态，帮我梳理接下来最值得优先推进的工作。", "Inspect the current branch and recent commits, and help prioritize next steps."))}
                  >
                    <span className="deck-file-status is-ok">
                      <Icon name="branch" size={10} />
                    </span>
                    <span className="deck-file-name">{tr("查看分支状态与近期脉络", "Inspect branch & history")}</span>
                    <span className="deck-file-delta">{branch ?? "HEAD"}</span>
                  </button>
                )}
              </div>
              <div className="deck-signal-actions">
                <button
                  type="button"
                  className="deck-signal-cta is-primary"
                  onClick={() => offer(conversationId, tr("运行当前项目的测试套件，汇报类型检查和单元测试结果。", "Run this project's test suite and report typecheck and unit test results."))}
                >
                  {tr("运行测试", "Run tests")}
                </button>
                <button
                  type="button"
                  className="deck-signal-cta"
                  onClick={() => {
                    if (!modeDisabled) onMode("plan");
                    offer(conversationId, tr("基于当前代码库，帮我规划下一个需求的实现步骤与变更范围：", "Based on the current codebase, help me plan the implementation steps and scope for: "));
                  }}
                >
                  {tr("规划新改动", "Plan a change")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="deck-signal-head">
                <span className="deck-signal-title">
                  <Icon name="folder" size={14} />
                  <span>{tr("工作区未启用 Git", "Git not initialized")}</span>
                </span>
                <span className="deck-signal-stat">{tr("普通目录", "Folder")}</span>
              </div>
              <div className="deck-signal-list">
                <button
                  type="button"
                  className="deck-signal-row"
                  onClick={() => offer(conversationId, tr("扫描当前目录的技术栈、依赖与可用脚本，给出简明概览。", "Scan this folder's tech stack, dependencies, and scripts for a concise overview."))}
                >
                  <span className="deck-file-status is-ok">
                    <Icon name="compass" size={10} />
                  </span>
                  <span className="deck-file-name">{tr("扫描目录结构、依赖与入口脚本", "Scan directory structure & scripts")}</span>
                  <span className="deck-file-delta">{tr("快速", "Quick")}</span>
                </button>
                <button
                  type="button"
                  className="deck-signal-row"
                  onClick={() => offer(conversationId, tr("检查当前目录的技术栈，生成一份合适的 .gitignore 文件。", "Inspect this project's stack and create a suitable .gitignore file."))}
                >
                  <span className="deck-file-status">+</span>
                  <span className="deck-file-name">{tr("生成适配技术栈的 .gitignore", "Generate a tailored .gitignore")}</span>
                  <span className="deck-file-delta">{tr("推荐", "Tip")}</span>
                </button>
              </div>
              <div className="deck-signal-actions">
                <button
                  type="button"
                  className="deck-signal-cta is-primary"
                  onClick={() => offer(conversationId, tr("为这个项目初始化 Git 仓库：先查看目录，补一份合适的 .gitignore，再完成首次提交。", "Initialize a Git repository for this project: inspect the directory, add a suitable .gitignore, then make the first commit."))}
                >
                  {tr("初始化 Git", "Initialize Git")}
                </button>
                <button
                  type="button"
                  className="deck-signal-cta"
                  onClick={() => offer(conversationId, tr("阅读这个项目，写一份清晰的 README，说明用途、安装和使用方法。", "Read this project and write a clear README covering its purpose, setup, and usage."))}
                >
                  {tr("撰写 README", "Write README")}
                </button>
              </div>
            </>
          )}
        </div>

        {/* 右舱：2×2 快捷指令矩阵 */}
        <div className="deck-tile-grid" role="list">
          {tiles.map((tile, index) => (
            <button
              key={tile.id}
              type="button"
              role="listitem"
              className="deck-action-tile"
              title={tr(tile.prompt[0], tile.prompt[1])}
              onClick={() => offer(conversationId, tr(tile.prompt[0], tile.prompt[1]))}
            >
              <div className="deck-tile-top">
                <span className="deck-tile-icon" aria-hidden="true">
                  <Icon name={tile.icon} size={16} />
                </span>
                <span className="deck-tile-kbd">{`${mod}${index + 1}`}</span>
              </div>
              <span className="deck-tile-label">{tr(tile.label[0], tile.label[1])}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 底部低噪音能力遥测条 */}
      <footer className="deck-harness-strip">
        <div className="deck-harness-pills">
          {telemetry.skillCount !== null ? (
            <span className="deck-harness-item">
              <span className="deck-harness-dot" aria-hidden="true" />
              <span>{trf("{0} 个 Skill 就绪", "{0} Skills ready", telemetry.skillCount)}</span>
            </span>
          ) : null}
          {telemetry.mcpCount !== null ? (
            <span className="deck-harness-item">
              <span className="deck-harness-dot is-accent" aria-hidden="true" />
              <span>{trf("{0} 个 MCP 已启用", "{0} MCP active", telemetry.mcpCount)}</span>
            </span>
          ) : null}
          <span className="deck-harness-item is-mono">{`${mod}1–${mod}4`}</span>
        </div>
        <span className="deck-harness-clock">{dateLabel} · {clock}</span>
      </footer>
    </div>
  );
}
