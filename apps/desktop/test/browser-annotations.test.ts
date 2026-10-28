import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { WebContents, Session } from 'electron';
import { BrowserHost } from '../src/main/browser-host.ts';
import type { AnnotationHit } from '../src/main/browser-cdp.ts';
import type { BrowserAnnotationImage } from '../../../packages/shared/src/browser-annotation.ts';

const asGuest = (v: unknown) => v as WebContents;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const image: BrowserAnnotationImage = { data: 'AAAA', mimeType: 'image/png', width: 30, height: 40, clipWidth: 30, clipHeight: 40, masks: [], cropped: false };

function fixture() {
  const session = {} as Session;
  const embedder = Object.assign(new EventEmitter(), { id: 1 });
  let closed = false, url = 'about:blank';
  const guests: ReturnType<typeof makeGuest>[] = [];
  function makeGuest(id: number) {
    const guest = Object.assign(new EventEmitter(), { id, hostWebContents: embedder, session,
      isDestroyed: () => closed, getURL: () => url, getTitle: () => 'Fixture', isLoading: () => false,
      navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} },
      loadURL: async (value: string) => { url = value; guest.emit('did-navigate'); }, close: () => { closed = true; guest.emit('destroyed'); }, reload() {}, stop() {} });
    guests.push(guest); return guest;
  }
  const boxes = new Map<number, { rect: { x: number; y: number; width: number; height: number } } | { error: 'gone' | 'hidden' }>();
  const calls: string[] = [];
  let listener: ((hit: AnnotationHit) => void) | null = null;
  let captureFails = false;
  const backend = {
    call: async () => ({}), dispose() {},
    setAnnotationListener(next: typeof listener) { listener = next; },
    annotationStart: async () => { calls.push('start'); }, annotationStop: async () => { calls.push('stop'); },
    annotationDescribe: async (hit: AnnotationHit) => ({
      element: { tag: 'button', classes: ['primary'], text: `n${hit.backendNodeId}`, selector: `#n${hit.backendNodeId}`, framePath: [], styles: {}, sensitive: false },
      rect: { x: 1, y: 2, width: 30, height: 40 }, viewport: { width: 800, height: 600 }, canParent: true, canChild: false,
    }),
    annotationNeighbor: async (hit: AnnotationHit, direction: string) => ({ backendNodeId: hit.backendNodeId + (direction === 'parent' ? 100 : -100) }),
    annotationBox: async (hit: AnnotationHit) => boxes.get(hit.backendNodeId) ?? { error: 'gone' as const },
    annotationCapture: async () => { if (captureFails) throw new Error('offscreen'); return image; },
  };
  const host = new BrowserHost(() => backend, session);
  host.registerWindow(10, asGuest(embedder));
  const first = makeGuest(2); host.registerGuest(10, asGuest(first));
  const command = (input: any) => host.command(10, asGuest(embedder), true, input);
  const context = { windowId: 10, conversationId: 'one', agentId: 'root', turnId: 'turn', invocationId: 'call' };
  return { host, backend, calls, boxes, command, context, guests, embedder, makeGuest, emit: (hit: AnnotationHit) => listener?.(hit), setCaptureFails: (v: boolean) => { captureFails = v; }, hasListener: () => !!listener };
}
async function ready(f: ReturnType<typeof fixture>, url = 'http://localhost:3000/') {
  await f.command({ type: 'activate', conversationId: 'one' }); await f.command({ type: 'open', id: 'tab' });
  await f.command({ type: 'bind', tabId: 'tab', guestId: 2 }); await f.guests[0]!.loadURL(url);
}
const annotation = async (f: ReturnType<typeof fixture>) => (await f.command({ type: 'state' })).tabs.find(t => t.id === 'tab')?.annotation;

