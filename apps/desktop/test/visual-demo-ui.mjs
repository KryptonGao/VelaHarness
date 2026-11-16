/** Focused renderer behavior checks for show_visual (Made a visual): node apps/desktop/test/visual-demo-ui.mjs */
import { readStyles } from "./read-styles.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));

const visualHtml = [
  "<style>.mock{padding:20px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg-surface-subtle);min-height:320px;color:var(--text-primary);}</style>",
  "<div class=\"mock\">Approval Banner Preview</div>",
  "<script>try{window.parent.__leaked=true;}catch(e){window.__blocked=true;}</script>",
].join("\n");

const readyTool = {
  id: "v-ready",
  name: "show_visual",
  status: "done",
  activity: {
    body: "Approval banner",
    visual: {
      title: "Approval banner",
      html: visualHtml,
      height: 160,
    },
  },
};

const runningTool = {
  id: "v-run",
  name: "show_visual",
  status: "running",
  activity: {
    body: "Draft card",
    streaming: { added: 18, removed: 0 },
  },
};

const failedTool = {
  id: "v-fail",
  name: "show_visual",
  status: "error",
  activity: {
    body: "Invalid HTML payload",
  },
};

if (!process.versions.electron) {
  const temp = mkdtempSync(join(tmpdir(), "vela-visual-ui-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ToolList } from './apps/desktop/src/renderer/components/ToolCard';
      import { setActiveLocale } from './apps/desktop/src/renderer/locale';
      setActiveLocale('en');
      const root = createRoot(document.getElementById('root'));
      window.renderVisuals = (tools, display = 'card') => root.render(<ToolList tools={tools} display={display} />);
      window.renderVisuals([${JSON.stringify(readyTool)}], 'compact');
    `,
        resolveDir: resolve(here, "../../.."),
        loader: "tsx",
      },
      loader: { ".svg": "dataurl" },
      bundle: true,
      outfile: join(temp, "ui.js"),
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    });
    writeFileSync(
      join(temp, "index.html"),
      '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><style>' +
        readStyles(resolve(here, "../src/renderer/styles.css")) +
        '</style></head><body><div id="root" style="padding:24px;max-width:800px"></div><script src="ui.js"></script></body></html>',
    );
    const env = { ...process.env, VELA_VISUAL_UI_TEMP: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    const code = await new Promise((res, rej) => {
      child.once("error", rej);
      child.once("exit", res);
    });
    clearTimeout(timer);
    assert.equal(code, 0, "Visual demo UI checks failed");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_VISUAL_UI_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    try {
      await win.loadFile(join(process.env.VELA_VISUAL_UI_TEMP, "index.html"));
      const evaluate = (code) => win.webContents.executeJavaScript(code);
      const until = async (code) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (await evaluate(code)) return;
          await new Promise((res) => setTimeout(res, 20));
        }
        throw new Error("Timed out: " + code);
      };

      await until("!!document.querySelector('.visual-tool-card iframe.visual-tool-iframe')");
      // Wait for sandboxed ResizeObserver to report >= 320px height instead of staying stuck at initial 160px.
      await until("parseInt(document.querySelector('iframe.visual-tool-iframe').style.height || '0', 10) >= 320");
      const iframeAttrs = await evaluate(`(() => {
        const f = document.querySelector('iframe.visual-tool-iframe');
        return {
          sandbox: f.getAttribute('sandbox'),
          referrerPolicy: f.getAttribute('referrerpolicy'),
          allow: f.getAttribute('allow'),
          sameOriginNull: f.contentDocument === null,
          leaked: window.__leaked === true,
          label: document.querySelector('.visual-tool-label')?.textContent,
          title: document.querySelector('.visual-tool-title')?.textContent,
        };
      })()`);
      assert.equal(iframeAttrs.sandbox, "allow-scripts");
      assert.equal(iframeAttrs.referrerPolicy, "no-referrer");
      assert.equal(iframeAttrs.allow, "");
      assert.equal(iframeAttrs.sameOriginNull, true);
      assert.equal(iframeAttrs.leaked, false);
      assert.equal(iframeAttrs.label, "Made a visual");
      assert.equal(iframeAttrs.title, "Approval banner");
      console.log("PASS inline sandboxed visual renders immediately and resizes cleanly without leaking parent access");

      // Source view toggle
      await evaluate("document.querySelector('button[aria-label=\"View HTML source\"]').click()");
      await until("!!document.querySelector('.visual-tool-surface pre.visual-tool-code')");
      assert.equal(await evaluate("document.querySelector('.visual-tool-surface pre.visual-tool-code').textContent.includes('Approval Banner Preview')"), true);
      await evaluate("document.querySelector('button[aria-label=\"View HTML source\"]').click()");
      await until("!!document.querySelector('iframe.visual-tool-iframe')");
      console.log("PASS HTML source toggle switches cleanly between preview and source");

      // Modal open, modal code toggle, Escape closes & restores focus
      await evaluate("document.querySelector('button[aria-label=\"Expand visual\"]').focus(); document.querySelector('button[aria-label=\"Expand visual\"]').click()");
      await until("!!document.querySelector('.visual-modal-dialog[role=\"dialog\"] iframe.visual-tool-iframe.is-modal')");
      await evaluate("document.querySelector('.visual-modal-dialog button[title=\"View HTML source\"]').click()");
      await until("!!document.querySelector('.visual-modal-body pre.visual-tool-code')");
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
      await until("!document.querySelector('.visual-modal-dialog')");
      const focusRestored = await evaluate("document.activeElement?.getAttribute('aria-label') === 'Expand visual'");
      assert.equal(focusRestored, true);
      console.log("PASS fullscreen modal opens, switches to HTML view, closes on Escape, and restores focus");

      // Collapse / expand toggle
      await evaluate("document.querySelector('.visual-tool-chevron').click()");
      await until("!document.querySelector('.visual-tool-surface')");
      await evaluate("document.querySelector('.visual-tool-chevron').click()");
      await until("!!document.querySelector('.visual-tool-surface iframe.visual-tool-iframe')");
      console.log("PASS collapse chevron toggles visual surface");

      // Running & error states
      await evaluate(`window.renderVisuals(${JSON.stringify([runningTool, failedTool])})`);
      await until("!!document.querySelector('.visual-tool-placeholder') && !!document.querySelector('.visual-tool-message.is-error')");
      const states = await evaluate(`({
        meta: document.querySelector('.visual-tool-stream-meta')?.textContent,
        error: document.querySelector('.visual-tool-message.is-error')?.textContent,
      })`);
      assert.equal(states.meta, "18 lines");
      assert.match(states.error, /Invalid HTML payload/);
      console.log("PASS running stream progress and error states render accurately");

      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
