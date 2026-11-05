/** 设置里的快捷键页:录入、冲突提示、清除、恢复默认与持久化。node apps/desktop/test/shortcuts-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStyles } from "./read-styles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-shortcuts-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "shortcuts-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".css": "empty" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    const mock = `window.fixture = { saved: new Map(), recordings: [] };
      window.vela = { platform: "darwin", uiStorage: {
        getItem: key => window.fixture.saved.has(key) ? window.fixture.saved.get(key) : undefined,
        setItem: (key, value) => { window.fixture.saved.set(key, value); },
        removeItem: key => { window.fixture.saved.delete(key); } } };`;
    writeFileSync(join(temporary, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${readStyles(join(here, "../src/renderer/styles.css"))}</style><script>${mock}</script></head><body><div id="root"></div><script src="ui.js"></script></body></html>`);
    const env = { ...process.env, VELA_SHORTCUTS_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Shortcuts UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_SHORTCUTS_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 900, height: 1200,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error" || event.level >= 3) errors.push(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}\n  while running: ${code}`); });
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
      throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
    };
    const row = action => `document.querySelector('[data-shortcut-action="${action}"]')`;
    const keys = action => evaluate(`[...${row(action)}.querySelectorAll('kbd')].map(el => el.textContent)`);
    const saved = () => evaluate(`window.fixture.saved.get('vela.shortcuts') ?? null`);
    const press = init => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ bubbles: true, cancelable: true, ...init })}))`);
    const click = selector => evaluate(`${selector}.click()`);
    try {
      await win.loadFile(join(temporary, "index.html"));
      await until(`${row("new-chat")}`);
      assert.deepEqual(await keys("new-chat"), ["⌘N"]);
      assert.deepEqual(await keys("next-tab"), ["⇧⌘]", "⌃Tab"], "two default bindings are shown");
      assert.deepEqual(await keys("go-back"), ["⌘["]);
      assert.deepEqual(await keys("side-chat"), ["⌥⌘S"]);
      assert.equal(await evaluate(`${row("open-terminal")}.textContent.includes('Unassigned')`), true, "unbound actions say so");
      assert.equal(await evaluate(`document.querySelector('.settings-shortcut-reset-all').disabled`), true, "nothing to reset yet");

      // 录入新快捷键:按住的修饰键不算,主键到了才落定;Option 改写字符(⌥N → ˜)也按物理键位识别。
      await click(`${row("new-chat")}.querySelector('.settings-key')`);
      await until(`${row("new-chat")}.querySelector('.is-recording')`);
      assert.equal(await evaluate(`${row("new-chat")}.querySelector('.is-recording').textContent.trim()`), "", "no text while listening");
      if (process.env.VELA_SHORTCUTS_CAPTURE) {
        mkdirSync(process.env.VELA_SHORTCUTS_CAPTURE, { recursive: true });
        writeFileSync(join(process.env.VELA_SHORTCUTS_CAPTURE, "recording.png"), (await win.webContents.capturePage()).toPNG());
      }
      await press({ code: "AltLeft", key: "Alt", altKey: true });
      assert.equal(await evaluate(`!!${row("new-chat")}.querySelector('.is-recording')`), true, "still waiting after a modifier alone");
      await press({ code: "KeyN", key: "˜", metaKey: true, altKey: true });
      await until(`!${row("new-chat")}.querySelector('.is-recording')`);
      assert.deepEqual(await keys("new-chat"), ["⌥⌘N"]);
      assert.deepEqual(JSON.parse(await saved()), { "new-chat": ["Mod+Alt+N"] });
      assert.equal(await evaluate(`document.querySelector('.settings-shortcut-reset-all').disabled`), false);

      // 冲突:⌘B 已经属于侧边栏,不允许抢,并说明占用者。
      await click(`${row("new-tab")}.querySelector('.settings-key')`);
      await until(`${row("new-tab")}.querySelector('.is-recording')`);
      await press({ code: "KeyB", key: "b", metaKey: true });
      await until(`${row("new-tab")}.querySelector('[role=alert]')`);
      assert.match(await evaluate(`${row("new-tab")}.querySelector('[role=alert]').textContent`), /Show\/hide sidebar/);
      // 没有修饰键、以及系统保留组合都被拒绝。
      await press({ code: "KeyQ", key: "q" });
      assert.match(await evaluate(`${row("new-tab")}.querySelector('[role=alert]').textContent`), /modifier/);
      await press({ code: "KeyC", key: "c", metaKey: true });
      assert.match(await evaluate(`${row("new-tab")}.querySelector('[role=alert]').textContent`), /reserved/);
      // Esc 取消录入并清掉提示。
      await press({ code: "Escape", key: "Escape" });
      await until(`!${row("new-tab")}.querySelector('.is-recording') && !${row("new-tab")}.querySelector('[role=alert]')`);
      assert.deepEqual(await keys("new-tab"), ["⌘T"], "binding unchanged after conflicts and cancel");

      // 添加第二个快捷键;删除键清除一个。
      await click(`${row("toggle-info")}.querySelector('.settings-key-add')`);
      await press({ code: "KeyI", key: "i", metaKey: true, shiftKey: true });
      await until(`${row("toggle-info")}.querySelectorAll('kbd').length === 2`);
      assert.deepEqual(await keys("toggle-info"), ["⌘J", "⇧⌘I"]);
      await click(`${row("toggle-info")}.querySelector('.settings-key')`);
      await press({ code: "Backspace", key: "Backspace" });
      await until(`${row("toggle-info")}.querySelectorAll('kbd').length === 1`);
      assert.deepEqual(await keys("toggle-info"), ["⇧⌘I"]);

      // 清空到只剩未分配,持久化为空数组。
      await click(`${row("toggle-info")}.querySelector('.settings-key')`);
      await press({ code: "Delete", key: "Delete" });
      await until(`${row("toggle-info")}.textContent.includes('Unassigned')`);
      assert.deepEqual(JSON.parse(await saved())["toggle-info"], []);

      // 单项与全部恢复默认;全部默认后存储键被移除。
      await click(`${row("toggle-info")}.querySelector('.settings-key-reset')`);
      await until(`${row("toggle-info")}.querySelectorAll('kbd').length === 1`);
      assert.deepEqual(await keys("toggle-info"), ["⌘J"]);
      await click("document.querySelector('.settings-shortcut-reset-all')");
      await until(`document.querySelector('.settings-shortcut-reset-all').disabled`);
      assert.deepEqual(await keys("new-chat"), ["⌘N"]);
      assert.equal(await saved(), null);

      if (process.env.VELA_SHORTCUTS_CAPTURE) {
        mkdirSync(process.env.VELA_SHORTCUTS_CAPTURE, { recursive: true });
        writeFileSync(join(process.env.VELA_SHORTCUTS_CAPTURE, "shortcuts.png"), (await win.webContents.capturePage()).toPNG());
      }
      assert.deepEqual(errors, [], "no console errors");
      console.log("PASS 快捷键页:录入、冲突/保留/无修饰键提示、Esc 取消、添加与清除、恢复默认");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
