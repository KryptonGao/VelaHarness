/** 滑块的档位；最右一格是「不限」。输入框仍可填档位之外的精确值。 */
export const taskBudgetMinuteStops = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440] as const;
export const taskBudgetTokenStops = [
  100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000,
  200_000_000, 500_000_000, 1_000_000_000, 2_000_000_000, 5_000_000_000, 10_000_000_000,
] as const;

/** 输入框里的文本转成上限：空表示不限；不是数字时返回 undefined 交给校验报错。 */
export function readLimit(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** 当前值对应的滑块位置：最近的档位；空（不限）在最右。 */
export function sliderIndex(stops: readonly number[], text: string): number {
  const value = readLimit(text);
  if (value === null || value === undefined) return stops.length;
  let best = 0;
  for (let index = 1; index < stops.length; index += 1) {
    if (Math.abs(Math.log(stops[index]!) - Math.log(value)) < Math.abs(Math.log(stops[best]!) - Math.log(value))) best = index;
  }
  return best;
}

export function stopText(stops: readonly number[], index: number): string {
  return index >= stops.length ? "" : String(stops[index]);
}
