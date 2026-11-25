// Run after building. Set VELA_QUIT_SCREENSHOTS to also capture the two live HUDs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { app, BrowserWindow } from 'electron';

if (process.platform !== 'darwin') { console.log('SKIP macOS only'); app.exit(0); }
else void run().catch(error => { console.error(error); app.exit(1); });

async function run() {
  const temp = mkdtempSync(join(tmpdir(), 'vela-quit-'));
  const home = join(temp, 'profile'); mkdirSync(home);
  const screenshots = process.env.VELA_QUIT_SCREENSHOTS;
  if (screenshots) mkdirSync(screenshots, { recursive: true });
  const src = fileURLToPath(new URL('./fixtures/quit-input.m', import.meta.url));
  const nodePath = execFileSync('node', ['-p', 'require("fs").realpathSync(process.execPath)'], { encoding: 'utf8' }).trim();
  const addon = join(temp, 'test-input.node');
  execFileSync('xcrun', ['clang', '-fobjc-arc', '-bundle', '-undefined', 'dynamic_lookup', '-framework', 'AppKit', '-I', resolve(dirname(nodePath), '../include/node'), src, '-o', addon]);
  const input = createRequire(import.meta.url)(addon);
  // A pending local model response keeps a real turn in flight without credentials or external traffic.
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.VELA_USER_DATA = home; process.env.VELA_CWD = temp; process.env.PI_OFFLINE = '1';
  delete process.env.ELECTRON_RENDERER_URL; delete process.env.VELA_CAPTURE;
  const write = (name, data) => writeFileSync(join(home, name), JSON.stringify(data));
  write('ui-state.json', { 'vela.onboarding.complete': 'true', 'vela.locale': 'zh-CN', 'vela.appearance': 'light' });
  write('models.json', { providers: { 'quit-test': { name: 'Local', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test', models: [{ id: 'fixture', name: 'Fixture', reasoning: false, contextWindow: 32000, maxTokens: 4096 }] } } });
  write('selection.json', { provider: 'quit-test', modelId: 'fixture', thinkingLevel: 'off', newConversationSelection: 'default' });
  const watchdog = setTimeout(() => { console.error('Timed out waiting for hold-to-quit'); app.exit(1); }, 30_000);
  let commitAt;
  app.once('before-quit', () => {
    if (!commitAt || performance.now() - commitAt < 1500) { console.error('Premature quit'); return app.exit(1); }
    console.log('PASS continuous hold reached the normal application quit path');
    server.closeAllConnections(); server.close();
  });
  app.once('will-quit', () => { clearTimeout(watchdog); rmSync(temp, { recursive: true, force: true }); });
  async function until(test, what) {
    for (let i = 0; i < 180; i++) { const value = await test(); if (value) return value; await delay(50); }
    throw Error('Timed out: ' + what);
  }
  await import('../out/main/index.mjs');
  const win = await until(() => BrowserWindow.getAllWindows()[0]?.isVisible() && BrowserWindow.getAllWindows()[0], 'main window');
  const evaluate = code => win.webContents.executeJavaScript(code);
  await until(() => evaluate(`window.vela?.getState().then(s => s.session.status === 'ready' && document.documentElement.lang === 'zh-CN')`), 'ready session');
  app.focus({ steal: true }); win.focus(); await until(() => win.isFocused(), 'focused window');
  const cmd = 1 << 20, shift = 1 << 17;
  const down = (repeat = false) => input.post(0, cmd, 12, repeat);
  const up = () => input.post(1, cmd, 12, false);
  const releaseCommand = () => input.post(2, 0, 55, false);
  const capture = name => {
    const hud = input.snapshot(screenshots ? join(screenshots, name + '.png') : null);
    assert.ok(hud?.roundedMaterial, 'the window material mask needs four transparent corners and a filled center');
  };
  assert.ok(!input.snapshot());
  input.post(0, cmd | shift, 12, false); await delay(100); assert.ok(!input.snapshot());
  down(); await until(() => input.snapshot()?.title === '退出 Vela', 'neutral hint');
  await delay(630); capture('idle'); up(); // Keep Command held, even after the original deadline.
  await delay(1650); assert.ok(!win.isDestroyed()); releaseCommand();
  console.log('PASS exact modifiers, idle hint and Q-first cancellation');
  await evaluate(`void window.vela.prompt('检查项目的测试覆盖情况。')`);
  await until(() => evaluate(`window.vela.getState().then(s => s.session.status === 'streaming')`), 'active turn');
  down(); await until(() => input.snapshot()?.title === '退出会中断正在运行的任务', 'running task warning');
  await delay(730); capture('running'); releaseCommand(); await delay(1650);
  assert.ok(await evaluate(`window.vela.getState().then(s => s.session.status === 'streaming')`));
  console.log('PASS active work warning and Command-first cancellation leaves task running');
  down(); await delay(100); win.hide(); await delay(1600); assert.ok(!input.snapshot());
  win.show(); app.focus({ steal: true }); win.focus(); await until(() => win.isFocused(), 'refocused');
  await delay(350); // Let AppKit finish ordering the window before the next physical gesture.
  console.log('PASS losing focus cancels hold');
  down(); await until(() => input.snapshot(), 'hold before minimizing');
  win.minimize(); await until(() => win.isMinimized(), 'minimized');
  await delay(1600); assert.ok(!input.snapshot());
  win.restore(); app.focus({ steal: true }); win.focus(); await until(() => win.isFocused(), 'restored');
  await delay(350);
  console.log('PASS minimizing cancels hold');
  commitAt = performance.now(); down();
  await until(() => input.snapshot()?.title === '退出会中断正在运行的任务', 'new hold after focus');
  await delay(750); down(true);
  // A repeat must neither restart the timer nor commit immediately.
  await delay(1300); if (server.listening) throw Error('Continuous hold did not quit within the original deadline');
}
