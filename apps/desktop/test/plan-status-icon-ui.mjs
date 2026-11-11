/** Verify that status glyphs remain centered inside every plan marker size. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStyles } from "./read-styles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-plan-status-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { PlanStatusIcon, PlanEndedDots } from './apps/desktop/src/renderer/components/ToolCard';
        window.renderCase = (scale, scheme) => {
          document.documentElement.style.setProperty('--ui-scale', scale);
          document.documentElement.dataset.scheme = scheme;
          flushSync(() => root.render(<>
            <div className="run-todo-mark" data-status="stopped"><PlanEndedDots /></div>
            {['in_progress', 'completed'].map(status => <React.Fragment key={status}>
              <PlanStatusIcon status={status} ended />
              <div className="plan-checklist-item"><PlanStatusIcon status={status} ended /></div>
              <div className="tool-card-name has-plan-icon"><PlanStatusIcon status={status} ended className="plan-status-inline" /><span>Task</span></div>
            </React.Fragment>)}
          </>));
        };
        const root = createRoot(document.getElementById('root'));
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
      logLevel: "error",
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>' +
      readStyles(join(here, "../src/renderer/styles.css")) +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_PLAN_STATUS_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Plan status icon UI checks failed");
    } finally { clearTimeout(timer); }
  } finally {
    // temporary is the absolute path returned by mkdtempSync above.
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_PLAN_STATUS_TEMP, "profile"));
  void app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({ show: false, width: 600, height: 400,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await win.loadFile(join(process.env.VELA_PLAN_STATUS_TEMP, "index.html"));
      for (const scale of [0.85, 1, 1.25, 1.5]) {
        for (const scheme of ["light", "dark"]) {
          const markers = await win.webContents.executeJavaScript(`
            window.renderCase(${scale}, ${JSON.stringify(scheme)});
            [...document.querySelectorAll('.run-todo-mark')].map(mark => {
              const box = mark.getBoundingClientRect();
              const svg = mark.querySelector('svg').getBoundingClientRect();
              return {size: box.width, status: mark.dataset.status,
                dx: (svg.left + svg.right - box.left - box.right) / 2,
                dy: (svg.top + svg.bottom - box.top - box.bottom) / 2};
            });
          `);
          assert.equal(markers.length, 7);
          assert.deepEqual([...new Set(markers.map(mark => mark.size))].sort(), [13, 14, 16]);
          for (const mark of markers) {
            assert.ok(Math.abs(mark.dx) < 0.05 && Math.abs(mark.dy) < 0.05,
              `Uncentered ${mark.status} marker: ${JSON.stringify({ scale, scheme, ...mark })}`);
          }
        }
      }
      console.log("Plan status icons centered: 56 checks across sizes, states, scales and themes.");
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
