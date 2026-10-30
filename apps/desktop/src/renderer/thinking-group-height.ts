/** 思考分组(OpenAI CoT 总结)展开区的高度上限设置;滑块档位和默认值。 */
export const thinkingGroupHeightStops = [160, 200, 240, 280, 320, 360, 400, 480, 560, 640] as const;
export const toolDetailHeightStops = [120, 160, 200, 240, 280, 320, 400] as const;
export const defaultThinkingGroupHeight = 280;
export const defaultToolDetailHeight = 200;

/** 展开详情时保留两项上限之差;不缩小原分组,也不突破分组上限。多个详情取最高的一项。 */
export function expandedThinkingGroupHeight(
  baseHeight: number,
  detailHeights: readonly number[],
  groupLimit: number,
  detailLimit: number,
): number {
  const detailHeight = Math.min(detailLimit, Math.max(0, ...detailHeights));
  const gap = Math.max(0, groupLimit - detailLimit);
  return Math.min(groupLimit, Math.max(baseHeight, detailHeights.length ? detailHeight + gap : 0));
}

/** 输入框允许的范围,取自对应档位的两端。 */
export function heightRange(stops: readonly number[]): { min: number; max: number } {
  return { min: stops[0]!, max: stops[stops.length - 1]! };
}

export function clampHeight(stops: readonly number[], value: number): number {
  const { min, max } = heightRange(stops);
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 当前高度对应的滑块位置:最近的档位。 */
export function heightStopIndex(stops: readonly number[], value: number): number {
  let best = 0;
  for (let index = 1; index < stops.length; index += 1) {
    if (Math.abs(stops[index]! - value) < Math.abs(stops[best]! - value)) best = index;
  }
  return best;
}
