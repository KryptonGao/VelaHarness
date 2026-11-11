/** Real Electron renderer checks: node apps/desktop/test/hooks-ui.mjs */
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
  const temp = mkdtempSync(join(tmpdir(), "vela-hooks-ui-"));
  try {
    const { build } = await import("esbuild");
    await build({ stdin: { contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { HooksSettingsSection } from './apps/desktop/src/renderer/components/HooksSettingsSection';
      window.fixture={calls:[],listener:null,fail:false,revision:1,holdTest:false,resolveTest:null};
      const f=window.fixture; const doc=scope=>({scope,path:'/workspace/'+scope+'/hooks.json',config:{version:1,hooks:[]},digest:'a'.repeat(64),trusted:false});
      f.catalog={cwd:'/workspace',documents:[doc('global'),doc('project')],history:[]};
      window.vela={
        getHooksCatalog: async input=>{f.calls.push({method:'catalog',input});return structuredClone(f.catalog)},
        saveHooksConfig: async input=>{f.calls.push({method:'save',input});if(f.fail)throw Error('conflict');const d=f.catalog.documents.find(d=>d.scope===input.scope);d.config=input.config;d.digest=String(++f.revision).padStart(64,'0');d.trusted=false;return structuredClone(f.catalog)},
        setHooksTrust: async input=>{f.calls.push({method:'trust',input});f.catalog.documents.find(d=>d.scope===input.scope).trusted=input.trusted;if(!input.trusted){f.resolveTest?.({allowed:false,failed:true,reason:'cancelled',additionalContext:''});f.resolveTest=null}return structuredClone(f.catalog)},
        testHooks: async input=>{f.calls.push({method:'test',input});if(f.holdTest)return new Promise(resolve=>{f.resolveTest=resolve});return {allowed:true,failed:false,reason:'verified-check',additionalContext:'<img src=x onerror=alert(1)>'}},
        onHooksChanged: listener=>{f.listener=listener;return ()=>{f.listener=null}}
      };
      const root=createRoot(document.getElementById('root'));window.renderHooks=(locale='en',cwd='/workspace')=>root.render(<HooksSettingsSection locale={locale} workspacePath={cwd}/>);window.renderHooks();
    `, resolveDir: resolve(here, "../../.."), loader: "tsx" }, bundle: true, outfile: join(temp, "ui.js"), platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
    writeFileSync(join(temp, "index.html"), `<!doctype html><meta charset="utf-8"><style>${readStyles(resolve(here, "../src/renderer/styles.css"))}</style><link rel="stylesheet" href="ui.css"><div id="root" style="padding:20px;max-width:800px;margin:auto"></div><script src="ui.js"></script>`);
    const env = { ...process.env, VELA_HOOKS_UI_TEMP: temp }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    const outcome = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); }); clearTimeout(timer);
    assert.equal(outcome.code, 0, `Hooks renderer checks failed (${outcome.signal ?? outcome.code})`);
  } finally { rmSync(temp, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_HOOKS_UI_TEMP, "profile"));
  void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadFile(join(process.env.VELA_HOOKS_UI_TEMP, "index.html"));
    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async code => { const end = Date.now() + 5000; while (Date.now() < end) { if (await evaluate(code)) return; await new Promise(r => setTimeout(r, 20)); } throw Error(`Timed out: ${code}`); };
    const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(n=>n.textContent===${JSON.stringify(label)}).click()`);
    const fill = value => evaluate(`(()=>{const n=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until("document.querySelector('textarea')");
    await click("Add rule"); await until("document.querySelectorAll('.hooks-rule').length===1");
    assert.equal(await evaluate("document.querySelector('.hooks-rule [role=switch]').getAttribute('aria-checked')"), "false", "new examples must be disabled");
    await click("Add rule"); await until("document.querySelectorAll('.hooks-rule').length===2");
    await evaluate("document.querySelectorAll('.hooks-remove')[1].click()"); await until("document.querySelectorAll('.hooks-rule').length===1");
    await evaluate("document.querySelector('.hooks-rule [role=switch]').click()");
    await click("Save configuration"); await until("fixture.calls.some(c=>c.method==='save') && !document.querySelector('.hooks-settings').getAttribute('aria-busy')?.includes('true')");
    assert.equal(await evaluate("fixture.calls.find(c=>c.method==='save').input.config.hooks[0].enabled"), true);
    await click("Review and authorize"); await until("document.querySelector('.hooks-confirm pre')");
    assert.equal(await evaluate("fixture.calls.filter(c=>c.method==='trust').length"), 0);
    await click("Cancel"); await until("!document.querySelector('.hooks-confirm')");
    await click("Review and authorize"); await click("Authorize native execution"); await until("fixture.catalog.documents[1].trusted");
    assert.equal(await evaluate("fixture.calls.find(c=>c.method==='trust').input.digest===fixture.catalog.documents[1].digest"), true);
    await click("Test run"); await until("document.querySelector('.hooks-confirm')");
    assert.equal(await evaluate("fixture.calls.filter(c=>c.method==='test').length"), 0);
    await click("Run commands now"); await until("document.body.textContent.includes('Test run passed')");
    assert.equal(await evaluate("fixture.calls.find(c=>c.method==='test').input.toolName"), "write");
    assert.equal(await evaluate("document.querySelector('.hooks-confirm pre').textContent.includes('verified-check') && !document.querySelector('.hooks-confirm img')"), true, "test output is visible as escaped text, not HTML");
    const saved = await evaluate("document.querySelector('textarea').value");
    await fill("{invalid"); await until("document.querySelector('textarea').getAttribute('aria-invalid')==='true'");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Save configuration').disabled"), true);
    await click("Global"); await until("document.querySelector('textarea') && !document.querySelector('textarea').value.includes('invalid')");
    await click("Project"); await until("document.querySelector('textarea')?.value==='{invalid'");
    await fill(saved.replace('10000', '11000'));
    await evaluate("fixture.fail=true"); await click("Save configuration"); await until("document.body.textContent.includes('Your draft was kept')");
    assert.ok((await evaluate("document.querySelector('textarea').value")).includes("11000"));
    await click("Reload"); await until("document.body.textContent.includes('Discard draft and reload')"); await click("Discard draft and reload");
    await until("document.querySelector('textarea')?.value.includes('10000')");
    await evaluate("fixture.listener({id:'run',cwd:'/workspace',scope:'project',hookId:'guard',event:'PreToolUse',toolName:'write',startedAt:Date.now(),durationMs:12,status:'denied',code:'denied'})");
    await until("document.querySelector('.hooks-run')?.textContent.includes('Denied')");
    await evaluate("fixture.holdTest=true"); await click("Test run"); await until("document.querySelector('.hooks-confirm')"); await click("Run commands now");
    await until("Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='Revoke authorization and stop test')");
    await click("Revoke authorization and stop test"); await until("!fixture.catalog.documents[1].trusted && document.querySelector('.hooks-settings').getAttribute('aria-busy')==='false'");
    await evaluate("fixture.holdTest=false");
    for (const [locale, text] of [["zh-CN", "审阅并授权"], ["zh-TW", "審閱並授權"], ["ja", "確認して許可"], ["ko", "검토 및 승인"], ["en", "Review and authorize"]]) {
      await evaluate(`renderHooks(${JSON.stringify(locale)})`); await until(`document.body.textContent.includes(${JSON.stringify(text)})`);
    }
    win.setSize(480, 1000);
    await new Promise(r => setTimeout(r, 80));
    assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth"), true, "narrow layout must not overflow horizontally");
    if (process.env.VELA_HOOKS_UI_CAPTURE) writeFileSync(process.env.VELA_HOOKS_UI_CAPTURE, (await win.webContents.capturePage()).toPNG());
    await evaluate("renderHooks('en',null)"); await until("document.body.textContent.includes('Open a workspace first.')");
    console.log("Hooks Electron UI checks passed (CRUD, trust, test, conflicts, drafts, history, five locales, narrow layout).");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  });
}
