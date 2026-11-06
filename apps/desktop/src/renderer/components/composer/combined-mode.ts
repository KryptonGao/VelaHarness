import type { InteractionMode, SandboxMode } from "@vela/shared";

/**
 * 「对话模式」（agent / plan / goal）和「执行权限」（ask / smart / full）合并后的单一选项。
 * 底层仍是两个独立的状态：选择 Plan / Goal 只切换对话模式，执行权限保持不变；
 * 其余三项把对话模式设为 agent，同时设置对应的执行权限。
 */
export type CombinedModeId = "auto" | "manual" | "plan" | "goal" | "full";

export interface CombinedModeOption {
  id: CombinedModeId;
  interaction: InteractionMode;
  /** 选择该项时要设置的执行权限；缺省表示保持当前权限。 */
  sandbox?: SandboxMode;
  badge?: "recommended";
}

export const combinedModeOptions: readonly CombinedModeOption[] = [
  // 先是三档执行权限（菜单里是带说明的整行），再是 Plan / Goal（紧凑的单行）。
  { id: "auto", interaction: "agent", sandbox: "smart", badge: "recommended" },
  { id: "manual", interaction: "agent", sandbox: "ask" },
  { id: "full", interaction: "agent", sandbox: "full" },
  { id: "plan", interaction: "plan" },
  { id: "goal", interaction: "goal" },
];

export function combinedModeOption(id: CombinedModeId): CombinedModeOption {
  return combinedModeOptions.find((option) => option.id === id) ?? combinedModeOptions[0]!;
}

export function currentCombinedMode(interaction: InteractionMode, sandbox: SandboxMode): CombinedModeId {
  if (interaction === "plan") return "plan";
  if (interaction === "goal") return "goal";
  if (sandbox === "smart") return "auto";
  if (sandbox === "full") return "full";
  return "manual";
}

export interface CombinedModeChange {
  interaction: InteractionMode | null;
  sandbox: SandboxMode | null;
}

/** 选择某一项需要改动的状态；已经是目标值的一侧返回 null，避免多余的写入。 */
export function combinedModeChange(
  id: CombinedModeId,
  current: { interaction: InteractionMode; sandbox: SandboxMode },
  options: { sandboxLocked?: boolean } = {},
): CombinedModeChange {
  const option = combinedModeOption(id);
  const sandbox = option.sandbox && !options.sandboxLocked && option.sandbox !== current.sandbox ? option.sandbox : null;
  const interaction = option.interaction !== current.interaction ? option.interaction : null;
  return { interaction, sandbox };
}
