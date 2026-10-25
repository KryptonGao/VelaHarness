import type { AppLocale } from "./i18n";
import type { MemoryLoadReport } from "./memory";
import type { ThinkingLevel } from "./index";

/**
 * 侧边聊天：只和模型对话，不提供 Agent 工具，带入全局与当前项目的长期记忆。
 * 历史按项目保存在资料目录（`side-chats/`），同一项目的所有对话共用；
 * 每次请求仍完整发送，不写进任何对话，也不计入轨迹和用量。
 */
export interface SideChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface SideChatRequest {
  /** 界面生成的请求 ID，用于流式事件归属和中途停止。 */
  requestId: string;
  /**
   * 决定带入哪个项目的记忆、默认用哪个模型：取这个对话的工作区和当前模型。
   * 为 null 时只带全局记忆，模型用设置里的默认模型。
   */
  conversationId: string | null;
  locale: AppLocale;
  /** 最后一条必须是用户消息。 */
  messages: SideChatMessage[];
  /** 不指定时跟随 conversationId 对应对话的当前模型。 */
  model?: { provider: string; id: string };
  /** 推理强度；不指定或为 off 时不开启推理。超出模型支持范围时就近调整。 */
  thinkingLevel?: ThinkingLevel;
}

export interface SideChatResult {
  requestId: string;
  text: string;
  /** 本次实际使用的模型，形如 provider/id。 */
  model: string;
  /** 本次实际使用的推理强度（已按模型支持范围调整）。 */
  thinkingLevel: ThinkingLevel;
  /** 本次带入的记忆来源，只含元数据；记忆关闭时为空。 */
  memory: MemoryLoadReport[];
  /** 设置里的「启用记忆」开关。 */
  memoryEnabled: boolean;
  /** 用户中途停止时为 true，text 是停止前已收到的部分。 */
  aborted: boolean;
}

export type SideChatEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "memory"; memory: MemoryLoadReport[]; memoryEnabled: boolean; model: string };

/** 落盘的一条侧边聊天消息；流式中的占位回复不保存。 */
export interface SideChatStoredEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 用户消息附带的引用文字。 */
  quotes?: string[];
  /** 回复被用户停止或出错中断。 */
  stopped?: boolean;
}

/** 一个项目下的一段侧边聊天；同一项目的所有对话共用。 */
export interface SideChatThread {
  id: string;
  /** 标签编号，第二个起显示在标签名里。 */
  number: number;
  updatedAt: number;
  entries: SideChatStoredEntry[];
}

export interface SideChatApi {
  /** 发送并等待完整回复；过程中的增量经 onEvent 推送。失败时抛出错误。 */
  send(request: SideChatRequest): Promise<SideChatResult>;
  cancel(requestId: string): Promise<void>;
  onEvent(listener: (event: SideChatEvent) => void): () => void;
  /**
   * 项目下已保存的侧边聊天，按最近更新在前。workspace 为项目目录，
   * 没有项目（空字符串）的对话共用一份。
   */
  listThreads(workspace: string): Promise<SideChatThread[]>;
  /** 保存一段侧边聊天；没有消息时等同于删除。 */
  saveThread(workspace: string, thread: SideChatThread): Promise<void>;
  removeThread(workspace: string, threadId: string): Promise<void>;
}
