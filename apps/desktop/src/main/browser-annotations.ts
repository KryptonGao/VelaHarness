import { randomUUID } from 'node:crypto';
import type { AgentAnnotationListing, AgentAnnotationRecord, AgentAnnotationReview, AnnotationHandoffItem, AnnotationRect, AnnotationShotState, AnnotationTrackStatus, AnnotationViewport, BrowserAnnotationImage, BrowserTabAnnotation, ElementDescription } from '../../../../packages/shared/src/browser-annotation';
import { annotationInViewport, annotationRef, classifyAnnotationBox, maxAnnotationText } from '../../../../packages/shared/src/browser-annotation';
import type { BrowserUiCommand } from '../../../../packages/shared/src/browser';
import { UI_BROWSER_BLANK_URL } from '../browser-policy';
import type { AnnotationBoxResult, AnnotationDescribed, AnnotationHit } from './browser-cdp';
import { BrowserHostError, type BrowserRecord } from './browser-session-registry';

/** The part of the CDP adapter that annotations use. It never exposes raw CDP to callers. */
export interface AnnotationBackend {
  setAnnotationListener(listener: ((hit: AnnotationHit) => void) | null): void;
  annotationStart(): Promise<void>;
  annotationStop(): Promise<void>;
  annotationDescribe(hit: AnnotationHit): Promise<AnnotationDescribed>;
  annotationNeighbor(hit: AnnotationHit, direction: 'parent' | 'child'): Promise<AnnotationHit | null>;
  annotationBox(hit: AnnotationHit): Promise<AnnotationBoxResult>;
  annotationCapture(rect: AnnotationRect, viewport: AnnotationViewport): Promise<BrowserAnnotationImage>;
  /** 按选择器重新找到元素（页面刷新或热更新后）；只在恰好命中一个时成功。 */
  annotationLocate(element: { selector: string; framePath: string[] }): Promise<AnnotationHit | 'missing' | 'ambiguous'>;
  annotationReveal(hit: AnnotationHit): Promise<void>;
}
export interface AnnotationDeps {
  /** Null while the page is not attached or automation is unsupported. */
  backend(tab: BrowserRecord): AnnotationBackend | null;
  publish(tab: BrowserRecord): void;
  /** True while an Agent invocation is operating the conversation's browser. */
  operating(conversationId: string | null): boolean;
}
type AnnotationCommand = Extract<BrowserUiCommand, { type: `annotate-${string}` }>;

interface Pick { id: string; hit: AnnotationHit; stack: AnnotationHit[]; described: AnnotationDescribed }
interface Delivered { note: string; resolution?: string }
interface Item {
  hit: AnnotationHit; generation: number; status: AnnotationTrackStatus; rect: AnnotationRect | null;
  viewport: AnnotationViewport; shot: AnnotationShotState; image: BrowserAnnotationImage | null; capture: Promise<void>;
  element: ElementDescription; pageUrl: string; pageTitle: string;
  /** 已随消息发出：不再属于输入框，由主进程保留给 Agent 复核。 */
  delivered?: Delivered;
}
interface TabEntry {
  mode: boolean; pick: Pick | null; notice: { code: 'pick-failed'; nonce: number } | null;
  items: Map<string, Item>; token: number; tracking: boolean; busy: boolean; timer?: ReturnType<typeof setInterval>;
}
const maxItemsPerTab = 100;
/** 每个标签页最多保留给 Agent 的已发送批注；超出时丢弃最早的。 */
const maxDeliveredPerTab = 30;
const defaultSettleMs = 2_500;
const maxSettleMs = 10_000;
const settleStableMs = 450;
const settlePollMs = 150;
const trackIntervalMs = 150;
const imageWaitMs = 8000;
const idPattern = /^[\w.:-]{1,100}$/;

