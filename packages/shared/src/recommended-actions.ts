/** 推荐操作契约：模型在一轮结束时给出 1-3 个后续操作，每个都附带点击后代为发送的完整 prompt。 */

export const recommendedActionsToolName = "recommend_actions";

export const recommendedActionLimits = {
  maxActions: 3, questionLength: 300, labelLength: 40, promptLength: 4_000,
} as const;

export interface RecommendedAction {
  /** 按钮上的短文字。 */
  label: string;
  /** 点击后原样作为用户消息发送给模型。 */
  prompt: string;
}

export interface RecommendedActions {
  /** 卡片上的一句建议，例如「要提交这些改动吗？」。 */
  question: string;
  actions: RecommendedAction[];
}

const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text;

/** 接受对象或 JSON 字符串；缺字段、没有有效操作时返回 null，多余的操作丢弃。 */
export function parseRecommendedActions(raw: unknown): RecommendedActions | null {
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
    catch { return null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.question !== "string" || !input.question.trim() || !Array.isArray(input.actions)) return null;
  const actions: RecommendedAction[] = [];
  for (const value of input.actions) {
    if (actions.length >= recommendedActionLimits.maxActions) break;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (typeof item.label !== "string" || typeof item.prompt !== "string") continue;
    const label = item.label.trim();
    const prompt = item.prompt.trim();
    if (!label || !prompt) continue;
    actions.push({ label: clip(label, recommendedActionLimits.labelLength), prompt: clip(prompt, recommendedActionLimits.promptLength) });
  }
  if (actions.length === 0) return null;
  return { question: clip(input.question.trim(), recommendedActionLimits.questionLength), actions };
}
