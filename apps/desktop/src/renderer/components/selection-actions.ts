import { createContext } from "react";

/** 选中文字后「开启侧边聊天」：由 App 提供，打开一个侧边聊天标签，带上引用和已经写好的问题。 */
export const SideChatLauncherContext = createContext<((quote: string, draft?: string) => void) | null>(null);

/** 引用文字的上限，避免整页选中把输入框撑爆。 */
const maxQuoteLength = 4_000;

/** 把选中的文字整理成引用：去掉首尾空白，过长时截断。 */
export function normalizeQuote(text: string): string {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  return trimmed.length > maxQuoteLength ? `${trimmed.slice(0, maxQuoteLength).trimEnd()}…` : trimmed;
}

/** Markdown 引用块，空行也保留 `>`，这样整段仍是同一个引用。 */
export function quoteBlock(text: string): string {
  return normalizeQuote(text).split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
}

/** 回复时发给模型的消息：引用块在前，用户补充的话在后。 */
export function composeReply(quote: string | null, text: string): string {
  return quote ? `${quoteBlock(quote)}\n\n${text}` : text;
}

/** 选区浮层里写好的回复：选中的文字和回复内容是一体的，在输入框上方显示成一张卡片。 */
export interface ReplyDraft {
  /** 选中的原文，发送时作为引用块。 */
  quote: string;
  /** 回复内容；为空时卡片显示原文，回复在输入框里写。 */
  text: string;
}

/** 卡片上显示的文字：写了回复就显示回复，否则显示被引用的原文。 */
export function replyCardText(reply: ReplyDraft): string {
  return reply.text.trim() || reply.quote;
}

/** 一张回复卡片带上它的编号，方便单独移除。 */
export type ReplyCard = ReplyDraft & { id: string };

/** 发出的消息正文：每张卡片是「引用原文 + 回复内容」一组，按顺序排列，输入框里补充的话在最后。 */
export function replyMessage(replies: readonly ReplyDraft[], typed: string): string {
  const groups = replies.map((reply) => composeReply(reply.quote, reply.text.trim()).trim());
  return [...groups, typed.trim()].filter(Boolean).join("\n\n");
}

/** 有任何一张卡片写了回复，输入框就可以留空直接发送。 */
export function hasReplyText(replies: readonly ReplyDraft[]): boolean {
  return replies.some((reply) => reply.text.trim());
}

/** 送进侧边聊天的一条：选中的原文，以及在浮层里已经写好的问题。 */
export interface SideChatInboxItem {
  id: string;
  quote: string;
  draft?: string;
}

/** 侧边聊天消息：引用块在前（多张按顺序），问题在后。 */
export function composeQuotes(quotes: readonly string[], text: string): string {
  return [...quotes.map(quoteBlock), text].filter(Boolean).join("\n\n");
}
