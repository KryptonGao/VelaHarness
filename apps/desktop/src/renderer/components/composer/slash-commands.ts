import {
  thinkingLevelLabel,
  type ContextUsage,
  type CustomCommand,
  type InteractionMode,
  type ThinkingLevel,
} from "@vela/shared";
import { tr, trf } from "../../locale";

/** 斜线菜单里的内置命令：直接执行动作或展开专用 Prompt。 */
export type SlashCommandId =
  | "model"
  | "effort"
  | "mode"
  | "handoff"
  | "race"
  | "review"
  | "compact"
  | "status";

export const builtinSlashCommandIds: readonly SlashCommandId[] = [
  "model",
  "effort",
  "mode",
  "handoff",
  "race",
  "review",
  "compact",
  "status",
];

const builtinSlashCommandSet = new Set<string>(builtinSlashCommandIds);

export function isBuiltinSlashCommand(name: string): name is SlashCommandId {
  return builtinSlashCommandSet.has(name);
}

/** 哪些内置命令适合在按下 Tab 时补全为 `/<name> ` 供继续输入参数。 */
export function slashCommandAcceptsArguments(id: SlashCommandId): boolean {
  return id === "effort" || id === "mode" || id === "race" || id === "review";
}

export interface SlashCommand {
  id: SlashCommandId;
  /** 输入 `/` 后匹配的名称，也是菜单里显示的 `/名称`。 */
  name: string;
  description: string;
}

export interface SlashCommandAvailability {
  /** 输入框里有没有可用的模型选择（运行中或配方执行期间不能换模型）。 */
  canChangeModel: boolean;
  /** 当前模型支持调节思考强度，且未在运行或配方执行期间。 */
  canChangeEffort?: boolean;
  /** 当前空闲且未在配方执行期间，可切换 Agent / Plan / Goal。 */
  canChangeMode?: boolean;
  /** 当前对话可生成交接包。 */
  canHandoff?: boolean;
  /** 当前可拉起多模型赛马。 */
  canRace?: boolean;
  /** 当前可发起只读代码审查。 */
  canReview?: boolean;
  /** 对话空闲、模型就绪，且已经有内容可压缩。 */
  canCompact: boolean;
}

/** 按当前状态列出可用的内置命令；`/status` 任何时候都可用。 */
export function slashCommands(availability: SlashCommandAvailability): SlashCommand[] {
  const commands: SlashCommand[] = [];
  if (availability.canChangeModel) {
    commands.push({ id: "model", name: "model", description: tr("切换当前对话使用的模型", "Switch model") });
  }
  if (availability.canChangeEffort) {
    commands.push({ id: "effort", name: "effort", description: tr("设置思考强度", "Set reasoning effort") });
  }
  if (availability.canChangeMode) {
    commands.push({ id: "mode", name: "mode", description: tr("切换 Agent / Plan / Goal 模式", "Switch Agent / Plan / Goal mode") });
  }
  if (availability.canHandoff) {
    commands.push({ id: "handoff", name: "handoff", description: tr("生成交接包，在新对话继续任务", "Generate a handoff pack for a new chat") });
  }
  if (availability.canRace) {
    commands.push({ id: "race", name: "race", description: tr("发起多模型赛马对比", "Start a multi-model race") });
  }
  if (availability.canReview) {
    commands.push({ id: "review", name: "review", description: tr("审查当前改动（只读）", "Review current changes (read-only)") });
  }
  if (availability.canCompact) {
    commands.push({ id: "compact", name: "compact", description: tr("压缩上下文，腾出窗口空间", "Compact the context to free up window space") });
  }
  commands.push({ id: "status", name: "status", description: tr("查看模型、模式和上下文用量", "Show model, mode and context usage") });
  return commands;
}

export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return commands;
  const rank = (command: SlashCommand): number | null => {
    if (command.name.startsWith(needle)) return 0;
    if (command.name.includes(needle)) return 1;
    return command.description.toLocaleLowerCase().includes(needle) ? 2 : null;
  };
  return commands
    .flatMap(command => { const r = rank(command); return r === null ? [] : [{ command, r }]; })
    .sort((a, b) => a.r - b.r)
    .map(entry => entry.command);
}

/** 按输入过滤 `.vela/commands/*.md` 自定义命令：前缀匹配优先，其次同级项目覆盖个人且按字母排序。 */
export function filterCustomCommands(commands: CustomCommand[], query: string): CustomCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  const rank = (command: CustomCommand): number | null => {
    if (!needle) return 0;
    const name = command.name.toLocaleLowerCase();
    if (name.startsWith(needle)) return 0;
    if (name.includes(needle)) return 1;
    const search = `${command.description} ${command.argumentHint ?? ""}`.toLocaleLowerCase();
    return search.includes(needle) ? 2 : null;
  };
  return commands
    .flatMap((command) => {
      const r = rank(command);
      return r === null ? [] : [{ command, r }];
    })
    .sort((a, b) => a.r - b.r || a.command.name.localeCompare(b.command.name))
    .map((entry) => entry.command);
}

const effortAliases: Record<string, ThinkingLevel> = {
  none: "off",
  min: "minimal",
  med: "medium",
  mid: "medium",
};

