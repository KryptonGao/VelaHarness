/** Exercises the production trace viewer and shared roster in a narrow Electron pane. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "vela-trace-agent-"));
app.setPath("userData", join(dir, "profile"));
app.on("quit", () => rmSync(dir, { recursive: true, force: true }));
app.whenReady().then(async () => {
  await build({ entryPoints: [join(here, "trace-preview.tsx")], bundle: true, jsx: "automatic",
    outfile: join(dir, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "import.meta.env.DEV": "false" }, logLevel: "error" });
  writeFileSync(join(dir, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
  const win = new BrowserWindow({ show: false, width: 570, height: 650, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(join(dir, "index.html"), { query: { scenario: "agents" } });
  const js = (code) => win.webContents.executeJavaScript(code);
  await js(`window.$ = (s) => document.querySelector(s); window.click = s => $(s).click(); void 0;`);
  const settle = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const click = async (s) => { await js(`click(${JSON.stringify(s)})`); await settle(); };
  const trigger = ".trace-agent-trigger";
  await settle();
  const mainLabel = await js(`$('${trigger}').textContent`);
  assert.match(mainLabel, /主代理|Main agent/);
  assert.ok(await js(`Boolean($('.trace-system-row') && $('.trace-stop') && $('.trace-interaction-notice'))`));
  await click(trigger);
  assert.equal(await js(`$('.agent-roster-menu').querySelectorAll('[role=option]').length`), 3);
  assert.ok(await js(`$('.agent-roster-menu').getBoundingClientRect().right <= $('.trace-view').getBoundingClientRect().right`));
  await click('.agent-roster-menu-item[title="/root/review"]');
  assert.equal(await js(`$('${trigger}').textContent`), "/root/review");
  assert.match(await js(`$('.trace-list').textContent`), /Thinking for review only/);
  assert.doesNotMatch(await js(`$('.trace-list').textContent`), /review\/tests|Desktop/);
  assert.equal(await js(`Boolean($('.trace-stop, .trace-system-row, .trace-interaction-notice'))`), false);
  await click(".trace-row-thinking");
  assert.match(await js(`$('.trace-inspector').textContent`), /Thinking for review only/);
  assert.match(await js(`$('.trace-summary').textContent`), /1K tok/);
  await click("#child-delta");
  assert.match(await js(`$('.trace-list').textContent`), /Scoped live reply/);
  await click(trigger);
  await click('.agent-roster-menu-item[title="/root/review/tests"]');
  assert.match(await js(`$('.trace-list').textContent`), /Thinking for review\/tests only/);
  assert.doesNotMatch(await js(`$('.trace-view').textContent`), /Thinking for review only|Scoped live reply/);
  await click(trigger);
  await click(".trace-root-option button");
  assert.ok(await js(`Boolean($('.trace-system-row') && $('.trace-stop'))`));
  await click(trigger);
  await click('.agent-roster-menu-item[title="/root/review"]');
  await click("#switch-chat");
  assert.equal(await js(`$('${trigger}').textContent`), mainLabel);
  assert.equal(await js(`$('${trigger}').disabled`), true);
  console.log("Trace roster: root, child, nested child, inspector, metrics, narrow layout and conversation reset passed.");
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
