import { useSyncExternalStore } from "react";
import type { MenuAction } from "@vela/shared";
import { readStoredState } from "./hooks/useStoredState";
import { uiStorage } from "./ui-storage";
import { createLogger } from "./logger";

const log = createLogger("preferences");

/**
 * 可自定义的快捷键。动作与应用菜单的 MenuAction 一一对应:按下快捷键和点菜单走同一条处理路径。
 *
 * 快捷键存成字符串 `Mod+Shift+]`:
 * - `Mod` 是 macOS 的 ⌘ / 其他平台的 Ctrl;`Ctrl` 是 macOS 上真正的 ⌃(其他平台与 Mod 等价,统一记成 Mod);
 * - 按键用物理键位(KeyboardEvent.code)归一化,这样 ⌥ 改变字符(⌥S → ß)或换键盘布局都不影响匹配。
 */
export type ShortcutAction = Extract<MenuAction,
  | "new-chat" | "new-tab" | "toggle-settings" | "toggle-sidebar" | "toggle-info"
  | "go-back" | "go-forward" | "archive-chat" | "side-chat"
  | "next-tab" | "prev-tab" | "next-chat" | "prev-chat" | "next-attention-chat"
  | "open-changes" | "open-files" | "open-terminal" | "open-browser">;

export type ShortcutGroup = "chat" | "navigation" | "workbench" | "view";

export interface ShortcutDefinition {
  action: ShortcutAction;
  group: ShortcutGroup;
  label: [zh: string, en: string];
  hint: [zh: string, en: string];
  /** 默认快捷键;macOS 与其他平台可以不同,缺省的平台沿用 `all`。 */
  defaults: { mac?: string[]; other?: string[]; all?: string[] };
}

export const shortcutDefinitions: readonly ShortcutDefinition[] = [
  { action: "new-chat", group: "chat", label: ["新聊天", "New chat"], hint: ["开始新聊天", "Start a new chat"], defaults: { all: ["Mod+N"] } },
  { action: "archive-chat", group: "chat", label: ["归档聊天", "Archive chat"], hint: ["归档当前聊天", "Archive the current chat"], defaults: { all: ["Mod+Shift+A"] } },
  { action: "side-chat", group: "chat", label: ["打开侧边聊天", "Open side chat"], hint: ["在侧边聊天中打开当前项目的聊天", "Open this project's side chat next to the conversation"], defaults: { all: ["Mod+Alt+S"] } },
  { action: "next-chat", group: "navigation", label: ["下一个侧边栏项目", "Next sidebar chat"], hint: ["切换到侧边栏里的下一个聊天", "Switch to the next chat in the sidebar"], defaults: { all: ["Mod+Alt+]"] } },
  { action: "prev-chat", group: "navigation", label: ["上一个侧边栏项目", "Previous sidebar chat"], hint: ["切换到侧边栏里的上一个聊天", "Switch to the previous chat in the sidebar"], defaults: { all: ["Mod+Alt+["] } },
  { action: "next-attention-chat", group: "navigation", label: ["下一个需关注的聊天", "Next chat needing attention"], hint: ["切换到下一个等待输入或出错的聊天", "Switch to the next chat that is waiting for input or has failed"], defaults: { all: ["Mod+Alt+A"] } },
  { action: "go-back", group: "navigation", label: ["返回", "Back"], hint: ["在导航历史记录中返回", "Go back in navigation history"], defaults: { mac: ["Mod+["], other: ["Alt+Left"] } },
  { action: "go-forward", group: "navigation", label: ["前进", "Forward"], hint: ["在导航历史记录中前进", "Go forward in navigation history"], defaults: { mac: ["Mod+]"], other: ["Alt+Right"] } },
  { action: "toggle-settings", group: "navigation", label: ["设置", "Settings"], hint: ["打开或关闭设置", "Open or close settings"], defaults: { all: ["Mod+,"] } },
  { action: "new-tab", group: "workbench", label: ["新建标签页", "New tab"], hint: ["打开新标签页", "Open a new tab"], defaults: { all: ["Mod+T"] } },
  { action: "next-tab", group: "workbench", label: ["下一个标签页", "Next tab"], hint: ["切换到下一个标签页", "Switch to the next tab"], defaults: { all: ["Mod+Shift+]", "Ctrl+Tab"] } },
  { action: "prev-tab", group: "workbench", label: ["上一个标签页", "Previous tab"], hint: ["切换到上一个标签页", "Switch to the previous tab"], defaults: { all: ["Mod+Shift+[", "Ctrl+Shift+Tab"] } },
  { action: "open-changes", group: "workbench", label: ["打开“变更”选项卡", "Open Changes tab"], hint: ["打开“变更”选项卡", "Open the Changes tab"], defaults: { all: ["Ctrl+Shift+G"] } },
  { action: "open-files", group: "workbench", label: ["显示文件面板", "Show files panel"], hint: ["打开文件标签页浏览项目文件", "Open the files tab to browse the project"], defaults: { all: ["Mod+Shift+E"] } },
  { action: "open-terminal", group: "workbench", label: ["打开终端", "Open terminal"], hint: ["打开终端标签页", "Open a terminal tab"], defaults: { all: [] } },
  { action: "open-browser", group: "workbench", label: ["打开浏览器", "Open browser"], hint: ["打开浏览器标签页", "Open a browser tab"], defaults: { all: [] } },
  { action: "toggle-sidebar", group: "view", label: ["显示/隐藏侧边栏", "Show/hide sidebar"], hint: ["显示或隐藏左侧侧边栏", "Show or hide the left sidebar"], defaults: { all: ["Mod+B"] } },
  { action: "toggle-info", group: "view", label: ["显示/隐藏信息面板", "Show/hide info panel"], hint: ["显示或隐藏右侧信息面板", "Show or hide the info panel"], defaults: { all: ["Mod+J"] } },
];

