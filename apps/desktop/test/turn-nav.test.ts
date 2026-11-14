import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TURN_NAV_HIDE_PX,
  TURN_NAV_MIN_TURNS,
  TURN_NAV_REVEAL_PX,
  buildTurnNavItems,
  findActiveTurnIndex,
  nextTurnNavReveal,
  positionTurnNavPopover,
  summarizeNavText,
} from "../src/renderer/components/turn-nav.ts";
import { TOOLTIP_EXCLUDED } from "../src/renderer/button-tooltip.ts";
import { setActiveLocale } from "../src/renderer/locale.ts";
import type { UiMessage } from "../src/renderer/hooks/useSession.ts";

function message(partial: Partial<UiMessage> & Pick<UiMessage, "id" | "role">): UiMessage {
  return {
    text: "",
    thinking: "",
    tools: [],
    ...partial,
  };
}

describe("turn-nav", () => {
  it("excludes turn-nav dots from the global button tooltip", () => {
    assert.ok(TOOLTIP_EXCLUDED.includes(".turn-nav"));
  });

  it("summarizes markdown text cleanly for popover previews", () => {
    setActiveLocale("zh-CN");
    const raw = "## 调整方案\n\n已调整 `footer` 的 [语言选择器](https://example.com) 样式，并移除 **旗帜**。\n- 第一项\n- 第二项";
    assert.equal(
      summarizeNavText(raw, 200),
      "调整方案 已调整 footer 的 语言选择器 样式，并移除 旗帜。 第一项 第二项",
    );
    assert.equal(summarizeNavText("这是一段很长的测试文本内容", 8), "这是一段很长的…");
  });

  it("builds turn navigation items with final reply previews and fallbacks", () => {
    setActiveLocale("zh-CN");
    const items = buildTurnNavItems([
      {
        id: "t1",
        user: { text: "没展开的时候不显示旗帜，也不要胶囊形状的框", timestamp: 1000 },
        assistants: [
          message({ id: "a1", role: "assistant", text: "中间过程", tools: [{ id: "tool-1", name: "edit", input: {}, status: "done" }] }),
          message({ id: "a2", role: "assistant", text: "已调整 `footer` 的语言选择器样式与显示逻辑。", timestamp: 2000 }),
        ],
      },
      {
        id: "t2",
        user: { text: "", images: [{ mimeType: "image/png", data: "abc" }], timestamp: 3000 },
        assistants: [],
      },
      {
        id: "t3",
        user: null,
        assistants: [message({ id: "a3", role: "assistant", text: "恢复的消息", turnCompletedAt: 4000 })],
      },
    ]);

    assert.equal(items.length, 3);
    assert.equal(items[0]?.prompt, "没展开的时候不显示旗帜，也不要胶囊形状的框");
    assert.equal(items[0]?.replyPreview, "已调整 footer 的语言选择器样式与显示逻辑。");
    assert.equal(items[0]?.timestamp, 1000);
    assert.equal(items[1]?.prompt, "[图片]");
    assert.equal(items[1]?.replyPreview, null);
    assert.equal(items[2]?.prompt, "助手消息");
    assert.equal(items[2]?.timestamp, 4000);
    assert.equal(TURN_NAV_MIN_TURNS, 4);
  });

  it("finds active turn index across top, middle, and bottom scroll positions", () => {
    const tops = [20, 420, 960, 1540, 2100];
    const getTurnTop = (i: number) => tops[i]!;

    assert.equal(findActiveTurnIndex({ scrollTop: 0, scrollHeight: 2800, clientHeight: 600, turnCount: 5, getTurnTop }), 0);
    assert.equal(findActiveTurnIndex({ scrollTop: 2190, scrollHeight: 2800, clientHeight: 600, turnCount: 5, getTurnTop }), 4);
    assert.equal(findActiveTurnIndex({ scrollTop: 350, scrollHeight: 2800, clientHeight: 600, turnCount: 5, getTurnTop }), 1);
    assert.equal(findActiveTurnIndex({ scrollTop: 940, scrollHeight: 2800, clientHeight: 600, turnCount: 5, getTurnTop }), 2);
    assert.equal(findActiveTurnIndex({ scrollTop: 1500, scrollHeight: 2800, clientHeight: 600, turnCount: 5, getTurnTop }), 3);
    assert.equal(findActiveTurnIndex({ scrollTop: 0, scrollHeight: 600, clientHeight: 600, turnCount: 0, getTurnTop }), -1);
  });

  it("positions popover beside hovered dot and clamps within the rail bounds", () => {
    assert.deepEqual(positionTurnNavPopover({ dotCenterY: 160, popoverHeight: 110, railHeight: 500 }), { top: 132 });
    assert.deepEqual(positionTurnNavPopover({ dotCenterY: 10, popoverHeight: 110, railHeight: 500 }), { top: 0 });
    assert.deepEqual(positionTurnNavPopover({ dotCenterY: 490, popoverHeight: 110, railHeight: 500 }), { top: 390 });
    assert.deepEqual(positionTurnNavPopover({ dotCenterY: 50, popoverHeight: 200, railHeight: 120 }), { top: 0 });
  });

  it("reveals near the left edge with hysteresis and hides outside", () => {
    assert.equal(nextTurnNavReveal(false, -1), false);
    assert.equal(nextTurnNavReveal(false, 0), true);
    assert.equal(nextTurnNavReveal(false, TURN_NAV_REVEAL_PX), true);
    assert.equal(nextTurnNavReveal(false, TURN_NAV_REVEAL_PX + 1), false);
    assert.equal(nextTurnNavReveal(true, TURN_NAV_REVEAL_PX + 1), true);
    assert.equal(nextTurnNavReveal(true, TURN_NAV_HIDE_PX), true);
    assert.equal(nextTurnNavReveal(true, TURN_NAV_HIDE_PX + 1), false);
    assert.equal(nextTurnNavReveal(true, -1), false);
  });
});
