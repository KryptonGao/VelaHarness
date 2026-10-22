import { thinkingLevels, type MemoryLoadReport, type ModelCatalog, type SideChatMessage, type ThinkingLevel } from "@vela/shared";
import { tr } from "../locale";
import { uiStorage } from "../ui-storage";

/** 侧边聊天自己的模型与推理强度，与主对话互不影响。 */
export interface SideChatModelChoice {
  provider: string;
  id: string;
  thinkingLevel: ThinkingLevel;
}

const choiceKey = "vela.sideChat.model";

/** 新开侧边聊天时沿用上一次的选择；没有时用当前主对话的模型。 */
export function readSideChatChoice(fallback: SideChatModelChoice | null): SideChatModelChoice | null {
  try {
    const raw = uiStorage.getItem(choiceKey);
    const parsed = raw ? JSON.parse(raw) as Partial<SideChatModelChoice> : null;
    if (parsed && typeof parsed.provider === "string" && typeof parsed.id === "string" &&
      (thinkingLevels as readonly unknown[]).includes(parsed.thinkingLevel)) {
      return { provider: parsed.provider, id: parsed.id, thinkingLevel: parsed.thinkingLevel as ThinkingLevel };
    }
  } catch {
    // 读不到时用主对话的模型。
  }
  return fallback;
}

export function writeSideChatChoice(choice: SideChatModelChoice): void {
  try {
    uiStorage.setItem(choiceKey, JSON.stringify(choice));
  } catch {
    // 只影响下次新开时的默认值。
  }
}

/** 所选模型在目录里的名字和可选推理强度；模型已移除时只能选「关闭」。 */
export function sideChatModelInfo(catalog: ModelCatalog | null, choice: SideChatModelChoice | null): {
  label: string | null;
  levels: ThinkingLevel[];
  level: ThinkingLevel;
} {
  const model = choice ? catalog?.models.find((item) => item.provider === choice.provider && item.id === choice.id) : undefined;
  const levels: ThinkingLevel[] = model?.thinkingLevels.length ? model.thinkingLevels : ["off"];
  const wanted = choice?.thinkingLevel ?? "off";
  // 新模型不支持原来的强度时取不超过它的最高一档。
  const rank = (level: ThinkingLevel) => thinkingLevels.indexOf(level);
  const level = levels.includes(wanted) ? wanted
    : [...levels].reverse().find((candidate) => rank(candidate) <= rank(wanted)) ?? levels[0]!;
  return { label: model?.name ?? (choice ? `${choice.provider}/${choice.id}` : null), levels, level };
}

export interface SideChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 正在流式接收。 */
  pending?: boolean;
  /** 用户停止或出错时中断，text 是已收到的部分。 */
  stopped?: boolean;
}

/** 发给模型的历史：只要有文字的消息，丢掉还没开始的占位回复。 */
export function sideChatRequestMessages(entries: readonly SideChatEntry[]): SideChatMessage[] {
  return entries.filter((entry) => entry.text.trim()).map((entry) => ({ role: entry.role, text: entry.text }));
}

/** 重试时回到最后一条用户消息为止，后面中断的回复丢掉。没有用户消息时返回 null。 */
export function sideChatRetryHistory(entries: readonly SideChatEntry[]): SideChatEntry[] | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]!.role === "user") return entries.slice(0, index + 1);
  }
  return null;
}

/** 记忆状态的简短说明；还没发过消息时传 null。 */
export function sideChatMemoryLabel(context: { memory: readonly MemoryLoadReport[]; memoryEnabled: boolean } | null): string {
  if (!context) return tr("带入长期记忆", "Uses long-term memory");
  if (!context.memoryEnabled) return tr("记忆已关闭", "Memory is off");
  const memory = context.memory;
  const loaded = memory.filter((item) => item.status === "loaded" && item.bytes > 0);
  if (loaded.length === 0) return tr("没有可带入的记忆", "No memory to include");
  const scopes = new Set(loaded.map((item) => item.scope));
  if (scopes.has("global") && scopes.has("project")) return tr("已带入全局与项目记忆", "Global and project memory included");
  return scopes.has("project") ? tr("已带入项目记忆", "Project memory included") : tr("已带入全局记忆", "Global memory included");
}
