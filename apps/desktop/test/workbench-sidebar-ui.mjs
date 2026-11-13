/** Pixel regression: sliding paper must not show through the rail layout's transparent sidebar. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-sidebar-pixels-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "workbench-split-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_SIDEBAR_PIXELS_TEMP: temporary }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    try { assert.equal(await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); }), 0); }
    finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_SIDEBAR_PIXELS_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1280, height: 840,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = ms => new Promise(done => setTimeout(done, ms));
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) { if (await js(code)) return; await wait(20); }
      throw new Error(`Timed out: ${code}`);
    };
    const difference = (a, b) => Math.max(...[0, 1, 2].map(i => Math.abs(a[i] - b[i])));
    try {
      await win.loadFile(join(temporary, "index.html"), { query: { rail: "1" } });
      await until("window.splitFixture && document.querySelector('.workbench-panel')");
      await js("document.documentElement.dataset.scheme='light'; splitFixture.setContext(true)");
      await wait(400);
      assert.deepEqual(await js("(()=>{const s=getComputedStyle(document.querySelector('.sidebar-right'));return [s.backgroundColor,s.backdropFilter]})()"), ['rgba(0, 0, 0, 0)', 'none']);
      for (const width of [1280, 1600]) {
        win.setSize(width, 840); await wait(350);
        for (const clipped of [false, true]) {
          await js(`(() => {const clip=document.querySelector('.workbench-clip'); clip.style.overflow=${JSON.stringify(clipped ? 'clip' : 'visible')}; clip.style.maskImage=${JSON.stringify(clipped ? '' : 'none')}; splitFixture.expand()})()`);
          await wait(350);
          const cornerRects = await js("(()=>{const r=document.querySelector('.workbench-clip').getBoundingClientRect();return [r.top+54,r.bottom-2].map(y=>({x:Math.floor(r.right)-2,y:Math.floor(y),width:1,height:1}))})()");
          const cornerBefore = [];
          for (const rect of cornerRects) cornerBefore.push((await win.webContents.capturePage({ ...rect, x: rect.x + 10 })).toBitmap());
          if (clipped) {
            for (const [i, rect] of cornerRects.entries()) {
              const pixel = (await win.webContents.capturePage(rect)).toBitmap();
              assert.ok(difference(cornerBefore[i], pixel) <= 3, `Expanded ${i ? 'bottom' : 'top'} right corner exposes the glass: ${[...cornerBefore[i]]} → ${[...pixel]}`);
            }
            if (process.env.VELA_SIDEBAR_PIXELS_CAPTURE && width === 1280) {
              writeFileSync(`${process.env.VELA_SIDEBAR_PIXELS_CAPTURE}-idle.png`, (await win.webContents.capturePage()).toPNG());
            }
          }
          const pixelRect = await js("(()=>{const r=document.querySelector('.sidebar-right').getBoundingClientRect();return {x:Math.floor(r.left)+8,y:Math.floor(r.top)+500,width:1,height:1}})()");
          const before = (await win.webContents.capturePage(pixelRect)).toBitmap();
          await js(`new Promise(resolve => {
            document.querySelector('.workbench-collapse').click();
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const transition = document.querySelector('.workbench-panel').getAnimations().find(a => a.transitionProperty === 'margin-right');
              if (transition) { transition.pause(); transition.currentTime = 80; }
              requestAnimationFrame(resolve);
            }));
          })`);
          const geometry = await js("(()=>{const p=document.querySelector('.workbench-panel').getBoundingClientRect(),s=document.querySelector('.sidebar-right').getBoundingClientRect(),v=document.querySelector('.workbench-clip').getBoundingClientRect();return {paperRight:p.right,sidebarLeft:s.left,viewportRight:v.right}})()");
          assert.ok(geometry.paperRight > pixelRect.x, 'The sampled pixel must be inside the overlapping sliding paper');
          const during = (await win.webContents.capturePage(pixelRect)).toBitmap();
          if (clipped) {
            assert.ok(Math.abs(geometry.viewportRight - geometry.sidebarLeft) < 1, 'The viewport ends at the transparent sidebar');
            assert.ok(difference(before, during) <= 2, `Sidebar pixels stay unchanged at width ${width}: ${[...before]} → ${[...during]}`);
            for (const [i, rect] of cornerRects.entries()) {
              const pixel = (await win.webContents.capturePage(rect)).toBitmap();
              assert.ok(difference(cornerBefore[i], pixel) <= 3, `Closing ${i ? 'bottom' : 'top'} right corner exposes the glass: ${[...cornerBefore[i]]} → ${[...pixel]}`);
            }
          } else {
            assert.ok(difference(before, during) > 20, 'The pixel check must detect white paper when clipping is disabled');
          }
          if (process.env.VELA_SIDEBAR_PIXELS_CAPTURE && width === 1280) {
            writeFileSync(`${process.env.VELA_SIDEBAR_PIXELS_CAPTURE}-${clipped ? 'fixed' : 'before'}.png`, (await win.webContents.capturePage()).toPNG());
          }
          await wait(240);
        }
        // Check the same stationary corners halfway through expansion.
        await js(`new Promise(resolve => {
          splitFixture.expand();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            for (const transition of document.querySelector('.workbench-panel').getAnimations()) {
              transition.pause(); transition.currentTime = 120;
            }
            requestAnimationFrame(resolve);
          }));
        })`);
        const openingCorners = await js("(()=>{const r=document.querySelector('.workbench-clip').getBoundingClientRect();return [r.top+54,r.bottom-2].map(y=>({x:Math.floor(r.right)-2,y:Math.floor(y),width:1,height:1}))})()");
        for (const [i, rect] of openingCorners.entries()) {
          const glass = (await win.webContents.capturePage({ ...rect, x: rect.x + 10 })).toBitmap();
          const pixel = (await win.webContents.capturePage(rect)).toBitmap();
          assert.ok(difference(glass, pixel) <= 3, `Opening ${i ? 'bottom' : 'top'} right corner exposes the glass: ${[...glass]} → ${[...pixel]}`);
        }
        await js("document.querySelector('.workbench-panel').getAnimations().forEach(a=>a.finish())");
        await wait(40);
        assert.equal(await js("getComputedStyle(document.querySelector('.workbench-clip')).maskImage"), 'none', 'Idle surfaces release the temporary mask');
        for (const [i, rect] of openingCorners.entries()) {
          const glass = (await win.webContents.capturePage({ ...rect, x: rect.x + 10 })).toBitmap();
          const pixel = (await win.webContents.capturePage(rect)).toBitmap();
          assert.ok(difference(glass, pixel) <= 3, `Finished expansion retains the ${i ? 'bottom' : 'top'} right corner after releasing the mask`);
        }
      }
      console.log('PASS Transparent sidebar and rounded top/bottom right corners remain correct before, during and after collapse/expansion at 1280px and 1600px');
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
