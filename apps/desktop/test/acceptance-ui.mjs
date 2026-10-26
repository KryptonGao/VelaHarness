/** 自打包真实 ChatView + Workbench：node apps/desktop/test/acceptance-ui.mjs */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-acceptance-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "acceptance-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_ACCEPTANCE_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 55000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Acceptance UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_ACCEPTANCE_TEMP, "profile"));
  void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level >= 3) errors.push(event.message); });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const until = async code => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
    throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
  };
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const open = async index => {
    await evaluate(`document.querySelectorAll('.acceptance-card')[${index}].click()`);
    await until("Boolean(document.querySelector('.acceptance-panel')) && !document.querySelector('.acceptance-panel').closest('[role=tabpanel]').hidden");
  };
  const capture = async name => {
    if (!process.env.VELA_ACCEPTANCE_CAPTURE) return;
    mkdirSync(process.env.VELA_ACCEPTANCE_CAPTURE, { recursive: true });
    await evaluate("new Promise(done => setTimeout(done, 250))");
    writeFileSync(join(process.env.VELA_ACCEPTANCE_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(join(process.env.VELA_ACCEPTANCE_TEMP, "index.html"));
    await until("document.querySelectorAll('.acceptance-card').length === 2");
    assert.equal(await evaluate("document.querySelector('.acceptance-card').textContent.includes('验收')"), true);
    assert.equal(await evaluate("document.querySelector('.acceptance-card').textContent.includes('待确认')"), true);

    // 回合边界、无改动问答、checkpoint 磁盘改动与最后一次成功提交。
    assert.deepEqual(await evaluate(`(() => {
      const f = acceptanceFixture; const { messages, tools } = f.records();
      const aggregate = f.aggregate;
      const newer = {id:'new-submit',name:'submit_outcome',status:'done',activity:{outcome:{items:[{requirement:'Last success',status:'done',files:[],verificationIds:[],toConfirm:[]}]}}};
      const invalid = {...newer,id:'invalid',status:'error',activity:{outcome:{items:[{...newer.activity.outcome.items[0],requirement:'Failed submission'}]}}};
      const changed = messages.slice(0,3).map(m => m.id === 'r1' ? {...m,tools:[...m.tools,newer,invalid]} : m);
      const qa = [{id:'q',role:'user',text:'Hello',tools:[]},{id:'answer',role:'assistant',text:'Hi',tools:[]}];
      return {completed:[...aggregate(messages,false,'/fixture').keys()],streaming:[...aggregate(messages,true,'/fixture').keys()],
        last:aggregate(changed,false,'/fixture').get('r1').outcome.items[0].requirement,qa:aggregate(qa,false,'/fixture').size,
        disk:aggregate(qa,false,'/fixture',new Map([['answer',['generated.txt']]])).get('answer').outcome.items[0].changes[0].origin};
    })()`), { completed: ["r1", "r2"], streaming: ["r1"], last: "Last success", qa: 0, disk: "disk" });
    console.log("PASS completed turn aggregation, streaming boundary, successful-last submission and disk fallback");

    await open(0);
    assert.equal(await evaluate("document.querySelectorAll('.acceptance-requirement').length"), 2);
    assert.equal(await evaluate("document.querySelector('.acceptance-evidence.is-failed .acceptance-evidence-toggle').getAttribute('aria-expanded')"), "true");
    assert.equal(await evaluate("document.querySelector('.acceptance-evidence.is-failed .tool-terminal-out').textContent.includes('Build failed: missing fixture type')"), true);
    await click(".acceptance-evidence.is-passed .acceptance-evidence-toggle");
    assert.equal(await evaluate("document.querySelector('.acceptance-evidence.is-passed .tool-terminal-out').textContent.includes('FULL_OUTPUT_START')"), true);
    assert.equal(await evaluate("Boolean(document.querySelector('.acceptance-stale'))"), true);
    assert.equal(await evaluate("Boolean(document.querySelector('.acceptance-unattributed'))"), true);
    await capture("acceptance-light");
    console.log("PASS chat acceptance opens workbench, failed evidence expands, full Bash output and stale/unattributed facts");

    await click(".acceptance-edits button:last-child");
    await until("Boolean(document.querySelector('.turn-review-edit[data-diff-tool-id=parser-second]')) && !document.querySelector('.turn-review-view').closest('[role=tabpanel]').hidden");
    await evaluate("new Promise(done => setTimeout(done, 300))");
    assert.equal(await evaluate("document.querySelector('.turn-review-scroll').scrollTop > 0"), true);
    assert.equal(await evaluate("(() => { const scroll=document.querySelector('.turn-review-scroll'); const s=scroll.getBoundingClientRect(); const e=document.querySelector('.turn-review-edit[data-diff-tool-id=parser-second]').getBoundingClientRect(); return (Math.abs(e.top-s.top)<2 || scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1) && e.top >= s.top - 2 && e.bottom <= s.bottom; })()"), true);
    assert.equal(await evaluate("document.querySelector('.turn-review-sidebar .explorer-tree-item.file[title=\"src/parser.ts\"]').classList.contains('active')"), true);
    const filter = "document.querySelector('.turn-review-sidebar .explorer-search-input')";
    await evaluate(`(() => { const input=${filter}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'README'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await until("document.querySelectorAll('.turn-review-file').length === 1");
    await open(0); await click(".acceptance-edits button:last-child");
    await until("document.querySelector('.turn-review-sidebar .explorer-search-input').value === '' && document.querySelectorAll('.turn-review-file').length === 3");
    console.log("PASS exact repeated-edit diff jump and clearing a previously filtered review");

    await open(0);
    await click(".acceptance-requirement:last-child");
    await until("document.querySelector('.acceptance-detail h2').textContent === '补充使用说明'");
    assert.equal(await evaluate("document.querySelector('.acceptance-detail').textContent.includes('未找到本轮修改：missing.md')"), true);
    assert.equal(await evaluate("document.querySelector('.acceptance-detail').textContent.includes('未找到本轮已完成的验证：fake-id')"), true);
    await open(0);
    assert.equal(await evaluate("document.querySelector('.acceptance-detail h2').textContent"), "补充使用说明");
    await evaluate("acceptanceFixture.scope('b')"); await until("!document.querySelector('.acceptance-panel')");
    await open(1); assert.equal(await evaluate("Boolean(document.querySelector('.acceptance-derived'))"), true);
    await evaluate("acceptanceFixture.scope('a')"); await until("Boolean(document.querySelector('.acceptance-panel'))");
    assert.equal(await evaluate("document.querySelector('.acceptance-detail h2').textContent"), "支持增量解析并保留公开 API");
    await evaluate("acceptanceFixture.scope('a','/other')"); await until("!document.querySelector('.acceptance-panel')");
    await evaluate("acceptanceFixture.scope('a','/fixture')"); await until("Boolean(document.querySelector('.acceptance-panel'))");
    console.log("PASS same turn preserves selection; chat/workspace snapshots are isolated; fallback is explicit");

    for (const display of ["card", "compact"]) for (const fold of ["message", "position"]) for (const noReply of [false, true]) {
      await evaluate(`acceptanceFixture.variant(${JSON.stringify(display)},${JSON.stringify(fold)},${noReply})`);
      await until("document.querySelectorAll('.acceptance-card').length === 2");
      await open(0);
    }
    await evaluate("acceptanceFixture.streaming(true)"); await until("document.querySelectorAll('.acceptance-card').length === 1");
    await evaluate("acceptanceFixture.streaming(false)"); await until("document.querySelectorAll('.acceptance-card').length === 2");
    await open(0); await click(".acceptance-requirement:first-child");
    await evaluate("document.documentElement.dataset.scheme='dark'"); await capture("acceptance-dark");
    await evaluate("acceptanceFixture.width(420)");
    await until("document.querySelector('.acceptance-panel').clientWidth < 520");
    assert.equal(await evaluate("document.querySelector('.acceptance-panel').scrollWidth <= document.querySelector('.acceptance-panel').clientWidth"), true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.acceptance-body')).gridTemplateColumns.split(' ').length"), 1);
    await capture("acceptance-narrow");
    await evaluate("document.body.style.zoom='2'");
    assert.equal(await evaluate("document.querySelector('.acceptance-panel').scrollWidth <= document.querySelector('.acceptance-panel').clientWidth"), true);
    await capture("acceptance-zoom");
    await evaluate("document.body.style.zoom='1'");
    const close = "Array.from(document.querySelectorAll('.workbench-tab-close')).find(button=>button.getAttribute('aria-label').includes('验收'))";
    await evaluate(`${close}.click()`); await until("!document.querySelector('.acceptance-panel')"); await open(0);
    assert.equal(await evaluate("acceptanceFixture.reads()"), 0);
    assert.deepEqual(errors, []);
    console.log("PASS all tool display/fold/reply variants, streaming cards, responsive layout, zoom, close/reopen and no disk reads");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  });
}