/** Element annotations of every tab. State is trusted-main authority; the renderer only projects it. */
export class BrowserAnnotations {
  private readonly tabs = new Map<string, TabEntry>();
  private nonce = 0;
  constructor(private readonly deps: AnnotationDeps) {}

  state(tabId: string): BrowserTabAnnotation | undefined {
    const entry = this.tabs.get(tabId);
    if (!entry || (!entry.mode && !entry.pick && !entry.items.size && !entry.notice)) return undefined;
    const pick = entry.pick;
    const delivered = [...entry.items].filter(([, item]) => item.delivered)
      .map(([id, item]) => ({ id, status: item.delivered?.resolution !== undefined ? 'resolved' as const : 'open' as const }));
    return {
      mode: entry.mode,
      notice: entry.notice,
      pick: pick ? {
        id: pick.id, element: pick.described.element, rect: pick.described.rect, viewport: pick.described.viewport,
        canParent: pick.described.canParent, canChild: pick.stack.length > 0 || pick.described.canChild,
      } : null,
      items: [...entry.items].filter(([, item]) => !item.delivered)
        .map(([id, item]) => ({ id, status: item.status, rect: item.rect, viewport: item.viewport, shot: item.shot })),
      ...(delivered.length ? { delivered } : {}),
    };
  }

  async command(tab: BrowserRecord, input: AnnotationCommand): Promise<void> {
    this.validate(input);
    if (input.type === 'annotate-mode') return input.enabled ? this.start(tab) : this.stop(tab);
    if (input.type === 'annotate-cancel') { this.entry(tab).pick = null; this.deps.publish(tab); return; }
    if (input.type === 'annotate-track') { this.track(tab, input.active); return; }
    if (input.type === 'annotate-remove') { this.remove(tab, input.annotationIds); return; }
    if (input.type === 'annotate-handoff') { this.handoff(tab, input.items); return; }
    if (input.type === 'annotate-commit') { this.commit(tab, input.pickId, input.annotationId); return; }
    return this.refine(tab, input.pickId, input.direction);
  }

  /** Leaves pick mode; existing annotations stay. */
  async stop(tab: BrowserRecord): Promise<void> {
    const entry = this.tabs.get(tab.id);
    if (!entry || (!entry.mode && !entry.pick)) return;
    entry.mode = false; entry.pick = null; entry.notice = null; entry.token++;
    const backend = this.deps.backend(tab);
    backend?.setAnnotationListener(null);
    this.deps.publish(tab);
    await backend?.annotationStop().catch(() => undefined);
  }
  /** Stops pick mode on every tab for which `matches` is true. */
  stopWhere(tabs: Iterable<BrowserRecord>, matches: (tab: BrowserRecord) => boolean): void {
    for (const tab of tabs) if (matches(tab)) void this.stop(tab);
  }
  /** A new document replaces every handle: pending picks are dropped, annotations become stale. */
  navigated(tab: BrowserRecord): void {
    const entry = this.tabs.get(tab.id);
    if (!entry) return;
    entry.pick = null; entry.token++;
    for (const item of entry.items.values()) { item.status = 'stale'; item.rect = null; }
  }
  crashed(tab: BrowserRecord): void {
    const entry = this.tabs.get(tab.id);
    if (!entry) return;
    entry.mode = false; entry.token++; this.navigated(tab);
  }
  close(tab: BrowserRecord): void {
    const entry = this.tabs.get(tab.id);
    if (entry?.timer) clearInterval(entry.timer);
    if (entry) this.deps.backend(tab)?.setAnnotationListener(null);
    this.tabs.delete(tab.id);
  }
  dispose(): void { for (const entry of this.tabs.values()) if (entry.timer) clearInterval(entry.timer); this.tabs.clear(); }

