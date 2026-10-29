/** 独立 Electron 夹具:node apps/desktop/test/changes-filter-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-changes-filter-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "changes-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>body{margin:0}#root{display:flex;padding:16px}.fixture{width:900px;display:flex}</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_CHANGES_FILTER_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 55000);
    try { assert.equal(await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); }), 0); }
    finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_CHANGES_FILTER_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error" || event.level >= 3) errors.push(event.message); });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const until = async code => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
    throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = key => evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)},bubbles:true}))`);
  const choose = async label => {
    await click(".changes-filter-trigger");
    await until("document.querySelector('.changes-filter-menu')");
    await evaluate(`[...document.querySelectorAll('.changes-filter-item')].find(item=>item.textContent.trim()===${JSON.stringify(label)}).click()`);
  };
  const paths = () => evaluate("[...document.querySelectorAll('.turn-review-file-header strong')].map(el=>el.textContent)");
  const capture = async name => {
    if (!process.env.VELA_CHANGES_FILTER_CAPTURE) return;
    mkdirSync(process.env.VELA_CHANGES_FILTER_CAPTURE, { recursive: true });
    await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 100))))");
    writeFileSync(join(process.env.VELA_CHANGES_FILTER_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(join(temporary, "index.html"));
    await until("document.querySelectorAll('.turn-review-file').length===3");
    assert.equal(await evaluate("document.querySelector('.changes-filter-trigger').textContent.trim()"), "未提交");
    assert.equal(await evaluate("document.querySelectorAll('.turn-review-file:first-child .turn-review-edit').length"), 2);
    await click(".changes-filter-trigger");
    await until("document.querySelector('.changes-filter-menu')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.changes-filter-item')].map(el=>el.textContent.trim())"), ["上一轮", "未提交", "未暂存", "已暂存", "已提交", "分支"]);
    await capture("menu-light");
    await key("End");
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "分支");
    await key("Home");
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "上一轮");
    await key("Escape");
    assert.equal(await evaluate("changesFixture.closed"), 0);
    assert.equal(await evaluate("document.activeElement.className"), "changes-filter-trigger");
    await choose("未暂存");
    await until("document.querySelectorAll('.turn-review-file').length===2");
    assert.deepEqual(await paths(), ["README.md", "apps/desktop/test/new.test.ts"]);
    await choose("已暂存");
    await until("document.querySelector('.turn-review-file:nth-child(2) strong')?.textContent==='apps/desktop/src/index.ts'");
    assert.deepEqual(await paths(), ["README.md", "apps/desktop/src/index.ts"]);
    assert.equal(await evaluate("document.querySelectorAll('.turn-review-file:first-child .turn-review-edit').length"), 1);
    await choose("上一轮");
    await until("document.querySelector('.turn-review-file-header strong')?.textContent==='last-turn.ts'");
    await choose("已提交");
    await until("document.querySelector('.changes-filter-commit')");
    await capture("commits-light");
    await click(".changes-filter-options button:nth-child(2)");
    await until("changesFixture.commitSha==='def5678' && document.querySelector('.turn-review-file-header strong')?.textContent==='README.md'");
    await choose("分支");
    await until("document.querySelector('.changes-filter-options button')");
    await click(".changes-filter-options button");
    await until("changesFixture.comparison[0]==='feature/menu' && document.querySelector('.turn-review-file-header strong')?.textContent==='apps/desktop/src/index.ts'");
    assert.deepEqual(await evaluate("changesFixture.comparison"), ["feature/menu", "HEAD"]);
    // 失败反馈与重试。
    await evaluate("changesFixture.failDiff=true");
    await choose("未提交");
    await until("document.querySelector('.changes-filter-retry')");
    await evaluate("changesFixture.failDiff=false");
    await click(".changes-filter-retry");
    await until("document.querySelectorAll('.turn-review-file').length===3");
    // 点击外部关闭。
    await click(".changes-filter-trigger");
    await evaluate("document.querySelector('.turn-review-count').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    await until("!document.querySelector('.changes-filter-menu')");
    // 窄面板和暗色主题。
    await evaluate("document.querySelector('.fixture').style.width='380px';document.documentElement.dataset.scheme='dark'");
    await until("document.querySelector('.turn-review-view.is-compact')");
    await click(".changes-filter-trigger");
    await until("document.querySelector('.changes-filter-menu')");
    assert.equal(await evaluate("document.querySelector('.changes-filter-menu').getBoundingClientRect().right <= document.querySelector('.fixture').getBoundingClientRect().right"), true);
    await capture("menu-dark-compact");
    await evaluate("document.body.style.zoom='2'");
    assert.equal(await evaluate("document.querySelector('.changes-filter-trigger').scrollWidth <= document.querySelector('.changes-filter-trigger').clientWidth+1"), true);
    await capture("menu-dark-zoom");
    assert.deepEqual(errors, []);
    console.log("Changes filter UI passed: six categories, mixed staging, commits, branch comparison, keyboard, dismissal, retry, narrow/dark/zoom.");
  } catch (error) { console.error(error); app.exit(1); }
  finally { win.destroy(); }
  app.exit(0);
  });
}
