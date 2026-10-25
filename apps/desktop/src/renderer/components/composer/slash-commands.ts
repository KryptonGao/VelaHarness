import { thinkingLevelLabel, type ContextUsage, type InteractionMode, type ThinkingLevel } from "@vela/shared";
import { tr } from "../../locale";

/** 斜线菜单里的内置命令：直接执行动作，不会写进消息。 */
export type SlashCommandId = "model" | "compact" | "status";

export interface SlashCommand {
  id: SlashCommandId;
  /** 输入 `/` 后匹配的名称，也是菜单里显示的 `/名称`。 */
  name: string;
  description: string;
}

export interface SlashCommandAvailability {
  /** 输入框里有没有可用的模型选择（运行中或配方执行期间不能换模型）。 */
  canChangeModel: boolean;
  /** 对话空闲、模型就绪，且已经有内容可压缩。 */
  canCompact: boolean;
}

/** 按当前状态列出可用的内置命令；`/status` 任何时候都可用。 */
export function slashCommands(availability: SlashCommandAvailability): SlashCommand[] {
  const commands: SlashCommand[] = [];
  if (availability.canChangeModel) {
    commands.push({ id: "model", name: "model", description: tr("切换模型或思考强度", "Switch model or reasoning effort") });
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