  /** Element crops for the ids; stale or failed annotations yield null. */
  async images(tab: BrowserRecord, ids: string[]): Promise<Record<string, BrowserAnnotationImage | null>> {
    const entry = this.tabs.get(tab.id);
    const result: Record<string, BrowserAnnotationImage | null> = {};
    for (const id of ids.slice(0, 50)) {
      const item = entry?.items.get(id);
      if (!item || item.status === 'stale') { result[id] = null; continue; }
      await Promise.race([item.capture, new Promise<void>(resolve => setTimeout(resolve, imageWaitMs).unref())]);
      result[id] = item.image;
    }
    return result;
  }

  private entry(tab: BrowserRecord): TabEntry {
    let entry = this.tabs.get(tab.id);
    if (!entry) { entry = { mode: false, pick: null, notice: null, items: new Map(), token: 0, tracking: false, busy: false }; this.tabs.set(tab.id, entry); }
    return entry;
  }
  private validate(input: AnnotationCommand): void {
    const bad = (message: string) => new BrowserHostError('invalid-command', message);
    if (input.type === 'annotate-mode' && typeof input.enabled !== 'boolean') throw bad('Invalid annotation mode');
    if (input.type === 'annotate-track' && typeof input.active !== 'boolean') throw bad('Invalid annotation tracking flag');
    if (input.type === 'annotate-refine' && input.direction !== 'parent' && input.direction !== 'child') throw bad('Invalid annotation direction');
    if ('pickId' in input && !(typeof input.pickId === 'string' && idPattern.test(input.pickId))) throw bad('Invalid annotation pick');
    if (input.type === 'annotate-handoff' && !(Array.isArray(input.items) && input.items.length <= 100
      && input.items.every(item => item && typeof item === 'object' && typeof item.annotationId === 'string' && idPattern.test(item.annotationId) && typeof item.note === 'string'))) throw bad('Invalid annotation handoff');
    if (input.type === 'annotate-commit' && !(typeof input.annotationId === 'string' && idPattern.test(input.annotationId))) throw bad('Invalid annotation id');
    if (input.type === 'annotate-remove' && !(Array.isArray(input.annotationIds) && input.annotationIds.length <= 100
      && input.annotationIds.every(id => typeof id === 'string' && idPattern.test(id)))) throw bad('Invalid annotation ids');
  }
  private async start(tab: BrowserRecord): Promise<void> {
    if (this.deps.operating(tab.conversationId)) throw new BrowserHostError('annotation-unavailable', 'The Agent is operating this browser');
    if (!tab.ready || tab.error || tab.url === UI_BROWSER_BLANK_URL) throw new BrowserHostError('annotation-unavailable', 'This page cannot be annotated');
    const backend = this.deps.backend(tab);
    if (!backend) throw new BrowserHostError('annotation-unavailable', 'Page is not attached');
    const entry = this.entry(tab);
    if (entry.mode) return;
    const token = ++entry.token;
    backend.setAnnotationListener(hit => this.picked(tab, backend, token, hit));
    entry.mode = true; entry.notice = null;
    try { await backend.annotationStart(); }
    catch (error) {
      entry.mode = false; backend.setAnnotationListener(null); this.deps.publish(tab);
      throw new BrowserHostError('annotation-unavailable', String((error as Error).message || error));
    }
    this.deps.publish(tab);
  }
  private picked(tab: BrowserRecord, backend: AnnotationBackend, token: number, hit: AnnotationHit): void {
    const entry = this.tabs.get(tab.id);
    if (!entry?.mode || entry.token !== token) return;
    const generation = tab.generation;
    void backend.annotationDescribe(hit).then(described => {
      if (entry.token !== token || !entry.mode || tab.generation !== generation) return;
      entry.pick = { id: randomUUID(), hit, stack: [], described }; entry.notice = null;
    }, () => {
      if (entry.token !== token || !entry.mode || tab.generation !== generation) return;
      entry.pick = null; entry.notice = { code: 'pick-failed', nonce: ++this.nonce };
    }).finally(() => this.deps.publish(tab));
  }
  private async refine(tab: BrowserRecord, pickId: string, direction: 'parent' | 'child'): Promise<void> {
    const entry = this.entry(tab); const pick = entry.pick;
    if (!pick || pick.id !== pickId) throw new BrowserHostError('annotation-stale', 'The picked element changed');
    const backend = this.deps.backend(tab);
    if (!backend) throw new BrowserHostError('annotation-unavailable', 'Page is not attached');
    const token = entry.token, generation = tab.generation;
    let next: AnnotationHit | null;
    const returning = direction === 'child' ? pick.stack[pick.stack.length - 1] : undefined;
    try { next = returning ?? await backend.annotationNeighbor(pick.hit, direction); } catch { next = null; }
    if (!next) return;
    try {
      const described = await backend.annotationDescribe(next);
      if (entry.token !== token || entry.pick !== pick || tab.generation !== generation) return;
      if (direction === 'parent') pick.stack.push(pick.hit); else if (returning) pick.stack.pop();
      pick.hit = next; pick.described = described;
    } catch {
      if (entry.token === token) entry.notice = { code: 'pick-failed', nonce: ++this.nonce };
    }
    this.deps.publish(tab);
  }
  private commit(tab: BrowserRecord, pickId: string, annotationId: string): void {
    const entry = this.entry(tab); const pick = entry.pick;
    if (!pick || pick.id !== pickId) throw new BrowserHostError('annotation-stale', 'The picked element changed');
    if (entry.items.has(annotationId)) throw new BrowserHostError('duplicate-annotation', 'Annotation already exists');
    if (entry.items.size >= maxItemsPerTab) throw new BrowserHostError('annotation-limit', 'Too many annotations on this tab');
    const { rect, viewport } = pick.described;
    const item: Item = {
      hit: pick.hit, generation: tab.generation, status: rect ? 'ok' : 'hidden', rect, viewport, shot: 'pending', image: null, capture: Promise.resolve(),
      element: pick.described.element, pageUrl: tab.url, pageTitle: tab.title,
    };
    entry.items.set(annotationId, item); entry.pick = null;
    const backend = this.deps.backend(tab);
    item.capture = (async () => {
      try {
        if (!backend || !rect) throw new Error('no element box');
        item.image = await backend.annotationCapture(rect, viewport); item.shot = 'ok';
      } catch { item.shot = 'failed'; }
      if (this.tabs.get(tab.id) === entry) this.deps.publish(tab);
    })();
    this.deps.publish(tab);
  }
  /** 消息已发出：这些批注从输入框移交给 Agent 复核，页面上不再绘制。 */
  private handoff(tab: BrowserRecord, items: AnnotationHandoffItem[]): void {
    const entry = this.tabs.get(tab.id);
    if (!entry) return;
    for (const { annotationId, note } of items) {
      const item = entry.items.get(annotationId);
      if (item && !item.delivered) item.delivered = { note: note.trim().slice(0, maxAnnotationText) };
    }
    const delivered = [...entry.items].filter(([, item]) => item.delivered);
    for (const [id] of delivered.slice(0, Math.max(0, delivered.length - maxDeliveredPerTab))) entry.items.delete(id);
    if (![...entry.items.values()].some(item => !item.delivered)) this.stopTracking(entry);
    this.deps.publish(tab);
  }

