/** 工作面板分屏的纯状态模型。标签身份与内容生命周期由宿主维护。 */
export type WorkbenchDropEdge = "left" | "right" | "top" | "bottom" | "center" | "tabbar";
export interface WorkbenchPane { id: string; tabs: string[]; selected: string }
export type WorkbenchLayoutNode = { pane: string } | {
  id: string; axis: "x" | "y"; ratio: number; a: WorkbenchLayoutNode; b: WorkbenchLayoutNode;
};
export interface WorkbenchLayout {
  root: WorkbenchLayoutNode | null; panes: WorkbenchPane[]; focused: string | null;
  maximized: string | null; sequence: number;
}
export interface WorkbenchRect { x: number; y: number; width: number; height: number }
export interface WorkbenchDivider extends WorkbenchRect {
  id: string; axis: "x" | "y"; ratio: number; parent: WorkbenchRect;
}
export const WORKBENCH_MAX_PANES = 4;
export const WORKBENCH_GAP = 4;
export const WORKBENCH_HEADER_HEIGHT = 52;
/** 单个窗口的最小宽高:再窄标签列表和右侧按钮就挤没了,再矮正文不足以操作。 */
export const WORKBENCH_MIN_PANE_WIDTH = 240;
export const WORKBENCH_MIN_PANE_HEIGHT = WORKBENCH_HEADER_HEIGHT + 148;
export const emptyWorkbenchLayout = (): WorkbenchLayout => ({ root: null, panes: [], focused: null, maximized: null, sequence: 0 });
export function workbenchPaneOrder(node: WorkbenchLayoutNode | null): string[] {
  return !node ? [] : "pane" in node ? [node.pane] : [...workbenchPaneOrder(node.a), ...workbenchPaneOrder(node.b)];
}
function removePane(node: WorkbenchLayoutNode | null, id: string): WorkbenchLayoutNode | null {
  if (!node || "pane" in node) return node?.pane === id ? null : node;
  const a = removePane(node.a, id), b = removePane(node.b, id);
  return !a ? b : !b ? a : a === node.a && b === node.b ? node : { ...node, a, b };
}
function replacePane(node: WorkbenchLayoutNode, id: string, replacement: WorkbenchLayoutNode): WorkbenchLayoutNode {
  if ("pane" in node) return node.pane === id ? replacement : node;
  return { ...node, a: replacePane(node.a, id, replacement), b: replacePane(node.b, id, replacement) };
}
/** 外部新建标签落在聚焦窗口；关闭最后一个标签自动收拢对应分支。 */
export function reconcileWorkbenchLayout(current: WorkbenchLayout, tabIds: readonly string[]): WorkbenchLayout {
  const live = new Set(tabIds);
  let root = current.root, sequence = current.sequence;
  const panes = current.panes.flatMap(pane => {
    const tabs = pane.tabs.filter(id => live.has(id));
    if (!tabs.length) { root = removePane(root, pane.id); return []; }
    const selected = tabs.includes(pane.selected) ? pane.selected : tabs[Math.min(Math.max(0, pane.tabs.indexOf(pane.selected)), tabs.length - 1)];
    return [{ ...pane, tabs, selected }];
  });
  let focused = panes.some(p => p.id === current.focused) ? current.focused : panes[0]?.id ?? null;
  const assigned = new Set(panes.flatMap(p => p.tabs));
  const added = tabIds.filter(id => !assigned.has(id));
  if (added.length) {
    let target = panes.find(p => p.id === focused);
    if (!target) {
      target = { id: `pane-${++sequence}`, tabs: [], selected: added[0] };
      panes.push(target); root = { pane: target.id }; focused = target.id;
    }
    target.tabs.push(...added);
  }
  const maximized = panes.some(p => p.id === current.maximized) ? current.maximized : null;
  if (root === current.root && focused === current.focused && maximized === current.maximized && sequence === current.sequence &&
    panes.length === current.panes.length && panes.every((p, i) => p.id === current.panes[i].id && p.selected === current.panes[i].selected &&
      p.tabs.length === current.panes[i].tabs.length && p.tabs.every((t, j) => t === current.panes[i].tabs[j]))) return current;
  return { root, panes, focused, maximized, sequence };
}
export function selectWorkbenchTab(layout: WorkbenchLayout, tabId: string): WorkbenchLayout {
  const owner = layout.panes.find(p => p.tabs.includes(tabId));
  if (!owner) return layout;
  const maximized = layout.maximized ? owner.id : null;
  if (owner.selected === tabId && layout.focused === owner.id && layout.maximized === maximized) return layout;
  return { ...layout, focused: owner.id, maximized, panes: layout.panes.map(p => p === owner ? { ...p, selected: tabId } : p) };
}
/** 纯计算可用作落点预览；标签栏收回、页面中心互换、内容边缘拆分。 */
export function dropWorkbenchTab(layout: WorkbenchLayout, tabId: string, targetId: string, edge: WorkbenchDropEdge, slot?: number): WorkbenchLayout {
  const source = layout.panes.find(p => p.tabs.includes(tabId));
  if (!source || !layout.root || layout.maximized || !layout.panes.some(p => p.id === targetId)) return layout;
  if (source.id === targetId && edge === "tabbar" && slot !== undefined) return reorderWorkbenchTab(layout, tabId, slot);
  if (source.id === targetId && (edge === "center" || edge === "tabbar" || source.tabs.length === 1)) return layout;
  const panes = layout.panes.map(p => ({ ...p, tabs: [...p.tabs] }));
  const from = panes.find(p => p.id === source.id)!;
  const index = from.tabs.indexOf(tabId);
  if (edge === "center") {
    const target = panes.find(p => p.id === targetId)!;
    const displaced = target.selected, targetIndex = target.tabs.indexOf(displaced);
    if (targetIndex < 0) return layout;
    // 两边原位替换，不挪动其他标签、不收拢窗口，也不改分隔树和比例。
    from.tabs[index] = displaced;
    target.tabs[targetIndex] = tabId;
    if (from.selected === tabId) from.selected = displaced;
    target.selected = tabId;
    return { ...layout, panes, focused: target.id };
  }
  from.tabs.splice(index, 1);
  if (from.selected === tabId) from.selected = from.tabs[Math.min(index, from.tabs.length - 1)] ?? "";
  let root: WorkbenchLayoutNode | null = layout.root;
  if (!from.tabs.length) { panes.splice(panes.indexOf(from), 1); root = removePane(root, from.id); }
  if (!root) return layout;
  if (edge === "tabbar") {
    const target = panes.find(p => p.id === targetId)!;
    target.tabs.splice(slot === undefined ? target.tabs.length : Math.max(0, Math.min(target.tabs.length, slot)), 0, tabId); target.selected = tabId;
    return { ...layout, root, panes, focused: target.id };
  }
  if (panes.length >= WORKBENCH_MAX_PANES) return layout;
  const sequence = layout.sequence + 1, id = `pane-${sequence}`, before = edge === "left" || edge === "top";
  root = replacePane(root, targetId, { id: `split-${sequence}`, axis: edge === "left" || edge === "right" ? "x" : "y", ratio: 0.5,
    a: { pane: before ? id : targetId }, b: { pane: before ? targetId : id } });
  panes.push({ id, tabs: [tabId], selected: tabId });
  return { ...layout, root, panes, focused: id, sequence };
}
/** 关闭分屏功能时把所有窗口合并成一个:标签按窗口顺序拼接,保留聚焦窗口当前显示的标签。 */
export function collapseWorkbenchLayout(layout: WorkbenchLayout): WorkbenchLayout {
  if (layout.panes.length < 2) return layout.maximized ? { ...layout, maximized: null } : layout;
  const order = workbenchPaneOrder(layout.root).map(id => layout.panes.find(p => p.id === id)!).filter(Boolean);
  const focused = order.find(p => p.id === layout.focused) ?? order[0], first = order[0];
  return { ...layout, root: { pane: first.id }, focused: first.id, maximized: null,
    panes: [{ id: first.id, tabs: order.flatMap(p => p.tabs), selected: focused.selected }] };
}
/** 同一窗口内重排:index 是移除该标签之前的插入位置(落在第 index 个标签之前)。 */
export function reorderWorkbenchTab(layout: WorkbenchLayout, tabId: string, index: number): WorkbenchLayout {
  const owner = layout.panes.find(p => p.tabs.includes(tabId));
  if (!owner) return layout;
  const from = owner.tabs.indexOf(tabId), clamped = Math.max(0, Math.min(owner.tabs.length, index));
  const to = clamped > from ? clamped - 1 : clamped;
  if (to === from) return layout;
  const tabs = owner.tabs.filter(id => id !== tabId); tabs.splice(to, 0, tabId);
  return { ...layout, focused: owner.id, panes: layout.panes.map(p => p === owner ? { ...p, tabs, selected: tabId } : p) };
}
/** 拆分后是否每个窗口都不小于最小尺寸。 */
export function workbenchFits(layout: WorkbenchLayout, width: number, height: number): boolean {
  return Object.values(workbenchGeometry(layout, width, height).panes)
    .every(r => r.width >= WORKBENCH_MIN_PANE_WIDTH - 0.5 && r.height >= WORKBENCH_MIN_PANE_HEIGHT - 0.5);
}
/** 分隔线可拖动的比例范围:两侧各至少留出一个最小窗口,父区域太小就只允许对半。 */
export function workbenchRatioBounds(parentSize: number, axis: "x" | "y"): [number, number] {
  const size = Math.max(1, parentSize - WORKBENCH_GAP), min = (axis === "x" ? WORKBENCH_MIN_PANE_WIDTH : WORKBENCH_MIN_PANE_HEIGHT) / size;
  return min >= 0.5 ? [0.5, 0.5] : [Math.max(0.25, min), Math.min(0.75, 1 - min)];
}
export function mergeWorkbenchPane(layout: WorkbenchLayout, paneId: string): WorkbenchLayout {
  if (layout.panes.length < 2) return layout;
  const order = workbenchPaneOrder(layout.root), index = order.indexOf(paneId);
  const source = layout.panes.find(p => p.id === paneId), target = layout.panes.find(p => p.id === order[index > 0 ? index - 1 : 1]);
  if (!source || !target) return layout;
  return { ...layout, root: removePane(layout.root, paneId), focused: target.id, maximized: null,
    panes: layout.panes.filter(p => p !== source).map(p => p === target ? { ...p, tabs: [...p.tabs, ...source.tabs] } : p) };
}
export function resizeWorkbenchDivider(layout: WorkbenchLayout, id: string, ratio: number, bounds: readonly [number, number] = [0.25, 0.75]): WorkbenchLayout {
  if (!Number.isFinite(ratio)) return layout;
  function visit(node: WorkbenchLayoutNode): WorkbenchLayoutNode {
    if ("pane" in node) return node;
    if (node.id === id) return { ...node, ratio: Math.max(bounds[0], Math.min(bounds[1], ratio)) };
    return { ...node, a: visit(node.a), b: visit(node.b) };
  }
  return layout.root ? { ...layout, root: visit(layout.root) } : layout;
}
export function workbenchGeometry(layout: WorkbenchLayout, width: number, height: number): {
  panes: Record<string, WorkbenchRect>; dividers: WorkbenchDivider[];
} {
  const panes: Record<string, WorkbenchRect> = {}, dividers: WorkbenchDivider[] = [];
  function walk(node: WorkbenchLayoutNode, rect: WorkbenchRect) {
    if ("pane" in node) { panes[node.pane] = rect; return; }
    const horizontal = node.axis === "x", size = Math.max(0, (horizontal ? rect.width : rect.height) - WORKBENCH_GAP);
    const first = size * node.ratio, second = size - first;
    const a = { ...rect }, b = { ...rect };
    if (horizontal) { a.width = first; b.x += first + WORKBENCH_GAP; b.width = second; }
    else { a.height = first; b.y += first + WORKBENCH_GAP; b.height = second; }
    dividers.push({ id: node.id, axis: node.axis, ratio: node.ratio, parent: rect,
      x: horizontal ? rect.x + first - 1 : rect.x, y: horizontal ? rect.y : rect.y + first - 1,
      width: horizontal ? 6 : rect.width, height: horizontal ? rect.height : 6 });
    walk(node.a, a); walk(node.b, b);
  }
  if (layout.root) walk(layout.root, { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) });
  return { panes, dividers };
}
/**
 * sourcePane:被拖标签所在窗口。落在它自己的中间区域本来是空操作(没有可互换的对象),
 * 这时直接取最近的一条边拆分,免得窗口中部整片区域拖不出任何落点。
 */
