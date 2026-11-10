/** 紧凑文件差异的初始定位与滚动：node apps/desktop/test/compact-diff-ui.mjs */
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
        import { streamedFileActivity } from './packages/agent/src/tool-stream';
        const context = Array.from({length: 6}, (_, i) => ' ' + (83 + i) + ' const unchanged = ' + 'long_context_'.repeat(14));
        const changes = Array.from({length: 28}, (_, i) => '+' + (89 + i) + ' const added = ' + i);
        function Fixture() {
          const [kind, setKind] = useState('add');
          const [streaming, setStreaming] = useState(false);
          const [extra, setExtra] = useState(0);
          const [statCase, setStatCase] = useState(null);
          const [syntaxCase, setSyntaxCase] = useState(null);
          const [numberCase, setNumberCase] = useState(null);
          window.setNumberCase = value => { setNumberCase(value); setExtra(0); };
          window.setNumberStage = stage => setNumberCase(value => ({...value, stage}));
          window.setSyntaxCase = value => { setSyntaxCase(value); setKind('stream'); setExtra(0); setStreaming(true); };
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
          const syntaxRows = syntaxCase?.path.endsWith('.css')
            ? ['-1 .old { color: red; }', '+1 .new { color: blue; }']
            : [...(syntaxCase?.name === 'write' ? [] : ['-1 const previous = "old";']), '+1 const current = "new";',
              ...Array.from({length: extra}, (_, i) => '+' + (2 + i) + ' const extra = ' + i)];
          const tool = {id: syntaxCase?.path ?? kind, name: syntaxCase?.name ?? (kind === 'new' ? 'write' : 'edit'), status: streaming ? 'running' : 'done', activity: {
            path: syntaxCase?.path ?? 'apps/example.txt', diff: (syntaxCase ? syntaxRows : rows).join('\\n'), ...(streaming ? {streaming: {added: rows.length, removed: 0}} : {}),
          }};
          const numberPreview = numberCase && streamedFileActivity(numberCase.name, JSON.stringify({
            path: 'apps/numbering.ts', content: Array.from({length: 32 + extra}, (_, i) => 'const line' + i + ' = ' + i).join('\\n'),
            edits: [
              {oldText: '', newText: Array.from({length: 32}, (_, i) => 'const line' + i + ' = ' + i).join('\\n')},
              {oldText: 'const timeout = 180000;', newText: 'const timeout = 60000;'},
              {oldText: 'const old = true;\\nconst previous = 1;', newText: 'const next = true;\\nconst current = 2;' + '\\nconst extra = 3;'.repeat(extra)},
            ],
          }));
          const numberTool = numberCase && {id: 'number-' + numberCase.display + numberCase.name, name: numberCase.name,
            status: numberCase.stage === 'done' || numberCase.stage === 'interrupted' ? 'done' : 'running',
            activity: numberCase.stage === 'stream' || numberCase.stage === 'interrupted' ? numberPreview
              : {path: 'apps/numbering.ts', diff: numberCase.diff ?? '-73 const previous = 1;\\n+73 const current = 2;\\n+74 const extra = 3;\\n 74 const tail = 4;'},
          };
          return <AppLocaleProvider locale="zh-CN"><div className="thinking-group-rail" style={{width: 620, margin: 24, '--tool-detail-height': '180px'}}>
            <ToolList key={numberCase ? 'number-' + numberCase.display + numberCase.name : statCase ? statCase.display + statCase.fold : syntaxCase?.path ?? kind}
              tools={numberTool ? [numberTool] : statCase ? Array.from({length: 3}, (_, i) => ({...tool, id: 'stat-' + i, status: 'done', activity: {path: 'apps/example' + i + '.txt', diff: '-1 old\\n+1 new'}})) : [tool]}
              display={numberCase?.display ?? statCase?.display ?? 'compact'} fold={numberCase ? 'none' : statCase?.fold ?? 'none'} />
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
      readStyles(join(here, "../src/renderer/styles.css")) +
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
    const evaluate = code => win.webContents.executeJavaScript(code).catch(error => {
      throw new Error(`Renderer evaluation failed: ${code}`, {cause: error});
    });
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
          // Explicitly collapse and reopen so details stay open after streaming finishes.
          await evaluate("document.querySelector('.tool-compact-detail-toggle').click()");
          await until("!document.querySelector('.tool-sheet-compact-diff')");
          await open();
          await evaluate("window.grow()");
          await until("document.querySelector('.tool-sheet-compact-diff')?.textContent.includes('extra = 9')");
          await until("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); return v.scrollHeight - v.clientHeight - v.scrollTop <= 1; })()");
          await evaluate("window.finish()");
          await until("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); const c = v?.querySelector('.add'); return c && Math.abs(c.getBoundingClientRect().top - v.getBoundingClientRect().top - 22) <= 1; })()");
          await checkAnchor();
        }
      }
      // Streaming diffs must tokenize both sides before the tool finishes, including newly received lines.
      const hasTokens = selector => `document.querySelector(${JSON.stringify(selector + ' .tool-code-text span[style*="--syntax-"]')})`;
      for (const syntaxCase of [
        {path: 'apps/stream-edit.mjs', name: 'edit'},
        {path: 'apps/stream-write.ts', name: 'write'},
        {path: 'apps/stream-style.css', name: 'edit'},
      ]) {
        await evaluate(`window.setSyntaxCase(${JSON.stringify(syntaxCase)})`);
        await until(`document.querySelector('.tool-compact-name').textContent === ${JSON.stringify(syntaxCase.path.split('/').pop())} && document.querySelector('.tool-sheet-compact-diff')`);
        await until(hasTokens('.tool-diff-line.add'));
        if (syntaxCase.name === 'edit') await until(hasTokens('.tool-diff-line.del'));
        assert.ok(await evaluate("!!document.querySelector('.tool-compact-item .compact.is-running')"), 'Highlighting must be visible while still streaming');
        // Explicitly reopen so details stay open after completion.
        await evaluate("document.querySelector('.tool-compact-detail-toggle').click()");
        await until("!document.querySelector('.tool-sheet-compact-diff')");
        await evaluate("document.querySelector('.tool-compact-detail-toggle').click()");
        await until("document.querySelector('.tool-sheet-compact-diff')");
        if (!syntaxCase.path.endsWith('.css')) {
          await evaluate('window.grow()');
          await until("document.querySelector('.tool-diff-line:last-child .tool-code-text').textContent === 'const extra = 9'");
          await until(hasTokens('.tool-diff-line:last-child'));
          assert.ok(await evaluate("Array.from(document.querySelectorAll('.tool-diff-line:last-child .tool-code-text span')).some(el => el.textContent === '9' && el.style.color === 'var(--syntax-number)')"), 'New streamed content must receive syntax colors');
        }
        await evaluate('window.finish()');
        await until("!!document.querySelector('.tool-compact-item .compact.is-done')");
        await until(hasTokens('.tool-diff-line.add'));
      }
      await evaluate("window.setSyntaxCase({path: 'apps/stream-plain.txt', name: 'edit'})");
      await until("document.querySelector('.tool-compact-name').textContent === 'stream-plain.txt' && document.querySelector('.tool-diff-line.add .tool-code-text')?.textContent === 'const current = \"new\";'");
      assert.equal(await evaluate("document.querySelectorAll('.tool-code-text span').length"), 0, 'Unsupported languages must remain readable plain text');
      // Streamed edit fragments restart at 1: never present those offsets as file line numbers.
      const gutters = () => evaluate("Array.from(document.querySelectorAll('.tool-diff-line .tool-gutter'), el => el.textContent.trim())");
      const checkNumberPreview = async name => {
        const values = await gutters();
        assert.ok(values.length >= 32, 'All replacement fragments must remain visible');
        if (name === 'edit') {
          assert.ok(values.every(value => value === '+' || value === '−'), 'Edit previews keep signs without invented file positions');
          assert.ok(await evaluate("Array.from(document.querySelectorAll('.tool-code-text'), el => el.textContent).includes('const timeout = 60000;')"), 'Hiding numbers must not remove code');
        } else {
          assert.equal(values[0], '+1', 'New files have known line numbers during streaming');
          assert.ok(values.includes('+32'));
        }
      };
      for (const display of ['compact', 'card']) {
        for (const name of ['edit', 'write']) {
          await evaluate(`window.setNumberCase(${JSON.stringify({display, name, stage: 'stream'})})`);
          await until("document.querySelector('.tool-compact-name, .tool-card-name')?.textContent === 'numbering.ts'");
          if (!await evaluate("!!document.querySelector('.tool-diff-line')")) {
            await evaluate(`document.querySelector(${JSON.stringify(display === 'compact' ? '.tool-compact-detail-toggle' : '.tool-card-head')}).click()`);
          }
          await until("document.querySelectorAll('.tool-diff-line').length >= 32");
          await checkNumberPreview(name);
          if (display === 'compact') {
            // Pin auto-opened details so the interrupted/finished preview remains visible.
            await evaluate("document.querySelector('.tool-compact-detail-toggle').click()");
            await until("!document.querySelector('.tool-diff-line')");
            await evaluate("document.querySelector('.tool-compact-detail-toggle').click()");
            await until("document.querySelector('.tool-diff-line')");
          }
          const previousCount = (await gutters()).length;
          await evaluate('window.grow()');
          await until(`document.querySelectorAll('.tool-diff-line').length > ${previousCount}`);
          await checkNumberPreview(name);
          await evaluate("window.setNumberStage('interrupted')");
          await until("document.querySelector('.tool-compact-item .compact.is-done, .tool-card.is-done')");
          await checkNumberPreview(name);
          await evaluate("window.setNumberStage('executing')");
          await until("document.querySelectorAll('.tool-diff-line').length === 4");
          assert.deepEqual(await gutters(), ['−73', '+73', '+74', '75'], 'Real diff positions appear as soon as the tool supplies them, with post-edit context numbers');
          await evaluate("window.setNumberStage('done')");
          await until("document.querySelector('.tool-compact-item .compact.is-done, .tool-card.is-done')");
          assert.deepEqual(await gutters(), ['−73', '+73', '+74', '75']);
          if (name === 'edit') {
            await evaluate(`window.setNumberCase(${JSON.stringify({display, name, stage: 'done', diff: ' 10 start\n-11 one\n-12 two\n+11 replacement\n 13 tail\n    ...\n 50 far\n+50 inserted\n+51 second\n 51 end'})})`);
            await until("document.querySelectorAll('.tool-diff-line').length === 9");
            assert.deepEqual(await gutters(), ['10', '−11', '−12', '+11', '12', '49', '+50', '+51', '52']);
          }
        }
      }
      await evaluate('window.setNumberCase(null)');
      await until("document.querySelector('.tool-compact-name')?.textContent === 'stream-plain.txt'");
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
      console.log("Compact diff UI: diff anchoring, scrolling, streaming syntax highlighting, edit/write numbering (compact/card, growth, interruption, execution, completion) and row-only stat hover (compact/card, grouped/ungrouped) passed");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
