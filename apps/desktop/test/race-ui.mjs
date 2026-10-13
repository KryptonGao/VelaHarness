/** 自打包真实 RacePanel + RaceSetupDialog：node apps/desktop/test/race-ui.mjs */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-race-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "race-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_RACE_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 55000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Race UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temp = process.env.VELA_RACE_TEMP;
  app.setPath("userData", join(temp, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1200, height: 860,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level >= 3) errors.push(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async code => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
      throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
    };
    const load = async query => { await win.loadURL(`file://${join(temp, "index.html")}${query}`); };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const clickText = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
    const calls = name => evaluate(`raceFixture.calls.filter(c => c.name === ${JSON.stringify(name)}).length`);
    const capture = async name => {
      if (!process.env.VELA_RACE_CAPTURE) return;
      mkdirSync(process.env.VELA_RACE_CAPTURE, { recursive: true });
      await evaluate("new Promise(done => setTimeout(done, 250))");
      writeFileSync(join(process.env.VELA_RACE_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    try {
      // 进行中：事实并排展示，没有徽章与采用入口可用。
      await load("");
      await until("document.querySelectorAll('.race-lane').length === 3");
      assert.equal(await evaluate("document.querySelector('.race-status.is-running').textContent"), "进行中");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.race-lane footer .is-primary')).every(b => b.disabled)"), true);
      assert.equal(await evaluate("document.querySelector('.race-lane:nth-child(2)').textContent.includes('expected 3 got 4')"), true);
      assert.equal(await evaluate("document.querySelector('.race-lane:nth-child(2) details.race-output').open"), true);
      assert.equal(await evaluate("document.querySelectorAll('.race-badges').length"), 0);
      console.log("PASS running race shows facts, failing output expanded, adopt disabled");

      // 全部结束：徽章只标事实最佳；采用先确认再执行。
      await evaluate("raceFixture.update(r => { r[0].status='ready'; r[0].lanes[2].status='responded'; r[0].lanes[2].finishedAt=1055000; r[0].lanes[2].tokens={input:1,output:1,cacheRead:0,total:50000}; r[0].lanes[2].diff={files:1,added:1,removed:0}; r[0].lanes[2].commitSha='c'.repeat(40); r[0].lanes[2].changedFiles=['x']; r[0].lanes[2].verification={state:'failed',exitCode:2,durationMs:1000,outputTail:'boom'}; })");
      await until("document.querySelector('.race-status.is-ready')");
      assert.equal(await evaluate("document.querySelector('.race-lane:first-child .race-badges').textContent.includes('唯一通过验证')"), true);
      assert.equal(await evaluate("document.querySelector('.race-lane:nth-child(3)').textContent.includes('改动最小')"), true);
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.race-lane footer .is-primary')).every(b => !b.disabled)"), true);
      await capture("race-ready-light");
      await evaluate("document.querySelector('.race-lane:first-child footer .is-primary').click()");
      await until("document.querySelector('.race-confirm')");
      assert.equal(await calls("adopt"), 0);
      await click(".race-confirm .is-primary");
      await until("document.querySelector('.race-message.is-ok')");
      assert.equal(await calls("adopt"), 1);
      assert.equal(await evaluate("document.querySelector('.race-message').textContent.includes('2 个文件')"), true);
      assert.equal(await evaluate("document.querySelector('.race-status.is-adopted') !== null"), true);
      console.log("PASS badges are factual, adopt needs confirmation and reports staged files");

      // 采用失败：冲突信息就地显示，仍可改选。
      await load("");
      await until("document.querySelectorAll('.race-lane').length === 3");
      await evaluate("raceFixture.update(r => { r[0].status='ready'; for (const l of r[0].lanes) { l.status='responded'; l.finishedAt=1050000; l.commitSha='d'.repeat(40); l.diff={files:1,added:1,removed:1}; } }); raceFixture.adoptResults.push({ok:false,reason:'conflict',message:'x',conflicts:['src/a.ts']})");
      await until("document.querySelector('.race-lane footer .is-primary:not([disabled])')");
      await evaluate("document.querySelector('.race-lane footer .is-primary').click()");
      await until("document.querySelector('.race-confirm')"); await click(".race-confirm .is-primary");
      await until("document.querySelector('.race-message.is-error')");
      assert.equal(await evaluate("document.querySelector('.race-message').textContent.includes('src/a.ts')"), true);
      assert.equal(await evaluate("document.querySelector('.race-status.is-ready') !== null"), true);
      await clickText("全部丢弃"); await clickText("确认丢弃");
      await until("document.querySelector('.race-status.is-discarded')");
      assert.equal(await calls("discard"), 1);
      console.log("PASS conflict shown inline and race stays ready; discard needs confirmation");

      // 暗色 + 窄宽度。
      await load("?theme=dark");
      await until("document.querySelectorAll('.race-lane').length === 3");
      await capture("race-dark");
      win.setContentSize(420, 860);
      await evaluate("new Promise(done => setTimeout(done, 300))");
      assert.equal(await evaluate("(() => { const p=document.querySelector('.race-panel'); return p.scrollWidth <= p.clientWidth; })()"), true);
      await capture("race-narrow");
      win.setContentSize(1200, 860);
      console.log("PASS dark theme and narrow width without horizontal overflow");

      // 空状态与英文。
      await load("?scenario=empty&en");
      await until("document.querySelector('.race-empty')");
      assert.equal(await evaluate("document.querySelector('.race-empty').textContent.includes('No races yet')"), true);

      // 设置对话框：能启动，草稿原样送到主程序。
      await load("?scenario=dialog");
      await until("document.querySelector('dialog.race-dialog[open]')");
      await until("raceFixture.calls.some(c => c.name === 'preflight')");
      assert.equal(await evaluate("document.querySelectorAll('.race-lane-config').length"), 2);
      // 必须真能点到：从屏幕坐标命中，而不是 element.click()。
      assert.equal(await evaluate("(() => { const r=document.querySelector('.race-dialog textarea').getBoundingClientRect(); return document.elementFromPoint(r.x+10,r.y+10)?.closest('.race-dialog') !== null; })()"), true);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.race-dialog')).pointerEvents"), "auto");
      await clickText("添加赛道");
      assert.equal(await evaluate("document.querySelectorAll('.race-lane-config').length"), 3);
      await clickText("开始赛马");
      await until("document.querySelector('#closed')");
      const draft = JSON.parse(await evaluate("JSON.stringify(raceFixture.calls.find(c => c.name==='start').args[0])"));
      assert.equal(draft.workspace, "/repo");
      assert.equal(draft.prompt, "Add a streaming parser");
      assert.equal(draft.lanes.length, 3);
      assert.equal(new Set(draft.lanes.map(l => l.label)).size, 3);
      console.log("PASS setup dialog starts a race with a clean draft and unique lane labels");

      // 非 git：禁止开始。
      await load("?scenario=nogit");
      await until("document.querySelector('.race-warning[role=alert]')");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('dialog footer button')).find(b => b.textContent.trim() === '开始赛马').disabled"), true);
      console.log("PASS non-git workspace blocks starting");

      assert.deepEqual(errors, []);
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
