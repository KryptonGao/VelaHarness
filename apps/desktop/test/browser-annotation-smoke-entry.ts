/** Dedicated fixture, not the product main or renderer. Bundled by the .mjs runner. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, session, webContents, ipcMain } from 'electron';
import { BrowserHost } from '../src/main/browser-host';
import { BrowserCdp } from '../src/main/browser-cdp';
const temporary = process.env.VELA_SMOKE_TEMP!;
app.setPath('userData', join(temporary, 'electron'));
app.commandLine.appendSwitch('site-per-process');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(check: () => T | Promise<T>, label: string, timeout = 6000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value as NonNullable<T>; await pause(25); }
  throw new Error(`Timed out: ${label}`);
}
let base = '';
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  if (req.url === '/frame') {
    res.end('<body style="margin:0"><button id="fb" style="position:absolute;left:10px;top:10px;width:100px;height:30px">Frame action</button>'
      + '<script>window.clicks=0;addEventListener("click",()=>clicks++)</script>'); return;
  }
  if (req.url === '/other') { res.end('<!doctype html><title>Other</title><p>other</p>'); return; }
  const local = base.replace('127.0.0.1', 'localhost');
  res.end(`<!doctype html><title>Annotation fixture</title><body style="margin:0;height:4000px">
  <div id="card" class="panel" style="position:absolute;left:40px;top:60px;width:300px;height:160px;background:#eef">
    <button id="go" class="primary" style="position:absolute;left:20px;top:20px;width:120px;height:40px;background:#2563eb;color:#fff;font-size:14px;margin:2px">Submit</button>
    <input id="pw" type="password" value="hunter2" style="position:absolute;left:20px;top:80px;width:200px;height:30px">
    <input id="cc" autocomplete="cc-number" value="4242424242424242" style="position:absolute;left:20px;top:120px;width:200px;height:30px">
  </div>
  <div id="host" style="position:absolute;left:400px;top:60px;width:150px;height:50px"></div>
  <iframe src="/frame" style="position:absolute;left:40px;top:300px;width:300px;height:120px;border:0"></iframe>
  <iframe src="${local}/frame" style="position:absolute;left:400px;top:300px;width:300px;height:120px;border:0"></iframe>
  <script>
    document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<button id="sb" style="width:100px;height:40px">Shadow action</button>';
    window.events=[];for(const t of ['click','mousedown','mouseup','pointerdown'])addEventListener(t,()=>events.push(t),true);
  </script>`);
});
let host: BrowserHost; let win: BrowserWindow;
const partition = 'persist:vela-ui-browser';
async function run() {
  await new Promise<void>(resolve => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await app.whenReady();
  host = new BrowserHost(guest => new BrowserCdp(guest), session.fromPartition(partition));
  const preload = join(temporary, 'preload.cjs');
  writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{bind:(tabId,guestId)=>ipcRenderer.invoke('fixture:bind',tabId,guestId),subscribe:fn=>ipcRenderer.on('fixture:state',(_,s)=>fn(s))});`);
  win = new BrowserWindow({ show: false, width: 1050, height: 820, webPreferences: { preload, webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  host.registerWindow(win.id, win.webContents);
  win.webContents.on('will-attach-webview', (_event, preferences) => {
    delete preferences.preload; preferences.sandbox = true; preferences.contextIsolation = true; preferences.nodeIntegration = false;
  });
  win.webContents.on('did-attach-webview', (_event, guest) => host.registerGuest(win.id, guest));
  ipcMain.handle('fixture:bind', (event, tabId, guestId) => host.command(win.id, event.sender, event.senderFrame === event.sender.mainFrame, { type: 'bind', tabId, guestId }));
  host.subscribe((_id, state) => win.webContents.send('fixture:state', state));
  const renderer = join(temporary, 'renderer.html');
  writeFileSync(renderer, `<!doctype html><style>html,body{margin:0}webview{width:1024px;height:768px}</style><script>
  const views=new Map();window.fixture.subscribe(state=>{for(const tab of state.tabs){if(views.has(tab.id))continue;const v=document.createElement('webview');v.setAttribute('partition','${partition}');v.src='about:blank';views.set(tab.id,v);v.addEventListener('dom-ready',()=>window.fixture.bind(tab.id,v.getWebContentsId()));document.body.append(v)}});
  </script>`);
  await win.loadFile(renderer);
  const command = (input: any) => host.command(win.id, win.webContents, true, input);
  await command({ type: 'activate', conversationId: 'main' });
  await command({ type: 'open', id: 'tab', url: 'about:blank' });
  await until(() => host.registry.list(win.id).find(t => t.id === 'tab')?.guestId, 'guest bind');
  const guest = webContents.fromId(host.registry.list(win.id)[0]!.guestId!)!;
  await guest.loadURL(base);
  await command({ type: 'viewport', tabId: 'tab', width: 1024, height: 768 });
  await until(async () => (await guest.executeJavaScript('document.querySelector("iframe:last-of-type").getBoundingClientRect().width')) > 0, 'frames laid out');
  await pause(600);

  const annotation = () => host.state(win.id).tabs.find(t => t.id === 'tab')?.annotation;
  const rectOf = (selector: string) => guest.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const near = (actual: { x: number; y: number; width: number; height: number } | null | undefined, expected: { x: number; y: number; width: number; height: number }, label: string) => {
    assert.ok(actual, `${label}: rect present`);
    for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(actual![key] - expected[key]) <= 1.5, `${label}: ${key} ${actual![key]} vs ${expected[key]}`);
  };
  const clickAt = async (x: number, y: number) => {
    guest.sendInputEvent({ type: 'mouseMove', x, y }); await pause(200);
    guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  };
  let lastPick = '';
  const pickAt = async (x: number, y: number, label: string) => {
    await clickAt(x, y);
    return until(() => { const pick = annotation()?.pick; if (pick && pick.id !== lastPick) { lastPick = pick.id; return pick; } return null; }, `pick ${label} (${JSON.stringify(annotation()?.notice ?? null)})`);
  };
  const center = (r: { x: number; y: number; width: number; height: number }) => [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] as const;

  let childSession = '';
  guest.debugger.on('message', (_event: unknown, method: string, params: any) => { if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') childSession = params.sessionId; });
  const domBefore = await guest.executeJavaScript('document.documentElement.outerHTML');
  await command({ type: 'annotate-mode', tabId: 'tab', enabled: true });
  assert.equal(annotation()?.mode, true);

  // 1. A real click picks the element and never reaches the page.
  const goRect = await rectOf('#go');
  let pick = await pickAt(...center(goRect), 'button');
  assert.equal(pick.element.tag, 'button'); assert.equal(pick.element.id, 'go'); assert.equal(pick.element.role, 'button');
  assert.equal(pick.element.name, 'Submit'); assert.equal(pick.element.text, 'Submit'); assert.equal(pick.element.selector, '#go');
  assert.equal(pick.element.styles['background-color'], '#2563eb'); assert.equal(pick.element.styles.color, '#fff');
  assert.equal(pick.element.styles.margin, '2px'); assert.equal(pick.element.styles['font-size'], '14px');
  near(pick.rect, goRect, 'button rect');
  assert.deepEqual(await guest.executeJavaScript('window.events'), [], 'the page observed no click while picking');
  console.log('PASS pick: description, styles and geometry; the page saw no events');

  // 2. Hierarchy.
  await command({ type: 'annotate-refine', tabId: 'tab', pickId: pick.id, direction: 'parent' });
  assert.equal(annotation()?.pick?.element.id, 'card'); assert.equal(annotation()?.pick?.canChild, true);
  await command({ type: 'annotate-refine', tabId: 'tab', pickId: pick.id, direction: 'child' });
  assert.equal(annotation()?.pick?.element.id, 'go');

  // 3. Commit and crop.
  await command({ type: 'annotate-commit', tabId: 'tab', pickId: pick.id, annotationId: 'go' });
  await until(() => annotation()?.items.find(i => i.id === 'go')?.shot === 'ok', 'go screenshot');
  const images = await host.annotationImages(win.id, win.webContents, true, 'tab', ['go']);
  assert.equal(images.go?.mimeType, 'image/png'); assert.equal(images.go?.clipWidth, 120); assert.equal(images.go?.clipHeight, 40);
  assert.ok(images.go!.width >= 120 && images.go!.height >= 40); assert.equal(images.go!.masks.length, 0); assert.equal(images.go!.cropped, false);
  assert.equal(annotation()?.mode, true, 'mode continues after a commit');

  // 4. Sensitive fields: no value is read, the crop reports masks.
  pick = await pickAt(...center(await rectOf('#pw')), 'password');
  assert.equal(pick.element.sensitive, true); assert.equal(pick.element.text, undefined);
  assert.ok(!JSON.stringify(annotation()).includes('hunter2'), 'password value never leaves the page');
  assert.ok(!JSON.stringify(annotation()).includes('4242'), 'card number never leaves the page');
  await command({ type: 'annotate-refine', tabId: 'tab', pickId: pick.id, direction: 'parent' });
  assert.equal(annotation()?.pick?.element.id, 'card');
  await command({ type: 'annotate-commit', tabId: 'tab', pickId: pick.id, annotationId: 'card' });
  await until(() => annotation()?.items.find(i => i.id === 'card')?.shot === 'ok', 'card screenshot');
  const card = (await host.annotationImages(win.id, win.webContents, true, 'tab', ['card'])).card!;
  assert.equal(card.masks.length, 2, 'password and card-number inputs are masked');
  const pwRect = await rectOf('#pw'), cardRect = await rectOf('#card');
  near(card.masks[0], { x: pwRect.x - cardRect.x, y: pwRect.y - cardRect.y, width: pwRect.width, height: pwRect.height }, 'password mask');
  console.log('PASS commit: crop, hierarchy, sensitive fields masked, values unread');

  // 5. Shadow DOM, same-origin iframe, OOPIF.
  const shadow = await pickAt(...center(await guest.executeJavaScript(`(() => { const r = document.querySelector('#host').shadowRoot.querySelector('#sb').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)), 'shadow');
  assert.equal(shadow.element.selector, '#host >>> #sb'); assert.equal(shadow.element.name, 'Shadow action');
  const frames = await guest.executeJavaScript(`Array.from(document.querySelectorAll('iframe')).map(f => { const r = f.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })`);
  const same = await pickAt(frames[0].x + 10 + 50, frames[0].y + 10 + 15, 'same-origin frame');
  assert.equal(same.element.selector, '#fb'); assert.equal(same.element.framePath.length, 1);
  near(same.rect, { x: frames[0].x + 10, y: frames[0].y + 10, width: 100, height: 30 }, 'same-origin frame rect in root coordinates');
  assert.equal(await guest.executeJavaScript('document.querySelector("iframe").contentWindow.clicks'), 0, 'frame saw no click');
  // sendInputEvent is not routed into out-of-process frames; dispatch to the child session like the Agent does.
  assert.ok(childSession, 'OOPIF session observed');
  const crossClick = async () => {
    const send = (params: object) => guest.debugger.sendCommand('Input.dispatchMouseEvent', params, childSession);
    await send({ type: 'mouseMoved', x: 60, y: 25 }); await pause(200);
    await send({ type: 'mousePressed', x: 60, y: 25, button: 'left', clickCount: 1 }); await send({ type: 'mouseReleased', x: 60, y: 25, button: 'left', clickCount: 1 });
  };
  await crossClick();
  const cross = await until(() => { const pick = annotation()?.pick; return pick && pick.id !== lastPick ? pick : null; }, `pick cross-origin frame (${JSON.stringify(annotation()?.notice ?? null)})`);
  lastPick = cross.id;
  assert.equal(cross.element.selector, '#fb'); assert.equal(cross.element.name, 'Frame action');
  near(cross.rect, { x: frames[1].x + 10, y: frames[1].y + 10, width: 100, height: 30 }, 'OOPIF rect lifted to root coordinates');
  await command({ type: 'annotate-cancel', tabId: 'tab' });
  assert.equal(annotation()?.pick, null);
  console.log('PASS shadow DOM, same-origin iframe and OOPIF picks');

  // 6. Tracking follows scrolling; removal makes the annotation stale.
  await command({ type: 'annotate-track', tabId: 'tab', active: true });
  await guest.executeJavaScript('scrollTo(0, 100)');
  await until(() => Math.abs((annotation()?.items.find(i => i.id === 'go')?.rect?.y ?? 0) - (goRect.y - 100)) <= 1.5, 'tracking follows scroll');
  await guest.executeJavaScript('document.querySelector("#go").style.display = "none"');
  await until(() => annotation()?.items.find(i => i.id === 'go')?.status === 'hidden', 'hidden element');
  await guest.executeJavaScript('document.querySelector("#go").remove()');
  await until(() => annotation()?.items.find(i => i.id === 'go')?.status === 'stale', 'removed element is stale');
  console.log('PASS tracking: scroll, hidden, removed');

  // 7. Leaving the mode restores page clicks and leaves no trace in the DOM.
  await command({ type: 'annotate-mode', tabId: 'tab', enabled: false });
  await pause(200);
  await clickAt(...center(await rectOf('#pw')));
  await until(async () => (await guest.executeJavaScript('window.events')).includes('click'), 'page click after leaving the mode');
  const domAfter = await guest.executeJavaScript('document.documentElement.outerHTML');
  const strip = (html: string) => html.replace(/<button id="go"[\s\S]*?<\/button>/, '');
  assert.equal(strip(domAfter), strip(domBefore), 'annotation never changed the page DOM');
  console.log('PASS leaving the mode: page clicks work again, DOM untouched');

  // 8. Navigation makes everything stale.
  await guest.loadURL(`${base}/other`);
  await until(() => annotation()?.items.every(i => i.status === 'stale'), 'navigation stales annotations');
  assert.equal((await host.annotationImages(win.id, win.webContents, true, 'tab', ['card'])).card, null);
  console.log('PASS navigation: annotations stale, no picture');
  console.log('PASS browser-annotation smoke complete');
}
const watchdog = setTimeout(() => { console.error('FAIL fixture deadline (55s)'); app.exit(1); }, 55000);
run().then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code: number) {
  clearTimeout(watchdog); host?.dispose();
  ipcMain.removeHandler('fixture:bind');
  server.closeAllConnections(); server.close(); win?.destroy(); app.exit(code);
}
process.on('uncaughtException', error => { console.error('UNCAUGHT fixture', error); finish(1); });
process.on('unhandledRejection', error => { console.error('UNHANDLED fixture', error); finish(1); });