  /** 找到 ref 对应的已发送批注；ref 是批注编号的前缀，必须唯一。 */
  private deliveredItem(tab: BrowserRecord, ref: string): [string, Item] | null {
    const entry = this.tabs.get(tab.id);
    const wanted = ref.trim().replace(/^ref\s*/i, '');
    if (!entry || !/^[\w-]{4,100}$/.test(wanted)) return null;
    const found = [...entry.items].filter(([id, item]) => item.delivered && (id === wanted || annotationRef(id).startsWith(wanted)));
    return found.length === 1 ? found[0]! : null;
  }
  hasDelivered(tab: BrowserRecord, ref: string): boolean { return this.deliveredItem(tab, ref) !== null; }
  private record(tab: BrowserRecord, id: string, item: Item): AgentAnnotationRecord {
    return {
      ref: annotationRef(id), tabId: tab.id, note: item.delivered?.note ?? '',
      status: item.status === 'stale' ? 'stale' : item.delivered?.resolution !== undefined ? 'resolved' : 'open',
      pageUrl: item.pageUrl, pageTitle: item.pageTitle, element: item.element, rect: item.rect,
      ...(item.delivered?.resolution ? { resolution: item.delivered.resolution } : {}),
    };
  }

  /**
   * 重新确认元素的位置：先看原来的句柄，页面换过文档或节点被替换时按选择器重新找。
   * 重新找到后句柄、位置与状态都更新。
   */
  private async relocate(tab: BrowserRecord, backend: AnnotationBackend, item: Item): Promise<'ok' | 'hidden' | 'missing' | 'ambiguous'> {
    const viewport = { width: tab.width, height: tab.height };
    let box: AnnotationBoxResult | null = null;
    if (item.generation === tab.generation) { try { box = await backend.annotationBox(item.hit); } catch { box = null; } }
    if (!box || ('error' in box && box.error === 'gone')) {
      let found: AnnotationHit | 'missing' | 'ambiguous';
      try { found = await backend.annotationLocate({ selector: item.element.selector, framePath: item.element.framePath }); } catch { found = 'missing'; }
      if (typeof found === 'string') { item.status = 'stale'; item.rect = null; return found; }
      item.hit = found; item.generation = tab.generation;
      try { box = await backend.annotationBox(found); } catch { box = { error: 'gone' }; }
    }
    const next = classifyAnnotationBox({ generation: item.generation, currentGeneration: tab.generation, box });
    item.status = next.status; item.rect = next.rect; item.viewport = viewport;
    return next.status === 'ok' ? 'ok' : next.status === 'hidden' ? 'hidden' : 'missing';
  }

