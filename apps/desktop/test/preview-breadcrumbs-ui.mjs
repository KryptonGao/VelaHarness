/** Run with node apps/desktop/test/preview-breadcrumbs-ui.mjs. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStyles } from "./read-styles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-breadcrumbs-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "preview-breadcrumbs-preview.tsx")], bundle: true,
      platform: "browser", format: "iife", jsx: "automatic", outfile: join(temporary, "ui.js"),
      loader: { ".svg": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>' +
      readStyles(join(here, "../src/renderer/styles.css")) +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_BREADCRUMBS_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      assert.equal(await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); }), 0);
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_BREADCRUMBS_TEMP, "profile"));
  void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const until = async code => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await evaluate(code)) return;
      await new Promise(done => setTimeout(done, 20));
    }
    throw new Error(`Timed out: ${code}`);
  };
  const nav = "document.querySelector('.preview-breadcrumbs-text')";
  const state = () => evaluate(`(() => { const n = ${nav}; return {left: n.scrollLeft, max: n.scrollWidth - n.clientWidth, start: n.dataset.fadeStart, end: n.dataset.fadeEnd}; })()`);
  const wheel = (deltaX, deltaY, extra = {}) => evaluate(`(() => { const e = new WheelEvent('wheel', ${JSON.stringify({ deltaX, deltaY, bubbles: true, cancelable: true, ...extra })}); ${nav}.dispatchEvent(e); return e.defaultPrevented; })()`);
  const choose = async label => {
    await evaluate(`Array.from(document.querySelectorAll('[data-setting-id="preview-breadcrumb-mode"] [role="radio"]')).find(n => n.textContent === ${JSON.stringify(label)}).click()`);
    await until(`${nav}.dataset.mode === ${JSON.stringify(label === "悬停展开" ? "hover" : "scroll")}`);
  };
  try {
    await win.loadFile(join(process.env.VELA_BREADCRUMBS_TEMP, "index.html"));
    await until(`${nav}?.dataset.mode === 'scroll' && ${nav}.scrollLeft > 0`);
    const initial = await state();
    assert.ok(initial.max > 100);
    assert.equal(initial.left, initial.max);
    assert.equal(initial.start, "true");
    assert.equal(initial.end, "false");
    assert.ok(await evaluate(`Array.from(${nav}.querySelectorAll('.preview-crumb-text')).every(n => n.scrollWidth <= n.clientWidth + 1)`), "All segments retain their full width");
    assert.equal(await wheel(0, -60), true);
    assert.equal((await state()).left, initial.left - 60);
    assert.equal((await state()).end, "true");
    assert.equal(await wheel(-40, 0), true);
    assert.equal((await state()).left, initial.left - 100);
    await wheel(20, 0);
    await wheel(0, 20);
    assert.equal((await state()).left, initial.left - 60);
    await wheel(10, -20);
    assert.equal((await state()).left, initial.left - 80, "Diagonal input follows its dominant axis");
    await wheel(0, -2, { deltaMode: 1 });
    assert.equal((await state()).left, initial.left - 112, "Line wheel units map to pixels");
    const beforePinch = (await state()).left;
    assert.equal(await wheel(0, -20, { ctrlKey: true }), false);
    assert.equal((await state()).left, beforePinch);
    await wheel(0, -10000);
    assert.deepEqual(await state(), { left: 0, max: initial.max, start: "false", end: "true" });
    await wheel(0, 1, { deltaMode: 2 });
    assert.ok((await state()).left > 0);
    const position = await evaluate(`(() => { const n = ${nav}; n.scrollLeft = 150; const r = n.getBoundingClientRect(); return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)}; })()`);
    win.webContents.sendInputEvent({ type: "mouseWheel", ...position, deltaX: 0, deltaY: 30, canScroll: true });
    await until(`${nav}.scrollLeft < 150`);
    await evaluate(`${nav}.scrollLeft = 150`);
    win.webContents.sendInputEvent({ type: "mouseWheel", ...position, deltaX: -30, deltaY: 0, canScroll: true });
    await until(`${nav}.scrollLeft > 150`);
    console.log("PASS full-width segments, four wheel directions, diagonal input, wheel units, pinch exclusion and edge fades");

    await evaluate(`${nav}.focus()`);
    await win.webContents.sendInputEvent({ type: "keyDown", keyCode: "HOME" });
    await until(`${nav}.scrollLeft === 0`);
    await win.webContents.sendInputEvent({ type: "keyDown", keyCode: "RIGHT" });
    await until(`${nav}.scrollLeft > 0`);
    await win.webContents.sendInputEvent({ type: "keyDown", keyCode: "END" });
    await until(`${nav}.dataset.fadeEnd === 'false'`);
    await evaluate("document.getElementById('panel').style.width = '350px'");
    await until(`${nav}.scrollLeft === ${nav}.scrollWidth - ${nav}.clientWidth`);
    await evaluate("document.getElementById('panel').style.width = '1800px'");
    await until(`${nav}.dataset.fadeStart === 'false' && ${nav}.dataset.fadeEnd === 'false'`);
    assert.equal(await wheel(0, 40), false, "A path that fits does not capture wheel input");
    await evaluate("document.getElementById('panel').style.width = '500px'");
    await until(`${nav}.dataset.fadeStart === 'true'`);
    if (process.env.VELA_BREADCRUMBS_SCREENSHOT) {
      await evaluate(`${nav}.scrollLeft = 150`);
      await until(`${nav}.dataset.fadeStart === 'true' && ${nav}.dataset.fadeEnd === 'true'`);
      assert.ok(await evaluate(`getComputedStyle(${nav}).maskImage.includes('16px')`), "Both clipped edges use a fade mask");
      writeFileSync(process.env.VELA_BREADCRUMBS_SCREENSHOT, (await win.webContents.capturePage({ x: 20, y: 20, width: 520, height: 88 })).toPNG());
    }
    await evaluate("window.setShortPath(true)");
    await until(`${nav}.textContent.includes('a.ts') && ${nav}.dataset.fadeStart === 'false'`);
    await evaluate("window.setShortPath(false)");
    await until(`${nav}.dataset.fadeStart === 'true' && ${nav}.dataset.fadeEnd === 'false'`);
    console.log("PASS keyboard access, panel resizing, no-overflow behavior and path changes");

    await choose("悬停展开");
    assert.equal(await evaluate("localStorage.getItem('vela.previewBreadcrumbMode')"), '"hover"');
    assert.ok(await evaluate("Array.from(document.querySelectorAll('.preview-breadcrumbs-text')).every(n => n.dataset.mode === 'hover')"));
    await until(`${nav}.querySelector('[data-fade="true"]') !== null`);
    assert.equal(await wheel(0, 40), false, "Hover mode removes the wheel handler");
    const target = await evaluate(`(() => { const r = ${nav}.querySelector('.preview-crumb').getBoundingClientRect(); return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)}; })()`);
    win.webContents.sendInputEvent({ type: "mouseMove", ...target });
    await until(`${nav}.querySelector('.preview-crumb').dataset.active === 'true'`);
    await until(`getComputedStyle(${nav}.querySelector('.preview-crumb')).flexShrink === '0'`);
    await win.loadFile(join(process.env.VELA_BREADCRUMBS_TEMP, "index.html"));
    await until(`${nav}?.dataset.mode === 'hover'`);
    await choose("完整路径滚动");
    await until(`${nav}.scrollLeft > 0`);
    assert.equal(await evaluate("localStorage.getItem('vela.previewBreadcrumbMode')"), '"scroll"');
    await win.loadFile(join(process.env.VELA_BREADCRUMBS_TEMP, "index.html"));
    await until(`${nav}?.dataset.mode === 'scroll' && ${nav}.scrollLeft > 0`);
    assert.deepEqual(errors, []);
    console.log("PASS live setting changes, hover expansion, synchronized previews and persistence across reloads");
    app.quit();
  } catch (error) { console.error(error); console.error(errors); app.exit(1); }
  });
}