/** 解析 `/effort <level>` 参数，支持英文档位、常用别名与中文标签。 */
export function parseEffortArg(
  rawArg: string,
  available: readonly ThinkingLevel[],
): { ok: true; level: ThinkingLevel } | { ok: false; error: string } {
  const trimmed = rawArg.trim();
  const needle = trimmed.toLocaleLowerCase();
  let matched: ThinkingLevel | null = null;

  if (needle === "max") {
    if (available.includes("ultra")) matched = "ultra";
    else if (available.includes("xhigh")) matched = "xhigh";
    else if (available.includes("high")) matched = "high";
  }

  const allLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "ultra"];
  if (!matched && allLevels.includes(needle as ThinkingLevel)) {
    matched = needle as ThinkingLevel;
  }
  if (!matched && effortAliases[needle]) {
    matched = effortAliases[needle];
  }
  if (!matched) {
    const byLabel = allLevels.find((level) => thinkingLevelLabel[level].toLocaleLowerCase() === needle);
    if (byLabel) matched = byLabel;
  }

  const choices = available.join(", ");
  if (!matched) {
    return {
      ok: false,
      error: trf("未知的思考强度「{0}」，可用：{1}", "Unknown reasoning effort \"{0}\". Available: {1}", trimmed, choices),
    };
  }
  if (!available.includes(matched)) {
    return {
      ok: false,
      error: trf("当前模型不支持思考强度「{0}」，可用：{1}", "Current model does not support effort \"{0}\". Available: {1}", trimmed, choices),
    };
  }
  return { ok: true, level: matched };
}

/** 解析 `/mode <mode>` 参数：agent / plan / goal。 */
export function parseModeArg(rawArg: string): InteractionMode | null {
  const needle = rawArg.trim().toLocaleLowerCase();
  if (needle === "agent" || needle === "default" || needle === "normal" || needle === "标准" || needle === "执行") {
    return "agent";
  }
  if (needle === "plan" || needle === "planning" || needle === "规划") {
    return "plan";
  }
  if (needle === "goal" || needle === "autonomous" || needle === "auto" || needle === "目标" || needle === "自主") {
    return "goal";
  }
  return null;
}

/** 为 `/review [focus]` 生成只读代码审查 Prompt。 */
export function buildReviewPrompt(rawFocus?: string): string {
  const focus = rawFocus?.trim() ?? "";
  const focusLine = focus
    ? `\n${trf("重点关注范围：{0}", "Focus specifically on: {0}", focus)}`
    : "";
  const header = tr(
    "请对当前工作区代码改动执行只读代码审查（不要修改任何文件）。",
    "Perform a read-only code review of the current workspace changes (do not modify any files).",
  );
  const body = tr(
    "检查步骤：\n1. 先查看 `git status`、未暂存与已暂存的 `git diff`；如果工作区干净，再检查最近一次提交的改动与相关上下文代码。\n2. 优先排查真实缺陷、行为回归、边界条件、并发/安全隐患，以及缺失的关键测试。\n3. 按严重程度从高到低输出具体发现，每条给出 `文件:行号`、问题原因和修复建议；如果没有发现明显问题，请明确说明并列出已核对的范围或潜在风险。",
    "Review steps:\n1. Inspect `git status`, unstaged and staged `git diff`; if the working tree is clean, inspect the most recent commit along with surrounding context.\n2. Prioritize concrete bugs, behavioral regressions, edge cases, security/concurrency issues, and missing test coverage.\n3. Report findings ordered from highest to lowest severity with exact `file:line` references, root cause, and suggested fix; if no issues are found, state that clearly along with what was verified and any residual risks.",
  );
  return `${header}${focusLine}\n\n${body}`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

export interface StatusItem {
  label: string;
  value: string;
}

/** `/status` 卡片里的条目：模型、思考强度、模式、上下文用量、自动压缩点和对话轮数。 */
export function statusItems(input: {
  model: string | null | undefined;
  thinkingLevel: ThinkingLevel;
  mode: InteractionMode;
  usage: ContextUsage | null;
}): StatusItem[] {
  const items: StatusItem[] = [
    { label: tr("模型", "Model"), value: input.model ?? tr("未选择模型", "No model selected") },
    { label: tr("思考强度", "Reasoning"), value: tr(thinkingLevelLabel[input.thinkingLevel], input.thinkingLevel) },
    { label: tr("模式", "Mode"), value: input.mode.charAt(0).toUpperCase() + input.mode.slice(1) },
  ];
  const usage = input.usage;
  if (!usage) return items;
  const percent = usage.contextWindow ? Math.round(usage.percent ?? (usage.tokens / usage.contextWindow) * 100) : null;
  items.push({
    label: tr("上下文", "Context"),
    value: usage.contextWindow ? `${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} (${percent}%)` : formatTokens(usage.tokens),
  });
  if (usage.compactAt) items.push({ label: tr("自动压缩", "Auto-compact"), value: `≈ ${formatTokens(usage.compactAt)}` });
  items.push({ label: tr("对话轮数", "Turns"), value: String(usage.turnCount) });
  return items;
}
