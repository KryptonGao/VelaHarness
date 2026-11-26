import { thinkingLevels, type ModelRef, type SubagentKind, type ThinkingLevel } from "./index";

export interface CustomSubagentProfile {
  id: string;
  name: string;
  /** Stable seed for the same DiceBear avatars used by spawned agents. */
  icon: string;
  description: string;
  permission: SubagentKind;
  systemPrompt: string;
  /** Omitted when the parent can use the standard subagent model selection. */
  model?: ModelRef & { thinkingLevel: ThinkingLevel };
}

export type CustomSubagentIdentity = Pick<CustomSubagentProfile, "name" | "icon">;

export const customSubagentLimits = { count: 32, name: 80, icon: 200, description: 500, systemPrompt: 16_000 } as const;

function singleLine(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= limit && !/[\p{Cc}\u2028\u2029]/u.test(text) ? text : undefined;
}

export function parseCustomSubagentIdentity(value: unknown): CustomSubagentIdentity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = singleLine(record.name, customSubagentLimits.name);
  const icon = singleLine(record.icon, customSubagentLimits.icon);
  return name && icon ? { name, icon } : undefined;
}

function profileText(value: unknown, limit: number): string {
  if (typeof value !== "string") throw new Error("自定义子代理配置不正确");
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > limit) throw new Error("自定义子代理配置不正确");
  return text;
}

export function parseCustomSubagentProfile(value: unknown): CustomSubagentProfile {
  const identity = parseCustomSubagentIdentity(value);
  if (!identity) throw new Error("自定义子代理配置不正确");
  if (["root", "general", "explore"].includes(identity.name.toLowerCase())) {
    throw new Error("自定义子代理名称重复或已被占用");
  }
  const record = value as Record<string, unknown>;
  const id = singleLine(record.id, 200);
  if (!id || (record.permission !== "general" && record.permission !== "explore")) {
    throw new Error("自定义子代理配置不正确");
  }
  const profile: CustomSubagentProfile = {
    id, ...identity, permission: record.permission,
    description: profileText(record.description, customSubagentLimits.description),
    systemPrompt: profileText(record.systemPrompt, customSubagentLimits.systemPrompt),
  };
  if (record.model !== undefined) {
    if (!record.model || typeof record.model !== "object") throw new Error("自定义子代理配置不正确");
    const fixed = record.model as Record<string, unknown>;
    const provider = singleLine(fixed.provider, 200);
    const modelId = singleLine(fixed.modelId, 200);
    if (!provider || !modelId) throw new Error("自定义子代理配置不正确");
    if (!thinkingLevels.includes(fixed.thinkingLevel as ThinkingLevel)) throw new Error("不支持这个思考强度");
    profile.model = { provider, modelId, thinkingLevel: fixed.thinkingLevel as ThinkingLevel };
  }
  return profile;
}

/** On disk, discard damaged entries independently and keep all other valid settings. */
export function parseCustomSubagents(value: unknown, strict = true): CustomSubagentProfile[] {
  if (!Array.isArray(value)) {
    if (strict) throw new Error("自定义子代理配置不正确");
    return [];
  }
  if (strict && value.length > customSubagentLimits.count) throw new Error("自定义子代理配置不正确");
  const profiles: CustomSubagentProfile[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of value) {
    try {
      const profile = parseCustomSubagentProfile(item);
      const name = profile.name.toLowerCase();
      if (ids.has(profile.id) || names.has(name)) throw new Error("自定义子代理名称重复或已被占用");
      ids.add(profile.id);
      names.add(name);
      profiles.push(profile);
      if (profiles.length === customSubagentLimits.count) break;
    } catch (error) {
      if (strict) throw error;
    }
  }
  return profiles;
}
