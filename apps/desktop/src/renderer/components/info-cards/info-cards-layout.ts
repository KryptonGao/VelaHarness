/** 卡片模式右侧信息卡片的布局：顺序、用户隐藏、折叠。纯函数，便于测试。 */

export const infoCardIds = ["env", "goal", "plan", "context", "outputs", "changes", "agents", "tools"] as const;

export type InfoCardId = (typeof infoCardIds)[number];

export interface InfoCardLayout {
  /** 全部卡片的顺序，含用户隐藏的；隐藏项保持相对位置，找回时不跳位。 */
  order: InfoCardId[];
  /** 用户主动隐藏的卡片。 */
  hidden: InfoCardId[];
  /** 折叠成单行摘要的卡片。 */
  collapsed: InfoCardId[];
}

export const defaultInfoCardLayout: Readonly<InfoCardLayout> = Object.freeze<InfoCardLayout>({
  order: [...infoCardIds],
  hidden: ["tools"],
  collapsed: ["context"],
});

export function isInfoCardId(value: unknown): value is InfoCardId {
  return typeof value === "string" && (infoCardIds as readonly string[]).includes(value);
}

export function defaultLayout(): InfoCardLayout {
  return { order: [...defaultInfoCardLayout.order], hidden: [...defaultInfoCardLayout.hidden], collapsed: [...defaultInfoCardLayout.collapsed] };
}

/** 存储里的值只做形状检查；内容交给 sanitizeLayout 修正。 */
export function isStoredInfoCardLayout(value: unknown): value is InfoCardLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Record<string, unknown>;
  return Array.isArray(layout.order) && Array.isArray(layout.hidden) && Array.isArray(layout.collapsed);
}

function uniqueIds(values: readonly unknown[]): InfoCardId[] {
  const seen = new Set<InfoCardId>();
  for (const value of values) if (isInfoCardId(value)) seen.add(value);
  return [...seen];
}

/**
 * 丢掉未知和重复的 id；版本升级新增的卡片补到末尾（默认隐藏的保持隐藏），
 * 旧版本留下的卡片则直接忽略，不会让布局损坏。
 */
export function sanitizeLayout(layout: InfoCardLayout): InfoCardLayout {
  const order = uniqueIds(layout.order);
  const known = new Set(order);
  for (const id of infoCardIds) {
    if (known.has(id)) continue;
    order.push(id);
    if (defaultInfoCardLayout.hidden.includes(id)) layout = { ...layout, hidden: [...layout.hidden, id] };
  }
  return { order, hidden: uniqueIds(layout.hidden), collapsed: uniqueIds(layout.collapsed) };
}

/** 当前要渲染的卡片：按顺序，去掉用户隐藏的和数据上不可用的。 */
export function renderedCards(layout: InfoCardLayout, available: ReadonlySet<InfoCardId>): InfoCardId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id) && available.has(id));
}

/** 用户隐藏、但数据上可用的卡片：托盘里列出这些。 */
export function hiddenCards(layout: InfoCardLayout, available: ReadonlySet<InfoCardId>): InfoCardId[] {
  return layout.order.filter((id) => layout.hidden.includes(id) && available.has(id));
}

/**
 * 把渲染出来的卡片重排成 next。它们依次落在原来被它们占着的位置上，
 * 因为没渲染（隐藏或暂无数据）的卡片留在原位，所以重排不会挪动它们。
 */
export function reorderRendered(layout: InfoCardLayout, rendered: readonly InfoCardId[], next: readonly InfoCardId[]): InfoCardLayout {
  const renderedSet = new Set(rendered);
  if (next.length !== rendered.length || !next.every((id) => renderedSet.has(id)) || new Set(next).size !== next.length) return layout;
  const order = [...layout.order];
  let cursor = 0;
  for (let index = 0; index < order.length; index++) {
    if (renderedSet.has(order[index]!)) order[index] = next[cursor++]!;
  }
  return { ...layout, order };
}

export function hideCard(layout: InfoCardLayout, id: InfoCardId): InfoCardLayout {
  return layout.hidden.includes(id) ? layout : { ...layout, hidden: [...layout.hidden, id] };
}

/** 找回的卡片放到列表末尾，让用户一眼看到它出现在哪。 */
export function showCard(layout: InfoCardLayout, id: InfoCardId): InfoCardLayout {
  if (!layout.hidden.includes(id)) return layout;
  return { ...layout, hidden: layout.hidden.filter((item) => item !== id), order: [...layout.order.filter((item) => item !== id), id] };
}

export function toggleCollapsed(layout: InfoCardLayout, id: InfoCardId): InfoCardLayout {
  const collapsed = layout.collapsed.includes(id) ? layout.collapsed.filter((item) => item !== id) : [...layout.collapsed, id];
  return { ...layout, collapsed };
}

/** 把 id 在渲染列表里移动一位；越界或没找到时返回 null。 */
export function stepRendered(rendered: readonly InfoCardId[], id: InfoCardId, delta: -1 | 1): InfoCardId[] | null {
  const from = rendered.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= rendered.length) return null;
  const next = [...rendered];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * 拖动时的落点：dragged 的中心越过多少张其他卡片的中点，就排在它们之后。
 * mids 是其他卡片按当前顺序的中点（同一坐标系），返回 dragged 在新顺序里的下标。
 */
export function dropIndex(center: number, mids: readonly number[]): number {
  let index = 0;
  for (const mid of mids) if (mid < center) index++;
  return index;
}

/** 把 dragged 放到 others 的第 index 个位置之前，得到新顺序。 */
export function placeAt(others: readonly InfoCardId[], dragged: InfoCardId, index: number): InfoCardId[] {
  const next = [...others];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, dragged);
  return next;
}
