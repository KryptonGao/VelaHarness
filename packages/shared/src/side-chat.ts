import type { AppLocale } from "./i18n";
import type { MemoryLoadReport } from "./memory";
import type { ThinkingLevel } from "./index";

/**
 * 侧边聊天：只和模型对话，不提供 Agent 工具，带入全局与当前项目的长期记忆。
 * 历史只保存在界面里，每次请求完整发送；主进程不落盘、不写进任何对话。
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

export interface SideChatApi {
  /** 发送并等待完整回复；过程中的增量经 onEvent 推送。失败时抛出错误。 */
  send(request: SideChatRequest): Promise<SideChatResult>;
  cancel(requestId: string): Promise<void>;
  onEvent(listener: (event: SideChatEvent) => void): () => void;
}
