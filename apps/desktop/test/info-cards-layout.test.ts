import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLayout,
  dropBoundaries,
  dropIndex,
  dropIndexAtTop,
  hiddenCards,
  hideCard,
  placeAt,
  renderedCards,
  reorderRendered,
  sanitizeLayout,
  showCard,
  stepRendered,
  toggleCollapsed,
  infoCardIds,
  type InfoCardId,
} from "../src/renderer/components/info-cards/info-cards-layout.ts";

const all = new Set<InfoCardId>(infoCardIds);

test("environment is opt-in and retired cards are not offered", () => {
  const layout = defaultLayout();
  assert.deepEqual(renderedCards(layout, all), ["goal", "plan", "context", "changes", "agents", "background"]);
  assert.deepEqual(hiddenCards(layout, all), ["env"]);
  assert.deepEqual(layout.collapsed, ["context"]);
  const restored = sanitizeLayout(showCard(layout, "env"));
  assert.equal(renderedCards(restored, all).at(-1), "env");
  assert.deepEqual(hiddenCards(restored, all), []);
});

test("cards without data are neither rendered nor offered for restore", () => {
  const layout = hideCard(defaultLayout(), "goal");
  const available = new Set<InfoCardId>(["env", "context"]);
  assert.deepEqual(renderedCards(layout, available), ["context"]);
  assert.deepEqual(hiddenCards(layout, available), ["env"]);
});

test("reorder keeps unrendered cards in their slots", () => {
  const layout = defaultLayout();
  const rendered = renderedCards(layout, new Set<InfoCardId>(["env", "goal", "plan", "changes"]));
  const next = reorderRendered(layout, rendered, ["changes", "goal", "plan"]);
  assert.deepEqual(next.order, ["env", "changes", "goal", "context", "plan", "agents", "background"]);
});

test("reorder ignores a list that is not a permutation", () => {
  const layout = defaultLayout();
  const rendered = renderedCards(layout, all);
  assert.equal(reorderRendered(layout, rendered, ["env", "env", "plan"]), layout);
  assert.equal(reorderRendered(layout, rendered, rendered.slice(1)), layout);
});

test("hide then show moves the card to the end", () => {
  let layout = hideCard(defaultLayout(), "goal");
  assert.deepEqual(layout.hidden, ["env", "goal"]);
  assert.equal(hideCard(layout, "goal"), layout);
  layout = showCard(layout, "goal");
  assert.deepEqual(layout.hidden, ["env"]);
  assert.equal(layout.order.at(-1), "goal");
  assert.equal(showCard(layout, "goal"), layout);
});

test("collapse toggles without touching order", () => {
  const layout = defaultLayout();
  const open = toggleCollapsed(layout, "context");
  assert.deepEqual(open.collapsed, []);
  assert.deepEqual(toggleCollapsed(open, "plan").collapsed, ["plan"]);
  assert.deepEqual(open.order, layout.order);
});

test("sanitize drops unknown and duplicate ids and appends new cards", () => {
  const stored = {
    order: ["plan", "outputs", "tools", "bogus", "env", "plan", "context"],
    hidden: ["outputs", "tools", "nope", "env", "env"],
    collapsed: ["plan", "outputs", "tools", 3, "plan"],
  };
  const layout = sanitizeLayout(stored);
  assert.deepEqual(layout.order, ["plan", "env", "context", "goal", "changes", "agents", "background"]);
  assert.deepEqual(layout.hidden, ["env"]);
  assert.deepEqual(layout.collapsed, ["plan"]);
});

test("only the untouched legacy layout adopts the new defaults", () => {
  const previous = {
    order: ["env", "goal", "plan", "context", "outputs", "changes", "agents", "background", "tools"],
    hidden: ["tools"], collapsed: ["context"],
  };
  assert.deepEqual(sanitizeLayout(previous), defaultLayout());
  const custom = sanitizeLayout({ ...previous, collapsed: ["env"] });
  assert.deepEqual(custom.hidden, []);
  assert.deepEqual(custom.collapsed, ["env"]);
});

test("step moves one place and stops at the ends", () => {
  const rendered: InfoCardId[] = ["env", "goal", "plan"];
  assert.deepEqual(stepRendered(rendered, "goal", -1), ["goal", "env", "plan"]);
  assert.deepEqual(stepRendered(rendered, "goal", 1), ["env", "plan", "goal"]);
  assert.equal(stepRendered(rendered, "env", -1), null);
  assert.equal(stepRendered(rendered, "plan", 1), null);
  assert.equal(stepRendered(rendered, "background", 1), null);
});

test("drop index counts the boundaries above the dragged edge", () => {
  assert.equal(dropIndex(10, [50, 150, 250]), 0);
  assert.equal(dropIndex(100, [50, 150, 250]), 1);
  assert.equal(dropIndex(300, [50, 150, 250]), 3);
  assert.deepEqual(placeAt(["a", "b", "c"] as unknown as InfoCardId[], "x" as InfoCardId, 1), ["a", "x", "b", "c"]);
  assert.deepEqual(placeAt(["a"] as unknown as InfoCardId[], "x" as InfoCardId, 9), ["a", "x"]);
});

test("drop boundaries sit in the middle of each slot the dragged card leaves behind", () => {
  // 两张 100px 卡片、间距 10：被拖卡片让位后，剩下的卡片落在 0 和 110，分界是 55 和 165。
  assert.deepEqual(dropBoundaries([100, 100], 10), [55, 165]);
  assert.deepEqual(dropBoundaries([], 10), []);
  assert.equal(dropIndexAtTop(0, [100, 100], 10), 0);
  assert.equal(dropIndexAtTop(54, [100, 100], 10), 0);
  assert.equal(dropIndexAtTop(56, [100, 100], 10), 1);
  assert.equal(dropIndexAtTop(500, [100, 100], 10), 2);
});

/** 落点用的分界与被拖卡片自身高度无关：只要顶端到分界，就换位。 */
test("a tall card reaches the top inside the list instead of above it", () => {
  const above = [260, 150, 300, 40, 220, 120, 160];
  const boundary = dropBoundaries(above, 10)[0]!;
  // 旧判断看卡片中心，顶端得退到 135 - 自身半高：642px 高的卡片要拖到列表上方 186px 处才能排到第一。
  // 现在看顶端，越过顶部卡片（260px）的中段就换位，跟卡片自身多高无关。
  assert.equal(boundary, 135);
  assert.ok(boundary > 0, "顶端不需要越过列表上沿");
  assert.equal(dropIndexAtTop(boundary - 1, above, 10), 0);
  assert.equal(dropIndexAtTop(boundary + 1, above, 10), 1);
});
