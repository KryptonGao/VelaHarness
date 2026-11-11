/**
 * Cost of a long conversation history in the real SessionChatView (offscreen Electron).
 * node_modules/.bin/electron apps/desktop/test/history-bench.mjs [turns=200]
 * Reports: initial mount time + nodes, streaming update cost with the history present, and scroll smoothness.
 * Manual benchmark, not part of the suites: timings depend on the machine.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

app.setPath("userData", mkdtempSync(join(tmpdir(), "vela-history-bench-")));
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const turns = process.argv.find((arg) => /^\d+$/.test(arg)) ?? "200";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => app.exit(1), 150000);
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

async function run() {
  const server = await createServer({
    root: desktop, configFile: false, plugins: [react()],
    resolve: { alias: { "@vela/shared": resolve(desktop, "../../packages/shared/src/index.ts") } },
    optimizeDeps: { entries: ["test/history-bench-preview.html"] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); console.log("vite up");
  await app.whenReady(); console.log("app ready");
  const win = new BrowserWindow({ width: 1000, height: 900, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } });
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/test/history-bench-preview.html?turns=${turns}`);
  console.log("page loaded"); const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  await dbg.sendCommand("Performance.enable");
  const metric = async (name) => (await dbg.sendCommand("Performance.getMetrics")).metrics.find((m) => m.name === name).value;

  win.webContents.on("console-message", (_event, level, message) => { if (level >= 2) console.log(`[page] ${message}`); });
  let mountTimer;
  const mountMs = await Promise.race([
    exec("window.__ready"),
    new Promise((_, reject) => {
      mountTimer = setTimeout(async () => {
        console.log("mount timed out; DOM:", await exec("document.body.innerHTML.slice(0, 1500)"));
        reject(new Error("history never mounted"));
      }, 20000);
    }),
  ]);
  clearTimeout(mountTimer);
  await pause(1500);
  const nodes = await exec("document.querySelectorAll('*').length");
  const heapMb = ((await metric("JSHeapUsedSize")) / 1048576).toFixed(0);

  // Streaming into a new turn with the whole history present.
  await exec("window.__start(); void 0");
  await pause(300);
  await exec(`window.__gaps = []; (() => { let last = performance.now(); window.__beat = setInterval(() => { const now = performance.now(); window.__gaps.push(now - last); last = now; }, 4); })()`);
  const busy0 = await metric("TaskDuration");
  const script0 = await metric("ScriptDuration");
  const layout0 = await metric("LayoutDuration");
  const style0 = await metric("RecalcStyleDuration");
  const N = 120;
  await exec(`(async () => { for (let i = 0; i < ${N}; i++) { window.__delta(); await new Promise(r => setTimeout(r, 20)); } })()`);
  await pause(300);
  const per = (v) => (v * 1000 / N).toFixed(1);
  const busy = per((await metric("TaskDuration")) - busy0);
  const script = per((await metric("ScriptDuration")) - script0);
  const layout = per((await metric("LayoutDuration")) - layout0);
  const style = per((await metric("RecalcStyleDuration")) - style0);
  const gaps = (await exec("clearInterval(window.__beat); window.__gaps.slice(5)")).sort((a, b) => a - b);

  // Scroll from bottom to top and back in wheel-sized steps; measure frame gaps and long tasks.
  await exec(`window.__scroller = document.querySelector('.chat-scroll, .chat-message-surface')?.closest('[class*=scroll]') ?? document.querySelector('.chat-message-surface').parentElement; void 0`);
  const scroll = await exec(`(async () => {
    const s = window.__scroller; const frames = [];
    let last = performance.now();
    const total = s.scrollHeight - s.clientHeight;
    const step = 240;
    for (let y = total; y > 0; y -= step) { s.scrollTop = y; await new Promise(r => requestAnimationFrame(r)); const now = performance.now(); frames.push(now - last); last = now; }
    for (let y = 0; y < total; y += step) { s.scrollTop = y; await new Promise(r => requestAnimationFrame(r)); const now = performance.now(); frames.push(now - last); last = now; }
    return { frames, total, height: s.clientHeight };
  })()`);
  const frames = scroll.frames.slice(2).sort((a, b) => a - b);

  console.log(`turns=${turns}: mount=${mountMs.toFixed(0)}ms nodes=${nodes} heap=${heapMb}MB`);
  console.log(`  stream(${N} deltas): busy=${busy}ms/update script=${script} layout=${layout} style=${style}; stall max=${gaps.at(-1).toFixed(0)}ms p99=${pct(gaps, 0.99).toFixed(0)}ms >50ms=${gaps.filter((g) => g > 50).length}`);
  console.log(`  scroll(${frames.length} frames over ${Math.round(scroll.total)}px): median=${pct(frames, 0.5).toFixed(1)}ms p95=${pct(frames, 0.95).toFixed(1)}ms max=${frames.at(-1).toFixed(0)}ms >33ms=${frames.filter((f) => f > 33).length}`);
  clearTimeout(watchdog);
  await server.close();
  app.exit(0);
}
run().catch((error) => { console.error(error); app.exit(1); });
