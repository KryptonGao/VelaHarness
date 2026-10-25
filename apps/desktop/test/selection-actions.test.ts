import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeQuotes, composeReply, hasReplyText, normalizeQuote, quoteBlock, replyMessage } from "../src/renderer/components/selection-actions.ts";

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
});