  private entries(tab: BrowserRecord, ref?: string): [string, Item][] {
    if (ref) { const found = this.deliveredItem(tab, ref); return found ? [found] : []; }
    return [...(this.tabs.get(tab.id)?.items ?? [])].filter(([, item]) => item.delivered);
  }

  /** 当前对话某个标签页上已发送的批注：重新确认位置；`screenshot` 时顺带截取元素现状（不滚动页面）。 */
  async list(tab: BrowserRecord, options: { ref?: string; screenshot?: boolean; signal?: AbortSignal }): Promise<AgentAnnotationListing> {
    const backend = this.deps.backend(tab);
    const listing: AgentAnnotationListing = { records: [], images: {} };
    for (const [id, item] of this.entries(tab, options.ref)) {
      options.signal?.throwIfAborted();
      if (backend) await this.relocate(tab, backend, item).catch(() => undefined);
      const record = this.record(tab, id, item);
      listing.records.push(record);
      if (options.screenshot && backend && item.rect && annotationInViewport(item.rect, { width: tab.width, height: tab.height })) {
        listing.images[record.ref] = await backend.annotationCapture(item.rect, { width: tab.width, height: tab.height }).catch(() => null);
      }
    }
    return listing;
  }

  /** 等页面静下来：文档不再变化、不在加载，元素位置连续一段时间不动；超时就按现状继续。 */
  private async settle(tab: BrowserRecord, backend: AnnotationBackend, item: Item, waitMs: number, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + waitMs;
    let last = '', since = Date.now();
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      await this.relocate(tab, backend, item).catch(() => undefined);
      const key = `${tab.generation}|${tab.loading}|${item.status}|${JSON.stringify(item.rect)}`;
      if (key !== last) { last = key; since = Date.now(); }
      else if (!tab.loading && Date.now() - since >= settleStableMs) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, settlePollMs);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
    }
  }

  /** Agent 改完之后：等页面稳定，重新找到同一元素截图，与发送时的截图配成 Before/After，并把批注标为已处理。 */
  async review(tab: BrowserRecord, ref: string, options: { summary?: string; settleMs?: number; signal?: AbortSignal }): Promise<AgentAnnotationReview> {
    const found = this.deliveredItem(tab, ref);
    if (!found) throw new BrowserHostError('annotation-not-found', 'No sent annotation matches this ref');
    const [id, item] = found;
    const backend = this.deps.backend(tab);
    const waitMs = Math.min(maxSettleMs, Math.max(0, Number.isFinite(options.settleMs) ? options.settleMs! : defaultSettleMs));
    let located: AgentAnnotationReview['located'] = 'missing';
    let after: BrowserAnnotationImage | null = null;
    if (backend) {
      await this.settle(tab, backend, item, waitMs, options.signal);
      located = await this.relocate(tab, backend, item).catch(() => 'missing' as const);
      if (located === 'ok' && item.rect) {
        if (!annotationInViewport(item.rect, { width: tab.width, height: tab.height })) {
          await backend.annotationReveal(item.hit).catch(() => undefined);
          located = await this.relocate(tab, backend, item).catch(() => 'missing' as const);
        }
        if (item.rect) after = await backend.annotationCapture(item.rect, { width: tab.width, height: tab.height }).catch(() => null);
      }
    }
    await Promise.race([item.capture, new Promise<void>(resolve => setTimeout(resolve, imageWaitMs).unref())]);
    const before = item.image;
    if (item.delivered) item.delivered.resolution = (options.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    this.deps.publish(tab);
    return {
      record: this.record(tab, id, item), located, before, after,
      changed: before && after ? before.data !== after.data : null,
    };
  }

  private remove(tab: BrowserRecord, ids: string[]): void {
    const entry = this.tabs.get(tab.id);
    if (!entry) return;
    // 已发送的批注归 Agent 复核所有：页面上的卡片没了也不释放，只随标签页关闭或超出保留上限而丢弃。
    for (const id of ids) if (!entry.items.get(id)?.delivered) entry.items.delete(id);
    if (![...entry.items.values()].some(item => !item.delivered)) this.stopTracking(entry);
    this.deps.publish(tab);
  }
  private track(tab: BrowserRecord, active: boolean): void {
    const entry = this.entry(tab);
    entry.tracking = active;
    if (!active) { this.stopTracking(entry); return; }
    if (entry.timer) return;
    entry.timer = setInterval(() => void this.tick(tab, entry), trackIntervalMs); entry.timer.unref();
  }
  private stopTracking(entry: TabEntry): void { if (entry.timer) clearInterval(entry.timer); entry.timer = undefined; }
  /** Follows scrolling, zooming and layout changes through the nodes' box models. */
  private async tick(tab: BrowserRecord, entry: TabEntry): Promise<void> {
    if (entry.busy || !entry.tracking) return;
    const backend = this.deps.backend(tab);
    const live = [...entry.items.values()].filter(item => item.status !== 'stale' && !item.delivered);
    if (!backend || !live.length) return;
    entry.busy = true;
    let changed = false;
    try {
      for (const item of live) {
        let box: AnnotationBoxResult;
        try { box = await backend.annotationBox(item.hit); } catch { continue; }
        const next = classifyAnnotationBox({ generation: item.generation, currentGeneration: tab.generation, box });
        const viewport = { width: tab.width, height: tab.height };
        const moved = next.status !== item.status || !sameRect(next.rect, item.rect) || viewport.width !== item.viewport.width || viewport.height !== item.viewport.height;
        if (moved) { item.status = next.status; item.rect = next.rect; item.viewport = viewport; changed = true; }
      }
    } finally { entry.busy = false; }
    if (changed && this.tabs.get(tab.id) === entry) this.deps.publish(tab);
  }
}
function sameRect(a: AnnotationRect | null, b: AnnotationRect | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}
