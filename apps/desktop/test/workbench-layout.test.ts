import assert from "node:assert/strict";
import { test } from "node:test";
import { dropWorkbenchTab, emptyWorkbenchLayout, mergeWorkbenchPane, reconcileWorkbenchLayout, resizeWorkbenchDivider,
  selectWorkbenchTab, workbenchDropTarget, workbenchFits, workbenchGeometry, workbenchPaneOrder, workbenchRatioBounds, reorderWorkbenchTab,
  WORKBENCH_MIN_PANE_HEIGHT, WORKBENCH_MIN_PANE_WIDTH, type WorkbenchLayout } from "../src/renderer/components/workbench-layout.ts";
const initial = () => reconcileWorkbenchLayout(emptyWorkbenchLayout(), ["browser", "code", "terminal", "agent"]);
const owner = (s: WorkbenchLayout, tab: string) => s.panes.find(p => p.tabs.includes(tab))!.id;
const all = (s: WorkbenchLayout) => s.panes.flatMap(p => p.tabs).sort();
function assertInvariant(s: WorkbenchLayout, expected = ["agent", "browser", "code", "terminal"]) {
  assert.deepEqual(all(s), expected); assert.equal(new Set(all(s)).size, expected.length);
  assert.ok(s.panes.length <= 4); assert.deepEqual(new Set(workbenchPaneOrder(s.root)), new Set(s.panes.map(p => p.id)));
  s.panes.forEach(p => { assert.ok(p.tabs.length); assert.ok(p.tabs.includes(p.selected)); });
}
test("单窗口初始化、无变化沿用原引用、新标签落在聚焦窗口", () => {
  let s = initial(); assert.equal(s.panes.length, 1); assert.equal(reconcileWorkbenchLayout(s, all(s)), s);
  s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right");
  s = reconcileWorkbenchLayout(s, [...all(s), "new"]);
  assert.equal(owner(s, "new"), owner(s, "code")); assertInvariant(s, ["agent", "browser", "code", "new", "terminal"]);
});
test("拖到标签栏收回单标签窗口，追加标签并自动收拢空源窗口", () => {
  const s = dropWorkbenchTab(initial(), "code", "pane-1", "right");
  const before = structuredClone(s), target = owner(s, "browser");
  const next = dropWorkbenchTab(s, "code", target, "tabbar");
  assert.deepEqual(s, before); assert.equal(next.panes.length, 1);
  assert.deepEqual(next.root, { pane: target }); assert.equal(next.sequence, s.sequence);
  assert.deepEqual(next.panes[0].tabs, ["browser", "terminal", "agent", "code"]);
  assert.equal(next.panes[0].selected, "code"); assert.equal(next.focused, target); assertInvariant(next);
});
test("多标签源窗口收回一个标签后保留，原比例与其他标签不变", () => {
  let s = dropWorkbenchTab(initial(), "code", "pane-1", "right");
  s = reconcileWorkbenchLayout(s, [...all(s), "extra"]);
  const divider = workbenchGeometry(s, 1000, 800).dividers[0];
  s = resizeWorkbenchDivider(s, divider.id, .62);
  const target = owner(s, "browser"), source = owner(s, "code"), root = s.root;
  const next = dropWorkbenchTab(s, "code", target, "tabbar");
  assert.equal(next.panes.length, 2); assert.equal(next.root, root);
  assert.deepEqual(next.panes.find(p => p.id === source)!.tabs, ["extra"]);
  assert.equal(next.panes.find(p => p.id === source)!.selected, "extra");
  assert.deepEqual(next.panes.find(p => p.id === target)!.tabs, ["browser", "terminal", "agent", "code"]);
  assertInvariant(next, ["agent", "browser", "code", "extra", "terminal"]);
});
test("四窗上限不阻止拖回标签栏；拖回自己的栏不改变状态", () => {
  let s = initial(); s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right");
  s = dropWorkbenchTab(s, "terminal", owner(s, "code"), "bottom"); s = dropWorkbenchTab(s, "agent", owner(s, "browser"), "bottom");
  assert.equal(dropWorkbenchTab(s, "code", owner(s, "code"), "tabbar"), s);
  const next = dropWorkbenchTab(s, "code", owner(s, "agent"), "tabbar");
  assert.equal(next.panes.length, 3); assert.equal(owner(next, "code"), owner(next, "agent")); assertInvariant(next);
  assert.equal(dropWorkbenchTab(next, "code", owner(next, "code"), "tabbar"), next);
});
test("四个边缘都可拆分，中心互换保留两个窗口和原比例", () => {
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    let s = initial(); const before = structuredClone(s);
    s = dropWorkbenchTab(s, "code", owner(s, "browser"), edge); assert.equal(s.panes.length, 2); assertInvariant(s); assert.deepEqual(initial(), before);
    const r = workbenchGeometry(s, 1000, 800).panes;
    const a = r[owner(s, "browser")], b = r[owner(s, "code")];
    if (edge === "left") assert.ok(b.x < a.x);
    if (edge === "right") assert.ok(b.x > a.x);
    if (edge === "top") assert.ok(b.y < a.y);
    if (edge === "bottom") assert.ok(b.y > a.y);
    const sourceId = owner(s, "code"), targetId = owner(s, "browser"), root = s.root, beforeSwap = structuredClone(s);
    s = dropWorkbenchTab(s, "code", targetId, "center");
    assert.equal(s.panes.length, 2); assert.equal(s.root, root); assert.equal(s.sequence, beforeSwap.sequence);
    assert.equal(owner(s, "code"), targetId); assert.equal(owner(s, "browser"), sourceId);
    assert.equal(s.panes.find(p => p.id === sourceId)!.selected, "browser");
    assert.equal(s.panes.find(p => p.id === targetId)!.selected, "code"); assertInvariant(s);
  }
});
test("中心互换只替换双方槽位；非当前源标签不打断原页面", () => {
  let s = initial(); s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right");
  s = reconcileWorkbenchLayout(s, [...all(s), "target-extra", "target-visible"]);
  s = selectWorkbenchTab(s, "target-visible");
  const sourceId = owner(s, "agent"), targetId = owner(s, "target-visible"), root = s.root;
  const before = structuredClone(s);
  const next = dropWorkbenchTab(s, "agent", targetId, "center");
  assert.equal(next.root, root); assert.deepEqual(s, before); assert.equal(next.focused, targetId);
  assert.deepEqual(next.panes.find(p => p.id === sourceId)!.tabs, ["browser", "terminal", "target-visible"]);
  assert.deepEqual(next.panes.find(p => p.id === targetId)!.tabs, ["code", "target-extra", "agent"]);
  assert.equal(next.panes.find(p => p.id === sourceId)!.selected, "browser");
  assert.equal(next.panes.find(p => p.id === targetId)!.selected, "agent");
  assertInvariant(next, ["agent", "browser", "code", "target-extra", "target-visible", "terminal"]);
});
test("四窗中心互换无需空位，分隔树和所有矩形保持不变", () => {
  let s = initial(); s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right");
  s = dropWorkbenchTab(s, "terminal", owner(s, "code"), "bottom"); s = dropWorkbenchTab(s, "agent", owner(s, "browser"), "bottom");
  const divider = workbenchGeometry(s, 1200, 900).dividers[0]; s = resizeWorkbenchDivider(s, divider.id, .63);
  const before = workbenchGeometry(s, 1200, 900), root = s.root;
  const target = owner(s, "terminal"), source = owner(s, "agent");
  const next = dropWorkbenchTab(s, "agent", target, "center");
  assert.equal(next.panes.length, 4); assert.equal(next.root, root);
  assert.equal(owner(next, "agent"), target); assert.equal(owner(next, "terminal"), source);
  assert.deepEqual(workbenchGeometry(next, 1200, 900), before); assertInvariant(next);
});
test("上二下一与上一下二，由落点决定而非布局选择器", () => {
  for (const edge of ["top", "bottom"] as const) {
    let s = initial(); s = dropWorkbenchTab(s, "terminal", owner(s, "browser"), edge);
    s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right");
    const r = workbenchGeometry(s, 1000, 800).panes, a = r[owner(s, "browser")], b = r[owner(s, "code")], c = r[owner(s, "terminal")];
    assert.equal(a.y, b.y); assert.equal(c.width, 1000); assert.ok(edge === "top" ? c.y < a.y : c.y > a.y); assertInvariant(s);
  }
});
test("保留左右式三窗，也允许镜像", () => {
  for (const edge of ["left", "right"] as const) {
    let s = initial(); s = dropWorkbenchTab(s, "code", owner(s, "browser"), edge);
    s = dropWorkbenchTab(s, "terminal", owner(s, "code"), "bottom");
    const r = workbenchGeometry(s, 1000, 800).panes;
    assert.equal(r[owner(s, "browser")].height, 800); assert.equal(r[owner(s, "code")].x, r[owner(s, "terminal")].x); assertInvariant(s);
  }
});
test("四窗上限禁止第五窗，但允许已有单标签窗口重新定位", () => {
  let s = initial(); s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right");
  s = dropWorkbenchTab(s, "terminal", owner(s, "code"), "bottom"); s = dropWorkbenchTab(s, "agent", owner(s, "browser"), "bottom");
  s = reconcileWorkbenchLayout(s, [...all(s), "new"]);
  assert.equal(dropWorkbenchTab(s, "new", owner(s, "agent"), "left"), s);
  const moved = dropWorkbenchTab(s, "code", owner(s, "terminal"), "left");
  assert.notEqual(moved, s); assert.equal(moved.panes.length, 4); assertInvariant(moved, ["agent", "browser", "code", "new", "terminal"]);
});
test("无效标签/目标、同一窗口中心及唯一标签拆分均不改变状态", () => {
  const s = initial(); assert.equal(dropWorkbenchTab(s, "code", "missing", "left"), s);
  assert.equal(dropWorkbenchTab(s, "missing", owner(s, "browser"), "left"), s);
  assert.equal(dropWorkbenchTab(s, "code", owner(s, "browser"), "center"), s);
  const split = dropWorkbenchTab(s, "code", owner(s, "browser"), "right");
  assert.equal(dropWorkbenchTab(split, "code", owner(split, "code"), "bottom"), split);
});
test("选择标签只改变所属窗口，不覆盖其他窗口的局部选择", () => {
  let s = initial(); s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right");
  s = selectWorkbenchTab(s, "agent"); assert.equal(s.panes.find(p => p.id === owner(s, "code"))!.selected, "code");
  const maximized = { ...s, maximized: owner(s, "agent") };
  assert.equal(selectWorkbenchTab(maximized, "code").maximized, owner(s, "code"));
  assert.equal(dropWorkbenchTab(maximized, "agent", owner(s, "code"), "top"), maximized);
});
test("关闭窗口保留全部标签，关闭所有标签后清空树", () => {
  let s = initial(); s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right"); s = mergeWorkbenchPane(s, owner(s, "browser"));
  assert.equal(s.panes.length, 1); assertInvariant(s); assert.equal(mergeWorkbenchPane(s, s.panes[0].id), s);
  s = reconcileWorkbenchLayout(s, []); assert.equal(s.root, null); assert.equal(s.panes.length, 0); assert.equal(s.focused, null);
});
test("外部关闭标签保留本组相邻选择，最后一个关闭自动折叠", () => {
  let s = selectWorkbenchTab(initial(), "code"); s = reconcileWorkbenchLayout(s, ["browser", "terminal", "agent"]);
  assert.equal(s.panes[0].selected, "terminal");
  s = dropWorkbenchTab(s, "terminal", owner(s, "browser"), "right"); s = reconcileWorkbenchLayout(s, ["browser", "agent"]);
  assert.equal(s.panes.length, 1); assert.ok(s.root && "pane" in s.root);
});
test("内部比例夹紧、非有限值忽略、外层尺寸变化不改变布局树", () => {
  let s = dropWorkbenchTab(initial(), "code", "pane-1", "right"); const id = workbenchGeometry(s, 1000, 800).dividers[0].id;
  assert.equal(resizeWorkbenchDivider(s, id, NaN), s);
  s = resizeWorkbenchDivider(s, id, 1.2); assert.equal(workbenchGeometry(s, 1000, 800).dividers[0].ratio, .75);
  s = resizeWorkbenchDivider(s, id, -.3); assert.equal(workbenchGeometry(s, 600, 800).dividers[0].ratio, .25);
  const before = structuredClone(s); workbenchGeometry(s, 1400, 300); assert.deepEqual(s, before);
});
test("落点命中左右上下及中心，越界/分隔缝/放大模式不产生落点", () => {
  const s = initial(); for (const [x,y,edge] of [[1,400,"left"],[999,400,"right"],[500,53,"top"],[500,799,"bottom"],[500,400,"center"],[500,1,"tabbar"]] as const)
    assert.equal(workbenchDropTarget(s,1000,800,x,y)?.edge,edge);
  assert.equal(workbenchDropTarget(s,1000,800,-1,0),null);
  assert.equal(workbenchDropTarget({...s,maximized:s.panes[0].id},1000,800,1,1),null);
  const split=dropWorkbenchTab(s,"code",s.panes[0].id,"right");assert.equal(workbenchDropTarget(split,1000,800,500,400),null);
});
test("标签栏命中优先于上/左/右边缘，下面一排的标签栏同样可收回", () => {
  const s = initial();
  for (const [x, y] of [[1, 1], [999, 1], [500, 51.9]]) assert.equal(workbenchDropTarget(s, 1000, 800, x, y)?.edge, "tabbar");
  assert.equal(workbenchDropTarget(s, 1000, 800, 500, 52)?.edge, "top");
  const split = dropWorkbenchTab(s, "code", s.panes[0].id, "bottom");
  const r = workbenchGeometry(split, 1000, 800).panes[owner(split, "code")];
  assert.deepEqual(workbenchDropTarget(split, 1000, 800, r.x + 2, r.y + 20), { pane: owner(split, "code"), edge: "tabbar" });
});
test("连续移动和外部关闭后始终无空窗口、无重复标签", () => {
  let s = initial();
  for (let i=0;i<120;i++) { const ids=all(s), key=ids[i%ids.length], target=s.panes[(i+1)%s.panes.length];
    s=dropWorkbenchTab(s,key,target.id,(["left","bottom","center","top","right","tabbar"] as const)[i%6]); assertInvariant(s);
    s=reconcileWorkbenchLayout(s,ids);assertInvariant(s);
  }
});

