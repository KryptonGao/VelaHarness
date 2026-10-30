/** 紧凑文件差异的初始定位与滚动：node apps/desktop/test/compact-diff-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-compact-diff-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { ToolList } from './apps/desktop/src/renderer/components/ToolCard';
        import { AppLocaleProvider } from './apps/desktop/src/renderer/locale';
        const context = Array.from({length: 6}, (_, i) => ' ' + (83 + i) + ' const unchanged = ' + 'long_context_'.repeat(14));
        const changes = Array.from({length: 28}, (_, i) => '+' + (89 + i) + ' const added = ' + i);
        function Fixture() {
          const [kind, setKind] = useState('add');
          const [streaming, setStreaming] = useState(false);
          const [extra, setExtra] = useState(0);
          const [statCase, setStatCase] = useState(null);
          window.setStatCase = setStatCase;
          const [, refresh] = useState(0);
          window.setCase = kind => { setKind(kind); setExtra(0); setStreaming(kind === 'stream'); };
          window.grow = () => setExtra(value => value + 10);
          window.finish = () => setStreaming(false);
          window.refresh = () => refresh(value => value + 1);
          const rows = kind === 'new' ? changes : kind === 'context' ? context : [
            ...context, ...(kind === 'del' ? ['-89 const removed = true'] : []), ...changes,
            ...Array.from({length: extra}, (_, i) => '+' + (117 + i) + ' const extra = ' + i),
          ];
          const tool = {id: kind, name: kind === 'new' ? 'write' : 'edit', status: streaming ? 'running' : 'done', activity: {
            path: 'apps/example.txt', diff: rows.join('\\n'), ...(streaming ? {streaming: {added: rows.length, removed: 0}} : {}),
          }};
          return <AppLocaleProvider locale="zh-CN"><div className="thinking-group-rail" style={{width: 620, margin: 24, '--tool-detail-height': '180px'}}>
            <ToolList key={statCase ? statCase.display + statCase.fold : kind}
              tools={statCase ? Array.from({length: 3}, (_, i) => ({...tool, id: 'stat-' + i, status: 'done', activity: {path: 'apps/example' + i + '.txt', diff: '-1 old\\n+1 new'}})) : [tool]}
              display={statCase?.display ?? 'compact'} fold={statCase?.fold ?? 'none'} />
          </div></AppLocaleProvider>;
        }
        createRoot(document.getElementById('root')).render(<Fixture />);
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
      logLevel: "error",
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><style>' +
      readFileSync(join(here, "../src/renderer/styles.css"), "utf8") +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_COMPACT_DIFF_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Compact diff UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_COMPACT_DIFF_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 760, height: 640,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`Timed out: ${code}`);
    };
    const snapshot = () => evaluate(`(() => {
      const viewport = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport');
      const change = viewport.querySelector('.tool-diff-line.add, .tool-diff-line.del');
      return {top: viewport.scrollTop, height: viewport.clientHeight, total: viewport.scrollHeight,
        changeTop: change ? change.getBoundingClientRect().top - viewport.getBoundingClientRect().top : null,
        first: change?.className, pageTop: window.scrollY};
    })()`);
    const open = async () => {
      await evaluate("document.querySelector('.tool-compact-detail-toggle').click()");
      await until("document.querySelector('.tool-compact-item.open .tool-sheet-compact-diff')");
      await until("document.querySelector('.tool-collapse-inner').getBoundingClientRect().height >= 180");
    };
    const checkAnchor = async () => {
      const state = await snapshot();
      assert.ok(Math.abs(state.changeTop - 22) <= 1, JSON.stringify(state));
      assert.equal(state.height, 180);
      assert.equal(state.pageTop, 0, "Only the diff viewport should scroll");
      return state;
    };
    try {
      await win.loadFile(join(process.env.VELA_COMPACT_DIFF_TEMP, "index.html"));
      await until("document.querySelector('.tool-compact-detail-toggle')");
      await open();
      await checkAnchor();
      if (process.env.VELA_COMPACT_DIFF_SCREENSHOT) {
        const image = await win.webContents.capturePage();
        writeFileSync(process.env.VELA_COMPACT_DIFF_SCREENSHOT, image.toPNG());
      }
      await evaluate("document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = 0; window.refresh()");
      await new Promise(done => setTimeout(done, 100));
      assert.equal((await snapshot()).top, 0, "Rerenders must preserve manual scrolling to earlier context");
      await evaluate("document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = 99999");
      const bottom = await snapshot();
      assert.ok(Math.abs(bottom.top + bottom.height - bottom.total) <= 1);
      await evaluate("document.querySelector('.tool-compact-detail-toggle').click()");
      await until("!document.querySelector('.tool-sheet-compact-diff')");
      await open();
      await checkAnchor();
      for (const kind of ["del", "new", "context", "stream"]) {
        await evaluate(`window.setCase(${JSON.stringify(kind)})`);
        await until(`document.querySelector('.tool-compact-name').textContent === 'example.txt' && ${kind === "stream" ? "document.querySelector('.tool-sheet-compact-diff')" : "!document.querySelector('.tool-sheet-compact-diff')"}`);
        if (kind !== "stream") await open();
        if (kind === "del") assert.ok((await checkAnchor()).first.includes("del"));
        if (kind === "new" || kind === "context") assert.equal((await snapshot()).top, 0);
        if (kind === "stream") {
          // 用户显式保持展开后，流式结束仍显示详情。
          await evaluate("document.querySelector('.tool-compact-detail-toggle').click()");
          await evaluate("window.grow()");
          await until("document.querySelector('.tool-sheet-compact-diff').textContent.includes('extra = 9')");
          await until("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); return v.scrollHeight - v.clientHeight - v.scrollTop <= 1; })()");
          await evaluate("window.finish()");
          await until("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); const c = v?.querySelector('.add'); return c && Math.abs(c.getBoundingClientRect().top - v.getBoundingClientRect().top - 22) <= 1; })()");
          await checkAnchor();
        }
      }
      // 在真实 Chromium 中强制行级 hover，验证移出恢复及相邻行隔离。
      win.webContents.debugger.attach('1.3');
      const protocol = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
      await protocol('DOM.enable');
      await protocol('CSS.enable');
      const colors = selector => evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.tool-stat-add, .tool-stat-del'), el => getComputedStyle(el).color)`);
      const muted = await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim()");
      // 用浏览器解析颜色，兼容 token 的 hex/rgb 表示形式。
      const resolvedColor = value => evaluate(`(() => { const el = document.createElement('span'); el.style.color = ${JSON.stringify(value)}; document.body.append(el); const color = getComputedStyle(el).color; el.remove(); return color; })()`);
      const neutral = await resolvedColor(muted);
      const added = await resolvedColor('var(--diff-stat-add-fg)');
      const removed = await resolvedColor('var(--diff-stat-del-fg)');
      for (const display of ['compact', 'card']) {
        for (const fold of ['none', 'message']) {
          await evaluate(`window.setStatCase(${JSON.stringify({display, fold})})`);
          const row = display === 'compact' ? (fold === 'none' ? '.tool-compact-line' : '.tool-compact-summary') : (fold === 'none' ? '.tool-card-head' : '.tool-run-head');
          await until(`document.querySelectorAll(${JSON.stringify(row)}).length === ${fold === 'none' ? 3 : 1}`);
          const first = row + ':first-of-type';
          assert.deepEqual(await colors(first), [neutral, neutral], `${display}/${fold}: neutral by default`);
          const {root} = await protocol('DOM.getDocument');
          const {nodeId} = await protocol('DOM.querySelector', {nodeId: root.nodeId, selector: first});
          await protocol('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: ['hover']});
          assert.deepEqual(await colors(first), [added, removed], `${display}/${fold}: colored on row hover`);
          if (fold === 'none') {
            const allColors = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(row)}), row => Array.from(row.querySelectorAll('.tool-stat-add, .tool-stat-del'), el => getComputedStyle(el).color))`);
            assert.deepEqual(allColors.slice(1), [[neutral, neutral], [neutral, neutral]], 'Neighboring rows must remain neutral');
          } else {
            await protocol('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: []});
            assert.deepEqual(await colors(first), [neutral, neutral], `${display}/${fold}: neutral after leaving row`);
            await protocol('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: ['hover']});
            await evaluate(`document.querySelector(${JSON.stringify(row)}).click()`);
            const childRow = display === 'compact' ? '.tool-compact-line' : '.tool-card-head';
            await until(`document.querySelector(${JSON.stringify(childRow)})`);
            assert.deepEqual(await colors(childRow), [neutral, neutral], 'Expanded child rows must not inherit summary hover colors');
          }
          await protocol('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: []});
          if (fold === 'none') assert.deepEqual(await colors(first), [neutral, neutral], `${display}/${fold}: neutral after leaving row`);
        }
      }
      win.webContents.debugger.detach();
      console.log("Compact diff UI: diff anchoring, scrolling, streaming and row-only stat hover (compact/card, grouped/ungrouped) passed");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
