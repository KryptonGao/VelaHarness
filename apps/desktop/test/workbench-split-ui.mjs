/** 真实工作面板：拖动分屏、稳定内容、多个文件/网页同时显示及内外调宽。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-workbench-split-"));
  const { build } = await import("esbuild");
  await build({ entryPoints: [join(here, "workbench-split-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" }, logLevel: "error" });
  writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
  const env = { ...process.env, VELA_WORKBENCH_SPLIT_TEMP: temporary }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 100000);
  try { assert.equal(await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); }), 0, "工作面板分屏检查失败"); }
  finally { clearTimeout(timer); }
} else {
  const { app, BrowserWindow, webContents } = await import("electron");
  const temporary = process.env.VELA_WORKBENCH_SPLIT_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_, callback) => callback({ cancel: true }));
    const js = code => win.webContents.executeJavaScript(code);
    const pause = () => new Promise(done => setTimeout(done, 150));
    const until = async code => { const deadline = Date.now() + 7000; while (Date.now() < deadline) { if (await js(code)) return; await new Promise(done => setTimeout(done, 25)); } throw new Error(`超时：${code}\n${errors.join("\n")}`); };
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const tabExpr = name => `Array.from(document.querySelectorAll('.workbench-tab')).find(t=>t.textContent.trim()===${JSON.stringify(name)})`;
    const paneExpr = name => `${tabExpr(name)}.closest('.workbench-group')`;
    const key = (selector, name, extra = {}) => js(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(name)},bubbles:true,...${JSON.stringify(extra)}}))`);
    const count = () => js("document.querySelectorAll('.workbench-group').length");
    const names = () => js("[...document.querySelectorAll('.workbench-tab')].map(t=>t.textContent.trim()).sort()");
    const reset = async (kind = "chat") => { await js(`splitFixture.reset(${JSON.stringify(kind)})`); await until("document.querySelectorAll('.workbench-group').length===1"); await pause(); };
    const box = name => js(`(()=>{const r=${paneExpr(name)}.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const setPanelWidth = async px => { await js(`document.documentElement.style.setProperty('--workbench-width','${px}px')`); let last = -1; for (let i = 0; i < 40; i++) { await new Promise(done => setTimeout(done, 50)); const w = await js("document.querySelector('.workbench-panel').getBoundingClientRect().width"); if (w === last) return; last = w; } };
    let heldPoint = null;
    async function hover(name, target, edge) {
      await js(`${tabExpr(name)}.scrollIntoView({block:'nearest',inline:'nearest'})`); await pause();
      const start = await js(`(()=>{const r=${tabExpr(name)}.getBoundingClientRect();return {x:Math.round(r.left+Math.min(20,r.width/3)),y:Math.round(r.top+r.height/2)}})()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
      win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x+10, y: start.y, button: 'left' });
      await until("document.querySelector('.workbench-drag-surface')");
      const point = await js(`(()=>{const r=${paneExpr(target)}.getBoundingClientRect();return {x:Math.round(${JSON.stringify(edge)}==='left'?r.left+16:${JSON.stringify(edge)}==='right'?r.right-16:r.left+r.width/2),y:Math.round(${JSON.stringify(edge)}==='tabbar'?r.top+26:${JSON.stringify(edge)}==='top'?r.top+64:${JSON.stringify(edge)}==='bottom'?r.bottom-12:r.top+r.height/2)}})()`);
      heldPoint = point;
      win.webContents.sendInputEvent({ type: 'mouseMove', ...point, button: 'left' });
      await pause(); return point;
    }
    async function releasePointer(point=heldPoint) {
      if (!point) return;
      win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }); heldPoint=null; await pause();
    }
    async function drop(name, target, edge) {
      const targetBarBefore = edge === 'tabbar' ? await box(target) : null;
      const before = await names(), p = await hover(name, target, edge);
      assert.ok(await js("Boolean(document.querySelector('.workbench-drop-preview'))"), `落点应可用：${name}/${edge}`);
      const preview = await js("(()=>{const e=document.querySelector('.workbench-drop-preview'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,text:e.textContent}})()");
      assert.equal(preview.text, "");
      await releasePointer(p);
      await until("!document.querySelector('.workbench-drag-surface')"); await pause();
      const actual = targetBarBefore ?? await box(name);
      if (edge === 'tabbar') actual.height=Math.min(52,actual.height);
      for (const k of ["x", "y"]) assert.ok(Math.abs(preview[k] - actual[k] - 5) < 1, "预览位置应等于落点");
      for (const k of ["width", "height"]) assert.ok(Math.abs(preview[k] - actual[k] + 10) < 1, "预览尺寸应等于落点");
      assert.deepEqual(await names(), before);
    }
    async function pointerDrag(selector, deltaX, deltaY = 0) {
      const point = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(80,r.height/2))}})()`);
      win.webContents.sendInputEvent({ type: "mouseMove", ...point });
      win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseMove", x: point.x + deltaX, y: point.y + deltaY, button: "left" });
      win.webContents.sendInputEvent({ type: "mouseUp", x: point.x + deltaX, y: point.y + deltaY, button: "left", clickCount: 1 }); await pause();
    }
    try {
      await win.loadFile(join(temporary, "index.html")); await until("document.querySelectorAll('.workbench-tab').length===4"); await pause();
      await setPanelWidth(1000);
      assert.equal(await count(), 1);
      assert.equal(await js("document.querySelectorAll('.layout-switch,.layout-button,.count-badge').length"), 0);
      await js("document.querySelector('textarea[aria-label=\"Draft B\"]').value='保留草稿'; window.originalDraft=document.querySelector('textarea[aria-label=\"Draft B\"]');");
      const mounts = await js("({...splitFixture.mounts})");
      await hover("B", "A", "right"); assert.equal(await count(), 1); await key("body", "Escape"); await releasePointer(); assert.equal(await count(), 1);
      await drop("C", "A", "bottom"); await drop("B", "A", "right"); assert.equal(await count(), 3);
      let a = await box("A"), b = await box("B"), c = await box("C"); assert.equal(a.y, b.y); assert.ok(c.y > a.y && c.width > a.width * 1.9);
      assert.equal(await js("document.querySelector('textarea[aria-label=\"Draft B\"]')===window.originalDraft && window.originalDraft.value==='保留草稿'"), true);
      assert.deepEqual(await js("({...splitFixture.mounts})"), mounts);
      await reset(); await drop("C", "A", "top"); await drop("B", "A", "right"); a = await box("A"); b = await box("B"); c = await box("C"); assert.equal(a.y, b.y); assert.ok(c.y < a.y && c.width > a.width * 1.9);
      await reset(); await drop("B", "A", "right"); await drop("C", "B", "bottom"); a = await box("A"); b = await box("B"); assert.ok(a.height > b.height * 1.9);
      await drop("D", "A", "bottom"); assert.equal(await count(), 4);
      await js("splitFixture.add()"); await until("document.querySelectorAll('.workbench-tab').length===5");
      await hover("new-1", "D", "left"); assert.equal(await js("Boolean(document.querySelector('.workbench-drop-preview'))"), false); await key("body", "Escape"); await releasePointer();
      await drop("B", "C", "left"); assert.equal(await count(), 4);
      const oldAPane = await js(`${paneExpr("A")}.dataset.workbenchPane`), oldCPane = await js(`${paneExpr("C")}.dataset.workbenchPane`);
      const windowRects = await js("[...document.querySelectorAll('.workbench-group')].map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.workbenchPane,x:r.x,y:r.y,w:r.width,h:r.height}})");
      await js("window.savedSwapDrafts=[...document.querySelectorAll('.split-test-draft textarea')]");
      await drop("A", "C", "center"); assert.equal(await count(), 4);
      assert.equal(await js(`${paneExpr("A")}.dataset.workbenchPane`), oldCPane);
      assert.equal(await js(`${paneExpr("C")}.dataset.workbenchPane`), oldAPane);
      assert.equal(await js(`${tabExpr("A")}.getAttribute('aria-selected')`), 'true');
      assert.equal(await js(`${tabExpr("C")}.getAttribute('aria-selected')`), 'true');
      assert.deepEqual(await js("[...document.querySelectorAll('.workbench-group')].map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.workbenchPane,x:r.x,y:r.y,w:r.width,h:r.height}})"), windowRects);
      assert.equal(await js("window.savedSwapDrafts.every(e=>e.isConnected)"),true);
      const topBars = await js("[...document.querySelectorAll('.workbench-group[data-top-row=\"true\"] .workbench-tabbar')].map(e=>({height:e.getBoundingClientRect().height,background:getComputedStyle(e).backgroundColor,paddingLeft:getComputedStyle(e).paddingLeft,tabHeight:e.querySelector('.workbench-tab').getBoundingClientRect().height}))");
      assert.ok(topBars.length); topBars.forEach(bar=>{assert.equal(bar.height,52);assert.equal(bar.background,'rgba(0, 0, 0, 0)');assert.equal(bar.paddingLeft,'16px');assert.equal(bar.tabHeight,28);});
      assert.equal(await js("getComputedStyle(document.querySelector('.workbench-canvas')).backgroundColor"),'rgba(0, 0, 0, 0)');
      // 标签放得下时，关闭按钮不能套上“被裁切”的白底描边（窗格宽度为小数像素时曾被误判）。
      for (const step of [0, 1, 3, 7]) {
        for (let i = 0; i < step; i++) await key('.workbench-split-handle.axis-x', 'ArrowRight'); await pause();
        const clippedFit = await js("[...document.querySelectorAll('.workbench-group')].filter(g=>{const l=g.querySelector('.workbench-tablist');return l.scrollWidth<=l.clientWidth+1&&g.querySelector('.workbench-tab-close.is-clipped')}).length");
        assert.equal(clippedFit, 0, '标签放得下却显示了被裁切样式的关闭按钮');
      }
      // 分屏窗格不画蓝色焦点边框（聚焦窗格只靠选中标签区分）。
      assert.deepEqual(await js("[...document.querySelectorAll('.workbench-group')].map(g=>getComputedStyle(g).boxShadow).filter(v=>v!=='none')"), []);
      // 分隔条悬停/聚焦只亮一条线，不涂整条命中区、不画焦点框。
      await js("document.querySelector('.workbench-split-handle').focus()"); await pause();
      assert.deepEqual(await js("(()=>{const h=document.querySelector('.workbench-split-handle');return [getComputedStyle(h).backgroundColor,getComputedStyle(h).outlineStyle]})()"), ['rgba(0, 0, 0, 0)', 'none']);
      // 拖动分屏分隔条时，面板边缘的侧栏手柄不能被连带点亮；侧栏自己拖动时仍要亮。
      const edge = () => js("getComputedStyle(document.querySelector('.workbench-panel > .sidebar-resize-handle'),'::after').backgroundColor");
      const idle = await edge();
      const settle = async () => { let last = await edge(); for (let i = 0; i < 20; i++) { await new Promise(done => setTimeout(done, 50)); const now = await edge(); if (now === last) return now; last = now; } return last; };
      await js("document.documentElement.dataset.resizing='true'");
      assert.notEqual(await settle(), idle, '侧栏拖动时手柄应点亮');
      await js("document.documentElement.dataset.paneResizing='true'");
      assert.equal(await settle(), idle, '分屏拖动时侧栏手柄不应点亮');
      await js("delete document.documentElement.dataset.resizing;delete document.documentElement.dataset.paneResizing"); await settle();
      // 起始页内容比窗格高时必须能滚回顶部（居中不能把顶部裁掉）。
      assert.equal(await js(`(()=>{const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:300px;height:200px;display:flex;flex-direction:column';
        host.innerHTML='<div class="start-view"><div class="start-view-inner"><div style="height:600px"></div></div></div>';document.body.append(host);
        const view=host.firstChild,inner=view.firstChild;view.scrollTop=0;const ok=inner.getBoundingClientRect().top>=view.getBoundingClientRect().top;host.remove();return ok})()`), true);
      console.log("PASS 真实鼠标按下/移动/松开分屏、强调色落点、各三窗方向、四窗上限及稳定草稿 DOM");
      console.log("PASS 顶栏透明、52px 原高度、原胶囊尺寸和留白");
      await click('.workbench-group .workbench-group-action[aria-label="放大窗口"]'); await pause();
      assert.equal(await js("document.querySelectorAll('.workbench-group:not([hidden])').length"), 1);
      const headerAndBody = await js("(()=>{const g=document.querySelector('.workbench-group:not([hidden])'),id=g.dataset.workbenchPane;return {bar:g.querySelector('.workbench-tabbar').getBoundingClientRect().bottom,body:[...document.querySelectorAll('[data-workbench-content-pane]')].find(e=>e.dataset.workbenchContentPane===id&&!e.classList.contains('is-inactive')).getBoundingClientRect().top}})()");
      assert.ok(Math.abs(headerAndBody.bar - headerAndBody.body) < 1);
      await key("body", "Escape"); await pause(); assert.equal(await js("document.querySelectorAll('.workbench-group:not([hidden])').length"), 4);
      const beforeMerge = await names(); await click('.workbench-group-action[aria-label="关闭窗口，保留标签"]'); await pause(); assert.equal(await count(), 3); assert.deepEqual(await names(), beforeMerge);
      await pointerDrag(".workbench-split-handle", 40, 35); assert.equal(await js("document.documentElement.dataset.resizing"), undefined);
      const minmax = await js("Number(document.querySelector('.workbench-split-handle').getAttribute('aria-valuenow'))"); assert.ok(minmax >= 25 && minmax <= 75);
      await key(".workbench-split-handle", "Home"); await pause(); assert.equal(await js("document.querySelector('.workbench-split-handle').getAttribute('aria-valuenow')"), "50");
      const ratio = await js("document.querySelector('.workbench-split-handle').getAttribute('aria-valuenow')");
      const oldWidth = await js("document.querySelector('.workbench-panel').getBoundingClientRect().width");
      await pointerDrag('.workbench-panel > .sidebar-resize-handle', -110);
      assert.ok(await js("document.querySelector('.workbench-panel').getBoundingClientRect().width") > oldWidth + 80);
      assert.equal(await js("document.querySelector('.workbench-split-handle').getAttribute('aria-valuenow')"), ratio);
      console.log("PASS 放大/还原、关闭窗口保留标签、内部调比及原有外层调宽");
      await reset(); await drop("C", "A", "bottom");
      const inactiveSource = await js(`${paneExpr("B")}.dataset.workbenchPane`), inactiveTarget = await js(`${paneExpr("C")}.dataset.workbenchPane`);
      await drop("B", "C", "center");
      assert.equal(await count(),2);
      assert.equal(await js(`${paneExpr("B")}.dataset.workbenchPane`),inactiveTarget);
      assert.equal(await js(`${paneExpr("C")}.dataset.workbenchPane`),inactiveSource);
      assert.equal(await js(`${tabExpr("A")}.getAttribute('aria-selected')`),'true');
      assert.equal(await js(`${tabExpr("C")}.getAttribute('aria-selected')`),'false');
      console.log("PASS 拖动非当前标签只交换槽位，不打断源窗口当前页面");
      await reset(); await drop("B", "A", "right");
      const restoreNames=await names();
      await js("window.restoredDraft=document.querySelector('textarea[aria-label=\"Draft B\"]'); window.restoredDraft.value='收回草稿'");
      await drop("B", "A", "tabbar"); assert.equal(await count(),1); assert.deepEqual(await names(),restoreNames);
      assert.equal(await js(`${paneExpr("B")}.dataset.workbenchPane===${paneExpr("A")}.dataset.workbenchPane`),true);
      assert.equal(await js(`${tabExpr("B")}.getAttribute('aria-selected')`),'true');
      assert.equal(await js("window.restoredDraft.isConnected && window.restoredDraft.value==='收回草稿'"),true);
      await drop("B", "A", "right"); await drop("D", "B", "tabbar");
      assert.equal(await count(),2);
      await drop("B", "A", "tabbar"); assert.equal(await count(),2);
      assert.equal(await js(`${tabExpr("D")}.getAttribute('aria-selected')`),'true');
      assert.equal(await js(`${paneExpr("B")}.dataset.workbenchPane===${paneExpr("A")}.dataset.workbenchPane`),true);
      await reset(); await drop("B", "A", "bottom"); await drop("C", "B", "tabbar");
      assert.equal(await count(),2);
      assert.equal(await js(`${paneExpr("C")}.dataset.workbenchPane===${paneExpr("B")}.dataset.workbenchPane`),true);
      assert.equal(await js(`${tabExpr("A")}.getAttribute('aria-selected')`),'true');
      console.log("PASS 真实拖回标签栏自动收拢空源窗口，多标签源窗口保留，下面一排标签栏命中正确");
      await reset(); await js(`${tabExpr("B")}.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,shiftKey:true,bubbles:true}))`); await pause(); assert.equal(await count(), 2);
      await js(`${paneExpr("A")}.querySelector('.workbench-new-tab').click()`); await until("document.querySelectorAll('.workbench-tab').length===5");
      assert.equal(await js(`${paneExpr("new-2")}.dataset.workbenchPane===${paneExpr("A")}.dataset.workbenchPane`), true);
      await js(`${tabExpr("D")}.click()`); await until(`${tabExpr("D")}.getAttribute('aria-selected')==='true'`); await pause();
      await js(`${paneExpr("D")}.querySelector('.workbench-group-action[aria-label="窗口操作"]').click()`); await until("document.querySelector('.workbench-pane-menu')");
      await js("Array.from(document.querySelectorAll('.workbench-pane-menu button')).find(b=>b.textContent==='移动当前标签').click()"); await until("document.querySelector('[data-placing]')");
      const oldDPane = await js(`${paneExpr("D")}.dataset.workbenchPane`), oldBPane = await js(`${paneExpr("B")}.dataset.workbenchPane`);
      const point = await js(`(()=>{const r=${paneExpr("B")}.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      await js(`document.querySelector('[data-placing]').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:${point.x},clientY:${point.y}}))`); await pause();
      assert.equal(await js(`${paneExpr("D")}.dataset.workbenchPane`), oldBPane);
      assert.equal(await js(`${paneExpr("B")}.dataset.workbenchPane`), oldDPane);
      console.log("PASS 键盘拆分、新建标签分组归属、非拖动的点击放置替代操作");
      await reset(); await js("splitFixture.requestLateTab()");
      await until(`${tabExpr("late-tab")}?.getAttribute('aria-selected')==='true'`);
      console.log("PASS 待激活标签先请求、后异步挂载时仍正确显示");
      await reset(); await js("splitFixture.openFile('one.ts')"); await until("document.querySelector('.code-line-content') || document.querySelector('.panel-file-preview-view')");
      await js("splitFixture.openFile('two.ts')"); await pause(); await drop("two.ts", "one.ts", "right");
      await until("[...document.querySelectorAll('.workbench-tabpanel:not(.is-inactive) .panel-file-preview-view')].length===2");
      await until("[...document.querySelectorAll('.workbench-tabpanel:not(.is-inactive) .panel-file-preview-view')].some(e=>e.textContent.includes('one.ts line 0')) && [...document.querySelectorAll('.workbench-tabpanel:not(.is-inactive) .panel-file-preview-view')].some(e=>e.textContent.includes('two.ts line 0'))");
      await js("splitFixture.reload()"); await until("[...document.querySelectorAll('.workbench-tabpanel:not(.is-inactive) .panel-file-preview-view')].every(e=>e.textContent.includes('revision 1'))");
      const firstFilePane = await js(`${paneExpr("one.ts")}.dataset.workbenchPane`), secondFilePane = await js(`${paneExpr("two.ts")}.dataset.workbenchPane`);
      await js("window.savedFileNodes=[...document.querySelectorAll('.panel-file-preview-view')]");
      await drop("two.ts", "one.ts", "center");
      assert.equal(await count(),2);
      assert.equal(await js(`${paneExpr("one.ts")}.dataset.workbenchPane`), secondFilePane);
      assert.equal(await js(`${paneExpr("two.ts")}.dataset.workbenchPane`), firstFilePane);
      assert.equal(await js("window.savedFileNodes.every(e=>e.isConnected)"),true);
      console.log("PASS 两个文件独立显示、原位互换保留 DOM 且 Git 刷新同时更新");
      await reset("browser"); await until("Object.keys(splitFixture.binds).length===2");
      const ids = await js("({...splitFixture.binds})");
      const guests = [webContents.fromId(ids['browser-1']), webContents.fromId(ids['browser-2'])];
      for (let i = 0; i < guests.length; i++) {
        await guests[i].loadURL('data:text/html,' + encodeURIComponent(`<html><body><input id="draft" value="guest-${i}"><div style="height:1800px">Browser ${i}</div></body></html>`));
        await guests[i].executeJavaScript(`document.querySelector('#draft').value='saved-${i}';scrollTo(0,150)`);
      }
      await drop("Browser 2", "Browser 1", "right");
      await until("document.querySelectorAll('.browser-guest-frame[aria-hidden=\"false\"]').length===2");
      await js(`${tabExpr("A")}.click()`); await pause();
      assert.equal(await js("document.querySelectorAll('.browser-guest-frame[aria-hidden=\"false\"]').length"), 1);
      await js(`${tabExpr("Browser 1")}.click()`); await until("document.querySelectorAll('.browser-guest-frame[aria-hidden=\"false\"]').length===2");
      await pointerDrag('.workbench-panel > .sidebar-resize-handle', -60);
      for (let i = 0; i < guests.length; i++) assert.equal(await guests[i].executeJavaScript("document.querySelector('#draft').value"), `saved-${i}`);
      assert.deepEqual(await js("({...splitFixture.binds})"), ids);
      const firstBrowserPane = await js(`${paneExpr("Browser 1")}.dataset.workbenchPane`), secondBrowserPane = await js(`${paneExpr("Browser 2")}.dataset.workbenchPane`);
      await drop("Browser 2", "Browser 1", "center"); await until("document.querySelectorAll('.browser-guest-frame[aria-hidden=\"false\"]').length===2");
      assert.equal(await count(),2);
      assert.equal(await js(`${paneExpr("Browser 1")}.dataset.workbenchPane`), secondBrowserPane);
      assert.equal(await js(`${paneExpr("Browser 2")}.dataset.workbenchPane`), firstBrowserPane);
      for (let i = 0; i < guests.length; i++) assert.equal(await guests[i].executeJavaScript("document.querySelector('#draft').value"), `saved-${i}`);
      console.log("PASS 两个真实 webview 原位互换后仍同时可见，页面与输入状态保留");
      await drop("Browser 1", "Browser 2", "tabbar"); assert.equal(await count(),1);
      await until("document.querySelectorAll('.browser-guest-frame[aria-hidden=\"false\"]').length===1");
      assert.equal(await js(`${paneExpr("Browser 1")}.dataset.workbenchPane===${paneExpr("Browser 2")}.dataset.workbenchPane`),true);
      assert.deepEqual(await js("({...splitFixture.binds})"),ids);
      for (let i=0;i<guests.length;i++) assert.equal(await guests[i].executeJavaScript("document.querySelector('#draft').value"),`saved-${i}`);
      console.log("PASS 网页拖回标签栏后 guest 不重建，输入和登录承载页面保持存活");
      // 窄窗格里标签不能被右侧按钮挤没：次要按钮收进菜单，标签列表至少容得下一个最小宽度的标签。
      await setPanelWidth(560); await reset(); await drop("B", "A", "right");
      const narrow = await js("[...document.querySelectorAll('.workbench-group')].map(g=>({w:g.getBoundingClientRect().width,list:g.querySelector('.workbench-tablist').clientWidth,secondary:[...g.querySelectorAll('.workbench-group-action.is-secondary')].every(b=>getComputedStyle(b).display==='none')}))");
      assert.equal(narrow.length, 2); narrow.forEach(p => { assert.ok(p.w >= 240 && p.w <= 340, `窗格宽度应在最小宽度与窄窗格阈值之间：${p.w}`); assert.ok(p.secondary, '窄窗格应隐藏次要按钮'); assert.ok(p.list >= 72, `窄窗格标签列表过窄：${p.list}`); });
      // 最小窗格尺寸：再向右拆会让窗格窄于下限，不给落点；窗格仍可正常重排布局。
      await hover("C", "B", "right"); assert.equal(await js("Boolean(document.querySelector('.workbench-drop-preview'))"), false, "拆分后窗格过窄时不应给出落点"); await key("body", "Escape"); await releasePointer();
      assert.equal(await count(), 2);
      await setPanelWidth(1000);
      // 同窗口重排：拖动中有插入线、被拖标签变淡；松手后顺序改变并选中被拖标签。
      await reset(); await drop("B", "A", "right"); await drop("C", "B", "tabbar");
      const order = () => js(`[...${paneExpr("B")}.querySelectorAll('.workbench-tab')].map(t=>t.textContent.trim())`);
      assert.deepEqual(await order(), ["B", "C"]);
      const from = await js(`(()=>{const r=${tabExpr("C")}.getBoundingClientRect();return {x:Math.round(r.left+30),y:Math.round(r.top+14)}})()`);
      const to = await js(`(()=>{const r=${tabExpr("B")}.getBoundingClientRect();return {x:Math.round(r.left+8),y:Math.round(r.top+14)}})()`);
      win.webContents.sendInputEvent({ type: "mouseMove", ...from }); win.webContents.sendInputEvent({ type: "mouseDown", ...from, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseMove", x: from.x - 12, y: from.y, button: "left" }); await until("document.querySelector('.workbench-drag-surface')");
      win.webContents.sendInputEvent({ type: "mouseMove", ...to, button: "left" }); await pause();
      assert.equal(await js("Boolean(document.querySelector('.workbench-drop-marker'))"), true, "重排时应有插入线");
      assert.equal(await js(`${tabExpr("C")}.hasAttribute('data-dragging')`), true); assert.equal(await js(`getComputedStyle(${tabExpr("C")}).opacity<1`), true);
      assert.equal(await js("getComputedStyle(document.querySelector('.workbench-drag-surface')).cursor"), "grabbing");
      win.webContents.sendInputEvent({ type: "mouseUp", ...to, button: "left", clickCount: 1 }); await until("!document.querySelector('.workbench-drag-surface')"); await pause();
      assert.deepEqual(await order(), ["C", "B"]); assert.equal(await js(`${tabExpr("C")}.getAttribute('aria-selected')`), "true");
      assert.equal(await js("document.querySelectorAll('[data-dragging]').length"), 0);
      // macOS 上 Option+数字的 key 是 ™，要按物理键位 code 生效；聚焦窗口之外的选中标签降一级。
      await js(`${tabExpr("A")}.click()`); await pause();
      const focusedTab = () => js("document.querySelector('.workbench-group.is-focused [aria-selected=true]').textContent.trim()");
      assert.equal(await focusedTab(), "A");
      const colors = await js("[...document.querySelectorAll('.workbench-group')].map(g=>({focused:g.classList.contains('is-focused'),color:getComputedStyle(g.querySelector('[aria-selected=true]')).color}))");
      assert.notEqual(colors.find(c => c.focused).color, colors.find(c => !c.focused).color, "聚焦窗口应可辨认");
      await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'™',code:'Digit2',altKey:true,bubbles:true,cancelable:true}))"); await pause();
      assert.equal(await focusedTab(), "C");
      // 放大后输入框里的 Esc 不还原窗口，其他地方的 Esc 照常还原。
      await click('.workbench-group-action[aria-pressed]'); await pause();
      assert.equal(await js("document.querySelectorAll('.workbench-group:not([hidden])').length"), 1);
      await js("document.querySelector('textarea').focus();document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))"); await pause();
      assert.equal(await js("document.querySelectorAll('.workbench-group:not([hidden])').length"), 1, "输入框里的 Esc 不应还原窗口");
      await js("document.activeElement.blur()"); await key("body", "Escape"); await pause();
      assert.equal(await js("document.querySelectorAll('.workbench-group:not([hidden])').length"), 2);
      // 分隔条命中区只压住相邻窗格各 1px，不盖住内容滚动条。
      assert.equal(await js("(()=>{const h=document.querySelector('.workbench-split-handle').getBoundingClientRect(),p=[...document.querySelectorAll('.workbench-tabpanel')].filter(e=>!e.hidden).map(e=>e.getBoundingClientRect());return Math.round(h.width)===6&&Math.round(Math.min(...p.map(r=>Math.abs(r.right-h.left))))<=1})()"), true);
      console.log("PASS 窗口内标签重排、拖动反馈、Option+数字、输入框 Esc、聚焦窗口提示、分隔条命中区");
      // 拖自己窗口里的标签：窗口中部不留死区，下半部分都能拆出下方窗口。
      await reset();
      { const canvas = await js("(()=>{const r=document.querySelector('.workbench-canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()");
        const begin = await js(`(()=>{const r=${tabExpr("B")}.getBoundingClientRect();return {x:Math.round(r.left+20),y:Math.round(r.top+14)}})()`);
        win.webContents.sendInputEvent({ type: "mouseMove", ...begin }); win.webContents.sendInputEvent({ type: "mouseDown", ...begin, button: "left", clickCount: 1 });
        win.webContents.sendInputEvent({ type: "mouseMove", x: begin.x + 10, y: begin.y + 10, button: "left" }); await until("document.querySelector('.workbench-drag-surface')");
        for (const fy of [0.62, 0.75, 0.9]) {
          win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(canvas.x + canvas.w * 0.5), y: Math.round(canvas.y + canvas.h * fy), button: "left" }); await pause();
          assert.equal(await js("document.querySelector('.workbench-drop-preview')?.dataset.edge"), "bottom", `高度 ${fy} 处应能拆出下方窗口`);
        }
        win.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(canvas.x + canvas.w * 0.5), y: Math.round(canvas.y + canvas.h * 0.62), button: "left", clickCount: 1 });
        await until("!document.querySelector('.workbench-drag-surface')"); await pause(); assert.equal(await count(), 2); }
      // 实验性开关：关闭时合并回单窗口、标签不能拖动、没有窗口操作菜单；重新开启后可再次拆分。
      await reset(); await drop("B", "A", "right"); await drop("C", "B", "bottom"); assert.equal(await count(), 3);
      await js("splitFixture.setSplit(false)"); await until("document.querySelectorAll('.workbench-group').length===1"); await pause();
      assert.deepEqual(await names(), ["A", "B", "C", "D"]);
      assert.equal(await js("document.querySelectorAll('button[aria-label=\"窗口操作\"],.workbench-group-action[aria-pressed],.workbench-split-handle').length"), 0);
      {
        const begin = await js(`(()=>{const r=${tabExpr("B")}.getBoundingClientRect();return {x:Math.round(r.left+20),y:Math.round(r.top+14)}})()`);
        win.webContents.sendInputEvent({ type: "mouseMove", ...begin }); win.webContents.sendInputEvent({ type: "mouseDown", ...begin, button: "left", clickCount: 1 });
        win.webContents.sendInputEvent({ type: "mouseMove", x: begin.x - 40, y: begin.y + 300, button: "left" }); await pause();
        assert.equal(await js("Boolean(document.querySelector('.workbench-drag-surface'))"), false, "关闭分屏后不应进入拖动");
        win.webContents.sendInputEvent({ type: "mouseUp", x: begin.x - 40, y: begin.y + 300, button: "left", clickCount: 1 }); await pause();
      }
      await js(`${tabExpr("A")}.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,shiftKey:true,bubbles:true,cancelable:true}))`); await pause(); assert.equal(await count(), 1);
      await js("splitFixture.setSplit(true)"); await pause(); await drop("B", "A", "right"); assert.equal(await count(), 2);
      await reset(); await drop("C", "A", "bottom"); await drop("B", "A", "right");
      await click('.workbench-collapse'); await pause(); assert.equal(await js("getComputedStyle(document.querySelector('.workbench-panel')).display"), "none");
      await js("splitFixture.expand()"); await pause(); assert.equal(await count(), 3);
      for (const scheme of ["light", "dark"]) {
        await js(`document.documentElement.dataset.scheme=${JSON.stringify(scheme)}`);
        assert.equal(await js("document.querySelectorAll('.layout-switch,.layout-button').length"), 0);
        if (process.env.VELA_WORKBENCH_SPLIT_CAPTURE) { await pause(); writeFileSync(`${process.env.VELA_WORKBENCH_SPLIT_CAPTURE}-${scheme}.png`, (await win.webContents.capturePage()).toPNG()); }
      }
      console.log("PASS 折叠保留布局、深浅色");
      // Terminal close uses the real compact in-app dialog, not a native OS alert.
      await reset("terminal"); await drop("Terminal", "A", "right");
      const closeTerminal = () => js(`(()=>{const b=document.querySelector('.workbench-tab-close[aria-label="关闭 Terminal"]');b.focus();b.click()})()`);
      const prompt = async () => { await closeTerminal(); await js("splitFixture.resolveTerminalClose('busy')"); await until("document.querySelector('.terminal-close-dialog[open]')"); };
      const press = async keyCode => {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode });
        if (keyCode === "Enter") win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode }); await pause();
      };
      await js("splitFixture.terminalCloseChecks=[];splitFixture.terminalCloses=[];splitFixture.closeRequests=[];window.savedTerminal=document.querySelector('.terminal-xterm')");
      await closeTerminal(); await closeTerminal(); await pause();
      assert.deepEqual(await js("splitFixture.terminalCloseChecks"), ["session-1"], "重复关闭不能重复检查");
      assert.deepEqual(await js("splitFixture.closeRequests"), []);
      assert.deepEqual(await js("splitFixture.terminalCloses"), []);
      assert.equal(await count(), 2);
      assert.equal(await js("document.querySelector('.workbench-panel').classList.contains('is-closing')"), false);
      await js("splitFixture.resolveTerminalClose('busy')"); await until("document.querySelector('.terminal-close-dialog[open]')");
      await closeTerminal();
      assert.equal(await js("document.querySelectorAll('.terminal-close-dialog').length"), 1);
      assert.equal(await js("document.activeElement.className"), "terminal-close-cancel");
      assert.equal(await js("document.querySelector('.terminal-close-dialog').getAttribute('role')"), "alertdialog");
      assert.equal(await js("document.querySelector('.terminal-close-dialog').querySelectorAll('button').length"), 2);
      // Theme tokens, original compact spacing and left-aligned buttons match the supplied card.
      const dialogBackgrounds = [];
      for (const scheme of ["light", "dark"]) {
        await js(`document.documentElement.dataset.scheme=${JSON.stringify(scheme)}`);
        const style = await js("(()=>{const d=document.querySelector('.terminal-close-dialog'),s=getComputedStyle(d),b=d.querySelector('button'),r=d.getBoundingClientRect();return {width:r.width,height:r.height,padding:s.padding,border:s.borderRadius,background:s.backgroundColor,cancel:getComputedStyle(b).backgroundColor,buttonHeight:b.getBoundingClientRect().height,left:b.getBoundingClientRect().left-r.left}})()");
        assert.equal(style.width, 552); assert.ok(style.height < 140); assert.equal(style.padding, "12px 14px");
        assert.equal(style.border, "8px"); assert.equal(style.buttonHeight, 32); assert.equal(style.left, 15);
        assert.notEqual(style.cancel, style.background); dialogBackgrounds.push(style.background);
      }
      assert.notEqual(dialogBackgrounds[0], dialogBackgrounds[1], "卡片随深浅主题切换");
      if (process.env.VELA_TERMINAL_CLOSE_CAPTURE) {
        await js("splitFixture.setLocale('zh-TW');document.documentElement.dataset.replyFontCjk='serif'"); await pause();
        const rect = await js("(()=>{const r=document.querySelector('.terminal-close-dialog').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()");
        writeFileSync(process.env.VELA_TERMINAL_CLOSE_CAPTURE, (await win.webContents.capturePage(rect)).toPNG());
        await js("splitFixture.setLocale('zh-CN');delete document.documentElement.dataset.replyFontCjk");
      }
      win.setSize(480, 700); await pause();
      assert.equal(await js("(()=>{const d=document.querySelector('.terminal-close-dialog').getBoundingClientRect();return d.left>=14&&d.right<=innerWidth-14&&d.width===innerWidth-28})()"), true, "窄窗口仍完整显示卡片");
      win.setSize(1600, 1000); await pause();
      await press("Tab"); assert.equal(await js("document.activeElement.textContent"), "终止命令并关闭");
      await press("Tab"); assert.equal(await js("document.activeElement.className"), "terminal-close-cancel", "焦点不能离开弹窗");
      await press("Enter"); await until("!document.querySelector('.terminal-close-dialog')");
      assert.equal(await js("document.activeElement.getAttribute('aria-label')"), "关闭 Terminal", "取消后恢复焦点");
      assert.equal(await js("window.savedTerminal.isConnected && document.querySelector('.terminal-xterm')===window.savedTerminal"), true);
      assert.deepEqual(await names(), ["A", "Terminal"]);
      assert.deepEqual(await js("splitFixture.terminalCloses"), []);
      await prompt(); await press("Escape"); await until("!document.querySelector('.terminal-close-dialog')");
      assert.deepEqual(await js("splitFixture.terminalCloses"), []);
      await closeTerminal(); await js("splitFixture.rejectTerminalClose()"); await pause();
      assert.deepEqual(await names(), ["A", "Terminal"], "检查失败不能关闭命令");
      assert.equal(await js("Boolean(document.querySelector('.terminal-close-dialog'))"), false);
      await closeTerminal(); await js("splitFixture.resolveTerminalClose('unavailable')"); await pause();
      assert.deepEqual(await names(), ["A", "Terminal"]);
      await prompt(); await click(".terminal-close-actions button:last-child");
      await until("splitFixture.terminalCloses.length===1");
      assert.deepEqual(await names(), ["A"]); assert.equal(await count(), 1);
      assert.deepEqual(await js("splitFixture.closeRequests"), ["terminal-1"]);
      assert.deepEqual(await js("splitFixture.terminalCloses"), ["session-1"]);
      // Last-tab animation starts only after explicit approval.
      await reset("terminal-only"); await js("splitFixture.terminalCloses=[];splitFixture.closeRequests=[]");
      await prompt(); await pause();
      assert.equal(await js("document.querySelector('.workbench-panel').classList.contains('is-closing')"), false);
      await click(".terminal-close-cancel"); await pause();
      assert.deepEqual(await js("splitFixture.terminalCloses"), []);
      await prompt(); await click(".terminal-close-actions button:last-child");
      await until("!document.querySelector('.workbench-panel')");
      assert.deepEqual(await js("splitFixture.terminalCloses"), ["session-1"]);
      // Idle/exited terminals close without a prompt.
      await reset("terminal-only"); await js("splitFixture.terminalCloses=[]");
      await closeTerminal(); await js("splitFixture.resolveTerminalClose('idle')");
      await until("!document.querySelector('.workbench-panel')");
      assert.deepEqual(await js("splitFixture.terminalCloses"), ["session-1"]);
      // Late inspection results and open prompts cannot leak across workspace scopes.
      await reset("terminal-only"); await closeTerminal(); await reset("terminal-only");
      await js("splitFixture.terminalCloses=[];splitFixture.closeRequests=[];splitFixture.resolveTerminalClose('busy')"); await pause();
      assert.deepEqual(await names(), ["Terminal"]);
      assert.equal(await js("Boolean(document.querySelector('.terminal-close-dialog'))"), false);
      await prompt(); await reset("terminal-only"); await pause();
      assert.equal(await js("Boolean(document.querySelector('.terminal-close-dialog'))"), false);
      console.log("PASS 应用内终端关闭卡片：深浅色、紧凑布局、默认取消、Enter/Escape、焦点循环与恢复、取消保留进程及 DOM、确认关闭、空闲直关及旧请求隔离");
      assert.deepEqual(errors, []); console.log("PASS 无控制台错误"); app.exit(0);
    } catch (error) { console.error(error); console.error(errors.join("\n")); app.exit(1); }
  });
}
