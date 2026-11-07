import type { GitStatusSnapshot, SandboxMode, ThinkingLevel } from "@vela/shared";
import { thinkingLevels } from "@vela/shared";
import { uiStorage } from "./ui-storage";

/**
 * 启动提示:记住上次的分支和模型,冷启动时在真实数据到达前先显示它们。
 * 只用于首屏占位——真实数据一到就以它为准,提示不参与任何判断(例如发送是否可用)。
 */

const gitKey = "vela.startup.git";
const modelKey = "vela.startup.model";
const sandboxKey = "vela.startup.sandbox";
/** Git 快照含改动文件列表,过大就不缓存,避免每次写盘都很重。 */
const maxGitHintBytes = 256 * 1024;

export interface GitHint {
  workspace: string;
  snapshot: GitStatusSnapshot;
}

export interface ModelHint {
  label: string;
  provider: string;
  id: string;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (thinkingLevels as readonly string[]).includes(value);
}

function readJson(key: string): unknown {
  try {
    const raw = uiStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= maxGitHintBytes) uiStorage.setItem(key, raw);
  } catch { /* 提示只是优化,写不进去就算了。 */ }
}

export function readGitHint(): GitHint | null {
  const value = readJson(gitKey) as Partial<GitHint> | null;
  if (!value || typeof value.workspace !== "string" || !value.workspace) return null;
  const snapshot = value.snapshot;
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.files)) return null;
  return { workspace: value.workspace, snapshot };
}

export function writeGitHint(workspace: string, snapshot: GitStatusSnapshot): void {
  writeJson(gitKey, { workspace, snapshot });
}

export function readModelHint(): ModelHint | null {
  const value = readJson(modelKey) as Partial<ModelHint> | null;
  if (!value || typeof value.label !== "string" || typeof value.provider !== "string" || typeof value.id !== "string") return null;
  if (!isThinkingLevel(value.thinkingLevel) || !Array.isArray(value.thinkingLevels) || !value.thinkingLevels.every(isThinkingLevel)) return null;
  return { label: value.label, provider: value.provider, id: value.id, thinkingLevel: value.thinkingLevel, thinkingLevels: value.thinkingLevels };
}

export function writeModelHint(hint: ModelHint): void {
  const previous = readModelHint();
  if (previous && JSON.stringify(previous) === JSON.stringify(hint)) return;
  writeJson(modelKey, hint);
}

export function readSandboxHint(): SandboxMode | null {
  const value = readJson(sandboxKey);
  return value === "ask" || value === "smart" || value === "full" ? value : null;
}

export function writeSandboxHint(mode: SandboxMode): void {
  if (readSandboxHint() !== mode) writeJson(sandboxKey, mode);
}
