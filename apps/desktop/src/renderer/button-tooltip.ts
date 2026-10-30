/** 按钮悬停提示的纯逻辑:解析 title 里的快捷键,并判断哪些按钮不弹提示。 */

export interface TooltipContent {
  label: string;
  keys: string[];
}

/** 标题末尾形如 "(⌘B)"、"(⇧⌘B)"、"(Ctrl+J)" 的括号,视为快捷键。 */
const TRAILING_SHORTCUT = /\s*[(（]((?:[⌘⇧⌥⌃]|Ctrl\+|Alt\+|Shift\+)[^()（）]*)[)）]\s*$/;
const KEY_TOKEN = /[⌘⇧⌥⌃]|Ctrl|Alt|Shift|Enter|Esc|[^+⌘⇧⌥⌃]+/g;

export function splitShortcut(shortcut: string): string[] {
  return shortcut.match(KEY_TOKEN) ?? [];
}

export function parseTooltip(raw: string): TooltipContent {
  const text = raw.trim();
  const match = TRAILING_SHORTCUT.exec(text);
  if (!match || match.index === 0) return { label: text, keys: [] };
  return { label: text.slice(0, match.index), keys: splitShortcut(match[1]) };
}

/** 这些区域里的按钮是展开/折叠、文件树、设置页之类,不弹提示。 */
export const TOOLTIP_EXCLUDED = [
  ".settings-view",
  ".explorer-tree-item",
  ".explorer-result",
  ".thinking-header",
  ".time-spent-trigger",
  ".coherent-thought-trigger",
  ".thinking-prose-toggle",
  ".tool-card-head",
  ".tool-compact-line",
  ".tool-compact-detail-toggle",
  ".agent-compact-toggle",
  ".browser-call-head",
].join(", ");

/** 带 aria-expanded 但不是菜单触发器的按钮是折叠开关;顶栏的图标按钮除外。 */
const ICON_BUTTON_CLASSES = ["view-icon-btn", "icon-btn-ghost"];

export interface TooltipElement {
  closest(selector: string): TooltipElement | null;
  getAttribute(name: string): string | null;
  classList: { contains(name: string): boolean };
  textContent: string | null;
}

export function isDisclosureToggle(button: TooltipElement): boolean {
  if (button.getAttribute("aria-expanded") === null) return false;
  if (button.getAttribute("aria-haspopup") !== null) return false;
  return !ICON_BUTTON_CLASSES.some((name) => button.classList.contains(name));
}

/** 从事件目标找到应该弹提示的按钮;不适用时返回 null。 */
export function findTooltipButton<T extends TooltipElement>(target: T | null): T | null {
  const button = (target?.closest("button, [role='button']") ?? null) as T | null;
  if (!button) return null;
  if (button.closest(TOOLTIP_EXCLUDED)) return null;
  if (isDisclosureToggle(button)) return null;
  return button;
}

/**
 * 提示文字:只给图标按钮(没有可见文字)弹;带文字的 chip、标签页、卡片不弹。
 * 图标按钮里带角标等文字时,加 data-tooltip 显式加入。优先 title,否则 aria-label。
 */
export function tooltipSource(button: TooltipElement): string | null {
  if (button.textContent?.trim() && button.getAttribute("data-tooltip") === null) return null;
  return button.getAttribute("title")?.trim() || button.getAttribute("aria-label")?.trim() || null;
}
