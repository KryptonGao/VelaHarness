/** 展开箭头与文件摘要的字体、布局、hover 配色和新建标记：真实 Electron 检查。 */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-expand-chevron-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { ToolList } from './apps/desktop/src/renderer/components/ToolCard';
        import { Thinking, CoherentThought } from './apps/desktop/src/renderer/components/Thinking';
        import { AgentPane } from './apps/desktop/src/renderer/components/AgentPane';
        import { ThinkingGroupModeContext, ThinkingModelCatalogContext } from './apps/desktop/src/renderer/components/ThinkingGroupModeContext';
        import { ThinkingSummaryContext } from './apps/desktop/src/renderer/components/ThinkingSummaryContext';
        import { AppLocaleProvider } from './apps/desktop/src/renderer/locale';
        window.addEventListener('error', event => console.error(event.error?.stack ?? event.message));
        const root = createRoot(document.getElementById('root'));
        let revision = 0;
        const tool = (name, activity = {}) => ({id: name, name, status: 'done', activity});
        const bash = tool('bash', {command: 'git status --short', body: 'clean'});
        const tools = {
          command: [bash],
          group: [bash, {...bash, id: 'second'}],
          diff: [tool('edit', {path: 'src/components/fixture.ts', diff: '-1 old\\n+1 new'})],
          created: [tool('write', {path: 'src/components/created.ts', diff: '+1 new'})],
          createdRoot: [tool('write', {path: 'created.ts', diff: '+1 new'})],
          failedWrite: [{...tool('write', {path: 'failed.ts', diff: '+1 new'}), status: 'error'}],
          streaming: [tool('edit', {path: 'fixture.ts', diff: '+1 new', streaming: {added: 1, removed: 0}})],
          browser: [tool('browser_repl', {command: 'nodeRepl.write(1)', body: '1'})],
          agent: [tool('spawn_agent', {body: 'Agent report'})],
          generic: [tool('fixture_tool', {body: 'Result details'})],
        };
        tools.streaming[0].status = 'running';
        window.renderCase = (name, scheme, display = 'compact') => {
          document.documentElement.dataset.scheme = scheme;
          const summary = {enabled: true, style: 'prose', get: () => name === 'deepseekMissing' ? undefined : ({status: 'done', text: 'Summary text.'}), request: () => {}};
          const thought = <CoherentThought text={'**Review changes**\\n\\nThinking body.'} active={false} expanded={false} />;
          const raw = Array.from({length: 100}, (_, i) => 'Raw reasoning paragraph ' + i + '.').join('\\n\\n');
          const modelCase = ['deepseek', 'deepseekMissing', 'gpt', 'gptRaw', 'legacy', 'mixed', 'gptName', 'gptNameSingle', 'idContainsGpt', 'oModel', 'otherProvider'].includes(name);
          const model = ['gptName', 'gptNameSingle', 'otherProvider'].includes(name) ? 'custom-alias' : name === 'idContainsGpt' ? 'myGpTalias' : name === 'oModel' ? 'o3' : name.startsWith('gpt') ? 'gpt-6.1' : name === 'legacy' ? undefined : 'deepseek-reasoner';
          const messages = [{id: 'raw', role: 'assistant', model, provider: name === 'otherProvider' ? 'other' : 'custom', thinking: (name === 'gptRaw' ? '' : '**Planning**\\n\\n') + raw, text: 'Done.', tools: []}];
          if (name === 'mixed') messages.push({id: 'gpt', role: 'assistant', model: 'gpt-6.1', thinking: '**GPT summary**\\n\\nShort body.', text: 'GPT done.', tools: []});
          const agent = {id: 'agent', name: 'fixture', path: '/root/fixture', kind: 'worker', status: 'completed', depth: 1, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}, activeMs: 0, runningSince: null};
          const content = modelCase ? <ThinkingModelCatalogContext.Provider value={[{id: 'custom-alias', provider: 'custom', name: 'My GpT Model'}, {id: 'custom-alias', provider: 'other', name: 'DeepSeek'}]}><ThinkingGroupModeContext.Provider value={name === 'gptNameSingle' ? 'single' : 'coherent'}><ThinkingSummaryContext.Provider value={summary}>
              <AgentPane agent={agent} agents={[agent]} messages={messages} ensureMessages={() => {}} onSwitch={() => {}} onControl={() => {}} toolDisplay="compact" />
            </ThinkingSummaryContext.Provider></ThinkingGroupModeContext.Provider></ThinkingModelCatalogContext.Provider>
            : name === 'coherent' ? thought
            : name === 'nested' ? <Thinking text="" active={false} showActivityIndicator={false} titled={{title: 'Read files and run commands', body: ''}} coherent>
                {thought}<ToolList tools={[bash]} display="compact" fold="none" />
              </Thinking>
            : name === 'thinking' || name === 'prose' ? <ThinkingSummaryContext.Provider value={name === 'prose' ? summary : null}>
                <Thinking text="Thinking body." messageId="fixture" active={false} showActivityIndicator={false} />
              </ThinkingSummaryContext.Provider>
            : <ToolList tools={tools[name]} display={display} fold={name === 'group' ? 'message' : 'none'} />;
          flushSync(() => root.render(<AppLocaleProvider locale="zh-CN"><div key={++revision} className="main-chat-view" data-tool-display="compact">{content}</div></AppLocaleProvider>));
        };
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
      logLevel: "error",
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>' +
      readStyles(join(here, "../src/renderer/styles.css")) +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_CHEVRON_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Expand chevron UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_CHEVRON_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 800, height: 700,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code);
    let currentCase = '';
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`Timed out (${currentCase}): ${code}`);
    };
    const arrow = '.tool-compact-chevron, .tool-chevron, .time-spent-trigger-arrow, .thinking-prose-toggle svg, .coherent-thought-arrow';
    const opacity = () => evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(arrow)})).opacity`);
    const toggle = () => evaluate(`document.querySelector(${JSON.stringify(arrow)}).closest('button').click()`);
    try {
      await win.loadFile(join(process.env.VELA_CHEVRON_TEMP, "index.html"));
      win.webContents.debugger.attach('1.3');
      const protocol = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
      await protocol('DOM.enable');
      await protocol('CSS.enable');
      for (const scheme of ['light', 'dark']) {
        for (const name of ['deepseek', 'deepseekMissing', 'legacy', 'mixed', 'gpt', 'gptRaw', 'gptName', 'gptNameSingle', 'idContainsGpt', 'oModel', 'otherProvider']) {
          currentCase = scheme + '/' + name;
          await evaluate(`window.renderCase(${JSON.stringify(name)}, ${JSON.stringify(scheme)})`);
          await until("document.querySelector('.assistant-block')");
          if (name === 'gptNameSingle') {
            assert.equal(await evaluate("document.querySelectorAll('.coherent-flat').length"), 0);
            assert.equal(await evaluate("document.querySelector('.thinking-headline-trigger').title"), 'Planning', 'display name also enables title grouping');
            continue;
          }
          if (['gpt', 'gptName', 'idContainsGpt'].includes(name)) {
            assert.equal(await evaluate("document.querySelectorAll('.coherent-flat').length"), 1, 'GPT retains coherent mode');
            assert.equal(await evaluate("document.querySelector('.coherent-thought-title').textContent"), 'Planning');
            continue;
          }
          assert.equal(await evaluate("document.querySelectorAll('.coherent-flat').length"), ['mixed', 'gptRaw'].includes(name) ? 1 : 0, 'only GPT enters coherent mode');
          if (name === 'deepseekMissing') {
            assert.equal(await evaluate("document.querySelector('.thinking-summary-action').textContent"), '总结', 'uncached raw thinking retains the summarize action');
            await evaluate("document.querySelector('.thinking-header .time-spent-trigger').click()");
          } else {
            assert.equal(await evaluate("document.querySelector('.thinking-prose-summary').textContent"), 'Summary text.', 'cached summary remains available');
            await evaluate("document.querySelector('.thinking-prose-toggle').click()");
          }
          await until("document.querySelector('.thinking-block.expanded .thinking-scroll-viewport')?.clientHeight === 280");
          assert.ok(await evaluate("(() => { const v = document.querySelector('.thinking-scroll-viewport'); return v.scrollHeight > v.clientHeight; })()"), 'long raw thinking scrolls instead of growing unbounded');
        }
        for (const name of ['command', 'group', 'diff', 'browser', 'agent', 'generic', 'thinking', 'prose', 'coherent', 'nested']) {
          currentCase = `${scheme}/${name}`;
          await evaluate(`window.renderCase(${JSON.stringify(name)}, ${JSON.stringify(scheme)})`);
          await until(`document.querySelector(${JSON.stringify(arrow)})`);
          assert.equal(await opacity(), '0', `${scheme}/${name}: collapsed arrow hidden without hover`);
          const { root } = await protocol('DOM.getDocument');
          // 连贯思考和正文总结的 hover 目标是按钮或整段文字,其他箭头自身也响应 hover。
          const hoverSelector = name === 'coherent' ? '.coherent-thought-trigger' : name === 'prose' ? '.thinking-prose-summary' : arrow;
          const { nodeId } = await protocol('DOM.querySelector', { nodeId: root.nodeId, selector: hoverSelector });
          await protocol('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
          await until(`Number(getComputedStyle(document.querySelector(${JSON.stringify(arrow)})).opacity) > 0`);
          await protocol('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
          await until(`getComputedStyle(document.querySelector(${JSON.stringify(arrow)})).opacity === '0'`);
          // 浏览器调用原先没有 focus-visible 显示规则;这里只回归已有的键盘行为。
          if (name !== 'browser') {
            const { nodeId: buttonId } = await protocol('DOM.querySelector', { nodeId: root.nodeId, selector: 'button[aria-expanded]' });
            await protocol('CSS.forcePseudoState', { nodeId: buttonId, forcedPseudoClasses: ['focus-visible'] });
            await until(`Number(getComputedStyle(document.querySelector(${JSON.stringify(arrow)})).opacity) > 0`);
            await protocol('CSS.forcePseudoState', { nodeId: buttonId, forcedPseudoClasses: [] });
            await until(`getComputedStyle(document.querySelector(${JSON.stringify(arrow)})).opacity === '0'`);
          }
          await toggle();
          await until(`getComputedStyle(document.querySelector(${JSON.stringify(arrow)})).opacity === ${JSON.stringify(name === 'coherent' ? '0.8' : '1')}`);
          assert.equal(await opacity(), name === 'coherent' ? '0.8' : '1', `${scheme}/${name}: expanded arrow always visible`);
          if (name === 'group' || name === 'nested') {
            await until(`document.querySelectorAll(${JSON.stringify(arrow)}).length > 1`);
            const children = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(arrow)})).slice(1).map(el => getComputedStyle(el).opacity)`);
            assert.ok(children.every(value => value === '0'), `${scheme}/${name}: collapsed children stay hidden: ${children}`);
          }
          await toggle();
          await until(`getComputedStyle(document.querySelector(${JSON.stringify(arrow)})).opacity === '0'`);
        }
        for (const display of ['compact', 'card']) {
          for (const name of ['diff', 'created', 'createdRoot', 'failedWrite']) {
            currentCase = `${scheme}/${display}/${name}`;
            await evaluate(`window.renderCase(${JSON.stringify(name)}, ${JSON.stringify(scheme)}, ${JSON.stringify(display)})`);
            const head = display === 'compact' ? '.tool-compact-line' : '.tool-card-head';
            const stat = display === 'compact' ? '.tool-compact-stat' : '.tool-stat';
            const measure = () => evaluate(`(() => {
              const row = document.querySelector(${JSON.stringify(head)});
              const stats = row.querySelector(${JSON.stringify(stat)});
              const arrow = row.querySelector('.tool-compact-chevron, .tool-chevron');
              const path = row.querySelector('.tool-compact-path-toggle, .tool-compact-name, .tool-card-main');
              const dot = row.querySelector('.tool-file-created-dot');
              const bounds = el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right}; };
              return {
                font: getComputedStyle(stats).fontFamily,
                weight: getComputedStyle(stats).fontWeight,
                uiFont: getComputedStyle(row.querySelector('.tool-compact-name, .tool-card-name')).fontFamily,
                add: getComputedStyle(stats.querySelector('.tool-stat-add')).color,
                muted: getComputedStyle(row).getPropertyValue('--text-muted').trim(),
                stats: bounds(stats), arrow: bounds(arrow),
                previous: stats.previousElementSibling.className,
                dot: dot ? {color: getComputedStyle(dot).backgroundColor, opacity: getComputedStyle(dot).opacity, width: dot.getBoundingClientRect().width} : null,
              };
            })()`);
            const before = await measure();
            assert.equal(before.font, before.uiFont, `${currentCase}: line counts use UI font`);
            assert.equal(before.weight, '400', `${currentCase}: line counts use regular weight`);
            assert.ok(before.stats.right <= before.arrow.left, `${currentCase}: counts precede arrow`);
            if (display === 'compact') {
              assert.match(before.previous, /tool-compact-(path-toggle|name)/, `${currentCase}: counts immediately follow path or filename`);
            }
            const created = name === 'created' || name === 'createdRoot';
            assert.equal(Boolean(before.dot), created, `${currentCase}: blue dot only on completed writes`);
            if (created) {
              assert.equal(before.dot.width, 6, `${currentCase}: small dot`);
              assert.equal(before.dot.opacity, '1', `${currentCase}: dot always visible`);
            }
            const { root } = await protocol('DOM.getDocument');
            const { nodeId } = await protocol('DOM.querySelector', { nodeId: root.nodeId, selector: head });
            await protocol('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
            const hovered = await measure();
            assert.notEqual(hovered.add, before.add, `${currentCase}: counts gain color on hover`);
            assert.equal(hovered.weight, '400', `${currentCase}: line counts stay regular on hover`);
            assert.deepEqual(hovered.dot, before.dot, `${currentCase}: dot color unaffected by hover`);
            await protocol('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
            if (created && display === 'compact') {
              await toggle();
              await until("document.querySelector('.tool-compact-item.open .tool-file-created-dot')");
              assert.equal(await evaluate("getComputedStyle(document.querySelector('.tool-file-created-dot')).opacity"), '1', `${currentCase}: expanded dot remains visible`);
            }
          }
        }
        await evaluate(`window.renderCase('streaming', ${JSON.stringify(scheme)})`);
        await until("document.querySelector('.tool-compact-item.open .tool-sheet-compact-diff')");
        assert.equal(await opacity(), '1', `${scheme}: auto-expanded streaming diff arrow visible`);
      }
      win.webContents.debugger.detach();
      console.log('Thinking model UI: GPT, DeepSeek, unknown history, mixed models, cached/missing summaries and bounded raw thinking passed in light/dark');
      console.log('Expand chevron UI: 11 arrow cases + 8 file summary cases × light/dark; visibility, hover/focus, nested isolation, UI fonts, count order and persistent creation dots passed');
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
