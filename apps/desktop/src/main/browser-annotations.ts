import { randomUUID } from 'node:crypto';
import type { AnnotationRect, AnnotationShotState, AnnotationTrackStatus, AnnotationViewport, BrowserAnnotationImage, BrowserTabAnnotation } from '../../../../packages/shared/src/browser-annotation';
import { classifyAnnotationBox } from '../../../../packages/shared/src/browser-annotation';
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
interface Item {
  hit: AnnotationHit; generation: number; status: AnnotationTrackStatus; rect: AnnotationRect | null;
  viewport: AnnotationViewport; shot: AnnotationShotState; image: BrowserAnnotationImage | null; capture: Promise<void>;
}
interface TabEntry {
  mode: boolean; pick: Pick | null; notice: { code: 'pick-failed'; nonce: number } | null;
  items: Map<string, Item>; token: number; tracking: boolean; busy: boolean; timer?: ReturnType<typeof setInterval>;
}
const maxItemsPerTab = 100;
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
    return {
      mode: entry.mode,
      notice: entry.notice,
      pick: pick ? {
        id: pick.id, element: pick.described.element, rect: pick.described.rect, viewport: pick.described.viewport,
        canParent: pick.described.canParent, canChild: pick.stack.length > 0 || pick.described.canChild,
      } : null,
      items: [...entry.items].map(([id, item]) => ({ id, status: item.status, rect: item.rect, viewport: item.viewport, shot: item.shot })),
    };
  }

  async command(tab: BrowserRecord, input: AnnotationCommand): Promise<void> {
    this.validate(input);
    if (input.type === 'annotate-mode') return input.enabled ? this.start(tab) : this.stop(tab);
    if (input.type === 'annotate-cancel') { this.entry(tab).pick = null; this.deps.publish(tab); return; }
    if (input.type === 'annotate-track') { this.track(tab, input.active); return; }
    if (input.type === 'annotate-remove') { this.remove(tab, input.annotationIds); return; }
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
    const item: Item = { hit: pick.hit, generation: tab.generation, status: rect ? 'ok' : 'hidden', rect, viewport, shot: 'pending', image: null, capture: Promise.resolve() };
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
  private remove(tab: BrowserRecord, ids: string[]): void {
    const entry = this.tabs.get(tab.id);
    if (!entry) return;
    for (const id of ids) entry.items.delete(id);
    if (!entry.items.size) this.stopTracking(entry);
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
    const live = [...entry.items.values()].filter(item => item.status !== 'stale');
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
