import type { ToolTrace } from "@vela/shared";
import type { ToolDisplay, ToolFold } from "../hooks/usePreferences";
import type { UiMessage } from "../hooks/useSession";
import { splitThinkingTitle } from "../thinking-title";
import { supportsThinkingGroups } from "../thinking-model";

/** 可折叠的工具种类,与 tool-compact 的 toolCompactKind 保持一致。 */
const foldableToolNames = new Set(["bash", "read", "edit", "write"]);

/** 同一段里连续工具达到该数量才折叠成一组。 */
export const RUN_MIN = 3;

/** 卡片模式至少 RUN_MIN 个才折叠;紧凑模式超过 1 个就折叠成摘要;fold 为 none 时从不折叠。 */
export function shouldFoldRun(length: number, display: ToolDisplay, fold: ToolFold = "message"): boolean {
  if (fold === "none") return false;
  return display === "compact" ? length > 1 : length >= RUN_MIN;
}

/** 失败的工具数;思考分组折叠时用它在标题后提示。 */
export function countFailedTools(tools: readonly ToolTrace[]): number {
  return tools.filter((tool) => tool.status === "error").length;
}

/** 按界面顺序拍平后的回合内容,用于跨 Assistant 消息做位置分组。 */
export type ProcessItem =
  | { kind: "thinking"; id: string; messageId: string; text: string; model?: string; modelName?: string }
  | { kind: "text"; id: string; messageId: string; text: string }
  | { kind: "tool"; id: string; messageId: string; tool: ToolTrace };

/** 渲染节点:单个内容,或一段被折叠的工具。 */
export type ProcessNode =
  | { type: "thinking"; id: string; messageId: string; text: string }
  | { type: "text"; id: string; messageId: string; text: string }
  | { type: "tool"; id: string; messageId: string; tool: ToolTrace }
  | { type: "run"; id: string; messageId: string; tools: ToolTrace[] };

/**
 * 子代理运行流的分块:用户消息单独一块;fold 为 position 时相邻助理消息合成一块,
 * 让工具分组可以跨消息合并,其余取值每条助理消息自成一块。
 */
export type AgentStreamBlock = { id: string; role: "user" | "assistant"; messages: UiMessage[] };

export function groupAgentStream(messages: UiMessage[], fold: ToolFold = "message"): AgentStreamBlock[] {
  const blocks: AgentStreamBlock[] = [];
  let run: UiMessage[] = [];
  const flush = () => {
    if (run.length === 0) return;
    blocks.push({ id: run[0]!.id, role: "assistant", messages: run });
    run = [];
  };
  for (const message of messages) {
    if (message.role === "user" || fold !== "position") {
      flush();
      blocks.push({ id: message.id, role: message.role, messages: [message] });
      continue;
    }
    run.push(message);
  }
  flush();
  return blocks;
}

/** 把一轮里的助理消息按界面顺序拍平:思考、工具、正文。 */
export function buildTurnItems(
  messages: UiMessage[],
  options: { includeText?: (message: UiMessage) => boolean } = {},
): ProcessItem[] {
  const items: ProcessItem[] = [];
  for (const message of messages) {
    if (message.thinking) items.push({ kind: "thinking", id: message.id, messageId: message.id, text: message.thinking, ...(message.model ? { model: message.model } : {}), ...(message.modelName ? { modelName: message.modelName } : {}) });
    for (const tool of message.tools) {
      items.push({ kind: "tool", id: tool.id, messageId: message.id, tool });
    }
    if (message.text && (options.includeText?.(message) ?? true)) {
      items.push({ kind: "text", id: `${message.id}:text`, messageId: message.id, text: message.text });
    }
  }
  return items;
}

/**
 * 位置关系分组:相邻的可折叠工具合成一段,中间不看消息边界。
 * 标题思考之后的工具先归入该思考,允许跨过正文;下一段思考结束归属。
 * 其余思考、可见正文和交互卡片等不可折叠工具仍打断工具折叠,阈值沿用卡片/紧凑规则。
 */
export function groupProcessItems(items: ProcessItem[], display: ToolDisplay): ProcessNode[] {
  const nodes: ProcessNode[] = [];
  let run: Extract<ProcessItem, { kind: "tool" }>[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const tools = run.map((item) => item.tool);
    if (shouldFoldRun(tools.length, display)) {
      nodes.push({ type: "run", id: run[0]!.id, messageId: run[0]!.messageId, tools });
    } else {
      for (const item of run) {
        nodes.push({ type: "tool", id: item.id, messageId: item.messageId, tool: item.tool });
      }
    }
    run = [];
  };

  for (const item of attachThinkingItems(items)) {
    if (item.kind === "tool" && foldableToolNames.has(item.tool.name)) {
      run.push(item);
      continue;
    }
    flush();
    if (item.kind === "tool") nodes.push({ type: "tool", id: item.id, messageId: item.messageId, tool: item.tool });
    else nodes.push({ type: item.kind, id: item.id, messageId: item.messageId, text: item.text });
  }
  flush();
  return nodes;
}

/** 连贯模式分组里的一项:一次思考总结,或一次工具调用。 */
export type CoherentEntry = Extract<ProcessNode, { type: "thinking" | "tool" }>;

/** 连贯模式的渲染节点:两段正文之间的所有思考和工具合成一组,正文留在原位。 */
export type CoherentNode =
  | { type: "group"; id: string; messageId: string; entries: CoherentEntry[] }
  | Extract<ProcessNode, { type: "text" }>;

/**
 * 连贯模式分组:正文是唯一的分界。一组从正文之后的第一个思考或工具开始,到下一段正文为止,
 * 组内按到达顺序保留每一次思考总结和工具调用;不依赖思考有没有标题。
 * 组 id 取第一项的 id,新项追加时保持稳定。
 */
