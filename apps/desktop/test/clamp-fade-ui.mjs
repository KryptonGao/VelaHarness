// Run with: node apps/desktop/test/clamp-fade-ui.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStyles } from './read-styles.mjs';

if (!process.versions.electron) {
  const dir = mkdtempSync(join(tmpdir(), 'vela-clamp-fade-'));
  try {
    const { build } = await import('esbuild');
    await build({
      stdin: { resolveDir: fileURLToPath(new URL('../src/renderer/', import.meta.url)), contents: `
        import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { BashView } from './components/ToolCard';
        const root = createRoot(document.querySelector('#bash'));
        window.renderBash = command => flushSync(() => root.render(createElement(BashView, {command, running: false, failed: false})));
      ` },
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: join(dir, 'bash.js'),
      loader: { '.svg': 'dataurl' }, define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
    });
    const env = { ...process.env, VELA_CLAMP_DIR: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url)], { env, stdio: 'inherit', timeout: 30000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Electron clamp fade regression');
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import('electron');
  const dir = process.env.VELA_CLAMP_DIR;
  app.setPath('userData', join(dir, 'profile'));
  void app.whenReady().then(async () => {
    const sheets = ['styles.css', 'agent-inbox.css', 'checkpoints.css', 'onboarding.css',
      'race.css', 'scheduled-tasks.css', 'selection-actions.css', 'task-recipes.css'];
    const css = sheets.map(sheet => readStyles(fileURLToPath(new URL('../src/renderer/' + sheet, import.meta.url)))).join('\n');
    const cases = [
      ['.agent-inbox-page .agent-inbox-row-subject', 2], ['.checkpoint-node-text', 2], ['.recipe-page .recipe-desc', 2],
      ['.race-prompt', 4], ['.st-page .scheduled-task-prompt', 2], ['.ob-news-new .ob-strip span', 4],
      ['.ob-news-imp li span', 2], ['.ob-wn-grid .ob-strip span', 3], ['.selection-reply-quote p', 2],
      ['.reply-quote-text', 4], ['.turn-nav-popover-prompt', 2], ['.turn-nav-popover-reply', 3],
      ['.tool-terminal-cmd .tool-terminal-cmd-text', 2], ['.plan-preview-overview', 2],
      ['.provider-error-text p', 4], ['.skill-migration-desc', 2],
    ];
    function fixture(path, lines) {
      return path.split(' ').reduceRight((child, part) => {
        const tag = part.startsWith('.') ? 'div' : part;
        const cls = part.startsWith('.') ? ` class="${part.slice(1)}"` : '';
        return `<${tag}${cls}${child ? '' : ` data-lines="${lines}"`}>${child}</${tag}>`;
      }, '');
    }
    const page = join(dir, 'index.html');
    writeFileSync(page, `<!doctype html><style>${css}</style>${cases.map(([path, lines]) => fixture(path, lines)).join('')}
      <div class="st-page"><details open><pre class="scheduled-task-prompt" id="detail">${'detail\n'.repeat(32)}</pre></details></div>
      <div id="bash" style="width:240px"></div><script src="bash.js"></script>`);
    const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(page);
    const wc = win.webContents;
    const run = code => wc.executeJavaScript(code);
    await run(`window.settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.probes = [...document.querySelectorAll('[data-lines]')];`);
    wc.debugger.attach();
    for (const motion of ['no-preference', 'reduce']) {
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
      for (const size of ['short', 'exact', 'overflow', 'exact']) {
        const rows = await run(`(async () => {
          for (const e of probes) {
            const count = '${size}' === 'short' ? 1 : Number(e.dataset.lines) + Number('${size}' === 'overflow');
            e.innerHTML = Array(count).fill('文字').join('<br>');
          }
          await settle();
          return probes.map(e => ({ masked: getComputedStyle(e).maskImage !== 'none', clipped: e.scrollHeight > e.clientHeight,
            height: e.clientHeight, line: parseFloat(getComputedStyle(e).lineHeight) }));
        })()`);
        rows.forEach(({ masked, clipped, height, line }, index) => {
          const [path, lines] = cases[index];
          const label = `${motion}, ${size}, ${path}`;
          assert.equal(masked, size === 'overflow', label + ': mask');
          assert.equal(clipped, size === 'overflow', label + ': layout');
          assert.ok(Math.abs(height - (size === 'short' ? 1 : lines) * line) < 1, `${label}: height ${height}, line ${line}`);
        });
      }
    }
    assert.ok(await run(`(async () => {
      const cmd = () => document.querySelector('#bash .tool-terminal-cmd-text');
      renderBash('short'); await settle();
      if (cmd().hasAttribute('role')) return false;
      const text = Array(10).fill('more text').join('\\n');
      renderBash(text); await settle();
      if (cmd().getAttribute('aria-expanded') !== 'false') return false;
      cmd().click(); await settle();
      if (cmd().getAttribute('aria-expanded') !== 'true' || cmd().textContent !== text || getComputedStyle(cmd()).maskImage !== 'none') return false;
      cmd().dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); await settle();
      return cmd().getAttribute('aria-expanded') === 'false' && cmd().textContent === text && cmd().scrollHeight > cmd().clientHeight
        && detail.scrollHeight > detail.clientHeight && getComputedStyle(detail).maskImage === 'none';
    })()`), 'Command click/Enter toggles without losing text; scrollable task detail stays unmasked');

    assert.ok(await run(`(async () => {
      const parent = document.querySelector('.reply-quote-text');
      parent.innerHTML = '<b><span class="overflow-fade-text" style="width:40px">a long single-line label</span></b>';
      const label = parent.querySelector('span'); await settle();
      const mask = getComputedStyle(label).maskImage;
      return label.scrollWidth > label.clientWidth && mask.startsWith('linear-gradient(to right') && !mask.includes('), linear-gradient(');
    })()`), 'Nested single-line overflow uses only the shared right fade');

    // Paint solid black on white so edge samples are independent of fonts/antialiasing.
    await run(`document.body.innerHTML = '<div class="reply-quote-text" id="paint"></div>';
      document.body.style.background = 'white';
      paint.style.cssText = 'margin:0;width:120px;font:16px/20px monospace;background:black;color:black;overflow-wrap:anywhere';
      paint.textContent = 'M'.repeat(80); settle()`);
    const sample = async (x, y) => (await wc.capturePage({ x, y, width: 1, height: 1 })).toBitmap()[0];
    assert.ok(await sample(118, 50) < 10, 'Line above the last stays opaque at its right edge');
    // In this 120px box the 16px fade starts at x=104; x=112 is its midpoint.
    assert.ok(await sample(103, 70) < 10, 'Last line stays opaque immediately before the fade');
    const mid = await sample(112, 70);
    assert.ok(mid > 96 && mid < 160, 'Last line is approximately half opaque at the midpoint');
    assert.ok(await sample(118, 70) > 225, 'Last line fades out on the right');
    const widened = await run(`(async () => {
      paint.style.width = '1000px';
      for (let frame = 0; frame < 10 && getComputedStyle(paint).maskImage !== 'none'; ++frame) await settle();
      return getComputedStyle(paint).maskImage;
    })()`);
    assert.equal(widened, 'none', 'Widening restores full opacity');
    console.log(`Clamp fade: ${cases.length} selectors, both motion modes, expand, resize and pixel samples passed.`);
    app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
}
