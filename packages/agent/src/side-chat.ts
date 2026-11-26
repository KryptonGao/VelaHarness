import { type Api, type AssistantMessage, type Message, type Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  isAppLocale,
  isCodexSpeed,
  thinkingLevels,
  memoryLoadReport,
  modelLanguageName,
  type AppLocale,
  type MemorySourceLoad,
  type SideChatMessage,
  type SideChatRequest,
  type SideChatResult,
  type ThinkingLevel,
} from "@vela/shared";
import { memoryContextBlock } from "./memory-context";
import { codexSpeedPayload } from "./codex-speed";
import { openCodeSessionHeaders } from "./provider-headers";
import { modelThinkingLevel } from "./thinking-level";
import { globalPromptSection } from "./system-prompt";

const maxMessages = 400;
const maxMessageChars = 100_000;
/** 每次请求最多带上的历史字符数；超出时从最早的消息开始丢弃，最后一条用户消息始终保留。 */
const maxHistoryChars = 200_000;
const maxRequestIdLength = 100;

export function parseSideChatRequest(raw: unknown): SideChatRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("侧边聊天请求不正确");
  const input = raw as Record<string, unknown>;
  if (typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > maxRequestIdLength) {
    throw new Error("侧边聊天请求不正确");
  }
  if (input.conversationId !== null && (typeof input.conversationId !== "string" ||
    !/^[0-9a-f-]{8,64}$/i.test(input.conversationId))) {
    throw new Error("侧边聊天请求不正确");
  }
  if (!isAppLocale(input.locale)) throw new Error("侧边聊天请求不正确");
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > maxMessages) {
    throw new Error("侧边聊天消息不正确");
  }
  const messages = input.messages.map((item): SideChatMessage => {
    if (!item || typeof item !== "object") throw new Error("侧边聊天消息不正确");
    const message = item as Record<string, unknown>;
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string" ||
      message.text.length > maxMessageChars) {
      throw new Error("侧边聊天消息不正确");
    }
    return { role: message.role, text: message.text };
  });
  const last = messages[messages.length - 1]!;
  if (last.role !== "user" || !last.text.trim()) throw new Error("侧边聊天消息不正确");
  let model: SideChatRequest["model"];
  if (input.model !== undefined) {
    const selection = input.model as Record<string, unknown> | null;
    if (!selection || typeof selection !== "object" || Array.isArray(selection) ||
      typeof selection.provider !== "string" || !selection.provider.trim() || selection.provider.length > 200 ||
      typeof selection.id !== "string" || !selection.id.trim() || selection.id.length > 500) {
      throw new Error("侧边聊天模型不正确");
    }
    model = { provider: selection.provider, id: selection.id };
  }
  let thinkingLevel: ThinkingLevel | undefined;
  if (input.thinkingLevel !== undefined) {
    if (!(thinkingLevels as readonly unknown[]).includes(input.thinkingLevel)) throw new Error("侧边聊天推理强度不正确");
    thinkingLevel = input.thinkingLevel as ThinkingLevel;
  }
  if (input.codexSpeed !== undefined && !isCodexSpeed(input.codexSpeed)) throw new Error("当前模型不支持此速度");
  return {
    ...(input.codexSpeed && { codexSpeed: input.codexSpeed }),
    requestId: input.requestId,
    conversationId: input.conversationId as string | null,
    locale: input.locale,
    messages,
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}

/** 侧边聊天的系统提示：说明没有工具、回复语言，并在末尾附上记忆。 */
export function sideChatSystemPrompt(locale: AppLocale, memory: readonly MemorySourceLoad[], globalPrompt?: string): string {
  const lines = [
    "You are Vela, chatting with the user in a side chat next to their main coding session.",
    "This side chat has no tools: you cannot read or edit files, run commands, browse the web, or see the main conversation. Answer from your own knowledge and what the user writes here.",
    "When a request needs those abilities, say so briefly and suggest asking in the main chat. Never pretend to have run a command or read a file.",
    "You cannot save memories here. If the user asks you to remember something, tell them to ask in the main chat or edit it in Settings → Memory.",
    `Reply in the language the user writes in; when unclear, use ${modelLanguageName(locale)}. Use Markdown when it helps; keep answers focused.`,
  ];
  return [lines.join("\n"), globalPromptSection(globalPrompt), memoryContextBlock(memory)].filter(Boolean).join("\n\n");
}