const definitionByAction = new Map(shortcutDefinitions.map(definition => [definition.action, definition]));
export const shortcutActions = shortcutDefinitions.map(definition => definition.action);

export type ShortcutOverrides = Partial<Record<ShortcutAction, string[]>>;
export type ShortcutBindings = Record<ShortcutAction, string[]>;

// ---------- 按键解析 ----------

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

export interface ParsedBinding {
  mods: ReadonlySet<Modifier>;
  key: string;
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
  Backquote: "`", Minus: "-", Equal: "=", Backslash: "\\", Space: "Space", Tab: "Tab", Enter: "Enter",
  ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down",
  Backspace: "Backspace", Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
};

const NAMED_KEYS = new Set(Object.values(CODE_KEYS));

/** 物理键位转成快捷键里的按键名;不能作为主键的(修饰键、未知键)返回 null。 */
export function keyFromCode(code: string): string | null {
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return null;
}

function isKnownKey(key: string): boolean {
  return /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || NAMED_KEYS.has(key);
}

export function parseBinding(binding: string): ParsedBinding | null {
  const parts = binding.split("+");
  // 按键本身可能就是 "+"-less 的符号,但 "+" 不在可用按键里,所以直接按 + 切分是安全的。
  const key = parts.pop() ?? "";
  if (!isKnownKey(key)) return null;
  const mods = new Set<Modifier>();
  for (const part of parts) {
    if (!(MODIFIER_ORDER as readonly string[]).includes(part)) return null;
    mods.add(part as Modifier);
  }
  if (mods.size !== parts.length) return null;
  return { mods, key };
}

export function normalizeBinding(binding: string): string | null {
  const parsed = parseBinding(binding);
  if (!parsed) return null;
  return [...MODIFIER_ORDER.filter(modifier => parsed.mods.has(modifier)), parsed.key].join("+");
}

