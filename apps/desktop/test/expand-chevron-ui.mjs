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
        import { JumpOrb } from './apps/desktop/src/renderer/components/JumpOrb';
        import { orbFrame, ORB_POOLS } from './apps/desktop/src/renderer/components/jump-orb';
        window.commandOrbFrames = ORB_POOLS.command.flatMap(style => Array.from({length: 600}, (_, i) => orbFrame(style, i * 0.025)));
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
          const modelCase = ['deepseek', 'deepseekMissing', 'gpt', 'gptMulti', 'gptRaw', 'legacy', 'mixed', 'gptName', 'gptNameSingle', 'idContainsGpt', 'gptCodex', 'oModel', 'otherProvider'].includes(name);
          const model = ['gptName', 'gptNameSingle', 'otherProvider'].includes(name) ? 'custom-alias' : name === 'idContainsGpt' ? 'myGpTalias' : name === 'oModel' ? 'o3' : name.startsWith('gpt') ? 'gpt-6.1' : name === 'legacy' ? undefined : 'deepseek-reasoner';
          const messages = [{id: 'raw', role: 'assistant', model, provider: name === 'otherProvider' ? 'other' : 'custom', thinking: (name === 'gptRaw' ? '' : '**Planning**\\n\\n') + raw, text: 'Done.', tools: []}];
          if (name === 'gptCodex') messages[0].tools = Array.from({length: 4}, (_, i) => ({...bash, id: 'codex-' + i}));
          if (name === 'gptMulti') messages[0].thinking = '**Review changes**\\n\\n**Verify the fix**';
          if (name === 'mixed') messages.push({id: 'gpt', role: 'assistant', model: 'gpt-6.1', thinking: '**GPT summary**\\n\\nShort body.', text: 'GPT done.', tools: []});
          const agent = {id: 'agent', name: 'fixture', path: '/root/fixture', kind: 'worker', status: 'completed', depth: 1, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}, activeMs: 0, runningSince: null};
          const content = modelCase ? <ThinkingModelCatalogContext.Provider value={[{id: 'custom-alias', provider: 'custom', name: 'My GpT Model'}, {id: 'custom-alias', provider: 'other', name: 'DeepSeek'}]}><ThinkingGroupModeContext.Provider value={name === 'gptNameSingle' ? 'single' : name === 'gptCodex' ? 'codex' : 'coherent'}><ThinkingSummaryContext.Provider value={summary}>
              <AgentPane agent={agent} agents={[agent]} messages={messages} ensureMessages={() => {}} onSwitch={() => {}} onControl={() => {}} toolDisplay={display} />
            </ThinkingSummaryContext.Provider></ThinkingGroupModeContext.Provider></ThinkingModelCatalogContext.Provider>
            : name === 'commandOrb' || name === 'thinkingOrb' ? <button className="chat-jump-latest" data-visible="true"><JumpOrb activity={name === 'commandOrb' ? 'command' : 'thinking'} running /></button>
            : name === 'coherent' ? thought
            : name === 'nested' ? <Thinking text="" active={false} showActivityIndicator={false} titled={{title: 'Read files and run commands', body: ''}} coherent>
                {thought}<ToolList tools={[bash]} display="compact" fold="none" />
              </Thinking>
            : name === 'thinking' || name === 'prose' ? <ThinkingSummaryContext.Provider value={name === 'prose' ? summary : null}>
                <Thinking text="Thinking body." messageId="fixture" active={false} showActivityIndicator={false} />
              </ThinkingSummaryContext.Provider>
            : <ToolList tools={tools[name]} display={display} fold={name === 'group' ? 'message' : 'none'} />;
          flushSync(() => root.render(<AppLocaleProvider locale="zh-CN"><div key={++revision} className={modelCase ? undefined : 'main-chat-view'} data-tool-display={modelCase ? undefined : 'compact'}>{content}</div></AppLocaleProvider>));
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
    const checkThoughtColor = async (token = '--text-muted') => {
      const colors = await evaluate(`(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(' + ${JSON.stringify(token)} + ')';
        document.body.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return Array.from(document.querySelectorAll('.coherent-thought-title, .coherent-thought-line')).map(title => ({actual: getComputedStyle(title).color, expected}));
      })()`);
      assert.ok(colors.length > 0, `${currentCase}: thought titles are present`);
      for (const {actual, expected} of colors) assert.equal(actual, expected, `${currentCase}: thought titles use ${token}`);
    };
    const checkBulbAlignment = async () => {
      const offset = await evaluate(`(() => {
        const trigger = document.querySelector('.coherent-thought-trigger');
        const icon = trigger.querySelector('.thinking-icon').getBoundingClientRect();
        const title = trigger.querySelector('.coherent-thought-title, .coherent-thought-line');
        const firstLineCenter = title.getBoundingClientRect().top + parseFloat(getComputedStyle(title).lineHeight) / 2;
        return firstLineCenter - (icon.top + icon.height / 2);
      })()`);
      assert.ok(Math.abs(offset - 1) < 0.25, `${currentCase}: bulb sits 1px above the first line center (actual ${offset})`);
    };
    try {
      await win.loadFile(join(process.env.VELA_CHEVRON_TEMP, "index.html"));
      win.webContents.debugger.attach('1.3');
      const protocol = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
      await protocol('DOM.enable');
      await protocol('CSS.enable');
      for (const scheme of ['light', 'dark']) {
        await evaluate(`window.renderCase('nested', ${JSON.stringify(scheme)})`);
        const typographyCases = await evaluate(`(() => {
          const root = document.documentElement;
          const prose = document.createElement('div');
          prose.className = 'agent-reply-prose';
          prose.textContent = 'Regular serif reply — 明体正文';
          document.querySelector('.main-chat-view').append(prose);
          const headline = document.querySelector('.thinking-block.is-coherent .thinking-headline-trigger');
          const results = [];
          const keys = ['uiFontLatin', 'uiFontCjk', 'replyFontLatin', 'replyFontCjk'];
          const saved = keys.map(key => root.dataset[key]);
          try {
            for (const uiLatin of ['sans', 'serif'])
            for (const uiCjk of ['sans', 'serif'])
            for (const replyLatin of ['inherit', 'sans', 'serif'])
            for (const replyCjk of ['inherit', 'sans', 'serif']) {
              const values = [uiLatin, uiCjk, replyLatin, replyCjk];
              keys.forEach((key, i) => root.dataset[key] = values[i]);
              const serif = (replyLatin === 'inherit' ? uiLatin : replyLatin) === 'serif'
                || (replyCjk === 'inherit' ? uiCjk : replyCjk) === 'serif';
              results.push({
                fonts: values.join('/'), expected: serif ? '400' : '500',
                styles: [prose, headline].map(node => {
                  const style = getComputedStyle(node);
                  return {weight: style.fontWeight, stroke: style.webkitTextStrokeWidth};
                }),
              });
            }
          } finally {
            keys.forEach((key, i) => {
              if (saved[i] === undefined) delete root.dataset[key];
              else root.dataset[key] = saved[i];
            });
            prose.remove();
          }
          return results;
        })()`);
        for (const {fonts, expected, styles} of typographyCases) {
          for (const style of styles) {
            assert.equal(style.weight, expected, `${scheme}/${fonts}: reply and coherent headline share regular serif weight`);
            assert.equal(style.stroke, '0px', `${scheme}/${fonts}: no artificial text stroke`);
          }
        }
        for (const name of ['commandOrb', 'thinkingOrb']) {
          currentCase = `${scheme}/${name}`;
          await evaluate(`window.renderCase(${JSON.stringify(name)}, ${JSON.stringify(scheme)})`);
          await until("document.querySelector('.jump-orb[data-on=\"true\"]')");
          const geometry = await evaluate(`(() => {
            const button = document.querySelector('.chat-jump-latest').getBoundingClientRect();
            const svg = document.querySelector('.jump-orb').getBoundingClientRect();
            const scale = svg.width / 30;
            const gap = Math.min(...window.commandOrbFrames.flatMap(frame => frame.dots.map(dot =>
              button.width / 2 - (Math.hypot(dot.x - 15, dot.y - 15) + dot.r) * scale)));
            return {button: button.width, canvas: svg.width, centered: Math.abs(svg.x + svg.width / 2 - button.x - button.width / 2) < 0.1, gap};
          })()`);
          assert.equal(geometry.button, 40, `${currentCase}: click target is unchanged`);
          assert.equal(geometry.canvas, name === 'commandOrb' ? 32 : 40, `${currentCase}: only command dots are inset`);
          assert.ok(geometry.centered, `${currentCase}: animation stays centered`);
          if (name === 'commandOrb') assert.ok(geometry.gap >= 6, `${currentCase}: all four-dot styles keep at least 6px from the circular border (${geometry.gap})`);
        }
        for (const name of ['deepseek', 'deepseekMissing', 'legacy', 'mixed', 'gpt', 'gptMulti', 'gptRaw', 'gptName', 'gptNameSingle', 'idContainsGpt', 'gptCodex', 'oModel', 'otherProvider']) {
          currentCase = scheme + '/' + name;
          await evaluate(`window.renderCase(${JSON.stringify(name)}, ${JSON.stringify(scheme)})`);
          await until("document.querySelector('.assistant-block')");
          if (name === 'gptCodex') {
            assert.equal(await evaluate("document.querySelectorAll('.coherent-thought, .coherent-flat').length"), 0, 'Codex style shows no per-thought summaries and never flattens');
            assert.equal(await evaluate("document.querySelector('.thinking-headline-trigger').title"), '运行了命令', 'finished group title sums up the actions');
            await evaluate("document.querySelector('.thinking-headline-trigger').click()");
            await until("document.querySelector('.thinking-block.is-codex.expanded .thinking-group-rail')");
            assert.equal(await evaluate("getComputedStyle(document.querySelector('.thinking-group-rail')).borderLeftWidth"), '0px', 'Codex style draws no guide line');
            assert.equal(await evaluate("document.querySelector('.thinking-group-rail').textContent.includes('Planning')"), false, 'expanded group has no summary text');
            const lefts = await evaluate("(() => { const edge = (selector, side) => document.querySelector(selector).getBoundingClientRect()[side]; return {left: [edge('.thinking-headline-trigger', 'left'), edge('.thinking-group-rail .tool-card-list', 'left')], right: [edge('.thinking-headline-trigger', 'right'), edge('.thinking-group-rail .tool-card-list', 'right')]}; })()");
            assert.ok(Math.abs(lefts.left[0] - lefts.left[1]) < 1, `${currentCase}: tool list starts at the title's left edge (${lefts.left})`);
            assert.ok(Math.abs(lefts.right[0] - lefts.right[1]) < 1, `${currentCase}: tool list spans to the title's right edge (${lefts.right})`);
            continue;
          }
          if (['gpt', 'gptMulti', 'gptName', 'gptNameSingle', 'idContainsGpt'].includes(name)) {
            assert.equal(await evaluate("document.querySelector('.agent-pane').closest('.main-chat-view')"), null, 'agent fixture is independent of the main chat');
            const icons = await evaluate("Array.from(document.querySelectorAll('.agent-pane .thinking-icon')).map(icon => ({display: getComputedStyle(icon).display, width: icon.getBoundingClientRect().width, svg: Boolean(icon.querySelector('svg')), hidden: icon.getAttribute('aria-hidden')}))");
            assert.ok(icons.length > 0, `${currentCase}: CoT title contains a bulb`);
            for (const icon of icons) assert.deepEqual(icon, {display: 'grid', width: 16, svg: true, hidden: 'true'}, `${currentCase}: bulb is visible and decorative`);
          }
          if (['gpt', 'gptMulti', 'gptName', 'idContainsGpt'].includes(name)) {
            await checkBulbAlignment();
            await checkThoughtColor();
          }
          if (name === 'gptMulti') {
            assert.equal(await evaluate("document.querySelectorAll('.coherent-thought-line').length"), 2);
            continue;
          }
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
        for (const name of ['gpt', 'gptMulti', 'gptNameSingle']) {
          currentCase = `${scheme}/card/${name}`;
          await evaluate(`window.renderCase(${JSON.stringify(name)}, ${JSON.stringify(scheme)}, 'card')`);
          const displays = await evaluate("Array.from(document.querySelectorAll('.agent-pane .thinking-icon')).map(icon => getComputedStyle(icon).display)");
          assert.ok(displays.length > 0 && displays.every(display => display === 'none'), `${currentCase}: card mode keeps the existing icon policy`);
          if (name !== 'gptNameSingle') await checkThoughtColor();
        }
        for (const name of ['command', 'group', 'diff', 'browser', 'agent', 'generic', 'thinking', 'prose', 'coherent', 'nested']) {
          currentCase = `${scheme}/${name}`;
          await evaluate(`window.renderCase(${JSON.stringify(name)}, ${JSON.stringify(scheme)})`);
          await until(`document.querySelector(${JSON.stringify(arrow)})`);
          if (name === 'coherent') {
            await checkBulbAlignment();
            await checkThoughtColor();
          }
          assert.equal(await opacity(), '0', `${scheme}/${name}: collapsed arrow hidden without hover`);
          const { root } = await protocol('DOM.getDocument');
          // 连贯思考和正文总结的 hover 目标是按钮或整段文字,其他箭头自身也响应 hover。
          const hoverSelector = name === 'coherent' ? '.coherent-thought-trigger' : name === 'prose' ? '.thinking-prose-summary' : arrow;
          const { nodeId } = await protocol('DOM.querySelector', { nodeId: root.nodeId, selector: hoverSelector });
          await protocol('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
          await until(`Number(getComputedStyle(document.querySelector(${JSON.stringify(arrow)})).opacity) > 0`);
          if (name === 'coherent') await checkThoughtColor('--text-secondary');
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
          if (name === 'coherent') await checkThoughtColor();
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
              assert.equal(before.dot.width, 4, `${currentCase}: small dot`);
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
      console.log('Reply typography: 36 Latin/CJK interface/reply font combinations × light/dark; serif regular weight, no stroke, matching coherent headlines and unchanged sans weight passed');
      console.log('Thinking model UI: GPT, DeepSeek, unknown history, mixed models, cached/missing summaries and bounded raw thinking passed in light/dark');
      console.log('Expand chevron UI: 11 arrow cases + 8 file summary cases × light/dark; visibility, hover/focus, nested isolation, UI fonts, count order and persistent creation dots passed');
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
