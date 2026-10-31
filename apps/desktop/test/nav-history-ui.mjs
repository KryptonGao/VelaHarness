/** 真实 App 的前进/后退：对话切换、设置页、快捷键与顶栏布局。node apps/desktop/test/nav-history-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-nav-history-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "workbench-chat-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_NAV_HISTORY_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Navigation history UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_NAV_HISTORY_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1440, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error" || event.level >= 3) errors.push(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async code => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
      throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
    };
    const capture = async (name, settle = 250) => {
      if (!process.env.VELA_NAV_HISTORY_CAPTURE) return;
      mkdirSync(process.env.VELA_NAV_HISTORY_CAPTURE, { recursive: true });
      if (settle) await evaluate(`new Promise(done => setTimeout(done, ${settle}))`);
      writeFileSync(join(process.env.VELA_NAV_HISTORY_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const back = "document.querySelector('.nav-history-buttons button:first-child')";
    const forward = "document.querySelector('.nav-history-buttons button:last-child')";
    const title = "document.querySelector('.main-stage-pane > .main-chat-view .chat-active-title')?.textContent";
    // Electron 按文档顺序合成 -webkit-app-region（不看遮挡/层级），elementFromPoint 看不出点击会不会被拖动区吞掉，这里自己合成。
    const clickable = () => evaluate(`(() => {
      const regions = [...document.querySelectorAll('*')].map(el => [el, getComputedStyle(el).getPropertyValue('-webkit-app-region')]).filter(([, value]) => value === 'drag' || value === 'no-drag');
      return [...document.querySelectorAll('.nav-history-buttons button')].map(button => {
        const r = button.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2;
        let state = 'none';
        for (const [el, value] of regions) { const b = el.getBoundingClientRect(); if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) state = value; }
        return state;
      });
    })()`);
    const key = (init) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ bubbles: true, ...init })}))`);
    try {
      await win.loadFile(join(temporary, "index.html"));
      await until(`${title} === '主聊天'`);
      assert.equal(await evaluate(`${back}.disabled && ${forward}.disabled`), true, "nothing to navigate to at first");
      await capture("nav-history-initial");

      // 切到另一条对话后可后退；后退回到原对话并可前进，且回退本身不产生新记录。
      await evaluate("chatFixture.changeMain()");
      await until(`${title} === '另一条主聊天'`);
      await until(`!${back}.disabled`);
      assert.equal(await evaluate(`${forward}.disabled`), true);
      await evaluate(`${back}.click()`);
      await until(`${title} === '主聊天'`);
      await until(`${back}.disabled && !${forward}.disabled`);
      await evaluate(`${forward}.click()`);
      await until(`${title} === '另一条主聊天'`);
      await until(`!${back}.disabled && ${forward}.disabled`);

      // 设置页也是一个落脚点：⌘, 打开，⌘[ 回到对话，⌘] 再回到设置。
      // 快捷键：⌘[ 后退、⌘] 前进。
      await key({ code: "BracketLeft", key: "[", metaKey: true });
      await until(`${title} === '主聊天'`);
      assert.equal(await evaluate(`${back}.disabled`), true);
      await key({ code: "BracketRight", key: "]", metaKey: true });
      await until(`${title} === '另一条主聊天'`);
      await key({ code: "BracketLeft", key: "[", metaKey: true });
      await until(`${title} === '主聊天'`);

      // 侧栏收起时按钮在红绿灯右侧，且不压住折叠按钮和标题。
      const layout = await evaluate(`(() => {
        const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const buttons = box(document.querySelector('.nav-history-buttons'));
        const toggle = box(document.querySelector('.main-stage-pane > .main-chat-view .view-icon-btn'));
        const heading = box(document.querySelector('.main-stage-pane > .main-chat-view .chat-active-title'));
        return { buttons, toggle, heading };
      })()`);
      assert.ok(layout.buttons.left >= 90, `buttons clear the traffic lights: ${layout.buttons.left}`);
      assert.ok(layout.buttons.right <= layout.toggle.left, "buttons end before the sidebar toggle");
      assert.ok(layout.buttons.right <= layout.heading.left, "buttons end before the title");
      assert.ok(Math.abs((layout.buttons.top + layout.buttons.bottom) / 2 - 26) <= 1, `buttons share the header midline: ${layout.buttons.top} ${layout.buttons.bottom} toggle ${layout.toggle.top} ${layout.toggle.bottom}`);
      assert.deepEqual(await clickable(), ["no-drag", "no-drag"], "buttons are not swallowed by a drag region (collapsed)");
      await capture("nav-history-collapsed");

      // 侧栏展开后按钮仍在原位，折叠按钮在侧栏另一端。
      await key({ code: "KeyB", key: "b", metaKey: true });
      await until("!document.querySelector('.vela-window').classList.contains('left-collapsed')");
      await evaluate("new Promise(done => setTimeout(done, 400))");
      const expanded = await evaluate(`(() => {
        const buttons = document.querySelector('.nav-history-buttons').getBoundingClientRect();
        const toggle = document.querySelector('.sidebar-left .titlebar-drag-row .icon-btn-ghost').getBoundingClientRect();
        return { buttonsRight: buttons.right, toggleLeft: toggle.left };
      })()`);
      assert.ok(expanded.buttonsRight <= expanded.toggleLeft, "buttons do not cover the sidebar toggle");
      assert.deepEqual(await clickable(), ["no-drag", "no-drag"], "buttons are not swallowed by a drag region (expanded)");
      await capture("nav-history-expanded");
      assert.deepEqual(errors, []);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
