import { tr } from "../locale";
import type { UiMessage } from "../hooks/useSession";
import { selectFinalReplies } from "./final-replies";

/** 至少达到这个轮次才在左侧显示轮次导航点。 */
export const TURN_NAV_MIN_TURNS = 4;

/** 指针进入对话区左缘这个宽度内时显示圆点，移出滞回阈值后收起。 */
export const TURN_NAV_REVEAL_PX = 52;
export const TURN_NAV_HIDE_PX = 72;

export function nextTurnNavReveal(currentlyVisible: boolean, offsetX: number): boolean {
  if (!Number.isFinite(offsetX) || offsetX < 0) return false;
  return currentlyVisible ? offsetX <= TURN_NAV_HIDE_PX : offsetX <= TURN_NAV_REVEAL_PX;
}

export interface TurnNavTurnInput {
  id: string;
  user: Pick<UiMessage, "text" | "images" | "timestamp"> | null;
  assistants: readonly UiMessage[];
}

export interface TurnNavItem {
  id: string;
  index: number;
  prompt: string;
  replyPreview: string | null;
  timestamp: number | null;
}

const MAX_PROMPT_CHARS = 220;
const MAX_REPLY_CHARS = 320;

/** 把 Markdown 片段压缩成纯文本单段摘要，避免在悬浮预览卡片里露出 `#`、反引号或 URL 噪点。 */
export function summarizeNavText(raw: string, maxChars: number): string {
  const cleaned = raw
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code: string) => ` ${code.trim()} `)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => alt.trim() || tr("[图片]", "[Image]"))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function buildTurnNavItems(turns: readonly TurnNavTurnInput[]): TurnNavItem[] {
  return turns.map((turn, index) => {
    const rawPrompt = turn.user ? summarizeNavText(turn.user.text, MAX_PROMPT_CHARS) : "";
    const prompt = rawPrompt
      || (turn.user?.images?.length ? tr("[图片]", "[Image]") : tr("助手消息", "Assistant message"));

    const finals = selectFinalReplies(turn.assistants);
    const replySource = finals.length > 0
      ? finals.map((reply) => reply.text.trim()).filter(Boolean).join(" ")
      : ([...turn.assistants].reverse().find((message) => message.text.trim().length > 0)?.text ?? "");
    const replySummary = replySource ? summarizeNavText(replySource, MAX_REPLY_CHARS) : "";
    const replyPreview = replySummary || null;

    const lastAssistant = turn.assistants[turn.assistants.length - 1];
    const finalReply = finals[finals.length - 1];
    const timestamp = turn.user?.timestamp
      ?? finalReply?.timestamp
      ?? lastAssistant?.timestamp
      ?? lastAssistant?.turnCompletedAt
      ?? null;

    return { id: turn.id, index, prompt, replyPreview, timestamp };
  });
}

/**
 * 根据滚动位置与各轮顶部坐标选出当前所在轮次：
 * 贴底时始终高亮最后一轮，贴顶时高亮第一轮，中间按视口上方参考线二分查找。
 */
export function findActiveTurnIndex(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  turnCount: number;
  getTurnTop: (index: number) => number;
  referenceOffset?: number;
}): number {
  const { scrollTop, scrollHeight, clientHeight, turnCount, getTurnTop } = input;
  if (turnCount <= 0) return -1;
  if (turnCount === 1) return 0;
  if (scrollHeight - scrollTop - clientHeight <= 16) return turnCount - 1;
  if (scrollTop <= 8) return 0;

  const offset = input.referenceOffset ?? Math.min(120, Math.max(48, clientHeight * 0.22));
  const threshold = scrollTop + offset;

  let low = 0;
  let high = turnCount - 1;
  let best = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (getTurnTop(mid) <= threshold) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/** 计算悬浮预览卡片相对 `.turn-nav` 的纵向位置，保证卡片对齐悬停点且不越出顶底边界。 */
export function positionTurnNavPopover(input: {
  dotCenterY: number;
  popoverHeight: number;
  railHeight: number;
  minTop?: number;
  maxBottom?: number;
}): { top: number } {
  const minTop = input.minTop ?? 0;
  const maxBottom = input.maxBottom ?? input.railHeight;
  const desired = input.dotCenterY - 28;
  const limit = Math.max(minTop, maxBottom - input.popoverHeight);
  return { top: Math.max(minTop, Math.min(desired, limit)) };
}
