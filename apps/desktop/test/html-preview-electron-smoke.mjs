/** Build first, then run: electron test/html-preview-electron-smoke.mjs */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "vela-html-preview-")));
const root = join(temp, "workspace");
const home = join(temp, "home");
mkdirSync(join(root, "assets", "theme"), { recursive: true });
mkdirSync(home);
app.setPath("userData", home);
process.env.VELA_USER_DATA = home;
process.env.VELA_CWD = root;
process.env.PI_OFFLINE = "1";
delete process.env.ELECTRON_RENDERER_URL;
writeFileSync(join(home, "ui-state.json"), JSON.stringify({ "vela.onboarding.complete": "true", "vela.locale": "en" }));
const write = (file, text) => writeFileSync(join(root, file), text);
write("Demo page.HTM", `<!doctype html><link rel="stylesheet" href="assets/main.css?v=1">
  <button>Click me</button><img src="/assets/icon.svg"><script type="module" src="./assets/main.mjs"></script>`);
write("assets/main.css", '@import "./theme/colors.css"; body { min-height: 220vh; }');
write("assets/theme/colors.css", "button { color: rgb(12, 34, 56); }");
write("assets/main.mjs", `import {label} from './label.js'; document.querySelector('button').onclick = e => e.target.textContent = label;`);
write("assets/label.js", `export const label = 'Clicked';`);
write("assets/icon.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="8"><rect width="6" height="8"/></svg>');

const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) {
  for (let i = 0; i < 200; i++) { const result = await check(); if (result) return result; await pause(50); }
  throw new Error(`Timed out: ${label}`);
}

// Import during startup just like production: the standard scheme must be registered before ready.
await import("../out/main/index.mjs");
app.whenReady().then(async () => {
  const win = await until(() => BrowserWindow.getAllWindows()[0], "main window");
  const js = code => win.webContents.executeJavaScript(code);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const visible = selector => until(() => js(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
  await visible(".main-chat-view");
  await js(`window.vela.selectWorkspace(${JSON.stringify(root)})`);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'E',code:'KeyE',${process.platform === "darwin" ? "metaKey" : "ctrlKey"}:true,shiftKey:true,bubbles:true}))`);
  const file = '.explorer-tree-item.file[title="Demo page.HTM"]';
  await visible(file); await click(file);
  const frameSelector = '.preview-html-frame';
  await visible(frameSelector);
  const previewFrame = () => win.webContents.mainFrame.frames.find(frame => frame.url.startsWith("vela-preview://"));
  const frame = await until(previewFrame, "HTML document");
  await until(() => frame.executeJavaScript(`document.querySelector('button')?.onclick && document.images[0].naturalWidth`), "module imports and image");
  assert.equal(await frame.executeJavaScript(`getComputedStyle(document.querySelector('button')).color`), 'rgb(12, 34, 56)');
  await until(() => js(`!document.querySelector('.workbench-clip.is-animating') &&
    !document.querySelector('.workbench-panel').getAnimations().length`), 'workbench opening');
  const guest = await js(`(() => {
    const iframe = document.querySelector('${frameSelector}');
    const frame = iframe.getBoundingClientRect();
    const bar = iframe.closest('.panel-file-preview-view').querySelector('.preview-subbar');
    const fadeBottom = bar.getBoundingClientRect().top + parseFloat(getComputedStyle(bar, '::before').height);
    // The workbench resize handle intentionally covers the outermost left edge.
    const probes = [0.25, 0.5, 0.75].map(at => {
      const hit = document.elementFromPoint(frame.left + frame.width * at, frame.top + 2);
      return { frameHit: hit === iframe, target: hit ? [hit.localName, hit.getAttribute('class')].filter(Boolean).join('.') : 'none' };
    });
    return { left: frame.left, top: frame.top, fadeBottom, probes,
      sandbox: iframe.getAttribute('sandbox'), referrerPolicy: iframe.referrerPolicy };
  })()`);
  assert.ok(guest.top >= guest.fadeBottom - 1, 'The fade must end before the guest viewport');
  assert.ok(guest.probes.every(probe => probe.frameHit),
    `The frame, not the host header, owns its top edge (hits: ${guest.probes.map(probe => probe.target).join(', ')})`);
  assert.equal(guest.sandbox, 'allow-scripts');
  assert.equal(guest.referrerPolicy, 'no-referrer');
  const button = await frame.executeJavaScript(`(() => {
    const r = document.querySelector('button').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  const point = { x: guest.left + button.x, y: guest.top + button.y };
  assert.ok(await js(`document.elementFromPoint(${point.x}, ${point.y}).matches('${frameSelector}')`));
  // Dispatch through Chromium's hit-test path, including the sandboxed child frame.
  const input = win.webContents.debugger;
  input.attach();
  try {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await input.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    }
    await until(() => frame.executeJavaScript(`document.querySelector('button').textContent === 'Clicked'`), 'real input on the first guest row');
    await input.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 180 });
    await until(() => frame.executeJavaScript('window.scrollY > 100'), 'independent guest scrolling');
  } finally { input.detach(); }
  assert.equal(await js(`document.querySelector('${frameSelector}').getBoundingClientRect().top`), guest.top);
  assert.equal(await frame.executeJavaScript(`typeof window.vela`), "undefined");
  assert.equal(await js(`document.querySelector('${frameSelector}').contentDocument === null`), true);
  await click('.preview-view-toggle button:last-child');
  await visible('.preview-code-pane .code-rows');
  assert.ok(await js(`document.querySelector('.code-rows').textContent.includes('assets/main.mjs')`));
  await click('.preview-view-toggle button:first-child');
  await until(previewFrame, "back to preview");
  write("assets/theme/colors.css", "button { color: rgb(98, 76, 54); }");
  await click('.preview-actions-group button[aria-label="Reload"]');
  await until(async () => {
    const updated = previewFrame();
    return updated && await updated.executeJavaScript(`document.querySelector('button') && getComputedStyle(document.querySelector('button')).color === 'rgb(98, 76, 54)'`).catch(() => false);
  }, "reloaded CSS");
  console.log("PASS workspace HTML preview: imported CSS, module scripts, image, real guest click/wheel, isolation, source toggle and reload");
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on("will-quit", () => rmSync(temp, { recursive: true, force: true }));
