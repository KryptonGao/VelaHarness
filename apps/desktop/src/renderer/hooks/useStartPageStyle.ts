import { useSyncExternalStore } from "react";
import { isBoolean, readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";

const log = createLogger("preferences");

/**
 * 新对话起始页样式：
 * - atelier：静纸稿台（左对齐叙事排版 + 编号索引目录）
 * - deck：星航指挥舱（仓库实况 Bento + 快捷键指令矩阵）
 * - classic：经典居中问候与提示词卡片
 * - minimal：极简，只保留输入框
 */
export const startPageStyles = ["atelier", "deck", "classic", "minimal"] as const;
export type StartPageStyle = (typeof startPageStyles)[number];

const key = "vela.startPageStyle";
const legacyMinimalKey = "vela.minimalStart";

const accept = (value: unknown): value is StartPageStyle =>
  typeof value === "string" && (startPageStyles as readonly string[]).includes(value);

function loadInitial(): StartPageStyle {
  const saved = readStoredState<StartPageStyle | null>(key, null, accept);
  if (saved) return saved;
  // 兼容旧版「极简起始页」开关：之前开启过极简模式的用户保持极简。
  if (readStoredState<boolean>(legacyMinimalKey, false, isBoolean)) return "minimal";
  return "atelier";
}

let current: StartPageStyle = loadInitial();
const listeners = new Set<() => void>();

export function setStartPageStyle(style: StartPageStyle) {
  const next: StartPageStyle = accept(style) ? style : "atelier";
  current = next;
  try {
    uiStorage.setItem(key, JSON.stringify(current));
    uiStorage.setItem(legacyMinimalKey, JSON.stringify(current === "minimal"));
  } catch (error) {
    log.error(`failed to save UI preference ${key}`, error);
  }
  listeners.forEach((listener) => listener());
}

export function useStartPageStyle(): StartPageStyle {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => current,
    () => current,
  );
}
