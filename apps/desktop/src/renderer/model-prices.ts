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

function store(prices: readonly ModelPrice[]): void {
  uiStorage.setItem(modelPricesStorageKey, serializeModelPrices(prices));
  current = prices;
  for (const listener of listeners) listener();
}

/** 价格同时交给主进程：任务费用上限和开跑前预估都在那边计算。同步失败不影响本地保存，下次启动会补同步。 */
function pushToMain(prices: readonly ModelPrice[]): void {
  void Promise.resolve(window.vela?.setModelPrices([...prices])).catch(() => log.error("failed to sync model prices"));
}

/** 保存失败时抛错，让设置页提示用户；内存中的价格不会提前改变。 */
export function saveModelPrices(prices: readonly ModelPrice[]): void {
  store(prices);
  pushToMain(prices);
}

/**
 * 启动时对齐主进程的价格副本。设置页是价格的编辑入口，所以以本地为准推上去；
 * 只有本地为空而主进程有价格时（例如清过浏览器存储）才反过来恢复。
 */
export async function syncModelPrices(): Promise<void> {
  const api = window.vela;
  if (!api) return;
  try {
    const remote = await api.getModelPrices();
    const local = load();
    if (remote === null || (local.length > 0 && serializeModelPrices(local) !== serializeModelPrices(remote))) {
      if (remote !== null || local.length > 0) await api.setModelPrices([...local]);
    } else if (local.length === 0 && remote.length > 0) {
      store(remote);
    }
  } catch {
    log.error("failed to sync model prices");
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 价格在设置页修改后，所有显示费用的界面同步刷新。 */
export function useModelPrices(): readonly ModelPrice[] {
  return useSyncExternalStore(subscribe, load, () => noPrices);
}
