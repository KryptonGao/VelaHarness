/** 导航栏 Codex 额度圆环检查：node apps/desktop/test/nav-usage-ring-ui.mjs（VELA_RING_SCREENSHOT=目录 可截图） */
import { readStyles } from "./read-styles.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-nav-usage-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { NavRail } from './apps/desktop/src/renderer/components/NavRail';
        import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
        const plan = new URLSearchParams(location.search).get('plan');
        const windows = plan === 'pro' ? [{ windowMinutes: 10080, usedPercent: 4, resetsAt: Date.now() + 3 * 86400000 }]
          : [{ windowMinutes: 300, usedPercent: 30, resetsAt: Date.now() + 3600000 }, { windowMinutes: 10080, usedPercent: 92, resetsAt: Date.now() + 3 * 86400000 }];
        window.usageCalls = 0;
        if (plan !== 'none') window.vela = { getUsageLimits: async () => { window.usageCalls += 1; return plan === 'none' ? null : { provider: 'openai-codex', plan: plan || 'plus', windows, fetchedAt: Date.now() }; } };
        setActiveLocale('zh-CN');
        createRoot(document.getElementById('root')).render(<AppLocaleProvider locale="zh-CN">
          <div className="vela-window platform-darwin nav-rail-layout" style={{ height: '100vh' }}>
            <NavRail active="home" platform="darwin" agentInboxBadge={0} onSelect={() => {}} />
            <div className="main-stage"><main className="main-chat-view" style={{ flex: 1 }} /></div>
          </div></AppLocaleProvider>);
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><style>' +
      // 与真实应用一致：nav-rail.css 先于 styles.css，等优先级时 styles.css 会赢。
      readFileSync(join(here, "../src/renderer/nav-rail.css"), "utf8") + readFileSync(join(here, "../src/renderer/usage-limit.css"), "utf8") + readStyles(join(here, "../src/renderer/styles.css")) +
      '</style></head><body><div id="root"></div><script>{ const prefs = new URLSearchParams(location.search).get("prefs"); if (prefs) localStorage.setItem("vela.usageRing", prefs); }</script><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_RING_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Nav usage ring checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_RING_TEMP, "profile"));
  // 逐个套餐开关窗口，最后一个窗口关闭时不能让 Electron 提前退出。
  app.on("window-all-closed", () => {});
  void app.whenReady().then(async () => {
    let failed = false;
    try {
      const shots = process.env.VELA_RING_SCREENSHOT;
      if (shots) mkdirSync(shots, { recursive: true });
      for (const [plan, prefs] of [["plus", ""], ["pro", ""], ["none", ""], ["plus", '{"enabled":false,"threshold":20}'], ["plus", '{"enabled":true,"threshold":5}'], ["pro", '{"enabled":true,"threshold":97}']]) {
        const variant = prefs.includes("false") ? "off" : prefs.includes('"threshold":5') ? "low5" : prefs.includes("97") ? "pro96" : plan;
        const win = new BrowserWindow({ show: false, width: 700, height: 520, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        await win.loadFile(join(process.env.VELA_RING_TEMP, "index.html"), { query: { plan, prefs } });
        const evaluate = code => win.webContents.executeJavaScript(code);
        const until = async code => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            if (await evaluate(code)) return;
            await new Promise(done => setTimeout(done, 20));
          }
          throw new Error(`Timed out: ${code}`);
        };
        await until("document.querySelector('.nav-rail')");
        if (variant === "off") {
          await new Promise(done => setTimeout(done, 300));
          assert.equal(await evaluate("document.querySelector('.nav-usage')"), null, "Ring can be turned off");
          assert.equal(await evaluate("window.usageCalls"), 0, "Hidden ring does not poll the quota API");
          win.destroy();
          continue;
        }
        if (plan === "none") {
          await new Promise(done => setTimeout(done, 300));
          assert.equal(await evaluate("document.querySelector('.nav-usage')"), null, "No ring without Codex quota");
          win.destroy();
          continue;
        }
        await until("document.querySelector('.nav-usage-button')");
        const order = await evaluate("[...document.querySelectorAll('.nav-rail-footer > *')].map(node => node.classList.contains('nav-usage') ? 'ring' : node.getAttribute('aria-label'))");
        assert.deepEqual(order, ["ring", "设置"], "Ring sits directly above Settings");
        const values = await evaluate("[...document.querySelectorAll('.nav-usage-value')].map(node => node.getAttribute('stroke-dasharray'))");
        if (plan === "plus") assert.deepEqual(values, ["70 100", "8 100"], "Plus draws 5-hour and weekly arcs of remaining quota");
        else assert.deepEqual(values, ["96 100"], "Pro draws one full ring");
        const tones = await evaluate("[...document.querySelectorAll('.nav-usage-value')].map(node => node.dataset.tone)");
        const colors = await evaluate("[...document.querySelectorAll('.nav-usage-value')].map(node => getComputedStyle(node).stroke)");
        const expected = { plus: ["ok", "low"], low5: ["ok", "ok"], pro: ["ok"], pro96: ["low"] }[variant];
        assert.deepEqual(tones, expected, "Arcs turn low only below the user's threshold");
        assert.deepEqual(colors.map((color, index) => color === colors[0] ? "same" : "different").slice(0, 1), ["same"]);
        const warning = await evaluate("(() => { const probe = document.createElement('i'); probe.style.color = getComputedStyle(document.querySelector('.nav-usage')).getPropertyValue('--usage-low'); document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; })()");
        tones.forEach((tone, index) => assert.equal(colors[index] === warning, tone === "low", `Arc ${index} is yellow exactly when low`));
        assert.equal(await evaluate("document.querySelectorAll('.nav-usage-track').length"), plan === "plus" ? 2 : 1);
        assert.equal(await evaluate("document.querySelector('.nav-usage-popover')"), null, "Details start closed");
        if (shots) { await new Promise(done => setTimeout(done, 400)); require_write(shots, `${variant}-closed.png`, await win.webContents.capturePage()); }
        await evaluate("document.querySelector('.nav-usage-button').click()");
        await until("document.querySelector('.nav-usage-popover')");
        const box = await evaluate("(() => { const b = document.querySelector('.nav-usage-button').getBoundingClientRect(); const p = document.querySelector('.nav-usage-popover').getBoundingClientRect(); return { buttonRight: b.right, popLeft: p.left, popRight: p.right, popBottom: p.bottom, buttonBottom: b.bottom, viewport: innerWidth }; })()");
        assert.ok(box.popLeft >= box.buttonRight, "Details open to the right of the ring");
        assert.ok(box.popRight <= box.viewport, "Details stay inside the window");
        const text = await evaluate("document.querySelector('.nav-usage-popover').innerText");
        if (plan === "plus") assert.match(text, /5 小时额度[\s\S]*剩余 70%[\s\S]*每周额度[\s\S]*剩余 8%/);
        else assert.match(text, /每周额度[\s\S]*剩余 96%/);
        // 点击到的是弹窗而不是被别的层盖住。
        assert.equal(await evaluate("(() => { const p = document.querySelector('.nav-usage-popover').getBoundingClientRect(); return document.elementFromPoint(p.left + 20, p.top + 20).closest('.nav-usage-popover') !== null; })()"), true, "Popover is on top");
        if (shots) { await new Promise(done => setTimeout(done, 400)); require_write(shots, `${variant}-open.png`, await win.webContents.capturePage()); }
        await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
        await until("!document.querySelector('.nav-usage-popover')");
        win.destroy();
      }
    } catch (error) {
      failed = true;
      console.error(error);
    }
    app.exit(failed ? 1 : 0);
  });
}

async function require_write(dir, name, image) {
  const { writeFileSync: write } = await import("node:fs");
  write(join(dir, name), image.toPNG());
}
