/**
 * Cost of one streaming update inside a large live coherent group (real AgentPane, offscreen Electron).
 * node_modules/.bin/electron apps/desktop/test/coherent-stream-bench.mjs [steps=300] [card|compact] [single] [tools=N] [plain] [position] [streamdiff] [css]
 * Manual benchmark, not part of the suites: timings depend on the machine. Before leaf memoization a
 * 300-step group took ~30ms per update (vs ~3ms at 20 steps); it should now stay flat in the step count.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

app.setPath("userData", mkdtempSync(join(tmpdir(), "vela-coherent-bench-")));
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const steps = process.argv.find((arg) => /^\d+$/.test(arg)) ?? "300";
const display = process.argv.includes("card") ? "card" : "compact";
const single = process.argv.includes("single");
const perMessage = process.argv.find((arg) => arg.startsWith("tools="))?.slice(6) ?? "1";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => app.exit(1), 90000);

async function run() {
  const server = await createServer({
    root: desktop, configFile: false, plugins: [react()],
    resolve: { alias: { "@vela/shared": resolve(desktop, "../../packages/shared/src/index.ts") } },
    optimizeDeps: { entries: ["test/coherent-stream-preview.html"] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  await app.whenReady();
  const win = new BrowserWindow({ width: 1000, height: 900, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } });
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/test/coherent-stream-preview.html?steps=${steps}&display=${display}&mode=${single ? "single" : "coherent"}&tools=${perMessage}${process.argv.includes("plain") ? "&plain=1" : ""}${process.argv.includes("position") ? "&fold=position" : ""}${process.argv.includes("streamdiff") ? "&streamdiff=1" : ""}${process.argv.includes("css") ? "&ext=css" : ""}`);
  await pause(2500);
  // A folded run only mounts its rows once opened: open the last one (the group the stream is writing into).
  await win.webContents.executeJavaScript("window.__tick(); void 0", true);
  await pause(300);
  await win.webContents.executeJavaScript("[...document.querySelectorAll('.tool-compact-summary, .tool-run-head')].at(-1)?.click()", true);
  await pause(500);
  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  await dbg.sendCommand("Performance.enable");
  const metric = async (name) => (await dbg.sendCommand("Performance.getMetrics")).metrics.find((m) => m.name === name).value;
  const busy = () => metric("TaskDuration");
  const breakdownBefore = { script: await metric("ScriptDuration"), layout: await metric("LayoutDuration"), style: await metric("RecalcStyleDuration") };
  // Event-loop stalls are what blank the screen while scrolling: sample the gap between 4ms timers.
  await win.webContents.executeJavaScript(`window.__gaps = []; (() => { let last = performance.now(); window.__beat = setInterval(() => { const now = performance.now(); window.__gaps.push(now - last); last = now; }, 4); })()`, true);
  const busyBefore = await busy();
  const times = await win.webContents.executeJavaScript(
    `(async () => { const t = []; for (let i = 0; i < 40; i++) { t.push(window.__tick()); await new Promise(r => setTimeout(r, 20)); } return t; })()`,
    true,
  );
  const sorted = times.slice(5).sort((a, b) => a - b);
  const gaps = await win.webContents.executeJavaScript("clearInterval(window.__beat); window.__gaps.slice(5)", true);
  gaps.sort((a, b) => a - b);
  const stall = `stall: max=${gaps.at(-1).toFixed(0)}ms p99=${gaps[Math.floor(gaps.length * 0.99)].toFixed(0)}ms >50ms=${gaps.filter((gap) => gap > 50).length}`;
  const busyPerUpdate = ((await busy()) - busyBefore) * 1000 / 40;
  const part = async (key, name) => (((await metric(name)) - breakdownBefore[key]) * 1000 / 40).toFixed(1);
  const breakdown = `script=${await part("script", "ScriptDuration")} layout=${await part("layout", "LayoutDuration")} style=${await part("style", "RecalcStyleDuration")}`;
  const diffRows = await win.webContents.executeJavaScript("document.querySelectorAll('.tool-diff-line').length", true);
  if (process.env.BENCH_DEBUG) console.log(await win.webContents.executeJavaScript(`JSON.stringify({groups: [...document.querySelectorAll('.tool-compact-group')].map(g => g.className), items: document.querySelectorAll('.tool-compact-item').length, lastItem: [...document.querySelectorAll('.tool-compact-item')].at(-1)?.outerHTML.slice(0, 600)})`, true));
  const nodes = await win.webContents.executeJavaScript("document.querySelectorAll('*').length", true);
  console.log(`steps=${steps} ${display} ${single ? "single" : "coherent"} tools=${perMessage}${process.argv.includes("plain") ? " plain" : ""}${process.argv.includes("streamdiff") ? " streamdiff" : ""}: update median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms max=${sorted.at(-1).toFixed(1)}ms, main thread busy=${busyPerUpdate.toFixed(1)}ms/update (incl. async work; ${breakdown}) ${stall} nodes=${nodes} diffRows=${diffRows}`);
  clearTimeout(watchdog);
  await server.close();
  app.exit(0);
}
run().catch((error) => { console.error(error); app.exit(1); });