/** 从最新往回取，直到字符预算用完；最后一条用户消息始终保留，开头的助手消息丢掉。 */
export function sideChatHistory(messages: readonly SideChatMessage[]): SideChatMessage[] {
  const kept: SideChatMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (!message.text.trim()) continue;
    if (kept.length > 0 && used + message.text.length > maxHistoryChars) break;
    kept.unshift(message);
    used += message.text.length;
  }
  while (kept.length > 1 && kept[0]!.role === "assistant") kept.shift();
  return kept;
}

function toModelMessages(model: Model<Api>, messages: readonly SideChatMessage[]): Message[] {
  const timestamp = Date.now();
  return messages.map((message): Message => message.role === "user"
    ? { role: "user", content: message.text, timestamp }
    : {
      role: "assistant",
      content: [{ type: "text", text: message.text }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp,
    });
}

function textOf(message: AssistantMessage): string {
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
}

export interface SideChatRunInput {
  runtime: Pick<ModelRuntime, "streamSimple">;
  model: Model<Api>;
  request: SideChatRequest;
  memory: readonly MemorySourceLoad[];
  memoryEnabled: boolean;
  globalPrompt?: string;
  onDelta: (text: string) => void;
}

type SideChatContext = Omit<SideChatRunInput, "request">;

/** 每个请求一次流式调用；不落盘、不缓存，可按 requestId 中途停止。 */
export class SideChatService {
  private readonly controllers = new Map<string, AbortController>();

  hasRunningWork(): boolean { return this.controllers.size > 0; }

  run(input: SideChatRunInput): Promise<SideChatResult> {
    return this.runPrepared(input.request, () => input);
  }

  /** Account for the whole request, including model selection and loading workspace memory before streaming. */
  async runPrepared(request: SideChatRequest, prepare: () => SideChatContext | Promise<SideChatContext>): Promise<SideChatResult> {
    if (this.controllers.has(request.requestId)) throw new Error("侧边聊天请求不正确");
    const controller = new AbortController();
    this.controllers.set(request.requestId, controller);
    try {
      const context = await prepare();
      return await this.stream({ ...context, request }, controller.signal);
    } finally {
      this.controllers.delete(request.requestId);
    }
  }

  private async stream({ runtime, model, request, memory, memoryEnabled, globalPrompt, onDelta }: SideChatRunInput, signal: AbortSignal): Promise<SideChatResult> {
    // 侧边聊天没有 SubAgent，Ultra 等同于模型的最高强度。
    const thinkingLevel = modelThinkingLevel(model, request.thinkingLevel ?? "off");
    const result = (text: string, aborted: boolean): SideChatResult => ({
      requestId: request.requestId,
      text,
      model: `${model.provider}/${model.id}`,
      thinkingLevel,
      memory: memory.map(memoryLoadReport),
      memoryEnabled,
      aborted,
    });
    if (signal.aborted) return result("", true);
    let text = "";
    try {
      const stream = runtime.streamSimple(model, {
        systemPrompt: sideChatSystemPrompt(request.locale, memory, globalPrompt),
        messages: toModelMessages(model, sideChatHistory(request.messages)),
      }, {
        ...(request.codexSpeed && { onPayload: (body: unknown) => codexSpeedPayload(body, model, request.codexSpeed) }),
        signal,
        ...(thinkingLevel !== "off" ? { reasoning: thinkingLevel } : {}),
        sessionId: request.requestId,
        headers: openCodeSessionHeaders(model, request.requestId),
      });
      for await (const event of stream) {
        if (event.type === "text_delta") {
          text += event.delta;
          onDelta(event.delta);
        } else if (event.type === "done") {
          return result(textOf(event.message) || text, false);
        } else if (event.type === "error") {
          if (signal.aborted) return result(text, true);
          throw new Error(event.error.errorMessage || "侧边聊天回复失败");
        }
      }
      return result(text, signal.aborted);
    } catch (error) {
      if (signal.aborted) return result(text, true);
      throw error;
    }
  }

  cancel(requestId: string): void {
    this.controllers.get(requestId)?.abort();
  }

  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