export function groupCoherentItems(items: ProcessItem[]): CoherentNode[] {
  const nodes: CoherentNode[] = [];
  let group: Extract<CoherentNode, { type: "group" }> | null = null;
  for (const item of items) {
    if (item.kind === "text") {
      group = null;
      nodes.push({ type: "text", id: item.id, messageId: item.messageId, text: item.text });
      continue;
    }
    if (item.kind === "thinking" && !item.text.trim()) continue;
    if (!group) {
      group = { type: "group", id: item.id, messageId: item.messageId, entries: [] };
      nodes.push(group);
    }
    group.entries.push(item.kind === "thinking"
      ? { type: "thinking", id: item.id, messageId: item.messageId, text: item.text }
      : { type: "tool", id: item.id, messageId: item.messageId, tool: item.tool });
  }
  return nodes;
}

/** 组内最新一段思考的 id;分组进行中只有它默认展开。 */
export function latestThoughtId(entries: readonly CoherentEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.type === "thinking") return entry.id;
  }
  return null;
}

/** 折叠标题里列出的动作,编辑、读取、运行、使用工具,按固定顺序;写入文件算编辑,其余工具统称使用工具。 */
export type CoherentAction = "edit" | "read" | "bash" | "tools";

/** 工具调用不超过这个数的分组不折叠,思考和工具直接平铺在对话里。 */
export const COHERENT_FLAT_MAX = 3;

export function isFlatCoherentGroup(entries: readonly CoherentEntry[]): boolean {
  return entries.filter((entry) => entry.type === "tool").length <= COHERENT_FLAT_MAX;
}

export function coherentActions(entries: readonly CoherentEntry[]): CoherentAction[] {
  const found = new Set<CoherentAction>();
  for (const entry of entries) {
    if (entry.type !== "tool") continue;
    const name = entry.tool.name;
    if (name === "edit" || name === "write") found.add("edit");
    else if (name === "read") found.add("read");
    else if (name === "bash") found.add("bash");
    else found.add("tools");
  }
  return (["edit", "read", "bash", "tools"] as const).filter((action) => found.has(action));
}

/** 工具仍保留原消息 id,以便分组里的运行状态和入场动画能追踪实际来源。 */
function attachThinkingItems(items: ProcessItem[]): ProcessItem[] {
  const output: ProcessItem[] = [];
  let group: ProcessItem[] | null = null;
  let replies: ProcessItem[] = [];
  const flush = () => {
    if (group) output.push(...group, ...replies);
    group = null;
    replies = [];
  };
  for (const item of items) {
    if (item.kind === "thinking") {
      flush();
      if (supportsThinkingGroups(item) && splitThinkingTitle(item.text, false)) {
        group = [item];
        continue;
      }
    }
    if (!group) output.push(item);
    else if (item.kind === "tool") group.push(item);
    else replies.push(item);
  }
  flush();
  return output;
}

/** 渲染用的助理消息:思考分组可能把后续消息的工具并进来,memberIds 是仍处在“分组进行中”的消息 id。 */
export interface AssistantUnit {
  message: UiMessage;
  memberIds: readonly string[];
}

const mergedCache = new WeakMap<UiMessage, { followers: readonly UiMessage[]; merged: UiMessage }>();
const strippedCache = new WeakMap<UiMessage, UiMessage>();

function sameMessages(a: readonly UiMessage[], b: readonly UiMessage[]): boolean {
  return a.length === b.length && a.every((message, index) => message === b[index]);
}

/**
 * 模型每调用一轮工具就是一条新的助理消息,后续几轮常常没有自己的思考。
 * 标题思考(OpenAI CoT 总结)之后、没有思考的助理消息,它们的工具并到这段思考名下;
 * 正文不打断归属,下一段思考或用户消息出现时分组结束。
 * 带正文的后续消息只留下正文,自己不再显示工具;空消息不再显示。
 */
export function attachFollowerTools(messages: readonly UiMessage[]): AssistantUnit[] {
  const followersOf = new Map<UiMessage, UiMessage[]>();
  const followerSet = new Set<UiMessage>();
  let lead: UiMessage | null = null;
  for (const message of messages) {
    if (message.role !== "assistant") {
      lead = null;
      continue;
    }
    if (message.thinking.trim()) {
      lead = supportsThinkingGroups(message) && splitThinkingTitle(message.thinking, false) ? message : null;
      continue;
    }
    if (!lead) continue;
    if (!supportsThinkingGroups(message) || message.model !== lead.model || message.provider !== lead.provider) {
      lead = null;
      continue;
    }
    followerSet.add(message);
    const list = followersOf.get(lead) ?? [];
    list.push(message);
    followersOf.set(lead, list);
  }

  const units: AssistantUnit[] = [];
  for (const message of messages) {
    if (followerSet.has(message)) {
      if (!message.text) continue;
      let stripped = strippedCache.get(message);
      if (!stripped) {
        stripped = { ...message, tools: [] };
        strippedCache.set(message, stripped);
      }
      units.push({ message: stripped, memberIds: [message.id] });
      continue;
    }
    const followers = followersOf.get(message);
    if (!followers) {
      units.push({ message, memberIds: [message.id] });
      continue;
    }
    let cached = mergedCache.get(message);
    if (!cached || !sameMessages(cached.followers, followers)) {
      cached = { followers, merged: { ...message, tools: [...message.tools, ...followers.flatMap((follower) => follower.tools)] } };
      mergedCache.set(message, cached);
    }
    units.push({
      message: cached.merged,
      memberIds: [message.id, ...followers
        .filter((follower) => !follower.text || follower.tools.some((tool) => tool.status === "running"))
        .map((follower) => follower.id)],
    });
  }
  return units;
}
