/** Run with node apps/desktop/test/file-preview-open-ui.mjs. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { providerIconsPlugin } from "./provider-icons-plugin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "vela-file-preview-open-")));
  try {
    const { build } = await import("esbuild");
    await build({ plugins: [providerIconsPlugin], entryPoints: [join(here, "file-preview-open-preview.tsx")], bundle: true,
      platform: "browser", format: "iife", jsx: "automatic", outfile: join(temporary, "ui.js"),
      loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_FILE_OPEN_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 55000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "File-opening UI checks failed");
    } finally { clearTimeout(timer); }
  } finally {
    console.log(`Removing temporary test directory: ${temporary}`);
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_FILE_OPEN_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1500, height: 940,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error" || event.level >= 3) errors.push(event.message); });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const until = async code => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await evaluate(code)) return;
      await new Promise(done => setTimeout(done, 20));
    }
    throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
  };
  const visible = '.workbench-tabpanel:not(.is-inactive)';
  const labels = () => evaluate("Array.from(document.querySelectorAll('.workbench-tab-label')).map(n => n.textContent)");
  const openFile = async path => {
    const pane = await evaluate("document.querySelector('.workbench-group.is-focused').dataset.workbenchPane");
    const target = `${visible}[data-workbench-content-pane="${pane}"]`;
    const query = path.includes("/") ? path : "";
    const selector = `${target} ${query ? ".explorer-result" : ".explorer-tree-item.file"}[title="${path}"]`;
    await evaluate(`(() => { const panel = document.querySelector(${JSON.stringify(target)}); Array.from(panel.querySelectorAll('.explorer-mode-chip')).find(n => n.textContent === '文件').click(); const i = panel.querySelector('.explorer-search-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(query)}); i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(`document.querySelector(${JSON.stringify(target + ' .preview-crumb.current')})?.textContent === ${JSON.stringify(path.split("/").pop())}`);
    await until(`document.querySelector(${JSON.stringify(target)})?.textContent.includes(${JSON.stringify(`Contents of ${path}`)})`);
  };
  const newFilesTab = async () => {
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {key:'t', code:'KeyT', metaKey:true, bubbles:true}))");
    await until(`!!document.querySelector(${JSON.stringify(visible + ' .start-view')})`);
    await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(visible + ' .start-option')})).find(n => n.querySelector('.start-option-title')?.textContent === '文件预览').click()`);
    await until(`!!document.querySelector(${JSON.stringify(visible + ' .file-browser-empty')})`);
  };
  const activate = async label => {
    await evaluate(`Array.from(document.querySelectorAll('.workbench-tab')).find(n => n.querySelector('.workbench-tab-label')?.textContent === ${JSON.stringify(label)}).click()`);
    await until(`document.querySelector('.workbench-tab[aria-selected="true"] .workbench-tab-label')?.textContent === ${JSON.stringify(label)}`);
  };
  async function checkCodeComments() {
    const file = "apps/desktop/src/renderer/components/example.ts";
    await openFile(file);
    const panel = `${visible} .code-rows`;
    await until(`document.querySelector('${panel} [data-line="2"] .code-row-content span')`);
    const point = (line, part) => evaluate(`(() => {
      const rect = document.querySelector('${panel} [data-line="${line}"] .code-row-${part}').getBoundingClientRect();
      return { x: Math.round(rect.left + 18), y: Math.round(rect.top + 9) };
    })()`);
    const openComment = async location => {
      await until("document.querySelector('.selection-actions[role=toolbar] button')?.textContent === '评论'");
      await evaluate("document.querySelector('.selection-actions button').click()");
      await until("document.activeElement?.matches('.selection-reply-row textarea')");
      assert.equal(await evaluate("document.querySelector('.selection-actions[role=dialog]').textContent"), location + "插入聊天框");
    };
    const key = key => evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
    const clickLine = async (line, modifiers = []) => {
      const position = await point(line, "gutter");
      for (const type of ["mouseDown", "mouseUp"]) win.webContents.sendInputEvent({ type, ...position, button: "left", clickCount: 1, modifiers });
    };
    const capture = async name => {
      if (!process.env.VELA_CODE_COMMENT_CAPTURE) return;
      await new Promise(done => setTimeout(done, 250));
      writeFileSync(join(process.env.VELA_CODE_COMMENT_CAPTURE, name), (await win.webContents.capturePage()).toPNG());
    };

    await evaluate("document.querySelector('.rich-input').focus()");
    await win.webContents.insertText("Keep this draft.");
    await clickLine(2);
    await openComment(`${file}:2`);
    assert.equal(await evaluate("document.querySelector('.selection-reply-insert').disabled"), true);
    await key("Escape");
    await until("!document.querySelector('.selection-actions')");
    assert.equal(await evaluate("document.querySelectorAll('.reply-quote-card').length"), 0);

    // Drag backwards across highlighted tokens and a blank line.
    const start = await point(5, "content");
    const end = await point(3, "content");
    win.webContents.sendInputEvent({ type: "mouseDown", ...start, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseMove", ...end, button: "left" });
    win.webContents.sendInputEvent({ type: "mouseUp", ...end, button: "left", clickCount: 1 });
    await openComment(`${file}:3-5`);
    await win.webContents.insertText("Can we make this configurable?");
    await capture("comment.png");
    await evaluate("document.querySelector('.selection-reply-insert').click()");
    await until("document.querySelector('.reply-quote-text')?.textContent === 'Can we make this configurable?'");
    assert.equal(await evaluate("document.querySelector('.reply-quote-badge').textContent"), "example.ts:3-5");
    assert.ok(await evaluate("document.querySelector('.code-comment-badge .file-type-icon')?.naturalWidth > 0"));
    assert.equal(await evaluate("document.querySelector('.rich-input').textContent"), "Keep this draft.");
    await capture("draft.png");
    const badgeCenter = await evaluate(`(() => {
      const r = document.querySelector('.code-comment-badge').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    win.webContents.sendInputEvent({ type: "mouseMove", ...badgeCenter });
    await until(`document.querySelector('.button-tooltip.is-path:popover-open')?.textContent === ${JSON.stringify("/projects/VelaHarness/" + file)}`);
    assert.ok(await evaluate("document.querySelector('.button-tooltip.is-path').scrollWidth <= document.querySelector('.button-tooltip.is-path').clientWidth"));
    await capture("path-tooltip.png");
    win.webContents.sendInputEvent({ type: "mouseMove", x: 5, y: 400 });
    await until("!document.querySelector('.button-tooltip.is-path')");

    await evaluate("document.querySelector('.workbench-fullscreen-button').click()");
    await until("document.querySelector('.vela-window.workbench-fullscreen') && !document.querySelector('.workbench-panel').getAnimations().length");
    await clickLine(3);
    await clickLine(5, ["shift"]);
    await openComment(`${file}:3-5`);
    await win.webContents.insertText("Another comment");
    await key("Enter");
    await until("document.querySelectorAll('.reply-quote-card').length === 2");
    await until("document.querySelector('.showing-pinned-chat')");
    await evaluate("document.querySelectorAll('.reply-quote-remove')[1].click()");
    assert.equal(await evaluate("chatFixture.calls.some(call => call.name === 'prompt')"), false);
    await evaluate("document.querySelector('.send-action-blue-btn.send').click()");
    await until("chatFixture.calls.some(call => call.name === 'prompt')");
    const sent = await evaluate("chatFixture.calls.find(call => call.name === 'prompt')");
    assert.equal(sent.id, "main-chat");
    assert.equal(sent.text, `> ${file}:3-5\n\nCan we make this configurable?\n\nKeep this draft.`);
    await evaluate("chatFixture.finish('main-chat')");
    await evaluate("document.querySelector('.workbench-restore').click()");
    await until("!document.querySelector('.vela-window.workbench-fullscreen')");
    await evaluate("document.querySelector('.workbench-tab-close[aria-label=\"关闭 example.ts\"]').click()");
    await until("!Array.from(document.querySelectorAll('.workbench-tab-label')).some(n => n.textContent === 'example.ts')");
    console.log("PASS file comments quote only the file and line range, preserve drafts and send once with the selected chat");
  }
  try {
    await win.loadFile(join(temporary, "index.html"));
    await until("document.querySelector('.chat-active-title')?.textContent === '主聊天'");
    await newFilesTab();
    assert.deepEqual(await labels(), ["文件"]);
    await openFile("first.txt");
    assert.deepEqual(await labels(), ["first.txt"]);
    await openFile("second.txt");
    assert.deepEqual(await labels(), ["first.txt", "second.txt"]);
    await openFile("first.txt");
    assert.deepEqual(await labels(), ["first.txt", "second.txt"]);
    console.log("PASS default mode reuses empty Files tab, adds new files, and activates existing files");
    await checkCodeComments();
    await activate("first.txt");

    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {key:',', code:'Comma', metaKey:true, bubbles:true}))");
    await until("!!document.querySelector('.settings-nav-item')");
    await evaluate("Array.from(document.querySelectorAll('.settings-nav-item')).find(n => n.textContent === '界面').click()");
    await until("!!document.querySelector('[data-setting-id=\"file-preview-open-mode\"]')");
    await evaluate("Array.from(document.querySelectorAll('[data-setting-id=\"file-preview-open-mode\"] [role=radio]')).find(n => n.textContent === '当前标签页').click()");
    assert.equal(await evaluate("localStorage.getItem('vela.filePreviewOpenMode')"), '"current-tab"');
    await evaluate("document.querySelector('.nav-history-buttons button:first-child').click()");
    await until("!document.querySelector('.settings-view')");
    await openFile("third.txt");
    assert.deepEqual(await labels(), ["third.txt", "second.txt"]);
    await openFile("second.txt");
    assert.deepEqual(await labels(), ["third.txt", "second.txt"]);
    await openFile("first.txt");
    assert.deepEqual(await labels(), ["third.txt", "first.txt"]);
    console.log("PASS current-tab mode replaces in place, preserves other tabs, and reopens replaced files");

    await newFilesTab();
    await openFile("fourth.txt");
    assert.deepEqual(await labels(), ["third.txt", "first.txt", "fourth.txt"]);
    console.log("PASS current-tab mode also consumes an empty Files tab without replacing unrelated files");

    // Code-search navigation must preserve the requested line while replacing the preview.
    await activate("third.txt");
    const codeButton = `Array.from(document.querySelectorAll('${visible} .explorer-mode-chip')).find(n => n.textContent === '代码')`;
    await evaluate(`${codeButton}.click()`);
    await evaluate(`(() => { const i = document.querySelector('${visible} .explorer-search-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Search target'); i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await until(`!!document.querySelector('${visible} .explorer-result.code')`);
    await evaluate(`document.querySelector('${visible} .explorer-result.code').click()`);
    await until("document.querySelector('.workbench-tab[aria-selected=\"true\"] .workbench-tab-label')?.textContent === 'fourth.txt'");
    assert.deepEqual(await labels(), ["third.txt", "first.txt", "fourth.txt"]);
    await until(`!!document.querySelector('${visible} .code-row.active[data-line="3"]')`);
    console.log("PASS code-search navigation activates an existing file and highlights the requested line");

    await evaluate(`${codeButton}.click()`);
    await evaluate(`(() => { const i = document.querySelector('${visible} .explorer-search-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'New target'); i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await until(`document.querySelector('${visible} .explorer-result.code')?.textContent.includes('second.txt')`);
    await evaluate(`document.querySelector('${visible} .explorer-result.code').click()`);
    await until("document.querySelector('.workbench-tab[aria-selected=\"true\"] .workbench-tab-label')?.textContent === 'second.txt'");
    await until(`!!document.querySelector('${visible} .code-row.active[data-line="3"]')`);
    assert.deepEqual(await labels(), ["third.txt", "first.txt", "second.txt"]);
    console.log("PASS code-search navigation to a new file replaces the preview and preserves line jumps");
    await openFile("fourth.txt");
    assert.deepEqual(await labels(), ["third.txt", "first.txt", "fourth.txt"]);

    await evaluate("fileOpenFixture.setMode('new-tab')");
    await openFile("second.txt");
    assert.deepEqual(await labels(), ["third.txt", "first.txt", "fourth.txt", "second.txt"]);
    await evaluate("Array.from(document.querySelectorAll('.workbench-tab-close')).find(n => n.getAttribute('aria-label').includes('second.txt')).click()");
    await until("document.querySelectorAll('.workbench-tab').length === 3");
    assert.deepEqual(await labels(), ["third.txt", "first.txt", "fourth.txt"]);
    await activate("first.txt");
    await openFile("second.txt");
    assert.deepEqual(await labels(), ["third.txt", "first.txt", "fourth.txt", "second.txt"]);
    console.log("PASS switching back to new-tab mode, closing and reopening keep provider and host tabs synchronized");

    await evaluate("fileOpenFixture.setMode('current-tab')");
    await evaluate("Array.from(document.querySelectorAll('.workbench-tab-close')).find(n => n.getAttribute('aria-label').includes('fourth.txt')).click()");
    await activate("third.txt");
    await evaluate("document.querySelector('.workbench-tab[aria-selected=\"true\"]').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', altKey:true, shiftKey:true, bubbles:true}))");
    await until("document.querySelectorAll('.workbench-group').length === 2");
    const oldPane = await evaluate("Array.from(document.querySelectorAll('.workbench-tab')).find(n => n.textContent === 'third.txt').closest('[data-workbench-pane]').dataset.workbenchPane");
    await openFile("fourth.txt");
    assert.equal(await evaluate("document.querySelectorAll('.workbench-group').length"), 2);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('.workbench-tab')).find(n => n.textContent === 'fourth.txt').closest('[data-workbench-pane]').dataset.workbenchPane"), oldPane);
    await evaluate("fileOpenFixture.setMode('new-tab')");
    await openFile("third.txt");
    assert.equal(await evaluate("document.querySelectorAll('.workbench-group').length"), 2);
    assert.equal((await labels()).filter(label => label === 'third.txt').length, 1);
    console.log("PASS replacing a split pane's only tab preserves that pane and reopening the old path does not replay replacements");
    assert.deepEqual(errors, []);
    console.log("ALL FILE OPENING CHECKS PASSED");
    app.quit();
  } catch (error) {
    console.error(error); console.error(errors.join("\n")); app.exit(1);
  }
  });
}
