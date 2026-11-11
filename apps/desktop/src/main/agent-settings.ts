import { maxSubagentModels, thinkingLevels, type AgentSettings, type ModelRef, type NewConversationSelection, type ThinkingLevel } from "@vela/shared";

export function parseId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}不正确`);
  const text = value.trim();
  if (!text || text.length > 200) throw new Error(`${label}不正确`);
  return text;
}

export function parseThinkingLevel(value: unknown): ThinkingLevel {
  if (typeof value !== "string" || !(thinkingLevels as readonly string[]).includes(value)) {
    throw new Error("不支持这个思考强度");
  }
  return value as ThinkingLevel;
}

/** 子代理模型池：缺省表示保持原值；给了就必须是不超过上限的 {provider, modelId} 列表。 */
function parseSubagentModels(value: unknown): ModelRef[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxSubagentModels) throw new Error("子代理模型池不正确");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("子代理模型池不正确");
    const record = item as Record<string, unknown>;
    return { provider: parseId(record.provider, "模型"), modelId: parseId(record.modelId, "模型") };
  });
}

export function parseAgentSettings(raw: unknown): AgentSettings {
  if (!raw || typeof raw !== "object") throw new Error("设置不正确");
  const record = raw as Record<string, unknown>;
  const provider = record.provider === null || record.provider === undefined || record.provider === ""
    ? null
    : parseId(record.provider, "模型");
  const modelId = record.modelId === null || record.modelId === undefined || record.modelId === ""
    ? null
    : parseId(record.modelId, "模型");
  if (Boolean(provider) !== Boolean(modelId)) throw new Error("需要同时选择提供方和模型");
  const instructions = typeof record.instructions === "string" ? record.instructions : "";
  if (instructions.length > 4000) throw new Error("额外指令过长");
  const subagentModels = parseSubagentModels(record.subagentModels);
  return {
    provider,
    modelId,
    thinkingLevel: parseThinkingLevel(record.thinkingLevel),
    newConversationSelection: parseNewConversationSelection(record.newConversationSelection),
    instructions,
    ...(subagentModels ? { subagentModels } : {}),
  };
}

function parseNewConversationSelection(value: unknown): NewConversationSelection {
  // 旧版本没有这个字段,按「设置默认」处理。
  if (value === undefined || value === null || value === "") return "default";
  if (value === "default" || value === "lastUsed") return value;
  throw new Error("新对话的默认选择不正确");
}
