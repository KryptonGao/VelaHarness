/**
 * 单个对话的上下文长度上限。
 * 上限小于模型窗口时，会话按上限计算占用比例并提前触发自动压缩；null 表示沿用模型自带的窗口。
 */

export const contextLimitBounds = {
  /** 系统提示与工具声明本身就要占用一部分，再小的上限留不出对话空间。 */
  minTokens: 32_000,
  maxTokens: 10_000_000,
} as const;

/** 压缩前为回复预留的空间,以及压缩后保留的最近内容,占上限的比例。 */
const reserveRatio = 0.25;
const keepRecentRatio = 0.4;

export interface ContextLimitSettings {
  /** 单个对话的上下文上限(token);null 表示不限制。 */
  limitTokens: number | null;
}

/** 一个对话的上下文上限:全局默认、本对话自定义(没有则沿用全局)和实际生效的设置。 */
export interface ConversationContextLimit {
  global: ContextLimitSettings;
  override: ContextLimitSettings | null;
  effective: ContextLimitSettings;
}

export const defaultContextLimitSettings: Readonly<ContextLimitSettings> = Object.freeze({ limitTokens: null });

/** 解析并校验设置;非法输入抛错,不静默改写。 */
export function parseContextLimitSettings(raw: unknown): ContextLimitSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("上下文长度限制设置不正确");
  const value = (raw as Record<string, unknown>).limitTokens;
  if (value === null) return { limitTokens: null };
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("上下文长度限制必须是数字");
  const rounded = Math.round(value);
  if (rounded < contextLimitBounds.minTokens || rounded > contextLimitBounds.maxTokens) {
    throw new Error("上下文长度限制超出范围");
  }
  return { limitTokens: rounded };
}

/** 读取磁盘上的设置:损坏或越界时回到不限制。 */
export function readContextLimitSettings(raw: unknown): ContextLimitSettings {
  try {
    return parseContextLimitSettings(raw);
  } catch {
    return { ...defaultContextLimitSettings };
  }
}

/** 模型窗口与上限取较小者;窗口未知(<=0)时保持原样。 */
export function effectiveContextWindow(modelWindow: number, limitTokens: number | null): number {
  if (limitTokens === null || modelWindow <= 0) return modelWindow;
  return Math.min(modelWindow, limitTokens);
}

/**
 * 按有效窗口缩放压缩参数,避免预留空间比窗口还大导致每轮都压缩。
 * 窗口没有被收窄时返回 null,沿用 Pi 的默认值。
 */
export function compactionTokensForLimit(
  modelWindow: number,
  limitTokens: number | null,
  defaults: { reserveTokens: number; keepRecentTokens: number },
): { reserveTokens: number; keepRecentTokens: number } | null {
  if (limitTokens === null || modelWindow <= 0 || limitTokens >= modelWindow) return null;
  return {
    reserveTokens: Math.min(defaults.reserveTokens, Math.floor(limitTokens * reserveRatio)),
    keepRecentTokens: Math.min(defaults.keepRecentTokens, Math.floor(limitTokens * keepRecentRatio)),
  };
}
