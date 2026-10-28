import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReplyStore } from "../src/renderer/browser/reply-store.ts";
import { planAnnotationImages } from "../src/renderer/components/annotation-images.ts";
import { isElementReply, type ElementReplyDraft, type ReplyCard } from "../src/renderer/components/selection-actions.ts";

const data: ElementReplyDraft["data"] = {
  pageUrl: "http://localhost:3000/", pageTitle: "首页", rect: null, viewport: { width: 800, height: 600 },
  element: { tag: "a", classes: [], selector: "a", framePath: [], styles: {}, sensitive: false },
};
const element = (id: string, tabId = "tab", text = ""): ElementReplyDraft & { id: string } => ({ id, kind: "element", tabId, text, data });
const track = (id: string, status: "ok" | "hidden" | "stale" = "ok", shot: "pending" | "ok" | "failed" = "ok") =>
  ({ id, status, shot, rect: null, viewport: { width: 800, height: 600 } });

describe("回复卡片按对话保存", () => {
  it("文字回复与元素批注按创建顺序排在同一排，对话之间互不影响", () => {
    const store = new ReplyStore();
    store.addText("one", "引文", "好");
    assert.equal(store.addElement("one", element("e1")), true);
    store.addElement("two", element("e2"));
    assert.deepEqual(store.get("one").map((card) => card.id.length > 0 && (isElementReply(card) ? "element" : "text")), ["text", "element"]);
    assert.equal(store.get("two").length, 1);
    assert.equal(store.get("one"), store.get("one"), "没有变化时引用保持稳定");
  });

  it("一条消息最多引用 20 条元素批注", () => {
    const store = new ReplyStore();
    for (let index = 0; index < 20; index++) assert.equal(store.addElement("c", element(`e${index}`)), true);
    assert.equal(store.canAddElement("c"), false);
    assert.equal(store.addElement("c", element("extra")), false);
    store.addText("c", "q", "t");
    assert.equal(store.get("c").length, 21, "文字回复不占批注名额");
  });

  it("切走对话只丢文字引用，关闭标签页移除它的批注", () => {
    const store = new ReplyStore();
    store.addText("one", "q", "t"); store.addElement("one", element("a", "tab-1")); store.addElement("one", element("b", "tab-2"));
    store.dropTextReplies("one");
    assert.deepEqual(store.get("one").map((card) => card.id), ["a", "b"]);
    store.dropTab("tab-1");
    assert.deepEqual(store.get("one").map((card) => card.id), ["b"]);
  });

  it("发送成功：卡片清空，句柄在确认前一直保留，确认后释放", () => {
    const store = new ReplyStore();
    store.addElement("c", element("a"));
    const sent = store.beginSend("c");
    assert.equal(store.get("c").length, 0);
    assert.deepEqual([...store.liveElementIds()], ["a"]);
    store.settleSend("c", sent, true);
    assert.deepEqual([...store.liveElementIds()], []);
  });

  it("发送失败：卡片原样放回在新卡片之前，句柄从未释放", () => {
    const store = new ReplyStore();
    store.addText("c", "q", "t"); store.addElement("c", element("a"));
    const sent = store.beginSend("c");
    store.addElement("c", element("later"));
    store.settleSend("c", sent, false);
    assert.deepEqual(store.get("c").map((card) => card.id).slice(1), ["a", "later"]);
    assert.equal(store.get("c").length, 3);
    assert.ok(store.liveElementIds().has("a"));
  });

  it("位置跟踪只保留还有卡片的批注，标签页之间互不覆盖", () => {
    const store = new ReplyStore();
    store.addElement("c", element("a", "tab-1")); store.addElement("c", element("b", "tab-2"));
    store.setTracking("tab-1", [track("a"), track("ghost")]);
    store.setTracking("tab-2", [track("b", "stale")]);
    assert.deepEqual([...store.trackingOf().keys()].sort(), ["a", "b"]);
    store.setTracking("tab-1", []);
    assert.deepEqual([...store.trackingOf().keys()], ["b"]);
    const before = store.trackingOf();
    store.setTracking("tab-2", [track("b", "stale")]);
    assert.equal(store.trackingOf(), before, "内容没变不触发更新");
  });

  it("点卡片请求定位，只对存在的批注有效", () => {
    const store = new ReplyStore();
    store.addElement("c", element("a", "tab-1"));
    store.requestFocus("nope");
    assert.equal(store.focusRequest(), null);
    store.requestFocus("a");
    assert.equal(store.focusRequest()?.tabId, "tab-1");
  });
});

describe("元素截图的名额", () => {
  const cards: ReplyCard[] = ["a", "b", "c", "d", "e", "f"].map((id) => element(id));
  const tracking = new Map([
    ["a", track("a")], ["b", track("b", "stale")], ["c", track("c", "ok", "failed")],
    ["d", track("d", "hidden", "pending")], ["e", track("e")], ["f", track("f")],
  ]);

  it("失效的只发文字，失败的注明，其余按顺序占名额，超出的注明省略", () => {
    const plan = planAnnotationImages(cards, tracking, 4);
    assert.deepEqual([...plan], [["a", "send"], ["b", "stale"], ["c", "failed"], ["d", "send"], ["e", "send"], ["f", "send"]]);
    assert.deepEqual([...planAnnotationImages(cards, tracking, 2)].map(([, value]) => value), ["send", "stale", "failed", "send", "omitted", "omitted"]);
  });

  it("每条消息最多 4 张，用户自己的附件占满名额时全部省略", () => {
    assert.equal([...planAnnotationImages(cards, tracking, 99).values()].filter((v) => v === "send").length, 4);
    assert.equal([...planAnnotationImages(cards, tracking, 0).values()].filter((v) => v === "send").length, 0);
  });

  it("主进程已经不认识的批注当作失效", () => {
    assert.equal(planAnnotationImages([element("x")], new Map(), 4).get("x"), "stale");
  });
});
