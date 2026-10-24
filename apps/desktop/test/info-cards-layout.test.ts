import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLayout,
  dropIndex,
  hiddenCards,
  hideCard,
  placeAt,
  renderedCards,
  reorderRendered,
  sanitizeLayout,
  showCard,
  stepRendered,
  toggleCollapsed,
  type InfoCardId,
  type InfoCardLayout,
} from "../src/renderer/components/info-cards/info-cards-layout.ts";

const all = new Set<InfoCardId>(["env", "goal", "plan", "context", "outputs", "changes", "agents", "tools"]);

test("default layout hides tools and collapses context", () => {
  const layout = defaultLayout();
  assert.deepEqual(renderedCards(layout, all), ["env", "goal", "plan", "context", "outputs", "changes", "agents"]);
  assert.deepEqual(hiddenCards(layout, all), ["tools"]);
  assert.deepEqual(layout.collapsed, ["context"]);
});

test("cards without data are neither rendered nor offered for restore", () => {
  const layout = defaultLayout();
  const available = new Set<InfoCardId>(["env", "context", "tools"]);
  assert.deepEqual(renderedCards(layout, available), ["env", "context"]);
  assert.deepEqual(hiddenCards(layout, available), ["tools"]);
});

test("reorder keeps unrendered cards in their slots", () => {
  const layout = defaultLayout();
  const rendered = renderedCards(layout, new Set<InfoCardId>(["env", "plan", "changes"]));
  const next = reorderRendered(layout, rendered, ["changes", "env", "plan"]);
  assert.deepEqual(next.order, ["changes", "goal", "env", "context", "outputs", "plan", "agents", "tools"]);
});

test("reorder ignores a list that is not a permutation", () => {
  const layout = defaultLayout();
  const rendered = renderedCards(layout, all);
  assert.equal(reorderRendered(layout, rendered, ["env", "env", "plan"]), layout);
  assert.equal(reorderRendered(layout, rendered, rendered.slice(1)), layout);
});

test("hide then show moves the card to the end", () => {
  let layout = hideCard(defaultLayout(), "goal");
  assert.deepEqual(layout.hidden, ["tools", "goal"]);
  assert.equal(hideCard(layout, "goal"), layout);
  layout = showCard(layout, "goal");
  assert.deepEqual(layout.hidden, ["tools"]);
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
    order: ["plan", "bogus", "env", "plan", "context"],
    hidden: ["nope", "env", "env"],
    collapsed: ["plan", 3, "plan"],
  } as unknown as InfoCardLayout;
  const layout = sanitizeLayout(stored);
  assert.deepEqual(layout.order, ["plan", "env", "context", "goal", "outputs", "changes", "agents", "tools"]);
  assert.deepEqual(layout.hidden, ["env", "tools"]);
  assert.deepEqual(layout.collapsed, ["plan"]);
});

test("step moves one place and stops at the ends", () => {
  const rendered: InfoCardId[] = ["env", "goal", "plan"];
  assert.deepEqual(stepRendered(rendered, "goal", -1), ["goal", "env", "plan"]);
  assert.deepEqual(stepRendered(rendered, "goal", 1), ["env", "plan", "goal"]);
  assert.equal(stepRendered(rendered, "env", -1), null);
  assert.equal(stepRendered(rendered, "plan", 1), null);
  assert.equal(stepRendered(rendered, "tools", 1), null);
});

test("drop index counts the midpoints above the dragged center", () => {
  assert.equal(dropIndex(10, [50, 150, 250]), 0);
  assert.equal(dropIndex(100, [50, 150, 250]), 1);
  assert.equal(dropIndex(300, [50, 150, 250]), 3);
  assert.deepEqual(placeAt(["a", "b", "c"] as unknown as InfoCardId[], "x" as InfoCardId, 1), ["a", "x", "b", "c"]);
  assert.deepEqual(placeAt(["a"] as unknown as InfoCardId[], "x" as InfoCardId, 9), ["a", "x"]);
});
