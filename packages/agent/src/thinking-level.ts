import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { thinkingLevels, ultraThinkingLevel, type ThinkingLevel } from "@vela/shared";
import { spawnAgentToolName } from "./subagent";

/** 底层模型真正接受的强度；Ultra 只存在于 Vela 这一层。 */
export type ModelThinkingLevel = Exclude<ThinkingLevel, typeof ultraThinkingLevel>;

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (thinkingLevels as readonly string[]).includes(value);
}

export function isUltra(level: string | null | undefined): level is typeof ultraThinkingLevel {
  return level === ultraThinkingLevel;
}

function supportedModelLevels(model: Model<Api>): ModelThinkingLevel[] {
  return getSupportedThinkingLevels(model).filter((level): level is ModelThinkingLevel => isThinkingLevel(level) && !isUltra(level));
}

/** 模型实际支持的最高强度（Ultra 默认使用它）；不支持推理的模型就是 off。 */
export function peakThinkingLevel(model: Model<Api>): ModelThinkingLevel {
  const rank = (level: ThinkingLevel) => thinkingLevels.indexOf(level);
  return supportedModelLevels(model).reduce<ModelThinkingLevel>((peak, level) => (rank(level) > rank(peak) ? level : peak), "off");
}

/** 滑块上的全部档位：模型支持的强度，外加所有模型都有的 Ultra。 */
export function thinkingLevelsFor(model: Model<Api>): ThinkingLevel[] {
  return [...supportedModelLevels(model), ultraThinkingLevel];
}

export function clampThinkingLevelFor(model: Model<Api>, level: ThinkingLevel): ThinkingLevel {
  if (isUltra(level)) return level;
  const clamped = clampThinkingLevel(model, level);
  return isThinkingLevel(clamped) && !isUltra(clamped) ? clamped : "off";
}

/** 交给底层会话的强度：Ultra 换成模型的最高强度，其余原样收敛。 */
export function modelThinkingLevel(model: Model<Api> | undefined, level: ThinkingLevel): ModelThinkingLevel {
  if (!model) return isUltra(level) ? "high" : level;
  return isUltra(level) ? peakThinkingLevel(model) : (clampThinkingLevelFor(model, level) as ModelThinkingLevel);
}

/** Ultra 不改推理预算，只让模型更积极地并行使用 SubAgent。 */
export const ultraInstructions = `Ultra mode is on. The user wants this work finished faster by spending more compute in parallel.
Whenever a task splits into independent pieces (searching or reading across many files or modules, separate implementations, independent checks, reviews, research), delegate them to subagents with ${spawnAgentToolName} and run them concurrently instead of working through them one by one.
Give every subagent a self-contained brief, keep tiny or tightly coupled steps in your own hands, and merge the results yourself. Stay within the subagent limits of this session.`;
