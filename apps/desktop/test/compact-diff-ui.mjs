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
        const context = Array.from({length: 12}, (_, i) => ' ' + (77 + i) + ' const unchanged = ' + 'long_context_'.repeat(14));
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
      assert.ok(Math.abs(state.changeTop - 23) <= 1, JSON.stringify(state));
      assert.equal(state.height, 180);
      assert.equal(state.pageTop, 0, "Only the diff viewport should scroll");
      return state;
    };
    try {
      await win.loadFile(join(process.env.VELA_COMPACT_DIFF_TEMP, "index.html"));
      await until("document.querySelector('.tool-compact-detail-toggle')");
      await open();
      await checkAnchor();
      // 行号列向下多伸 1px 只用于盖住相邻行之间的缝;紧挨分隔带的行不能伸出,否则分隔线左侧比右侧细。
      const reach = await evaluate(`(() => {
        const line = document.querySelector('.tool-diff-line');
        const bottoms = () => ({gutter: line.querySelector('.tool-gutter').getBoundingClientRect().bottom, row: line.getBoundingClientRect().bottom});
        const between = bottoms();
        const gap = document.createElement('div'); gap.className = 'tool-diff-gap is-compact'; line.after(gap);
        const beforeGap = bottoms(); gap.remove();
        return {between, beforeGap};
      })()`);
      assert.ok(Math.abs(reach.between.gutter - reach.between.row - 1) < 0.01, 'Gutters overlap the next row by 1px to hide seams: ' + JSON.stringify(reach));
      assert.ok(Math.abs(reach.beforeGap.gutter - reach.beforeGap.row) < 0.01, 'A row followed by a gap band must not let its gutter cover the band: ' + JSON.stringify(reach));
      // 一次手势只沿一个方向滚动:上下滚时左右偏移不带动横向滚动,横向滚时同理;每个事件都由脚本接管(见 wheel-axis.ts)。
      const wheel = (dx, dy) => evaluate(`(() => {
        const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport');
        const e = new WheelEvent('wheel', {deltaX: ${dx}, deltaY: ${dy}, bubbles: true, cancelable: true});
        v.dispatchEvent(e);
        return {prevented: e.defaultPrevented, top: v.scrollTop, left: v.scrollLeft, wide: v.scrollWidth > v.clientWidth, tall: v.scrollHeight > v.clientHeight};
      })()`);
      const before = await wheel(0, 0);
      assert.ok(before.wide && before.tall, 'Fixture must overflow on both axes: ' + JSON.stringify(before));
      const vertical = await wheel(6, 40);
      assert.ok(vertical.prevented && vertical.top === before.top + 40 && vertical.left === 0, 'Vertical gesture ignores sideways drift: ' + JSON.stringify(vertical));
      
      const single = await wheel(0, 20);
      assert.ok(single.prevented && single.top === vertical.top + 20 && single.left === 0, 'Even pure single-axis events are handled, so a latched native scroll cannot pick up drift: ' + JSON.stringify(single));
      const drift = await wheel(-30, 2);
      assert.ok(drift.left === 0 && drift.top === single.top + 2, 'Drift later in the same gesture stays locked to vertical: ' + JSON.stringify(drift));
      await new Promise(done => setTimeout(done, 250));
      const horizontal = await wheel(40, 6);
      assert.ok(horizontal.prevented && horizontal.left === 40 && horizontal.top === drift.top, 'Horizontal gesture ignores vertical drift: ' + JSON.stringify(horizontal));
      await evaluate("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); v.scrollLeft = 0; v.scrollTop -= 62; })()");
      await checkAnchor();
      // 手势开始前已在顶部/底部,继续往外滚才按由内到外的顺序带动外层容器(先工具序列容器,它到头再带动最外层)。
      const anchoredTop = await evaluate("document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop");
      await evaluate(`(() => {
        const root = document.getElementById('root');
        root.style.cssText = 'height: 260px; overflow-y: auto';
        const rail = root.firstElementChild;
        const mid = document.createElement('div');
        mid.id = 'wheel-mid'; mid.style.cssText = 'height: 200px; overflow-y: auto';
        root.prepend(mid); mid.append(rail);
        const spacer = document.createElement('div');
        spacer.id = 'wheel-spacer'; spacer.style.height = '900px';
        root.append(spacer);
        const v = rail.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport');
        v.scrollTop = v.scrollHeight;
      })()`);
      const scrolled = async () => { await new Promise(done => setTimeout(done, 1000)); return evaluate("({mid: document.getElementById('wheel-mid').scrollTop, root: document.getElementById('root').scrollTop, midMax: document.getElementById('wheel-mid').scrollHeight - document.getElementById('wheel-mid').clientHeight})"); };
      assert.ok(await evaluate("(() => { const m = document.getElementById('wheel-mid'); return m.scrollHeight > m.clientHeight + 20 && document.getElementById('root').scrollHeight > document.getElementById('root').clientHeight + 100; })()"), 'Both outer containers must be scrollable for this check');
      // 弹性滚动(实验性)默认关闭,它只控制皮筋空白,不影响带动外层的规则:
      // 手势开始前已在底部、继续往下滚照样带动外层;中途才滚到底的手势不带动外层,也没有皮筋。
      const elasticPullOffset = () => evaluate("(() => { const t = getComputedStyle(document.querySelector('.compact-diff-scroll-content')).transform; return t === 'none' ? 0 : 1; })()");
      const resetOuter = () => evaluate("(() => { document.getElementById('wheel-mid').scrollTop = 0; document.getElementById('root').scrollTop = 0; })()");
      for (const mode of [undefined, 'false']) {
        await evaluate(mode === undefined ? 'delete document.documentElement.dataset.elasticScroll' : "document.documentElement.dataset.elasticScroll = 'false'");
        await resetOuter();
        await evaluate("document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = 1e6");
        await new Promise(done => setTimeout(done, 250));
        for (let i = 0; i < 3; i += 1) await wheel(0, 60);
        const chainedOff = await scrolled();
        assert.ok(chainedOff.mid > 0, 'With elastic scrolling off, a gesture that starts at the bottom still drives the outer container: ' + JSON.stringify(chainedOff));
        await resetOuter();
        const offMax = (await evaluate("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); return v.scrollHeight - v.clientHeight; })()"));
        await evaluate(`document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = ${offMax - 20}`);
        await new Promise(done => setTimeout(done, 250));
        await wheel(0, 15); await wheel(0, 60); await wheel(0, 60);
        assert.equal(await elasticPullOffset(), 0, 'With elastic scrolling off there is no rubber band');
        const midOff = await scrolled();
        assert.ok(midOff.mid === 0 && midOff.root === 0, 'A gesture that reaches the bottom mid-way still must not drive the outer container: ' + JSON.stringify(midOff));
        await evaluate(`document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = ${offMax}`);
        await new Promise(done => setTimeout(done, 250));
        await wheel(0, -30);
        const upOff = await scrolled();
        assert.ok(upOff.mid === 0 && upOff.root === 0, 'Scrolling up at the bottom only scrolls the diff: ' + JSON.stringify(upOff));
        await new Promise(done => setTimeout(done, 250));
      }
      await evaluate("document.documentElement.dataset.elasticScroll = 'true'");
      // 手势在内容中间开始、中途才滚到底:到头后的位移(含惯性)不带动外层。
      const viewportState = () => evaluate("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); return {top: v.scrollTop, max: v.scrollHeight - v.clientHeight}; })()");
      const diffBottom = (await viewportState()).max;
      await evaluate(`document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = ${diffBottom - 20}`);
      await new Promise(done => setTimeout(done, 250));
      await wheel(0, 15);
      await wheel(0, 40);
      await wheel(0, 40);
      // 不允许带动外层时,内容被拉离边缘露出空白,松手后弹回。
      const pullOffset = () => evaluate("(() => { const t = getComputedStyle(document.querySelector('.compact-diff-scroll-content')).transform; return t === 'none' ? 0 : Number(t.match(/matrix\\(([^)]+)\\)/)[1].split(',')[5]); })()");
      assert.ok(await pullOffset() < -2, 'Overscroll past the bottom pulls the content up, leaving a blank band');
      const edgeKind = (last) => evaluate(`(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); const sheet = v.querySelector('.tool-sheet'); const row = sheet.${last ? 'lastElementChild' : 'firstElementChild'}; return {edge: v.dataset.pullEdge, row: row.classList.contains('add') ? 'add' : row.classList.contains('del') ? 'del' : 'ctx', background: getComputedStyle(v).backgroundImage}; })()`);
      const bottomEdge = await edgeKind(true);
      assert.ok(bottomEdge.edge === bottomEdge.row && bottomEdge.background.includes('gradient'), 'The blank band at the bottom takes the colour of the last row: ' + JSON.stringify(bottomEdge));
      // 滚动持续时空白保持并越拉越开,不会定时缩回。
      const firstPull = await pullOffset();
      assert.ok(Number.isInteger(firstPull), 'The pull offset is a whole pixel, fractional offsets leave white seams between rows: ' + firstPull);
      for (let i = 0; i < 12; i += 1) { await wheel(0, 20); await new Promise(done => setTimeout(done, 40)); }
      const heldPull = await pullOffset();
      assert.ok(heldPull < firstPull - 2, 'The blank band keeps widening while the user keeps scrolling: ' + JSON.stringify({firstPull, heldPull}));
      for (let i = 0; i < 40; i += 1) await wheel(0, 120);
      const maxPull = await pullOffset();
      assert.ok(maxPull < heldPull && maxPull >= -12.5, 'The blank band is capped at 12px however hard the user pulls: ' + maxPull);
      // 弹回途中每一帧也都是整数像素。
      await new Promise(done => setTimeout(done, 500));
      const returning = [];
      for (let i = 0; i < 6; i += 1) { returning.push(await pullOffset()); await new Promise(done => setTimeout(done, 25)); }
      assert.ok(returning.every(Number.isInteger), 'The spring-back also moves in whole pixels: ' + JSON.stringify(returning));
      const midGesture = await scrolled();
      assert.ok(Math.abs(await pullOffset()) < 0.5, 'The pulled content springs back after release');
      assert.ok(midGesture.mid === 0 && midGesture.root === 0, 'A gesture that reaches the bottom mid-way must not drive outer containers: ' + JSON.stringify(midGesture));
      // 顶部同理:中途滚到顶后继续往上,内容被往下拉出空白。
      await evaluate("document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = 20");
      await new Promise(done => setTimeout(done, 250));
      await wheel(0, -15);
      await wheel(0, -40);
      await wheel(0, -40);
      assert.ok(await pullOffset() > 2, 'Overscroll past the top pulls the content down');
      const topEdge = await edgeKind(false);
      assert.ok(topEdge.edge === topEdge.row, 'The blank band at the top takes the colour of the first row: ' + JSON.stringify(topEdge));
      await scrolled();
      assert.ok(Math.abs(await pullOffset()) < 0.5, 'Top pull also springs back');
      await new Promise(done => setTimeout(done, 200));
      assert.equal(await evaluate("document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').dataset.pullEdge ?? null"), null, 'The edge colour is removed once the band has sprung back');
      await evaluate(`document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = ${diffBottom}`);
      await new Promise(done => setTimeout(done, 250));
      // 已在底部时往上滚:只是内部往上滚,外层不动。
      await new Promise(done => setTimeout(done, 250));
      const upFromBottom = await wheel(0, -30);
      const afterUp = await scrolled();
      assert.ok(upFromBottom.top === diffBottom - 30 && afterUp.mid === 0 && afterUp.root === 0, 'Scrolling up while at the bottom only scrolls the diff: ' + JSON.stringify({upFromBottom, afterUp}));
      // 在底部先往上滚、同一手势里再折返往下回到底:不算「从边缘出发继续往外滚」,不带动外层。
      await evaluate(`document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = ${diffBottom}`);
      await new Promise(done => setTimeout(done, 250));
      await wheel(0, -30);
      await wheel(0, 60);
      await wheel(0, 40);
      const reversed = await scrolled();
      assert.ok(reversed.mid === 0 && reversed.root === 0, 'Up then back down in one gesture must not drive outer containers: ' + JSON.stringify(reversed));
      await evaluate(`document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = ${diffBottom}`);
      // 手势开始前已经在底部,继续往下滚才带动外层。
      await new Promise(done => setTimeout(done, 250));
      await wheel(0, 30);
      const first = await scrolled();
      assert.ok(first.mid > 0 && first.root === 0, 'First overscroll drives the nearest outer container only: ' + JSON.stringify(first));
      for (let i = 0; i < 6; i += 1) await wheel(0, 40);
      const chained = await scrolled();
      assert.ok(chained.mid === chained.midMax && chained.root > 0, 'Once that container is at its end the next outer one scrolls: ' + JSON.stringify(chained));
      // 回到顶部再往上滚,同样向外传递。
      await evaluate("(() => { document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = 0; })()");
      await new Promise(done => setTimeout(done, 250));
      await wheel(0, -40);
      const upward = await scrolled();
      assert.ok(upward.mid < chained.mid || upward.root < chained.root, 'Overscroll at the diff top also chains outward: ' + JSON.stringify({chained, upward}));
      await evaluate(`(() => {
        const root = document.getElementById('root');
        const mid = document.getElementById('wheel-mid');
        root.prepend(mid.firstElementChild); mid.remove();
        document.getElementById('wheel-spacer').remove(); root.style.cssText = '';
        delete document.documentElement.dataset.elasticScroll;
        document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').scrollTop = ${anchoredTop};
      })()`);
      // 真实输入管线:触控板手势只有第一个滚轮事件可取消,先纯纵向、后带横向偏移的手势不能把横向带动。
      const viewportCenter = await evaluate("(() => { const r = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport').getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}; })()");
      const position = () => evaluate("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); return {top: v.scrollTop, left: v.scrollLeft}; })()");
      const sendWheel = async (deltaX, deltaY, phase) => {
        win.webContents.sendInputEvent({type: 'mouseWheel', ...viewportCenter, deltaX, deltaY, wheelTicksX: 0, wheelTicksY: 0, phase, hasPreciseScrollingDeltas: true, canScroll: true});
        await new Promise(done => setTimeout(done, 16));
      };
      await new Promise(done => setTimeout(done, 250));
      const nativeStart = await position();
      await sendWheel(0, -12, 'began');
      for (const [dx, dy] of [[-6, -14], [-9, -16], [-5, -12], [-7, -10]]) await sendWheel(dx, dy, 'changed');
      await sendWheel(0, 0, 'ended');
      await new Promise(done => setTimeout(done, 200));
      const nativeEnd = await position();
      assert.equal(nativeEnd.left, nativeStart.left, 'Real wheel gesture: sideways drift after a vertical start must not scroll horizontally: ' + JSON.stringify({nativeStart, nativeEnd}));
      assert.notEqual(nativeEnd.top, nativeStart.top, 'Real wheel gesture still scrolls vertically: ' + JSON.stringify({nativeStart, nativeEnd}));
      await new Promise(done => setTimeout(done, 250));
      const sideStart = await position();
      await sendWheel(-14, 0, 'began');
      for (const [dx, dy] of [[-16, -5], [-14, -7], [-12, -4]]) await sendWheel(dx, dy, 'changed');
      await sendWheel(0, 0, 'ended');
      await new Promise(done => setTimeout(done, 200));
      const sideEnd = await position();
      assert.equal(sideEnd.top, sideStart.top, 'Real wheel gesture: vertical drift after a horizontal start must not scroll vertically: ' + JSON.stringify({sideStart, sideEnd}));
      assert.notEqual(sideEnd.left, sideStart.left, 'Real horizontal gesture still scrolls horizontally: ' + JSON.stringify({sideStart, sideEnd}));
      await evaluate(`(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); v.scrollLeft = 0; v.scrollTop = ${nativeStart.top}; })()`);
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
          await until("(() => { const v = document.querySelector('.compact-diff-scroll-shell .thinking-scroll-viewport'); const c = v?.querySelector('.add'); return c && Math.abs(c.getBoundingClientRect().top - v.getBoundingClientRect().top - 23) <= 1; })()");
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
      assert.equal(await evaluate("document.querySelectorAll('.tool-code-text span:not(.tool-diff-word)').length"), 0, 'Unsupported languages must remain readable plain text');
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
      assert.equal(added, 'rgb(0, 162, 64)', 'Added statistics use #00A240');
      assert.equal(removed, 'rgb(224, 46, 42)', 'Deleted statistics use #E02E2A');
      for (const theme of ['', 'paper', 'celadon', 'lilac', 'blossom', 'graphite', 'ember', 'forest', 'tide']) {
        for (const scheme of ['light', 'dark']) {
          await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.dataset.scheme = ${JSON.stringify(scheme)}`);
          for (const [kind, foreground] of [['add', '#00a240'], ['del', '#e02e2a']]) {
            const actual = await evaluate(`(() => {
              const line = document.querySelector('.tool-diff-line.${kind}');
              const gutter = line.querySelector('.tool-gutter');
              const surface = getComputedStyle(line.closest('.tool-sheet')).backgroundColor;
              return {background: getComputedStyle(line).backgroundColor,
                text: getComputedStyle(line.querySelector('.tool-code-text')).color,
                gutterText: getComputedStyle(gutter).color, gutterBackground: getComputedStyle(gutter).backgroundColor,
                stripe: getComputedStyle(gutter).boxShadow, divider: getComputedStyle(gutter).borderRightColor + ' ' + getComputedStyle(gutter).borderRightWidth, surface};
            })()`);
            const expected = {
              background: await resolvedColor('color-mix(in srgb, ' + foreground + ' 7%, transparent)'),
              text: await resolvedColor('var(--text-primary)'), gutterText: await resolvedColor(foreground),
              gutterBackground: await resolvedColor('color-mix(in srgb, ' + foreground + ' 15%, ' + actual.surface + ')'),
            };
            assert.deepEqual({background: actual.background, text: actual.text, gutterText: actual.gutterText, gutterBackground: actual.gutterBackground}, expected,
              `${theme || 'default'}/${scheme}/${kind}: 7% line tint, 15% opaque gutter with colored numbers, neutral code text`);
            assert.equal(actual.divider, actual.surface + ' 3px', `${theme || 'default'}/${scheme}/${kind}: divider is a card-surface block, not a grey line`);
            assert.ok(actual.stripe.startsWith(await resolvedColor(foreground)) && actual.stripe.includes('inset'), `${theme || 'default'}/${scheme}/${kind}: gutter keeps the 3px stripe: ${actual.stripe}`);
          }
        }
      }
      await evaluate("delete document.documentElement.dataset.theme; document.documentElement.dataset.scheme = 'light'");
      // Diff filenames stay regular-weight; only hovering the name adds emphasis.
      for (const name of ['edit', 'write']) {
        await evaluate(`window.setNumberCase(${JSON.stringify({display: 'compact', name, stage: 'stream'})})`);
        await until("document.querySelector('.compact-diff-card-name')");
        const {root} = await protocol('DOM.getDocument');
        const {nodeId} = await protocol('DOM.querySelector', {nodeId: root.nodeId, selector: '.compact-diff-card-name'});
        const {nodeId: headerId} = await protocol('DOM.querySelector', {nodeId: root.nodeId, selector: '.compact-diff-card-head'});
        const nameStyle = () => evaluate(`(() => {
          const style = getComputedStyle(document.querySelector('.compact-diff-card-name'));
          return {color: style.color, weight: style.fontWeight, decoration: style.textDecorationLine};
        })()`);
        for (const scheme of ['light', 'dark']) {
          await evaluate(`document.documentElement.dataset.scheme = ${JSON.stringify(scheme)}`);
          const idle = {color: await resolvedColor('var(--text-muted)'), weight: '400', decoration: 'none'};
          assert.deepEqual(await nameStyle(), idle, `${name}/${scheme}: muted regular filename by default`);
          await protocol('CSS.forcePseudoState', {nodeId: headerId, forcedPseudoClasses: ['hover']});
          assert.deepEqual(await nameStyle(), idle, 'Header hover must not emphasize the filename');
          await protocol('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: ['hover']});
          assert.deepEqual(await nameStyle(), {color: await resolvedColor('var(--text-primary)'), weight: '400', decoration: 'underline'}, `${name}/${scheme}: filename hover adds color and underline without bold`);
          await protocol('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: []});
          assert.deepEqual(await nameStyle(), idle, 'Filename returns to muted regular text after leaving');
          await protocol('CSS.forcePseudoState', {nodeId: headerId, forcedPseudoClasses: []});
        }
      }
      await evaluate("document.documentElement.dataset.scheme = 'light'; window.setNumberCase(null)");
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
      console.log("Compact diff UI: diff anchoring, scrolling, streaming syntax highlighting, edit/write numbering (compact/card, growth, interruption, execution, completion) diff palette (all themes, light/dark) and filename hover (compact, light/dark) and row-only stat hover (compact/card, grouped/ungrouped) passed");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