test('annotation commands pass through the same sender, ownership and field validation', async () => {
  const f = fixture(); await ready(f);
  await assert.rejects(f.host.command(10, asGuest(f.guests[0]), true, { type: 'annotate-mode', tabId: 'tab', enabled: true }), /main frame/);
  await assert.rejects(f.host.command(10, asGuest(f.embedder), false, { type: 'annotate-mode', tabId: 'tab', enabled: true }), /main frame/);
  await assert.rejects(f.command({ type: 'annotate-mode', tabId: 'missing', enabled: true }), /closed/);
  await assert.rejects(f.command({ type: 'annotate-mode', tabId: 'tab', enabled: 'yes' }), /Invalid annotation mode/);
  await assert.rejects(f.command({ type: 'annotate-refine', tabId: 'tab', pickId: 'p', direction: 'sideways' }), /direction/);
  await assert.rejects(f.command({ type: 'annotate-refine', tabId: 'tab', pickId: '../x', direction: 'parent' }), /pick/);
  await assert.rejects(f.command({ type: 'annotate-commit', tabId: 'tab', pickId: 'p', annotationId: 'bad id!' }), /annotation id/);
  await assert.rejects(f.command({ type: 'annotate-remove', tabId: 'tab', annotationIds: 'nope' }), /ids/);
  await assert.rejects(f.command({ type: 'annotate-remove', tabId: 'tab', annotationIds: Array.from({ length: 101 }, (_, i) => `a${i}`) }), /ids/);
  await assert.rejects(f.command({ type: 'annotate-commit', tabId: 'tab', pickId: 'nothing-picked', annotationId: 'a1' }), /changed/);
  await assert.rejects(f.host.annotationImages(10, asGuest(f.guests[0]), true, 'tab', []), /main frame/);
  await f.command({ type: 'activate', conversationId: 'two' });
  await assert.rejects(f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true }), /another conversation/);
  f.host.dispose();
});

test('annotation mode is refused on blank pages, failed pages and while the Agent operates', async () => {
  const f = fixture();
  await f.command({ type: 'activate', conversationId: 'one' }); await f.command({ type: 'open', id: 'tab' }); await f.command({ type: 'bind', tabId: 'tab', guestId: 2 });
  await assert.rejects(f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true }), /cannot be annotated/);
  await f.guests[0]!.loadURL('http://localhost:3000/');
  const revoke = f.host.beginInvocation(f.context);
  await assert.rejects(f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true }), /Agent is operating/);
  revoke();
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  assert.equal((await annotation(f))?.mode, true);
  // An Agent invocation starting takes over the page: the person's mode ends.
  const again = f.host.beginInvocation({ ...f.context, invocationId: 'call-2' });
  await settle();
  assert.equal((await annotation(f)), undefined);
  assert.deepEqual(f.calls, ['start', 'stop']);
  again(); f.host.dispose();
});

test('pick, refine and commit keep the element handle in the main process', async () => {
  const f = fixture(); await ready(f);
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  f.emit({ backendNodeId: 7 }); await settle();
  let state = await annotation(f);
  assert.equal(state?.pick?.element.selector, '#n7');
  assert.equal(state?.pick?.canParent, true); assert.equal(state?.pick?.canChild, false);
  const pickId = state!.pick!.id;
  await f.command({ type: 'annotate-refine', tabId: 'tab', pickId, direction: 'parent' });
  state = await annotation(f);
  assert.equal(state?.pick?.element.selector, '#n107');
  assert.equal(state?.pick?.canChild, true, 'a parent step can be undone');
  await f.command({ type: 'annotate-refine', tabId: 'tab', pickId, direction: 'child' });
  assert.equal((await annotation(f))?.pick?.element.selector, '#n7');
  await assert.rejects(f.command({ type: 'annotate-refine', tabId: 'tab', pickId: 'other', direction: 'parent' }), /changed/);
  await f.command({ type: 'annotate-commit', tabId: 'tab', pickId, annotationId: 'note-1' });
  await settle();
  state = await annotation(f);
  assert.equal(state?.pick, null);
  assert.equal(state?.mode, true, 'pick mode continues for the next element');
  assert.deepEqual(state?.items.map(i => [i.id, i.status, i.shot]), [['note-1', 'ok', 'ok']]);
  const images = await f.host.annotationImages(10, asGuest(f.embedder), true, 'tab', ['note-1', 'unknown']);
  assert.equal(images['note-1']?.data, 'AAAA'); assert.equal(images['unknown'], null);
  await assert.rejects(f.command({ type: 'annotate-commit', tabId: 'tab', pickId, annotationId: 'note-2' }), /changed/);
  f.host.dispose();
});