/** 把键盘事件还原成快捷键字符串;只按了修饰键、或用了不支持的修饰键(如 Windows 键)时返回 null。 */
export function bindingFromEvent(event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, platform: string): string | null {
  const key = keyFromCode(event.code);
  if (!key) return null;
  const mac = platform === "darwin";
  if (!mac && event.metaKey) return null;
  const mods: Modifier[] = [];
  if (mac ? event.metaKey : event.ctrlKey) mods.push("Mod");
  if (mac && event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  return [...MODIFIER_ORDER.filter(modifier => mods.includes(modifier)), key].join("+");
}

export function matchesBinding(event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, binding: string, platform: string): boolean {
  return bindingFromEvent(event, platform) === binding;
}

/** 单独的 Shift 或无修饰键会抢走文字输入,只允许 F 键裸用。 */
export function isUsableBinding(binding: string): boolean {
  const parsed = parseBinding(binding);
  if (!parsed) return false;
  if (/^F\d+$/.test(parsed.key)) return true;
  return parsed.mods.has("Mod") || parsed.mods.has("Ctrl") || parsed.mods.has("Alt");
}

/** 不带 Mod/Ctrl 的快捷键(如 Alt+←)会和文本编辑冲突:在输入框里不触发,也不注册成菜单加速键。 */
export function stealsTextEditing(binding: string): boolean {
  const parsed = parseBinding(binding);
  return !parsed || !(parsed.mods.has("Mod") || parsed.mods.has("Ctrl"));
}

/** 这些组合留给系统/编辑功能,不允许自定义占用。 */
const RESERVED = new Set(["Mod+C", "Mod+V", "Mod+X", "Mod+A", "Mod+Z", "Mod+Shift+Z", "Mod+Q", "Mod+W", "Mod+H", "Mod+M", "Mod+F", "Mod+R", "Mod+S"]);
export function isReservedBinding(binding: string): boolean {
  return RESERVED.has(binding);
}

// ---------- 显示与菜单加速键 ----------

const MAC_GLYPH: Record<Modifier, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const MAC_ORDER: Modifier[] = ["Ctrl", "Alt", "Shift", "Mod"];
const KEY_GLYPH: Record<string, string> = { Left: "←", Right: "→", Up: "↑", Down: "↓", Enter: "↩", Backspace: "⌫", Delete: "⌦" };

export function formatBinding(binding: string, platform: string): string {
  const parsed = parseBinding(binding);
  if (!parsed) return binding;
  if (platform === "darwin") {
    const key = KEY_GLYPH[parsed.key] ?? parsed.key;
    return MAC_ORDER.filter(modifier => parsed.mods.has(modifier)).map(modifier => MAC_GLYPH[modifier]).join("") + key;
  }
  const names: Record<Modifier, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
  const mods = ["Mod", "Ctrl", "Alt", "Shift"].filter(modifier => parsed.mods.has(modifier as Modifier)).map(modifier => names[modifier as Modifier]);
  return [...new Set(mods), KEY_GLYPH[parsed.key] ?? parsed.key].join("+");
}

/** 转成 Electron 菜单加速键;不适合注册成菜单加速键的返回 null。 */
export function toAccelerator(binding: string, platform: string): string | null {
  const parsed = parseBinding(binding);
  if (!parsed || stealsTextEditing(binding)) return null;
  const mods: string[] = [];
  if (parsed.mods.has("Mod")) mods.push("CmdOrCtrl");
  if (parsed.mods.has("Ctrl")) mods.push("Ctrl");
  if (parsed.mods.has("Alt")) mods.push("Alt");
  if (parsed.mods.has("Shift")) mods.push("Shift");
  const unique = [...new Set(platform === "darwin" ? mods : mods.map(modifier => modifier === "CmdOrCtrl" ? "Ctrl" : modifier))];
  return [...unique, parsed.key].join("+");
}

// ---------- 默认值、自定义与冲突 ----------

export function defaultBindings(action: ShortcutAction, platform: string): string[] {
  const defaults = definitionByAction.get(action)?.defaults;
  if (!defaults) return [];
  const list = (platform === "darwin" ? defaults.mac : defaults.other) ?? defaults.all ?? [];
  return [...list];
}

export function resolveBindings(overrides: ShortcutOverrides, platform: string): ShortcutBindings {
  const result = {} as ShortcutBindings;
  for (const action of shortcutActions) result[action] = overrides[action] ?? defaultBindings(action, platform);
  return result;
}

export function isCustomized(action: ShortcutAction, overrides: ShortcutOverrides, platform: string): boolean {
  const custom = overrides[action];
  if (!custom) return false;
  const defaults = defaultBindings(action, platform);
  return custom.length !== defaults.length || custom.some((binding, index) => binding !== defaults[index]);
}

/** 返回已占用这个快捷键的其他动作。 */
export function findConflict(binding: string, action: ShortcutAction, bindings: ShortcutBindings): ShortcutAction | null {
  return shortcutActions.find(other => other !== action && bindings[other].includes(binding)) ?? null;
}

/** 按键事件命中的动作;输入框里不带 Mod/Ctrl 的快捷键让给文本编辑。 */
export function actionForEvent(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  bindings: ShortcutBindings,
  platform: string,
  inTextField: boolean,
): ShortcutAction | null {
  const pressed = bindingFromEvent(event, platform);
  if (!pressed) return null;
  for (const action of shortcutActions) {
    if (!bindings[action].includes(pressed)) continue;
    if (inTextField && stealsTextEditing(pressed)) continue;
    return action;
  }
  return null;
}

/** 渲染层发给主进程的加速键表:每个动作取第一个可注册为菜单加速键的快捷键。 */
export function acceleratorMap(bindings: ShortcutBindings, platform: string): Partial<Record<ShortcutAction, string>> {
  const map: Partial<Record<ShortcutAction, string>> = {};
  for (const action of shortcutActions) {
    for (const binding of bindings[action]) {
      const accelerator = toAccelerator(binding, platform);
      if (accelerator) { map[action] = accelerator; break; }
    }
  }
  return map;
}

function sanitizeOverrides(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 读取已保存的自定义项;无法识别的动作或快捷键直接丢弃,不影响其他项。 */
export function parseOverrides(raw: unknown): ShortcutOverrides {
  if (!sanitizeOverrides(raw)) return {};
  const result: ShortcutOverrides = {};
  for (const action of shortcutActions) {
    const list = raw[action];
    if (!Array.isArray(list)) continue;
    const bindings: string[] = [];
    for (const item of list) {
      const normalized = typeof item === "string" ? normalizeBinding(item) : null;
      if (normalized && isUsableBinding(normalized) && !bindings.includes(normalized)) bindings.push(normalized);
    }
    result[action] = bindings;
  }
  return result;
}

// ---------- 存储 ----------

const storageKey = "vela.shortcuts";
let overrides: ShortcutOverrides = parseOverrides(readStoredState<Record<string, unknown>>(storageKey, {}, sanitizeOverrides));
let recording = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function persist() {
  try {
    if (Object.keys(overrides).length === 0) uiStorage.removeItem(storageKey);
    else uiStorage.setItem(storageKey, JSON.stringify(overrides));
  } catch (error) { log.error(`failed to save UI preference ${storageKey}`, error); }
}

export function setShortcutBindings(action: ShortcutAction, bindings: string[], platform: string): void {
  const next = { ...overrides };
  const defaults = defaultBindings(action, platform);
  if (bindings.length === defaults.length && bindings.every((binding, index) => binding === defaults[index])) delete next[action];
  else next[action] = bindings;
  overrides = next;
  persist();
  emit();
}

export function resetShortcut(action: ShortcutAction): void {
  if (!(action in overrides)) return;
  const next = { ...overrides };
  delete next[action];
  overrides = next;
  persist();
  emit();
}

export function resetAllShortcuts(): void {
  overrides = {};
  persist();
  emit();
}

/** 录入快捷键时暂停全部快捷键(包括菜单加速键),否则按下的组合会被直接执行。 */
export function setShortcutRecording(value: boolean): void {
  if (recording === value) return;
  recording = value;
  emit();
}

export function isShortcutRecording(): boolean {
  return recording;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useShortcutOverrides(): ShortcutOverrides {
  return useSyncExternalStore(subscribe, () => overrides);
}

export function useShortcutRecording(): boolean {
  return useSyncExternalStore(subscribe, () => recording);
}

/** 仅测试使用:换一组存储内容。 */
export function __setShortcutOverridesForTest(value: ShortcutOverrides): void {
  overrides = value;
  emit();
}
