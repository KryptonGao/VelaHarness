/** 真实 App 的侧边聊天：node apps/desktop/test/side-chat-ui.mjs（VELA_SIDE_CHAT_CAPTURE=目录 时保存截图） */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-side-chat-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "side-chat-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_SIDE_CHAT_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 55000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Side chat UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_SIDE_CHAT_TEMP;
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
    const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
    const capture = async name => {
      if (!process.env.VELA_SIDE_CHAT_CAPTURE) return;
      mkdirSync(process.env.VELA_SIDE_CHAT_CAPTURE, { recursive: true });
      await evaluate("new Promise(done => setTimeout(done, 250))");
      writeFileSync(join(process.env.VELA_SIDE_CHAT_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const view = ".workbench-tabpanel:not(.is-inactive) .side-chat";
    const input = view + " textarea";
    const type = async value => {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(input)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
      await until(`!document.querySelector(${JSON.stringify(view + " .send")})?.disabled`);
    };
    const enter = () => evaluate(`document.querySelector(${JSON.stringify(input)}).dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
    const newTab = async () => {
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {key:'t', metaKey:true, bubbles:true}))");
      await until("document.querySelector('.workbench-tabpanel:not(.is-inactive) .start-view')");
    };
    const sideOption = ".workbench-tabpanel:not(.is-inactive) .start-option:nth-child(2)";
    try {
      await win.loadFile(join(temporary, "index.html"));
      await until("document.querySelector('.chat-active-title')?.textContent === '主聊天'");
      await newTab();
      assert.equal(await text(sideOption + " .start-option-title"), "侧边聊天");
      await click(sideOption);
      await until(`document.querySelector(${JSON.stringify(view)})`);
      assert.equal(await text(".workbench-tab[aria-selected=true] .workbench-tab-label"), "侧边聊天");
      assert.ok((await text(view + " .side-chat-empty")).includes("不会读写文件或运行命令"));
      assert.equal(await text(view + " .side-chat-meta .side-chat-chip:nth-child(2)"), "带入长期记忆");
      await until(`document.activeElement === document.querySelector(${JSON.stringify(input)})`);
      // 默认沿用主对话的模型与推理强度。
      await until(`document.querySelector(${JSON.stringify(view + " .model-pill")})?.textContent.includes('Model One')`);
      assert.equal(await text(view + " .model-choice-pill:not(.model-pill)"), "中");
      await capture("side-chat-empty");

      // 发送：带当前主对话 ID 和语言；增量逐段显示；记忆状态来自主进程。
      await type("TypeScript 的 satisfies 是做什么的？"); await enter();
      await until("sideChatFixture.requests.length === 1");
      const first = await evaluate("sideChatFixture.requests[0]");
      assert.equal(first.conversationId, "main-chat");
      assert.equal(first.locale, "zh-CN");
      assert.deepEqual(first.model, { provider: "fixture", id: "one" });
      assert.equal(first.thinkingLevel, "medium");
      assert.deepEqual(first.messages, [{ role: "user", text: "TypeScript 的 satisfies 是做什么的？" }]);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "");
      await until(`document.querySelector(${JSON.stringify(view + " .stop")})`);
      await evaluate("sideChatFixture.memory(true); sideChatFixture.delta('它检查表达式**满足**某个类型，')");
      await until(`document.querySelector(${JSON.stringify(view + " .side-chat-assistant strong")})?.textContent === '满足'`);
      assert.equal(await text(view + " .side-chat-meta .side-chat-chip:nth-child(2)"), "已带入全局与项目记忆");
      await evaluate("sideChatFixture.delta('同时保留推断出的更窄类型。'); sideChatFixture.finish()");
      await until(`document.querySelector(${JSON.stringify(view + " .send")})`);
      assert.ok((await text(view + " .side-chat-assistant")).includes("同时保留推断出的更窄类型。"));
      // 主对话不受影响：没有任何 prompt 调用。
      assert.equal(await evaluate("chatFixture.calls.filter(c => c.name === 'prompt').length"), 0);
      assert.equal(await evaluate("document.querySelector('.main-stage-pane > .main-chat-view').textContent.includes('同时保留推断出的更窄类型。')"), false);
      await capture("side-chat-reply-light");

      // 侧边聊天自己选模型和推理强度，不改动主对话。
      await click(view + " .model-pill");
      await until(`[...document.querySelectorAll(${JSON.stringify(view + " button")})].some(b => b.textContent.includes('Model Two'))`);
      await evaluate(`[...document.querySelectorAll(${JSON.stringify(view + " button")})].find(b => b.textContent.includes('Model Two')).click()`);
      await until(`document.querySelector(${JSON.stringify(view + " .model-pill")})?.textContent.includes('Model Two')`);
      await click(view + " .model-choice-pill:not(.model-pill)");
      await until(`document.querySelector(${JSON.stringify(view + " .thinking-slider-input")})`);
      await evaluate(`(() => {const el = document.querySelector(${JSON.stringify(view + " .thinking-slider-input")}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '3'); el.dispatchEvent(new Event('input', {bubbles:true}));})()`);
      await until(`document.querySelector(${JSON.stringify(view + " .model-choice-pill:not(.model-pill)")})?.textContent === '高'`);
      await capture("side-chat-thinking");
      await click(view + " .model-choice-pill:not(.model-pill)");
      assert.equal(await evaluate("chatFixture.calls.filter(c => c.name === 'model' || c.name === 'thinking').length"), 0);
      assert.equal(await evaluate("chatFixture.state('main-chat').session.modelId"), "one");
      assert.equal(await evaluate("chatFixture.state('main-chat').session.thinkingLevel"), "medium");

      // 第二轮带上完整历史和新的模型选择；停止后保留已收到的部分。
      await type("举个例子"); await enter();
      await until("sideChatFixture.requests.length === 2");
      assert.deepEqual(await evaluate("sideChatFixture.requests[1].messages.map(m => m.role)"), ["user", "assistant", "user"]);
      assert.deepEqual(await evaluate("sideChatFixture.requests[1].model"), { provider: "fixture", id: "two" });
      assert.equal(await evaluate("sideChatFixture.requests[1].thinkingLevel"), "high");
      await evaluate("sideChatFixture.delta('const config = {')");
      await click(view + " .stop");
      await until("sideChatFixture.cancelled.length === 1");
      await until(`document.querySelector(${JSON.stringify(view + " .side-chat-stopped")})?.textContent === '已停止'`);

      // 失败：显示错误，可从最后一条用户消息重试。
      await type("再试一次"); await enter();
      await until("sideChatFixture.requests.length === 3");
      await evaluate("sideChatFixture.fail('先选择一个已登录或已配置密钥的模型')");
      await until(`document.querySelector(${JSON.stringify(view + " .side-chat-error")})`);
      assert.ok((await text(view + " .side-chat-error")).includes("先选择一个已登录或已配置密钥的模型"));
      await click(view + " .side-chat-error button");
      await until("sideChatFixture.requests.length === 4");
      assert.deepEqual(await evaluate("sideChatFixture.requests[3].messages"), await evaluate("sideChatFixture.requests[2].messages"));
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(view + " .side-chat-error")})`), null);
      await evaluate("sideChatFixture.memory(false); sideChatFixture.delta('好的。'); sideChatFixture.finish()");
      await until(`document.querySelector(${JSON.stringify(view + " .send")})`);
      assert.equal(await text(view + " .side-chat-meta .side-chat-chip:nth-child(2)"), "记忆已关闭");

      // 切换主对话后保留侧边聊天，下次发送跟随新的主对话。
      await evaluate("chatFixture.changeMain()");
      await until("document.querySelector('.main-stage-pane > .main-chat-view .chat-active-title')?.textContent === '另一条主聊天'");
      assert.ok((await text(view)).includes("同时保留推断出的更窄类型。"));
      await type("还在吗"); await enter();
      await until("sideChatFixture.requests.length === 5");
      assert.equal(await evaluate("sideChatFixture.requests[4].conversationId"), "other-main");
      await evaluate("sideChatFixture.delta('在。'); sideChatFixture.finish()");
      await until(`document.querySelector(${JSON.stringify(view + " .send")})`);

      await evaluate("document.documentElement.dataset.scheme = 'dark'; document.documentElement.dataset.theme = 'midnight'");
      await capture("side-chat-dark");
      await evaluate("document.documentElement.style.setProperty('--workbench-width', '360px')");
      await evaluate("new Promise(done => setTimeout(done, 300))");
      assert.equal(await evaluate(`(() => {const el = document.querySelector(${JSON.stringify(view)}); return el.scrollWidth <= el.clientWidth;})()`), true);
      assert.equal(await evaluate(`(() => {const v = document.querySelector(${JSON.stringify(view)}).getBoundingClientRect(); const b = document.querySelector(${JSON.stringify(view + ' .send')}).getBoundingClientRect(); return b.left >= v.left && b.right <= v.right && b.bottom <= v.bottom;})()`), true);
      await capture("side-chat-narrow");
      // 窄面板里弹层也要完整落在面板内，不能伸出左缘被裁掉。
      const inside = selector => evaluate(`(() => {const panel = document.querySelector('.workbench-panel').getBoundingClientRect(); const pop = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return pop.width >= 200 && pop.left >= panel.left && pop.right <= panel.right;})()`);
      await click(view + " .model-choice-pill:not(.model-pill)");
      await until(`document.querySelector(${JSON.stringify(view + " .thinking-popover")})`);
      await evaluate("new Promise(done => setTimeout(done, 250))");
      assert.equal(await inside(view + " .thinking-popover"), true, "thinking popover overflows the panel");
      await capture("side-chat-narrow-thinking");
      await click(view + " .model-choice-pill:not(.model-pill)");
      await click(view + " .model-pill");
      await until(`document.querySelector(${JSON.stringify(view + " .model-popover")})`);
      await evaluate("new Promise(done => setTimeout(done, 250))");
      assert.equal(await inside(view + " .model-popover"), true, "model popover overflows the panel");
      await click(view + " .model-pill");
      await evaluate("document.documentElement.style.removeProperty('--workbench-width')");

      // 清空；第二个侧边聊天编号；关闭仍在回复的标签会停止请求。
      await click(view + " .side-chat-clear");
      await until(`document.querySelector(${JSON.stringify(view + " .side-chat-empty")})`);
      await newTab(); await click(sideOption);
      await until("[...document.querySelectorAll('.workbench-tab-label')].some(el => el.textContent === '侧边聊天 2')");
      // 新开的侧边聊天沿用上一次的选择。
      await until(`document.querySelector(${JSON.stringify(view + " .model-pill")})?.textContent.includes('Model Two')`);
      assert.equal(await text(view + " .model-choice-pill:not(.model-pill)"), "高");
      await type("关闭前的问题"); await enter();
      await until("sideChatFixture.requests.length === 6");
      const cancelledBefore = await evaluate("sideChatFixture.cancelled.length");
      await click(".workbench-tab-close:last-child");
      await until(`sideChatFixture.cancelled.length === ${cancelledBefore + 1}`);
      assert.equal(await evaluate("document.querySelectorAll('.side-chat').length"), 1);

      for (const [locale, label] of [["en", "Side chat"], ["zh-TW", "側邊聊天"], ["ja", "サイドチャット"], ["ko", "사이드 채팅"]]) {
        await win.loadFile(join(temporary, "index.html"), { query: { locale } });
        await until("document.querySelector('.main-chat-view')"); await newTab();
        assert.equal(await text(sideOption + " .start-option-title"), label);
      }
      assert.equal(errors.length, 0, errors.join("\n"));
      console.log("PASS side chat tab, own model and reasoning choice, streaming, memory status, history, stop, retry, follows main chat, narrow width, close cancels, locales");
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(await evaluate("document.body.textContent.slice(-1500)").catch(() => ""));
      await capture("failure"); win.destroy(); app.exit(1);
    }
  });
}