test("同一窗口内重排标签:落在第几个标签之前,选中被拖标签,无变化沿用原引用", () => {
  const s = initial(), id = s.panes[0].id; assert.deepEqual(s.panes[0].tabs, ["browser", "code", "terminal", "agent"]);
  const moved = dropWorkbenchTab(s, "agent", id, "tabbar", 1);
  assert.deepEqual(moved.panes[0].tabs, ["browser", "agent", "code", "terminal"]); assert.equal(moved.panes[0].selected, "agent");
  assert.deepEqual(reorderWorkbenchTab(s, "browser", 3).panes[0].tabs, ["code", "terminal", "browser", "agent"]);
  assert.equal(reorderWorkbenchTab(s, "code", 1), s); assert.equal(reorderWorkbenchTab(s, "code", 2), s);
  assert.deepEqual(reorderWorkbenchTab(s, "code", 99).panes[0].tabs, ["browser", "terminal", "agent", "code"]);
  assert.equal(dropWorkbenchTab(s, "code", id, "tabbar"), s);
});
test("拖到其他窗口标签栏时可指定插入位置", () => {
  let s = dropWorkbenchTab(initial(), "code", "pane-1", "right"); const target = owner(s, "browser");
  s = dropWorkbenchTab(s, "code", target, "tabbar", 0);
  assert.deepEqual(s.panes.find(p => p.id === target)!.tabs, ["code", "browser", "terminal", "agent"]);
});
test("最小窗口尺寸:拆得过窄或过矮不算合法,分隔线比例按像素夹取", () => {
  let s = initial(); s = dropWorkbenchTab(s, "code", owner(s, "browser"), "right"); assert.ok(workbenchFits(s, 640, 800));
  s = dropWorkbenchTab(s, "terminal", owner(s, "code"), "right"); assert.equal(workbenchFits(s, 640, 800), false);
  assert.ok(workbenchFits(s, 1000, 800));
  let v = initial(); v = dropWorkbenchTab(v, "code", owner(v, "browser"), "bottom"); assert.ok(workbenchFits(v, 640, 800));
  assert.equal(workbenchFits(v, 640, WORKBENCH_MIN_PANE_HEIGHT * 2 - 20), false);
  const [lo, hi] = workbenchRatioBounds(640, "x"); assert.ok(lo > 0.25 && Math.abs(lo + hi - 1) < 1e-9);
  assert.ok(Math.abs(lo * (640 - 4) - WORKBENCH_MIN_PANE_WIDTH) < 1e-6);
  assert.deepEqual(workbenchRatioBounds(1600, "x"), [0.25, 0.75]); assert.deepEqual(workbenchRatioBounds(300, "x"), [0.5, 0.5]);
  const divider = workbenchGeometry(s, 640, 800).dividers[0];
  assert.equal(resizeWorkbenchDivider(s, divider.id, 0.9, [lo, hi]).root && (resizeWorkbenchDivider(s, divider.id, 0.9, [lo, hi]).root as { ratio: number }).ratio, hi);
});
test("拖自己窗口的标签时中间区域取最近的边,不留空操作死区;其他窗口的中间仍是互换", () => {
  const s = dropWorkbenchTab(initial(), "code", "pane-1", "right"); const own = owner(s, "browser"), other = owner(s, "code");
  const r = workbenchGeometry(s, 1000, 800).panes[own];
  const cx = r.x + r.width / 2, cy = r.y + 52 + (r.height - 52) / 2;
  assert.deepEqual(workbenchDropTarget(s, 1000, 800, cx, cy), { pane: own, edge: "center" });
  assert.deepEqual(workbenchDropTarget(s, 1000, 800, cx, r.y + r.height * 0.75, own), { pane: own, edge: "bottom" });
  assert.deepEqual(workbenchDropTarget(s, 1000, 800, r.x + r.width * 0.4, cy, own), { pane: own, edge: "left" });
  const o = workbenchGeometry(s, 1000, 800).panes[other];
  assert.deepEqual(workbenchDropTarget(s, 1000, 800, o.x + o.width / 2, o.y + o.height / 2, own), { pane: other, edge: "center" });
});
