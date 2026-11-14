/** 自打包真实 ChatView 验证左侧轮次导航：node apps/desktop/test/turn-nav-ui.mjs */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-turn-nav-"));
  try {
    const { build } = await import("esbuild");
    await build({
      entryPoints: [join(here, "turn-nav-preview.tsx")],
      bundle: true,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      outfile: join(temporary, "ui.js"),
      loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' },
      logLevel: "error",
    });
    writeFileSync(
      join(temporary, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>',
    );
    const env = { ...process.env, VELA_TURN_NAV_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      assert.equal(code, 0, "Turn navigation UI checks failed");
    } finally {
      clearTimeout(timer);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_TURN_NAV_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1120,
      height: 760,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    const errors = [];
    win.webContents.on("console-message", (event) => {
      if (event.level >= 3) errors.push(event.message);
    });
    const evaluate = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
    };
    const capture = async (name) => {
      if (!process.env.VELA_TURN_NAV_CAPTURE) return;
      mkdirSync(process.env.VELA_TURN_NAV_CAPTURE, { recursive: true });
      await evaluate("new Promise(done => setTimeout(done, 180))");
      writeFileSync(join(process.env.VELA_TURN_NAV_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };

    try {
      await win.loadFile(join(temporary, "index.html"));
      await until("document.querySelectorAll('.turn-nav-item').length === 16");

      // 默认未悬停在左侧附近时隐藏圆点导航且不可点击
      assert.equal(await evaluate("document.querySelector('.turn-nav')?.hasAttribute('data-visible')"), false);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.turn-nav')).opacity"), "0");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.turn-nav-rail')).pointerEvents"), "none");

      // 初始贴底时最后一轮（第 16 轮）处于激活状态
      assert.equal(
        await evaluate("document.querySelector('.turn-nav-item[data-active=\"true\"]')?.getAttribute('data-turn-index')"),
        "15",
      );

      // 计算第 3 个圆点坐标；鼠标移近左侧边缘才显示导航栏
      const dot3Box = await evaluate(`(() => {
        const r = document.querySelectorAll('.turn-nav-item')[2].getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      win.webContents.sendInputEvent({ type: "mouseMove", x: 36, y: dot3Box.y });
      await until("document.querySelector('.turn-nav')?.getAttribute('data-visible') === 'true'");
      await until("getComputedStyle(document.querySelector('.turn-nav')).opacity === '1'");
      await capture("turn-nav-bottom");

      // 悬停第 3 个圆点显示悬浮预览卡片，包含本轮要求、回复摘要、轮次计数与时间，且不触发全局 ButtonTooltip
      win.webContents.sendInputEvent({ type: "mouseMove", x: dot3Box.x, y: dot3Box.y });
      await until("Boolean(document.querySelector('.turn-nav-popover'))");
      const popoverState = await evaluate(`(() => {
        const pop = document.querySelector('.turn-nav-popover');
        const pane = document.querySelector('.chat-conversation-pane').getBoundingClientRect();
        const box = pop.getBoundingClientRect();
        return {
          prompt: pop.querySelector('.turn-nav-popover-prompt')?.textContent,
          reply: pop.querySelector('.turn-nav-popover-reply')?.textContent,
          meta: pop.querySelector('.turn-nav-popover-meta')?.textContent,
          insidePane: box.top >= pane.top && box.bottom <= pane.bottom && box.right <= pane.right,
          hasButtonTooltip: Boolean(document.querySelector('.button-tooltip')),
        };
      })()`);
      assert.ok(popoverState.prompt.includes("没展开的时候不显示旗帜"));
      assert.ok(popoverState.reply.includes("已调整 footer 的语言选择器样式与显示逻辑"));
      assert.ok(popoverState.meta.includes("3 / 16"));
      assert.equal(popoverState.insidePane, true);
      assert.equal(popoverState.hasButtonTooltip, false);
      await capture("turn-nav-hover");

      // 点击第 3 个圆点快速跳转到第 3 轮，第 3 轮进入视口顶部且圆点高亮切换为 index 2
      await evaluate("document.querySelectorAll('.turn-nav-item')[2].click()");
      await until(`(() => {
        const scroller = document.querySelector('.chat-scroll-area').getBoundingClientRect();
        const turn3 = document.querySelector('[data-turn-id="u3"]').getBoundingClientRect();
        const active = document.querySelector('.turn-nav-item[data-active="true"]')?.getAttribute('data-turn-index');
        return active === '2' && Math.abs(turn3.top - (scroller.top + 20)) < 48;
      })()`);
      await capture("turn-nav-jumped");

      // 滚回顶部时自动切回第 1 轮激活
      await evaluate("document.querySelector('.chat-scroll-area').scrollTop = 0; void 0");
      await until("document.querySelector('.turn-nav-item[data-active=\"true\"]')?.getAttribute('data-turn-index') === '0'");

      // 窄容器（<= 560px）自动隐藏圆点导航
      await evaluate("window.__turnNavFixture.setPaneWidth(500); void 0");
      await until("getComputedStyle(document.querySelector('.turn-nav')).display === 'none'");
      await evaluate("window.__turnNavFixture.setPaneWidth(null); void 0");
      await until("getComputedStyle(document.querySelector('.turn-nav')).display !== 'none'");

      // 鼠标移回主对话区后隐藏导航栏与悬浮卡片
      win.webContents.sendInputEvent({ type: "mouseMove", x: dot3Box.x, y: dot3Box.y });
      await until("Boolean(document.querySelector('.turn-nav-popover'))");
      win.webContents.sendInputEvent({ type: "mouseMove", x: 420, y: 300 });
      await until("!document.querySelector('.turn-nav')?.hasAttribute('data-visible')");
      await until("getComputedStyle(document.querySelector('.turn-nav')).opacity === '0'");
      assert.equal(await evaluate("Boolean(document.querySelector('.turn-nav-popover'))"), false);

      // 轮数较少（3 轮）时不显示左侧导航
      await evaluate("window.__turnNavFixture.setCount(3); void 0");
      await until("document.querySelector('.turn-nav') === null");

      assert.deepEqual(errors, []);
      console.log("PASS turn-nav UI checks");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