export function workbenchDropTarget(layout: WorkbenchLayout, width: number, height: number, x: number, y: number, sourcePane?: string): { pane: string; edge: WorkbenchDropEdge } | null {
  if (layout.maximized) return null;
  const { panes } = workbenchGeometry(layout, width, height);
  for (const id of workbenchPaneOrder(layout.root)) {
    const r = panes[id];
    if (r.width <= 0 || r.height <= 0 || x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
    // 标签栏优先于四边命中，避免收回窗口的手势被误当成向上拆分。
    if (y - r.y < Math.min(WORKBENCH_HEADER_HEIGHT, r.height)) return { pane: id, edge: "tabbar" };
    const bodyHeight = r.height - WORKBENCH_HEADER_HEIGHT;
    if (bodyHeight <= 0) continue;
    const distances: [WorkbenchDropEdge, number][] = [["left", (x - r.x) / r.width], ["right", 1 - (x - r.x) / r.width],
      ["top", (y - r.y - WORKBENCH_HEADER_HEIGHT) / bodyHeight], ["bottom", (r.y + r.height - y) / bodyHeight]];
    distances.sort((a, b) => a[1] - b[1]);
    return { pane: id, edge: distances[0][1] < 0.24 || id === sourcePane ? distances[0][0] : "center" };
  }
  return null;
}
