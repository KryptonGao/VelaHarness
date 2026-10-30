import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatLaneMaxShrinkRatio, chatLaneMinGap, infoCardMinTextWidthRatio, planChatLane, planInfoCardLane } from "../src/renderer/chat-lane.ts";

/** 自然几何:760px 的列在 [24, 860] 之间居中放不下时才会让位。 */
function plan(overrides: Partial<Parameters<typeof planChatLane>[0]> = {}) {
  return planChatLane({
    laneLeft: 100,
    laneWidth: 760,
    cardLeft: 800,
    laneLimitLeft: 24,
    ...overrides,
  });
}

/** 左移后的最终位置:自然左边界 + 收窄带来的右移 - 左移量。 */
function laneBox(plan: { shift: number; shrink: number }, laneLeft = 100, laneWidth = 760) {
  const left = laneLeft + plan.shrink / 2 - plan.shift;
  return { left, right: left + (laneWidth - plan.shrink) };
}

describe("planInfoCardLane", () => {
  const input = { laneLeft: 100, laneWidth: 760, cardLeft: 447, cardWidth: 300, laneLimitLeft: 24 };

  it("shows cards at exactly 1.25 times their width and hides below it", () => {
    const result = planInfoCardLane(input);
    assert.equal(result.concealed, false);
    assert.equal(input.laneWidth - result.shrink, input.cardWidth * infoCardMinTextWidthRatio);
    assert.deepEqual(planInfoCardLane({ ...input, cardLeft: 446.5 }), { shift: 0, shrink: 0, concealed: true });
  });

  it("replaces the 10% shrink limit only in card mode", () => {
    const geometry = { ...input, cardLeft: 700 };
    assert.deepEqual(planChatLane(geometry), { shift: 0, shrink: 0 });
    const result = planInfoCardLane(geometry);
    assert.equal(result.concealed, false);
    assert.ok(result.shrink > input.laneWidth * chatLaneMaxShrinkRatio);
    const box = laneBox(result);
    assert.equal(box.left - input.laneLimitLeft, chatLaneMinGap);
    assert.equal(geometry.cardLeft - box.right, chatLaneMinGap);
  });

  it("uses the text width after both gutters, including compact padding", () => {
    const result = planInfoCardLane({ ...input, cardLeft: 431, minGap: 16 });
    assert.equal(result.concealed, false);
    assert.equal(input.laneWidth - result.shrink, 375);
    assert.equal(planInfoCardLane({ ...input, cardLeft: 431 }).concealed, true);
  });

  it("caps the text area by the natural lane width", () => {
    assert.equal(planInfoCardLane({ ...input, laneWidth: 374, cardLeft: 2000 }).concealed, true);
    assert.deepEqual(planInfoCardLane({ ...input, laneWidth: 375, cardLeft: 2000 }), { shift: 0, shrink: 0, concealed: false });
  });

  it("recomputes visibility from reserved geometry when the window grows again", () => {
    assert.deepEqual(planInfoCardLane({ ...input, cardLeft: 400 }), { shift: 0, shrink: 0, concealed: true });
    assert.equal(planInfoCardLane(input).concealed, false);
    assert.deepEqual(planInfoCardLane({ ...input, cardLeft: 1000 }), { shift: 0, shrink: 0, concealed: false });
  });

  it("tracks the measured card width rather than a fixed breakpoint", () => {
    assert.equal(planInfoCardLane({ ...input, cardWidth: 299 }).concealed, false);
    assert.equal(planInfoCardLane({ ...input, cardWidth: 301 }).concealed, true);
  });

  it("conceals cards for invalid or empty geometry", () => {
    for (const overrides of [{ cardWidth: 0 }, { cardWidth: Infinity }, { laneWidth: 0 }, { laneWidth: Infinity },
      { laneLeft: NaN }, { cardLeft: NaN }, { cardLeft: Infinity }, { laneLimitLeft: Infinity }, { cardLeft: 0 }]) {
      assert.deepEqual(planInfoCardLane({ ...input, ...overrides }), { shift: 0, shrink: 0, concealed: true });
    }
  });

  it("preserves the ratio and symmetric gutters across card widths and pane sizes", () => {
    for (const cardWidth of [200, 300, 340]) {
      for (let cardLeft = 100; cardLeft < 1300; cardLeft += 3) {
        const result = planInfoCardLane({ ...input, cardWidth, cardLeft });
        const expectedWidth = Math.min(input.laneWidth, cardLeft - input.laneLimitLeft - chatLaneMinGap * 2);
        assert.equal(result.concealed, expectedWidth < cardWidth * infoCardMinTextWidthRatio);
        if (result.concealed) {
          assert.equal(result.shift, 0);
          assert.equal(result.shrink, 0);
        } else if (result.shift || result.shrink) {
          const box = laneBox(result);
          assert.ok(box.right <= cardLeft - chatLaneMinGap + 1e-9);
          assert.ok(Math.abs((box.left - input.laneLimitLeft) - (cardLeft - box.right)) < 1e-9);
        }
      }
    }
  });
});

