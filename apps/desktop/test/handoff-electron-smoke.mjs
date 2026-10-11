/** Real Electron check of the task handoff pack: node apps/desktop/test/handoff-electron-smoke.mjs (build first).
 * A fake OpenAI-compatible server answers the chat and the handoff summary request. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../package.json'));
const root = resolve(here, '..');
const temporary = mkdtempSync(join(tmpdir(), 'vela-handoff-electron-'));
const entry = join(temporary, 'entry.mjs');
for (const dir of ['workspace', 'vela']) mkdirSync(join(temporary, dir));
const handoffRequests = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const data of req) raw += data;
  const input = JSON.parse(raw);
  const system = input.messages.find(message => message.role === 'system')?.content ?? '';
  const isHandoff = typeof system === 'string' && system.includes('handoff note');
  if (isHandoff) handoffRequests.push(input);
  const content = isHandoff
    ? JSON.stringify({ goal: 'Smoke goal from the model', decisions: ['Keep it simple'], unfinished: ['Write the docs'], files: [{ path: 'invented.ts' }] })
    : 'Handoff smoke reply';
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = delta => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  res.write(chunk({ role: 'assistant', content: '' })); res.write(chunk({ content }));
  res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: input.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
writeFileSync(join(temporary, 'vela/ui-state.json'), JSON.stringify({ 'vela.onboarding.complete': 'true', 'vela.leftCollapsed': 'false', 'vela.locale': 'zh-CN' }));
writeFileSync(join(temporary, 'vela/models.json'), JSON.stringify({ providers: { 'handoff-smoke': { name: 'Handoff smoke', api: 'openai-completions', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'synthetic-test-key', models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 }] } } }));
writeFileSync(join(temporary, 'vela/selection.json'), JSON.stringify({ provider: 'handoff-smoke', modelId: 'fixture', thinkingLevel: 'off', newConversationSelection: 'default' }));
copyFileSync(join(here, 'handoff-smoke-entry.mjs'), entry);
try {
  const env = { ...process.env, PI_OFFLINE: '1', VELA_USER_DATA: join(temporary, 'vela'), VELA_CWD: join(temporary, 'workspace'), VELA_HANDOFF_SMOKE_ROOT: root, VELA_HANDOFF_SMOKE_TEMP: temporary };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [entry], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 55000);
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  clearTimeout(timer);
  assert.equal(code, 0, 'Handoff Electron smoke failed');
  assert.ok(output.includes('PASS Handoff pack'));
  assert.equal(handoffRequests.length, 1, 'One model call per generated pack');
  const prompt = JSON.stringify(handoffRequests[0].messages);
  assert.ok(prompt.includes('Please build the handoff smoke feature'), 'The transcript reaches the summary model');
} finally { await new Promise(resolve => server.close(resolve)); rmSync(temporary, { recursive: true, force: true }); }
