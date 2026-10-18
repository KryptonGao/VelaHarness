/** 真实 App 的聊天标签与会话隔离：node apps/desktop/test/workbench-chat-ui.mjs */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-workbench-chat-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "workbench-chat-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_WORKBENCH_CHAT_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 55000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Workbench chat UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_WORKBENCH_CHAT_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1440, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error" || event.level >= 3) errors.push(event.message); });
    const evaluate = async code => {
      try { return await win.webContents.executeJavaScript(code); }
      catch (error) { console.error(`Renderer check failed: ${code}\n${errors.join("\n")}`); throw error; }
    };
    const until = async code => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
      throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
    };
    const click = async selector => {
      await until(`document.querySelector(${JSON.stringify(selector)})`);
      return evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    };
    const input = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    const capture = async name => {
      if (!process.env.VELA_WORKBENCH_CHAT_CAPTURE) return;
      mkdirSync(process.env.VELA_WORKBENCH_CHAT_CAPTURE, { recursive: true });
      await evaluate("new Promise(done => setTimeout(done, 250))");
      writeFileSync(join(process.env.VELA_WORKBENCH_CHAT_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const panel = '.workbench-tabpanel:not(.is-inactive) .panel-chat-view';
    const newTab = async () => {
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {key:'t', metaKey:true, bubbles:true}))");
      await until("document.querySelector('.workbench-tabpanel:not(.is-inactive) .start-view')");
    };
    const chatOption = ".workbench-tabpanel:not(.is-inactive) .start-option:first-child";
    try {
      await win.loadFile(join(temporary, "index.html"));
      await until("document.querySelector('.chat-active-title')?.textContent === '主聊天'");
      await newTab(); await capture("start-light");
      await click(chatOption);
      await until(`document.querySelector(${JSON.stringify(panel + ' textarea')}) && !document.querySelector(${JSON.stringify(panel + ' textarea')}).disabled`);
      assert.equal(await evaluate("chatFixture.active()"), "main-chat");
      assert.deepEqual(await evaluate("chatFixture.calls.find(c => c.name === 'create').options"), { activate: false });
      await input(panel + " textarea", "第一条独立聊天");
      await click(panel + " .send");
      await until("chatFixture.calls.some(c => c.name === 'prompt' && c.id === 'panel-1')");
      await evaluate("chatFixture.emit({type:'text_delta', conversationId:'panel-1', delta:'独立回复只在右侧出现。'})");
      await until(`document.querySelector(${JSON.stringify(panel)})?.textContent.includes('独立回复只在右侧出现。')`);
      assert.equal(await evaluate("document.querySelector('.main-stage-pane > .main-chat-view').textContent.includes('独立回复只在右侧出现。')"), false);
      await click(panel + " .stop");
      await until("chatFixture.calls.some(c => c.name === 'abort' && c.id === 'panel-1')");
      await input(panel + " textarea", "保留这段草稿");
      await capture("chat-light");
      await newTab(); await click(chatOption);
      await until("document.querySelectorAll('.panel-chat-view').length === 2");
      assert.equal(await evaluate("(() => {const ids = [...document.querySelectorAll('textarea.input-textarea')].map(el => el.id); return new Set(ids).size === ids.length;})()"), true);
      const first = await evaluate("document.querySelectorAll('.workbench-tab')[0].id");
      await click(`#${first}`);
      await until(`document.querySelector(${JSON.stringify(panel + ' textarea')})?.value === '保留这段草稿'`);
      // 模式、模型和思考强度都必须使用该标签绑定的 ID。
      await click(panel + " .mode-pill"); await click(panel + " .mode-option:nth-of-type(2)");
      await until("chatFixture.state('panel-1').session.mode === 'plan'");
      assert.equal(await evaluate("chatFixture.state('main-chat').session.mode"), "agent");
      await click(panel + " .model-pill");
      await until(`Array.from(document.querySelectorAll(${JSON.stringify(panel + ' button')})).some(b => b.textContent.includes('Model Two'))`);
      await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(panel + ' button')})).find(b => b.textContent.includes('Model Two')).click()`);
      await until("chatFixture.state('panel-1').session.modelId === 'two'");
      assert.equal(await evaluate("chatFixture.state('main-chat').session.modelId"), "one");
      await click(panel + " .model-choice-pill:not(.model-pill)");
      await until(`document.querySelector(${JSON.stringify(panel + ' .thinking-slider-input')})`);
      await evaluate(`(() => {const el = document.querySelector(${JSON.stringify(panel + ' .thinking-slider-input')}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '3'); el.dispatchEvent(new Event('input', {bubbles:true}));})()`);
      await until("chatFixture.state('panel-1').session.thinkingLevel === 'high'");
      assert.equal(await evaluate("chatFixture.state('main-chat').session.thinkingLevel"), "medium");
      await click(panel + " .model-choice-pill:not(.model-pill)");
      await evaluate("chatFixture.changeMain()");
      await until("document.querySelector('.main-stage-pane > .main-chat-view .chat-active-title')?.textContent === '另一条主聊天'");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel + ' textarea')}).value`), "保留这段草稿");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel + ' .chat-active-title')}).textContent`), "第一条独立聊天");
      await evaluate("document.documentElement.dataset.scheme = 'dark'; document.documentElement.dataset.theme = 'midnight'");
      await capture("chat-dark");
      await evaluate("document.documentElement.style.setProperty('--workbench-width', '360px')");
      await evaluate("new Promise(done => setTimeout(done, 300))");
      assert.equal(await evaluate(`(() => {const el = document.querySelector(${JSON.stringify(panel)}); return el.scrollWidth <= el.clientWidth;})()`), true);
      assert.equal(await evaluate(`Math.round(document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect().width)`), 360);
      assert.equal(await evaluate(`(() => {const view = document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect(); const send = document.querySelector(${JSON.stringify(panel + ' .send')}).getBoundingClientRect(); return send.left >= view.left && send.right <= view.right && send.bottom <= view.bottom;})()`), true);
      await capture("chat-narrow");
      if (process.env.VELA_WORKBENCH_CHAT_CAPTURE) {
        win.setContentSize(2880, 1800);
        win.webContents.setZoomFactor(2);
        await capture("chat-zoom-200");
        win.webContents.setZoomFactor(1);
        win.setContentSize(1440, 900);
      }
      // 同一对话在主区与 Panel 同时打开时，重新发送会同步替换两处历史。
      await evaluate("document.documentElement.style.removeProperty('--workbench-width'); window.vela.switchConversation('panel-1')");
      const main = '.main-stage-pane > .main-chat-view';
      await until(`document.querySelector(${JSON.stringify(main)})?.textContent.includes('第一条独立聊天')`);
      assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(main + ' .user-msg-container')}).length`), 1);
      assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(panel + ' .user-msg-container')}).length`), 1);
      await click(panel + " .user-message-action[aria-label='修改消息']");
      await until(`document.querySelector(${JSON.stringify(panel + ' .user-message-editor textarea')})`);
      await input(panel + " .user-message-editor textarea", "修改后的独立聊天");
      await click(panel + " .user-edit-submit");
      await until(`document.querySelector(${JSON.stringify(main)})?.textContent.includes('修改后的独立聊天')`);
      await until(`!document.querySelector(${JSON.stringify(main)})?.textContent.includes('第一条独立聊天')`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent.includes('独立回复只在右侧出现。')`), false);
      await evaluate("chatFixture.finish('panel-1')");
      await click(main + " .user-message-action[aria-label='修改消息']");
      await until(`document.querySelector(${JSON.stringify(main + ' .user-message-editor textarea')})`);
      await input(main + " .user-message-editor textarea", "从主区再次修改");
      await click(main + " .user-edit-submit");
      await until(`document.querySelector(${JSON.stringify(panel)})?.textContent.includes('从主区再次修改')`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent.includes('修改后的独立聊天')`), false);
      await evaluate("chatFixture.finish('panel-1'); chatFixture.changeMain()");
      // 方向键切换标签保留标准 tablist 语义。
      await evaluate(`document.getElementById(${JSON.stringify(first)}).dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))`);
      await until("document.activeElement.matches('.workbench-tab[aria-selected=true]')");
      assert.equal(await evaluate("document.querySelectorAll('.workbench-tab[aria-selected=true]').length"), 1);
      // 创建失败可重试，关闭待创建标签不会在请求完成后重新出现。
      await newTab(); await evaluate("chatFixture.failCreate = true"); await click(chatOption);
      await until("document.querySelector('.start-error')?.textContent === '新建对话失败'");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(chatOption)}).disabled`), false);
      await evaluate("chatFixture.failCreate = false; chatFixture.deferCreate = true"); await click(chatOption);
      await until("document.querySelector('.start-options[aria-busy=true]')");
      await click(".workbench-tab-close:last-child");
      await evaluate("chatFixture.releaseCreate()");
      await until("chatFixture.calls.filter(c => c.name === 'create').length === 4");
      await evaluate("new Promise(done => setTimeout(done, 200))");
      assert.equal(await evaluate("document.querySelectorAll('.panel-chat-view').length"), 2);
      assert.equal(await evaluate("chatFixture.calls.filter(c => c.name === 'abort').length"), 1);
      // 关闭已创建标签只移除视图，仍保留历史与另一条聊天。
      await click(".workbench-tab-close:first-child");
      await until("document.querySelectorAll('.panel-chat-view').length === 1");
      assert.equal(await evaluate("chatFixture.state().conversations.some(c => c.id === 'panel-1')"), true);
      await input(panel + " textarea", "关闭标签后继续运行"); await click(panel + " .send");
      await until("chatFixture.state('panel-2').session.status === 'streaming'");
      await click(".workbench-tab-close");
      await until("!document.querySelector('.workbench-panel')");
      assert.equal(await evaluate("chatFixture.state('panel-2').session.status"), "streaming");
      assert.equal(await evaluate("chatFixture.calls.filter(c => c.name === 'abort').length"), 1);
      // 最后一个入口在退出动画中完成创建，也不能重新打开面板。
      await newTab(); await click(chatOption);
      await until("document.querySelector('.start-options[aria-busy=true]')");
      await click(".workbench-tab-close");
      await evaluate("chatFixture.releaseCreate()");
      await until("!document.querySelector('.workbench-panel')");
      await evaluate("new Promise(done => setTimeout(done, 220))");
      assert.equal(await evaluate("document.querySelector('.workbench-panel') === null"), true);
      for (const [locale, label] of [["en", "Chat"], ["zh-TW", "聊天"], ["ja", "チャット"], ["ko", "채팅"]]) {
        await win.loadFile(join(temporary, "index.html"), { query: { locale } });
        await until("document.querySelector('.main-chat-view')"); await newTab();
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(chatOption + ' .start-option-title')}).textContent`), label);
      }
      assert.equal(errors.length, 0, errors.join("\n"));
      console.log("PASS chat creation, isolated streams/controls, shared rewind history, retained drafts, keyboard tabs, failure/retry and close races");
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(await evaluate("JSON.stringify({titles: [...document.querySelectorAll('.chat-active-title')].map(el => el.textContent), main: document.querySelector('.main-stage-pane')?.className, text: document.body.textContent.slice(-1800)})"));
      await capture("failure"); win.destroy(); app.exit(1);
    }
  });
}