test('a failed screenshot still creates the annotation', async () => {
  const f = fixture(); await ready(f); f.setCaptureFails(true);
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  f.emit({ backendNodeId: 1 }); await settle();
  await f.command({ type: 'annotate-commit', tabId: 'tab', pickId: (await annotation(f))!.pick!.id, annotationId: 'n' }); await settle();
  assert.deepEqual((await annotation(f))?.items.map(i => i.shot), ['failed']);
  assert.equal((await f.host.annotationImages(10, asGuest(f.embedder), true, 'tab', ['n']))['n'], null);
  f.host.dispose();
});

test('navigation drops a pending pick and marks annotations stale', async () => {
  const f = fixture(); await ready(f);
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  f.emit({ backendNodeId: 1 }); await settle();
  await f.command({ type: 'annotate-commit', tabId: 'tab', pickId: (await annotation(f))!.pick!.id, annotationId: 'n' }); await settle();
  f.emit({ backendNodeId: 2 }); await settle();
  assert.ok((await annotation(f))?.pick);
  await f.guests[0]!.loadURL('http://localhost:3000/other'); await settle();
  const state = await annotation(f);
  assert.equal(state?.pick, null);
  assert.deepEqual(state?.items.map(i => [i.status, i.rect]), [['stale', null]]);
  assert.equal((await f.host.annotationImages(10, asGuest(f.embedder), true, 'tab', ['n']))['n'], null, 'stale annotations send no picture');
  f.host.dispose();
});

test('tracking follows the element and reports removal', async () => {
  const f = fixture(); await ready(f);
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  f.emit({ backendNodeId: 5 }); await settle();
  await f.command({ type: 'annotate-commit', tabId: 'tab', pickId: (await annotation(f))!.pick!.id, annotationId: 'n' }); await settle();
  f.boxes.set(5, { rect: { x: 10, y: 300, width: 30, height: 40 } });
  await f.command({ type: 'annotate-track', tabId: 'tab', active: true });
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.deepEqual((await annotation(f))?.items[0]?.rect, { x: 10, y: 300, width: 30, height: 40 });
  f.boxes.set(5, { error: 'hidden' });
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal((await annotation(f))?.items[0]?.status, 'hidden');
  f.boxes.delete(5);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal((await annotation(f))?.items[0]?.status, 'stale');
  await f.command({ type: 'annotate-track', tabId: 'tab', active: false });
  await f.command({ type: 'annotate-remove', tabId: 'tab', annotationIds: ['n'] });
  assert.deepEqual((await annotation(f))?.items, []);
  f.host.dispose();
});

test('selecting another tab, switching conversation or closing the tab leaves the mode', async () => {
  const f = fixture(); await ready(f);
  await f.command({ type: 'open', id: 'other' });
  await f.command({ type: 'select', tabId: 'tab' });
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  await f.command({ type: 'select', tabId: 'other' }); await settle();
  assert.equal(await annotation(f), undefined);
  await f.command({ type: 'select', tabId: 'tab' });
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  await f.command({ type: 'activate', conversationId: 'two' }); await settle();
  assert.equal(f.calls.filter(c => c === 'stop').length, 2);
  await f.command({ type: 'activate', conversationId: 'one' });
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  await f.command({ type: 'close', tabId: 'tab' });
  assert.equal(f.hasListener(), false);
  f.host.dispose();
});

test('Esc in the page leaves annotation mode without reaching the page', async () => {
  const f = fixture(); await ready(f);
  await f.command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  let prevented = false;
  f.guests[0]!.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'a' });
  assert.equal(prevented, false);
  f.guests[0]!.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'Escape' });
  await settle();
  assert.equal(prevented, true);
  assert.equal((await annotation(f)), undefined);
  f.host.dispose();
});
