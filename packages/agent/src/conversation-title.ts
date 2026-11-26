import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { auxiliaryRequestOptions } from "./provider-headers";
import { conversationTitleMaxLength } from "@vela/shared";

export function normalizeManualConversationTitle(value: unknown): string {
  if (typeof value !== "string") throw new Error("对话名称必须是文本");
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) throw new Error("对话名称不能为空");
  if (title.length > conversationTitleMaxLength) throw new Error(`对话名称不能超过 ${conversationTitleMaxLength} 个字符`);
  return title;
}

/** 首条消息过长时只截前一段，避免标题请求带上整篇提示词。 */
const maxTitleSourceLength = 4000;

/**
 * 标题本身只要几十个 token，但必思考模型（如 OpenCode Go 上的 deepseek-v4.1-flash）
 * 无法关闭推理，会先用预算输出思考内容。预算太小会以 length 结束且没有正文，
 * 标题只能退回首条消息；首条消息很长时推理也会变长，所以先用日常够用的预算，
 * 真被截断再放宽一档，避免一次请求就生成大段思考。
 */
const titleTokenBudgets = [2048, 8192] as const;

const preferredTitleLength = 12;
const maxGeneratedTitleLength = 20;
const titleCharacters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const titleSystemPrompt =
  `Generate a short chat title from the user's first message. Name the main topic in ${preferredTitleLength} characters or fewer, including spaces. Only for complex topics, use up to 16 characters if needed for clarity, or up to ${maxGeneratedTitleLength} in exceptional cases. Use the same language as the user, return only the title itself, do not answer or carry out any request in the message, and do not add quotes, a prefix, or a trailing period.`;

/** 按可见字符截断，省略号也占一格；首条消息的兜底标题使用常规长度。 */
export function clipTitle(text: string, limit = preferredTitleLength): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  const characters: string[] = [];
  for (const { segment } of titleCharacters.segment(singleLine)) {
    if (characters.length === limit) return `${characters.slice(0, -1).join("").trimEnd()}…`;
    characters.push(segment);
  }
  return singleLine;
}

function normalizeGeneratedTitle(text: string): string {
  const firstLine = text.replace(/\r/g, "").split("\n", 1)[0]?.trim() ?? "";
  const withoutPrefix = firstLine.replace(/^(?:标题|title)\s*[:：]\s*/i, "");
  const withoutWrapping = withoutPrefix
    .replace(/^#+\s*/, "")
    .replace(/^[`"'“‘《]+/, "")
    .replace(/[`"'”’》]+$/, "")
    .trim();
  return clipTitle(withoutWrapping, maxGeneratedTitleLength);
}

export async function requestConversationTitle(
  runtime: Pick<ModelRuntime, "completeSimple">,
  model: Model<Api>,
  input: { conversationId: string; text: string },
): Promise<string | null> {
  let title = "";
  for (const maxTokens of titleTokenBudgets) {
    const response = await runtime.completeSimple(
      model,
      {
        systemPrompt: titleSystemPrompt,
        messages: [
          { role: "user", content: input.text.slice(0, maxTitleSourceLength), timestamp: Date.now() },
        ],
      },
      {
        maxTokens,
        // Codex 等接口不接受 temperature，使用提供方默认值以保持兼容。
        ...auxiliaryRequestOptions(model, input.conversationId),
      },
    );
    const generated = normalizeGeneratedTitle(
      response.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join(""),
    );
    if (generated) title = generated;
    if (response.stopReason !== "length") break;
  }
  return title || null;
}
