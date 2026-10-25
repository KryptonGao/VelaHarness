import { useSyncExternalStore } from "react";
import { parseModelPrices, serializeModelPrices, type ModelPrice } from "@vela/shared";
import { uiStorage } from "./ui-storage";
import { createLogger } from "./logger";

const log = createLogger("model-prices");

export const modelPricesStorageKey = "vela.modelPrices";

const noPrices: readonly ModelPrice[] = Object.freeze([]);
let current: readonly ModelPrice[] | null = null;
const listeners = new Set<() => void>();

function load(): readonly ModelPrice[] {
  if (current) return current;
  try {
    current = parseModelPrices(uiStorage.getItem(modelPricesStorageKey));
  } catch {
    log.error("failed to read model prices");
    current = noPrices;
  }
  return current;
}

export function readModelPrices(): readonly ModelPrice[] {
  return load();
}

/** 保存失败时抛错，让设置页提示用户；内存中的价格不会提前改变。 */
export function saveModelPrices(prices: readonly ModelPrice[]): void {
  uiStorage.setItem(modelPricesStorageKey, serializeModelPrices(prices));
  current = prices;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 价格在设置页修改后，所有显示费用的界面同步刷新。 */
export function useModelPrices(): readonly ModelPrice[] {
  return useSyncExternalStore(subscribe, load, () => noPrices);
}
