import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeQuotes, composeReply, elementNumber, hasReplyText, isElementReply, normalizeQuote, quoteBlock, replyCardText, replyMessage, type ReplyCard } from "../src/renderer/components/selection-actions.ts";

describe("选中文字引用", () => {
  it("去掉首尾空白并统一换行", () => {
    assert.equal(normalizeQuote("  第一行\r\n第二行 \n"), "第一行\n第二行");
  });

  it("每一行都是引用，空行保留引用符号", () => {
    assert.equal(quoteBlock("a\n\nb"), "> a\n>\n> b");
  });

  it("过长的选区被截断", () => {
    const quote = normalizeQuote("x".repeat(5_000));
    assert.equal(quote.length, 4_001);
    assert.ok(quote.endsWith("…"));
  });

  it("回复把引用放在补充的话前面，没有引用时原样发送", () => {
    assert.equal(composeReply("请再发截图。", "好的"), "> 请再发截图。\n\n好的");
    assert.equal(composeReply(null, "好的"), "好的");
  });

  it("多张回复卡片各自带着原文，按顺序排在输入框里的话前面", () => {
    const replies = [{ quote: "甲", text: "好的" }, { quote: "乙", text: "" }, { quote: "丙", text: "再看看" }];
    assert.equal(replyMessage(replies, "补充"), "> 甲\n\n好的\n\n> 乙\n\n> 丙\n\n再看看\n\n补充");
    assert.equal(replyMessage([], " 只有输入框 "), "只有输入框");
  });

  it("只要有一张卡片写了回复就能直接发送", () => {
    assert.equal(hasReplyText([{ quote: "甲", text: " " }]), false);
    assert.equal(hasReplyText([{ quote: "甲", text: " " }, { quote: "乙", text: "好" }]), true);
  });

  it("侧边聊天的多张引用按顺序排在问题前面", () => {
    assert.equal(composeQuotes(["甲", "乙"], "问题"), "> 甲\n\n> 乙\n\n问题");
    assert.equal(composeQuotes([], "问题"), "问题");
  });

  describe("元素批注卡片", () => {
    const data = {
      pageUrl: "http://localhost:3000/", pageTitle: "首页", rect: { x: 10, y: 20, width: 30, height: 40 }, viewport: { width: 800, height: 600 },
      element: { tag: "button", classes: ["primary"], text: "提交", selector: "button.primary", framePath: [], styles: {}, sensitive: false },
    };
    const cards: ReplyCard[] = [
      { id: "a", kind: "text", quote: "甲", text: "好的" },
      { id: "b", kind: "element", tabId: "t", text: "太小了", data },
      { id: "c", kind: "element", tabId: "t", text: "", data },
    ];

    it("卡片文字：写了批注显示批注，否则显示元素简述", () => {
      assert.equal(replyCardText(cards[1]!), "太小了");
      assert.equal(replyCardText(cards[2]!), "button.primary「提交」");
      assert.equal(isElementReply(cards[0]!), false);
      assert.equal(isElementReply(cards[1]!), true);
    });

    it("只有元素没有文字的批注不算回复文字，输入框必须有内容", () => {
      assert.equal(hasReplyText([cards[2]!]), false);
      assert.equal(hasReplyText([cards[1]!]), true);
    });

    it("元素批注与文字回复混排，按卡片顺序编号，输入框的话在最后", () => {
      const message = replyMessage(cards, "补充", { images: new Map([["b", { ref: 1 }]]) });
      assert.ok(message.startsWith("> 甲\n\n好的\n\n> [页面批注 1] http://localhost:3000/（首页）"));
      assert.match(message, /见图 1\n\n太小了\n\n> \[页面批注 2\]/);
      assert.ok(message.endsWith("\n\n补充"));
      assert.equal(elementNumber(cards, "b"), 1);
      assert.equal(elementNumber(cards, "c"), 2);
    });

    it("失效的批注在引用块里注明，仍然发送", () => {
      const message = replyMessage([cards[1]!], "", { stale: new Set(["b"]) });
      assert.match(message, /元素已失效/);
      assert.match(message, /太小了$/);
    });
  });
});
