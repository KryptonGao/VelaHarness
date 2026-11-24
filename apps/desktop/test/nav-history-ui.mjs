/** 真实 App 的前进/后退：对话切换、设置页、快捷键与顶栏布局。node apps/desktop/test/nav-history-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { providerIconsPlugin } from "./provider-icons-plugin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-nav-history-"));
  try {
    const { build } = await import("esbuild");
    await build({ plugins: [providerIconsPlugin], entryPoints: [join(here, "workbench-chat-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
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
    const nativeControls = process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 18 }, titleBarOverlay: true } : {};
    const win = new BrowserWindow({ ...nativeControls, show: false, width: 1280, height: 800,
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
    const toggle = "document.querySelector('.window-navigation > button')";
    const toggleBounds = () => evaluate(`${toggle}.getBoundingClientRect().toJSON()`);
    const title = "document.querySelector('.main-stage-pane > .main-chat-view .chat-active-title')?.textContent";
    // Electron 按文档顺序合成 -webkit-app-region（不看遮挡/层级），elementFromPoint 看不出点击会不会被拖动区吞掉，这里自己合成。
    const clickable = () => evaluate(`(() => {
      const regions = [...document.querySelectorAll('*')].map(el => [el, getComputedStyle(el).getPropertyValue('-webkit-app-region')]).filter(([, value]) => value === 'drag' || value === 'no-drag');
      return [...document.querySelectorAll('.window-navigation button')].map(button => {
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

      // 快捷键：⌘[ 后退、⌘] 前进。
      await key({ code: "BracketLeft", key: "[", metaKey: true });
      await until(`${title} === '主聊天'`);
      assert.equal(await evaluate(`${back}.disabled`), true);
      await key({ code: "BracketRight", key: "]", metaKey: true });
      await until(`${title} === '另一条主聊天'`);
      await key({ code: "BracketLeft", key: "[", metaKey: true });
      await until(`${title} === '主聊天'`);

      await until("document.querySelector('.app-screen-main').getAnimations().length === 0");
      const anchor = await toggleBounds();
      const history = await evaluate("document.querySelector('.nav-history-buttons').getBoundingClientRect().toJSON()");
      assert.ok(anchor.left >= 90 && anchor.right <= history.left, "Sidebar toggle sits between the traffic lights and history");
      assert.ok(Math.abs(anchor.y + anchor.height / 2 - 26) <= 1, "Toggle aligns with the titlebar");
      assert.ok(history.right <= await evaluate("document.querySelector('.chat-active-title').getBoundingClientRect().left"));
      assert.deepEqual(await clickable(), ["no-drag", "no-drag", "no-drag"]);
      await capture("nav-history-collapsed");

      await key({ code: "KeyB", key: "b", metaKey: true });
      await until(`${toggle}.ariaExpanded === 'true' && !document.querySelector('.sidebar-left').inert`);
      assert.deepEqual(await toggleBounds(), anchor);
      assert.deepEqual(await clickable(), ["no-drag", "no-drag", "no-drag"]);
      await capture("nav-history-expanded");

      await key({ code: "Comma", key: ",", metaKey: true });
      const settingsNav = "document.querySelector('.settings-nav')";
      await until(`${settingsNav}?.checkVisibility()`);
      await evaluate(`${toggle}.click()`);
      await until(`${toggle}.ariaExpanded === 'false' && !${settingsNav}.checkVisibility()`);
      assert.deepEqual(await toggleBounds(), anchor);
      assert.ok(history.right <= await evaluate("document.querySelector('.settings-header h2').getBoundingClientRect().left"));
      await capture("nav-history-settings-collapsed");
      await key({ code: "KeyF", key: "f", metaKey: true });
      await until("document.activeElement.matches('.settings-search-input')");
      assert.equal(await evaluate(`${toggle}.ariaExpanded`), "true");
      await evaluate(`${back}.click()`);
      await until(`!${settingsNav} && ${title} === '主聊天'`);
      assert.deepEqual(await toggleBounds(), anchor);

      await key({ code: "KeyT", key: "t", metaKey: true });
      await until("document.querySelector('.workbench-fullscreen-button')");
      await evaluate("document.querySelector('.workbench-fullscreen-button').click()");
      await until("document.querySelector('.workbench-pinned-chat')");
      await evaluate(`${toggle}.click()`);
      await until(`${toggle}.ariaExpanded === 'false' && document.querySelector('.vela-window').getAnimations().length === 0`);
      assert.deepEqual(await toggleBounds(), anchor);
      assert.ok(history.right <= await evaluate("document.querySelector('.workbench-pinned-chat').getBoundingClientRect().left"));
      if (process.platform === "darwin") {
        win.webContents.setZoomFactor(0.8);
        await until(`navigator.windowControlsOverlay.getTitlebarAreaRect().left > ${anchor.left}
          && ${toggle}.getBoundingClientRect().left === navigator.windowControlsOverlay.getTitlebarAreaRect().left`);
      }
      assert.deepEqual(errors, []);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
