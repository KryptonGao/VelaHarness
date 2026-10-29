import type { ToolTrace } from "@vela/shared";
import type { ToolDisplay, ToolFold } from "../hooks/usePreferences";
import type { UiMessage } from "../hooks/useSession";
import { splitThinkingTitle } from "../thinking-title";

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
  | { kind: "thinking"; id: string; messageId: string; text: string }
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
    if (message.thinking) items.push({ kind: "thinking", id: message.id, messageId: message.id, text: message.thinking });
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
 * 思考、可见正文和交互卡片等不可折叠工具都会打断分组,阈值沿用卡片/紧凑规则。
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

  for (const item of items) {
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
 * 出现正文或下一段思考时分组结束。带正文的后续消息只留下正文,自己不再显示工具;空消息不再显示。
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
      lead = !message.text && splitThinkingTitle(message.thinking, false) ? message : null;
      continue;
    }
    if (!lead) continue;
    followerSet.add(message);
    const list = followersOf.get(lead) ?? [];
    list.push(message);
    followersOf.set(lead, list);
    if (message.text) lead = null;
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
      memberIds: [message.id, ...followers.filter((follower) => !follower.text).map((follower) => follower.id)],
    });
  }
  return units;
}
