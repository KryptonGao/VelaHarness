// Run with: pnpm --filter @vela/desktop exec electron test/overflow-fade-ui.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'vela-overflow-fade-'));
app.setPath('userData', join(dir, 'profile'));
app.on('quit', () => rmSync(dir, { recursive: true, force: true }));
app.whenReady().then(async () => {
  await build({ entryPoints: [join(here, 'overflow-fade-preview.tsx')], bundle: true, jsx: 'automatic',
    outfile: join(dir, 'ui.js'), loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'error' });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html data-scheme="light"><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
  const win = new BrowserWindow({ show: false, width: 1000, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(join(dir, 'index.html'));
  const wc = win.webContents;
  const js = code => wc.executeJavaScript(code);
  const settle = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))');
  await settle();
  wc.debugger.attach();
  await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await js(`window.$ = selector => document.querySelector(selector);
    window.mask = (selector, pseudo) => getComputedStyle($(selector), pseudo).maskImage;
    window.label = $('.session-group-name').textContent;
    window.action = $('.recommended-action > span');`);
  for (const motion of ['reduce', 'no-preference']) {
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
    for (const [width, clipped] of [[185, true], [930, false], [185, true]]) {
      await js(`$('#fixture').style.width = '${width}px'`);
      await settle();
      const masks = await js(`[mask('.session-group-name'), mask('.recommended-action > span'), mask('.browser-address-display'), mask('.rich-input', '::before')]`);
      for (const [i, name] of ['workspace', 'button label', 'URL', 'composer placeholder'].entries()) {
        assert.equal(masks[i].includes('linear-gradient(to right'), clipped, `${name}, ${width}px, ${motion}: ${masks[i]}`);
      }
      assert.deepEqual(await js(`[action.textContent === label, mask('.recommended-action'), mask('.session-group-header svg'), mask('.browser-address')]`), [true, 'none', 'none', 'none']);
    }
  }
  // A short label that ends very near the edge still has no mask. Scaling text without
  // touching the box must activate the mask; shrinking or replacing the text clears it.
  await js(`$('.session-group-name').style.cssText = 'flex:none;width:12ch;font:16px monospace';
    $('.session-group-name').textContent = '123456789012';`);
  await settle();
  assert.equal(await js(`mask('.session-group-name')`), 'none');
  await js(`const e = $('.session-group-name'); e.style.width = getComputedStyle(e).width; e.style.fontSize = '24px'`);
  await settle();
  assert.notEqual(await js(`mask('.session-group-name')`), 'none');
  await js(`$('.session-group-name').textContent = '短名'`);
  await settle();
  assert.equal(await js(`mask('.session-group-name')`), 'none');
  await js(`$('.recommended-action').click(); $('.browser-address').focus()`);
  assert.equal(await js('document.body.dataset.selected'), 'read the file');
  assert.deepEqual(await js(`(() => { const input = $('.browser-address'); return {
    focused: input.matches(':focus'), selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
    label: getComputedStyle($('.browser-address-display')).visibility, visibleText: getComputedStyle(input).color !== 'rgba(0, 0, 0, 0)'
  }; })()`), { focused: true, selected: true, label: 'hidden', visibleText: true }, 'Editing uses the real selected address and its caret');
  console.log('Overflow fade passed: resizing, exact fit, font scale, replacement text, controls, focus and reduced motion.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
