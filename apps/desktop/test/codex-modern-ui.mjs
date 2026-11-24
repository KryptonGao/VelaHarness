/** Targeted Electron checks: node apps/desktop/test/codex-modern-ui.mjs */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-codex-modern-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "codex-modern-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body style="overflow:auto"><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_CODEX_MODERN_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Modern Codex Electron checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_CODEX_MODERN_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 850, height: 1000, webPreferences: { backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    const until = async code => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (await evaluate(`Boolean(${code})`)) return;
        await new Promise(done => setTimeout(done, 25));
      }
      throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
    };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const preference = (name, value) => evaluate(`window.flushFixture(() => window.fixturePreferences[${JSON.stringify(name)}](${JSON.stringify(value)}))`);
    const viewport = '#direct .thinking-group-shell > .thinking-scroll-viewport';
    const headline = '#direct .thinking-headline-trigger';
    const frame = () => evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    const settle = () => evaluate("new Promise(done => setTimeout(done, 350))");
    const measure = () => evaluate(`(() => { const v = document.querySelector('${viewport}'); return {
      height: v.clientHeight, content: v.scrollHeight, cap: getComputedStyle(v).maxHeight, inlineCap: v.style.maxHeight,
      overflow: getComputedStyle(v).overflowY, rail: getComputedStyle(v.firstElementChild).borderLeftWidth,
      fades: v.parentElement.querySelectorAll('.thinking-scroll-fade').length,
    }; })()`);
    const capture = async name => {
      if (!process.env.VELA_CODEX_MODERN_CAPTURE) return;
      mkdirSync(process.env.VELA_CODEX_MODERN_CAPTURE, { recursive: true });
      await settle();
      await frame();
      await win.webContents.capturePage();
      writeFileSync(join(process.env.VELA_CODEX_MODERN_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    try {
      await win.loadFile(join(process.env.VELA_CODEX_MODERN_TEMP, "index.html"));
      await until("window.fixturePreferences");
      await preference("setLocale", "zh-CN");
      await preference("setToolDisplay", "compact");
      await preference("setThinkingGroupMode", "codex-modern");
      await until("localStorage.getItem('vela.thinkingGroupMode') === 'codex-modern'");
      await win.reload();
      await until("window.fixturePreferences?.thinkingGroupMode === 'codex-modern'");
      await click(headline);
      await until(`document.querySelector('${viewport}')?.clientHeight > 400`);
      await settle();
      const initial = await measure();
      assert.equal(initial.cap, "none");
      assert.equal(initial.overflow, "visible");
      assert.equal(initial.rail, "1px");
      assert.equal(initial.fades, 0);
      // Allow the small paint overflow from row focus outlines and icon transforms.
      assert.ok(Math.abs(initial.height - initial.content) <= 4, JSON.stringify(initial));
      assert.equal(await evaluate("document.querySelectorAll('#direct .coherent-thought').length"), 0);
      await capture("expanded-list");

      for (const grow of [false, true]) {
        await preference("setThinkingGroupHeight", 160);
        await preference("setCommandDetailHeight", 320);
        await preference("setToolDetailHeight", 320);
        await preference("setToolDetailHeightScale", true);
        await preference("setThinkingGroupHeightGrow", grow);
        await click('#direct .tool-kind-bash > .tool-compact-line');
        await click('#direct .tool-kind-edit .tool-compact-detail-toggle');
        await until(`document.querySelector('#direct .tool-terminal')?.offsetHeight >= 300 && document.querySelector('${viewport}').clientHeight > ${initial.height + 300}`);
        await frame();
        const expanded = await measure();
        assert.equal(expanded.cap, "none");
        assert.equal(expanded.inlineCap, "");
        assert.ok(expanded.height > initial.height + 300);
        assert.ok(Math.abs(expanded.height - expanded.content) <= 4, JSON.stringify(expanded));
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#direct .tool-kind-bash .tool-collapse-inner')).borderLeftWidth"), "1px");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#direct .compact-diff-scroll-shell > .thinking-scroll-viewport')).maxHeight"), "320px");
        await capture(grow ? "details-grow-enabled" : "details-light");
        await click('#direct .tool-kind-bash > .tool-compact-line');
        await click('#direct .tool-kind-edit .tool-compact-detail-toggle');
        await until(`document.querySelector('${viewport}').clientHeight < ${initial.height + 20}`);
      }

      // Switching from a previously locked legacy group clears the inline height cap.
      await preference("setThinkingGroupHeightGrow", false);
      await preference("setThinkingGroupMode", "codex");
      await click('#direct .tool-kind-bash > .tool-compact-line');
      await until(`document.querySelector('${viewport}').style.maxHeight !== ''`);
      assert.equal((await measure()).rail, "0px");
      assert.ok((await measure()).height <= 160);
      await preference("setThinkingGroupMode", "codex-modern");
      await until(`document.querySelector('${viewport}').style.maxHeight === '' && document.querySelector('${viewport}').clientHeight > 400`);
      assert.equal((await measure()).cap, "none");

      // The actual agent stream uses the same mode and preserves source-model gating.
      await click('#agent .thinking-headline-trigger');
      await until("document.querySelectorAll('#agent .is-codex-modern .tool-compact-item').length === 22");
      assert.equal(await evaluate("document.querySelectorAll('#agent .coherent-thought').length"), 0);
      await evaluate("window.updateFixture({model:'claude-sonnet-4-6'})");
      await until("document.querySelector('#agent .is-codex-modern') === null");
      await evaluate("window.updateFixture({model:'gpt-6.1',live:true})");
      await until("document.querySelector('#agent .is-codex-modern')");
      await evaluate("window.updateFixture({live:false})");
      await until(`document.querySelector('${headline}').getAttribute('aria-expanded') === 'false'`);
      win.show();
      win.focus();
      win.webContents.focus();
      await evaluate(`document.querySelector('${headline}').focus()`);
      await until(`document.hasFocus() && document.activeElement === document.querySelector('${headline}')`);
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
      await until(`document.querySelector('${headline}').getAttribute('aria-expanded') === 'true'`);

      await preference("setAppearance", "dark");
      win.setSize(440, 900);
      await frame();
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      await capture("details-dark-narrow");
      await preference("setToolDisplay", "card");
      await until("document.querySelector('#direct .tool-card')");
      assert.equal((await measure()).cap, "none");
      assert.ok((await measure()).height > 400);

      await evaluate("window.updateFixture({settings:true})");
      await until("document.querySelector('[data-setting-id=thinking-summary]')");
      assert.equal(await evaluate("document.querySelector('[data-setting-id=thinking-group-mode]')"), null);
      await preference("setToolDisplay", "compact");
      await evaluate("window.updateFixture({chat:true})");
      await until("document.querySelector('#main-chat .assistant-turn-trigger')");
      await click('#main-chat .assistant-turn-trigger');
      await until("document.querySelector('#main-chat .is-codex-modern .thinking-headline-trigger')");
      await click('#main-chat .is-codex-modern .thinking-headline-trigger');
      await until("document.querySelectorAll('#main-chat .is-codex-modern .tool-compact-item').length === 22");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#main-chat .thinking-group-shell > .thinking-scroll-viewport')).maxHeight"), "none");
      await evaluate("window.updateFixture({model:'claude-sonnet-4-6'})");
      await until("document.querySelector('#main-chat .is-codex-modern') === null");
      assert.deepEqual(errors, []);
      console.log("PASS modern Codex persistence, long groups, nested disclosure, independent detail limits, scale/grow settings, legacy switching, main chat and agent model gating, keyboard, narrow dark layout and card display");
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