describe("planChatLane", () => {
  it("keeps the natural centered layout when the card does not cover the column", () => {
    assert.deepEqual(plan({ cardLeft: 1000 }), { shift: 0, shrink: 0 });
    // 刚好留足最小间距时不用让位。
    assert.deepEqual(plan({ cardLeft: 884 }), { shift: 0, shrink: 0 });
  });

  it("centers the column between the sidebar boundary and the card", () => {
    const result = plan({ cardLeft: 800 });
    assert.equal(result.shrink, 32);
    assert.equal(result.shift, 68);
    const box = laneBox(result);
    // 左缘到分界 24 的距离 = 右缘到卡片 800 的距离。
    assert.equal(box.left - 24, 800 - box.right);
    assert.equal(box.left - 24, chatLaneMinGap);
  });

  it("reserves both gutters in addition to the card shrink budget", () => {
    const result = plan({ cardLeft: 760 });
    assert.equal(result.shrink, 72);
    const box = laneBox(result);
    assert.equal(box.left, 48);
    assert.equal(box.right, 736);
    assert.ok(result.shrink < 760 * chatLaneMaxShrinkRatio);
  });

  it("leaves the card covering the column once the needed shrink reaches 10%", () => {
    // 需要收窄 84px,超过 10%。
    assert.deepEqual(plan({ cardLeft: 700 }), { shift: 0, shrink: 0 });
    // 恰好 10%(region 684)也不收。
    assert.deepEqual(plan({ cardLeft: 708 }), { shift: 0, shrink: 0 });
    // 少 1px 就还算小于 10%。
    const almost = plan({ cardLeft: 709 });
    assert.equal(almost.shrink, 123);
    assert.equal(laneBox(almost).left, 48);
    assert.equal(laneBox(almost).right, 685);
  });

  it("leaves space even when the natural column only touches the card", () => {
    const result = plan({ cardLeft: 860 });
    const box = laneBox(result);
    assert.equal(result.shrink, 0);
    assert.equal(box.left - 24, 38);
    assert.equal(860 - box.right, 38);
  });

  it("keeps 24px gutters at the reported window size", () => {
    const input = { laneLeft: 437, laneWidth: 760, cardLeft: 1018, laneLimitLeft: 305 };
    const result = planChatLane(input);
    const box = laneBox(result, input.laneLeft, input.laneWidth);
    assert.equal(box.left, 329);
    assert.equal(box.right, 994);
  });

  it("uses the compact layout's 16px gutter", () => {
    const result = plan({ cardLeft: 760, minGap: 16 });
    const box = laneBox(result);
    assert.equal(box.left, 40);
    assert.equal(box.right, 744);
  });

  it("ignores degenerate measurements", () => {
    assert.deepEqual(plan({ laneWidth: 0 }), { shift: 0, shrink: 0 });
    assert.deepEqual(plan({ cardLeft: Number.NaN }), { shift: 0, shrink: 0 });
    assert.deepEqual(plan({ laneLimitLeft: Number.POSITIVE_INFINITY }), { shift: 0, shrink: 0 });
    // 卡片左缘跑到分界左侧时无从居中。
    assert.deepEqual(plan({ cardLeft: 0 }), { shift: 0, shrink: 0 });
  });

  it("never overlaps the card, stays right of the boundary, and keeps equal gaps", () => {
    for (let cardLeft = 400; cardLeft <= 1200; cardLeft += 7) {
      const result = plan({ cardLeft });
      if (result.shift === 0 && result.shrink === 0) continue;
      const box = laneBox(result);
      assert.ok(box.right <= cardLeft - chatLaneMinGap + 1e-9, `right ${box.right} vs ${cardLeft}`);
      assert.ok(box.left >= 24 + chatLaneMinGap - 1e-9, `left ${box.left}`);
      assert.ok(Math.abs((box.left - 24) - (cardLeft - box.right)) < 1e-9, "gaps differ");
      assert.ok(result.shrink - chatLaneMinGap * 2 < 760 * chatLaneMaxShrinkRatio);
    }
  });
});
