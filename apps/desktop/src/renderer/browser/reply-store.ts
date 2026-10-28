import { useSyncExternalStore } from "react";
import { maxElementAnnotations, type BrowserAnnotationTrack } from "@vela/shared";
import { isElementReply, type ElementReplyDraft, type ReplyCard, type TextReplyDraft } from "../components/selection-actions";

/**
 * 按对话保存的回复卡片：选中文字后的回复与浏览器里的元素批注是同一种东西，
 * 由对话视图、输入框和浏览器面板共同读写。
 */
export interface FocusRequest { id: string; tabId: string; nonce: number; at: number }

const empty: readonly ReplyCard[] = [];
const noTracking: ReadonlyMap<string, BrowserAnnotationTrack> = new Map();

export class ReplyStore {
  private cards = new Map<string, readonly ReplyCard[]>();
  /** 已经发出、还没确认送达的卡片：从界面上拿走，但页面里的元素句柄要保留到确认为止。 */
  private inflight = new Map<string, readonly ReplyCard[]>();
  private tracking: ReadonlyMap<string, BrowserAnnotationTrack> = noTracking;
  private focus: FocusRequest | null = null;
  private version = 0;
  private nonce = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getVersion = (): number => this.version;
  private emit(): void { this.version++; for (const listener of this.listeners) listener(); }

  get(key: string): readonly ReplyCard[] { return this.cards.get(key) ?? empty; }
  trackingOf = (): ReadonlyMap<string, BrowserAnnotationTrack> => this.tracking;
  focusRequest = (): FocusRequest | null => this.focus;

  private set(key: string, next: readonly ReplyCard[]): void {
    if (next.length) this.cards.set(key, next); else this.cards.delete(key);
    this.emit();
  }

  addText(key: string, quote: string, text: string): void {
    const card: ReplyCard = { id: crypto.randomUUID(), kind: "text", quote, text } satisfies TextReplyDraft & { id: string };
    this.set(key, [...this.get(key), card]);
  }
  /** 一条消息最多引用 20 条元素批注；超出时返回 false。 */
  canAddElement(key: string): boolean {
    return this.get(key).filter(isElementReply).length < maxElementAnnotations;
  }
  addElement(key: string, card: ElementReplyDraft & { id: string }): boolean {
    if (!this.canAddElement(key)) return false;
    this.set(key, [...this.get(key), card]);
    return true;
  }
  setText(key: string, id: string, text: string): void {
    this.set(key, this.get(key).map((card) => (card.id === id ? { ...card, text } : card)));
  }
  remove(key: string, id: string): void {
    const current = this.get(key);
    if (current.some((card) => card.id === id)) this.set(key, current.filter((card) => card.id !== id));
  }
  clear(key: string): void { if (this.cards.has(key)) this.set(key, empty); }
  /** 切走对话时丢掉选中文字的引用；元素批注属于浏览器标签页，保留。 */
  dropTextReplies(key: string): void {
    const current = this.get(key);
    if (current.some((card) => !isElementReply(card))) this.set(key, current.filter(isElementReply));
  }
  /** 标签页关闭：它的批注一并移除。 */
  dropTab(tabId: string): void {
    let changed = false;
    for (const map of [this.cards, this.inflight]) {
      for (const [key, list] of map) {
        const next = list.filter((card) => !(isElementReply(card) && card.tabId === tabId));
        if (next.length === list.length) continue;
        changed = true;
        if (next.length) map.set(key, next); else map.delete(key);
      }
    }
    if (changed) this.emit();
  }

  /** 开始发送：卡片离开界面，元素句柄保留；返回发出去的卡片。 */
  beginSend(key: string): readonly ReplyCard[] {
    const sent = this.get(key);
    if (!sent.length) return sent;
    this.inflight.set(key, [...(this.inflight.get(key) ?? empty), ...sent]);
    this.set(key, empty);
    return sent;
  }
  /** 消息留下了：释放元素句柄；没有留下：原样放回，页面标记保留。 */
  settleSend(key: string, sent: readonly ReplyCard[], kept: boolean): void {
    if (!sent.length) return;
    const ids = new Set(sent.map((card) => card.id));
    const pending = (this.inflight.get(key) ?? empty).filter((card) => !ids.has(card.id));
    if (pending.length) this.inflight.set(key, pending); else this.inflight.delete(key);
    if (kept) { this.emit(); return; }
    const present = new Set(this.get(key).map((card) => card.id));
    this.set(key, [...sent.filter((card) => !present.has(card.id)), ...this.get(key)]);
  }

  /** 页面里仍然需要保留句柄的元素批注编号（含正在发送的）。 */
  liveElementIds(): Set<string> {
    const ids = new Set<string>();
    for (const map of [this.cards, this.inflight]) {
      for (const list of map.values()) for (const card of list) if (isElementReply(card)) ids.add(card.id);
    }
    return ids;
  }
  /** 把某个标签页当前的批注位置合并进来；不再有卡片的编号一并清掉。 */
  setTracking(tabId: string, items: readonly BrowserAnnotationTrack[]): void {
    const tabs = this.elementTabs();
    const next = new Map<string, BrowserAnnotationTrack>();
    for (const [id, item] of this.tracking) if (tabs.has(id) && tabs.get(id) !== tabId) next.set(id, item);
    for (const item of items) if (tabs.get(item.id) === tabId) next.set(item.id, item);
    const same = next.size === this.tracking.size
      && [...next].every(([id, item]) => JSON.stringify(this.tracking.get(id)) === JSON.stringify(item));
    if (same) return;
    this.tracking = next;
    this.emit();
  }
  private elementTabs(): Map<string, string> {
    const tabs = new Map<string, string>();
    for (const map of [this.cards, this.inflight]) {
      for (const list of map.values()) for (const card of list) if (isElementReply(card)) tabs.set(card.id, card.tabId);
    }
    return tabs;
  }
  requestFocus(id: string): void {
    const tabId = this.elementTabs().get(id);
    if (!tabId) return;
    this.focus = { id, tabId, nonce: ++this.nonce, at: Date.now() };
    this.emit();
  }
}

export const replyStore = new ReplyStore();

/** 当前对话的回复卡片，按创建顺序。 */
export function useReplyCards(key: string): readonly ReplyCard[] {
  return useSyncExternalStore(replyStore.subscribe, () => replyStore.get(key));
}
export function useAnnotationTracking(): ReadonlyMap<string, BrowserAnnotationTrack> {
  return useSyncExternalStore(replyStore.subscribe, replyStore.trackingOf);
}
export function useReplyFocus(): FocusRequest | null {
  return useSyncExternalStore(replyStore.subscribe, replyStore.focusRequest);
}
