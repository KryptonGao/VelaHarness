/** Handoff pack dialog checks: node apps/desktop/test/handoff-pack-ui.mjs */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-handoff-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { HandoffPackDialog } from './apps/desktop/src/renderer/components/HandoffPackDialog';
          import { ComposerSeedContext, useComposerSeed } from './apps/desktop/src/renderer/components/composer-seed-context';
          import { setActiveLocale } from './apps/desktop/src/renderer/locale';
          setActiveLocale('zh-CN');

          const basePack = {
            conversationId: 'chat-a', title: 'Parser work', cwd: '/w', generatedAt: 1, source: 'model',
            goal: '让解析器支持流式输入', decisions: ['保持公开 API 不变', '使用增量解析'],
            files: [
              { path: 'src/parser.ts', added: 12, removed: 3, edits: 2, origin: 'agent' },
              { path: 'scripts/gen.sh', added: 0, removed: 0, edits: 0, origin: 'disk' },
            ], omittedFiles: 0,
            verifications: [
              { command: 'pnpm test', category: 'test', result: 'passed', exitCode: 0, stale: false, outputTail: '' },
              { command: 'pnpm build', category: 'build', result: 'failed', exitCode: 2, stale: true, outputTail: '' },
            ], omittedVerifications: 0,
            unfinished: ['更新文档'], notes: '',
          };
          window.fixture = { requests: [], cancels: [], confirmed: [], closed: 0, consumed: [], mode: 'ok', confirmFails: false, release: null };
          window.vela = {
            draftHandoff: request => {
              fixture.requests.push(request);
              if (fixture.mode === 'fail') return Promise.reject(new Error('等当前回复结束后再生成交接包'));
              if (fixture.mode === 'hold') return new Promise(resolve => { fixture.release = () => resolve(structuredClone(basePack)); });
              return Promise.resolve(structuredClone(fixture.mode === 'facts' ? { ...basePack, source: 'facts-only', decisions: [], unfinished: [] } : basePack));
            },
            cancelHandoff: async id => { fixture.cancels.push(id); },
          };

          function SeedTarget({ conversationId }) {
            const [value, setValue] = useState('');
            useComposerSeed(conversationId, text => setValue(text));
            return <textarea id={'target-' + conversationId} value={value} onChange={event => setValue(event.target.value)} />;
          }
          function Host() {
            const [open, setOpen] = useState(false);
            const [seed, setSeed] = useState(null);
            window.openDialog = () => setOpen(true);
            return <ComposerSeedContext.Provider value={{ seed, consume: id => { fixture.consumed.push(id); setSeed(current => current?.id === id ? null : current); } }}>
              <button id="opener">Open</button>
              <SeedTarget conversationId="chat-new" />
              <SeedTarget conversationId="chat-other" />
              {open ? <HandoffPackDialog conversationId="chat-a"
                onConfirm={async text => {
                  fixture.confirmed.push(text);
                  if (fixture.confirmFails) throw new Error('新建对话失败');
                  setSeed({ id: 'seed-' + fixture.confirmed.length, conversationId: 'chat-new', text });
                }}
                onClose={() => { fixture.closed += 1; setOpen(false); }} /> : null}
            </ComposerSeedContext.Provider>;
          }
          createRoot(document.getElementById('root')).render(<Host />);
        `,
        resolveDir: resolve(here, "../../.."), loader: "tsx",
      },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' },
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="dark"><head><meta charset="utf-8"><style>' +
      readFileSync(join(here, "../src/renderer/styles.css"), "utf8") +
      '</style><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_HANDOFF_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Handoff pack dialog checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_HANDOFF_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 900, height: 760, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    try {
      await win.loadFile(join(process.env.VELA_HANDOFF_TEMP, "index.html"));
      const evaluate = async code => {
        try { return await win.webContents.executeJavaScript(code); }
        catch (error) { console.error(`Renderer check failed: ${code}`); throw error; }
      };
      const until = async code => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (await evaluate(code)) return;
          await new Promise(done => setTimeout(done, 20));
        }
        throw new Error(`Timed out: ${code}`);
      };
      const setValue = (selector, value) => evaluate(`(() => {
        const control = document.querySelector(${JSON.stringify(selector)});
        const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${JSON.stringify(value)});
        control.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const button = label => evaluate(`Array.from(document.querySelectorAll('.handoff-dialog button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`);
      const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
      const closedDialog = () => until("!document.querySelector('.handoff-dialog')");

      // 1. Loading state, cancel on close, and the request carries the conversation, locale and a unique id.
      await evaluate("fixture.mode = 'hold'; openDialog()");
      await until("Boolean(document.querySelector('.handoff-dialog[open]'))");
      assert.equal(await text(".handoff-state[role=status]"), "正在整理这个对话…");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.handoff-dialog footer button')).find(b => b.classList.contains('is-primary')).disabled"), true);
      const first = await evaluate("fixture.requests[0]");
      assert.equal(first.conversationId, "chat-a");
      assert.equal(first.locale, "zh-CN");
      assert.ok(first.requestId.length > 10);
      await button("取消");
      await closedDialog();
      assert.ok((await evaluate("fixture.cancels")).includes(first.requestId));
      assert.equal(await evaluate("fixture.confirmed.length"), 0);

      // 2. Loaded pack: fields, facts as checkboxes, and edits flow into the preview.
      await evaluate("fixture.mode = 'ok'; openDialog()");
      await until("Boolean(document.querySelector('.handoff-dialog textarea'))");
      assert.equal(await evaluate("document.querySelector('.handoff-dialog textarea').value"), "让解析器支持流式输入");
      assert.equal(await evaluate("document.activeElement === document.querySelector('.handoff-dialog textarea')"), true);
      assert.equal(await evaluate("Boolean(document.querySelector('.handoff-notice'))"), false);
      assert.equal(await evaluate("document.querySelectorAll('.handoff-group input[type=checkbox]').length"), 4);
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.handoff-group input[type=checkbox]')).every(input => input.checked)"), true);
      assert.equal(await evaluate("document.querySelector('.handoff-group').textContent.includes('磁盘检测')"), true);
      assert.equal(await evaluate("document.querySelector('.handoff-dialog').textContent.includes('之后文件又被修改，可能已过期')"), true);
      // Facts cannot be rewritten: only checkboxes, no inputs for commands or paths.
      assert.equal(await evaluate("document.querySelectorAll('.handoff-group input:not([type=checkbox]), .handoff-group textarea').length"), 0);

      await evaluate("document.querySelector('.handoff-group input[type=checkbox]').click()");
      await setValue(".handoff-dialog textarea", "让解析器流式输出，并保持兼容");
      await button("预览");
      await until("Boolean(document.querySelector('.handoff-preview'))");
      const preview = await text(".handoff-preview");
      assert.ok(preview.startsWith("# 任务交接包 · Parser work"));
      assert.ok(preview.includes("让解析器流式输出，并保持兼容"));
      assert.ok(!preview.includes("src/parser.ts"), "unchecked file stays out of the pack");
      assert.ok(preview.includes("`scripts/gen.sh`"));
      assert.ok(preview.includes("`pnpm test` — 通过（退出码 0）"));
      assert.ok(preview.includes("`pnpm build` — 失败（退出码 2） — 之后文件又被修改，结果可能已过期"));
      assert.ok(preview.includes("- 更新文档"));
      await button("编辑");
      await until("Boolean(document.querySelector('.handoff-dialog textarea'))");
      assert.equal(await evaluate("document.querySelector('.handoff-dialog textarea').value"), "让解析器流式输出，并保持兼容");

      // 3. IME composition must not confirm.
      await evaluate("document.querySelector('.handoff-dialog textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, isComposing: true }))");
      await new Promise(done => setTimeout(done, 100));
      assert.equal(await evaluate("fixture.confirmed.length"), 0);

      // 4. A failed confirmation stays visible and keeps the dialog and edits.
      await setValue(".handoff-dialog label:last-of-type textarea", "注意 flaky 测试");
      await evaluate("fixture.confirmFails = true");
      await button("创建新对话并填入");
      await until("Boolean(document.querySelector('.handoff-error'))");
      assert.equal(await text(".handoff-error"), "新建对话失败");
      assert.equal(await evaluate("Boolean(document.querySelector('.handoff-dialog'))"), true);
      assert.equal(await evaluate("document.querySelector('#target-chat-new').value"), "");

      // 5. Confirm: the edited text seeds the new chat's input only, and the seed is consumed once.
      await evaluate("fixture.confirmFails = false");
      await button("创建新对话并填入");
      await closedDialog();
      const confirmed = await evaluate("fixture.confirmed.at(-1)");
      assert.ok(confirmed.includes("让解析器流式输出，并保持兼容"));
      assert.ok(confirmed.includes("## 补充说明\n注意 flaky 测试"));
      assert.ok(!confirmed.includes("src/parser.ts"));
      await until("document.querySelector('#target-chat-new').value.length > 0");
      assert.equal(await evaluate("document.querySelector('#target-chat-new').value"), confirmed);
      assert.equal(await evaluate("document.querySelector('#target-chat-other').value"), "");
      assert.deepEqual(await evaluate("fixture.consumed"), [`seed-${await evaluate("fixture.confirmed.length")}`]);

      // 6. Facts-only packs explain themselves.
      await evaluate("fixture.mode = 'facts'; openDialog()");
      await until("Boolean(document.querySelector('.handoff-notice'))");
      assert.ok((await text(".handoff-notice")).startsWith("没有使用模型"));
      await button("取消"); await closedDialog();

      // 7. Load failures show the localized message and Retry issues a new request.
      await evaluate("fixture.mode = 'fail'; openDialog()");
      await until("Boolean(document.querySelector('.handoff-state[role=alert]'))");
      assert.ok((await text(".handoff-state[role=alert]")).includes("等当前回复结束后再生成交接包"));
      const before = await evaluate("fixture.requests.length");
      await evaluate("fixture.mode = 'ok'");
      await button("重试");
      await until("Boolean(document.querySelector('.handoff-dialog textarea'))");
      assert.equal(await evaluate("fixture.requests.length"), before + 1);
      assert.notEqual(await evaluate("fixture.requests.at(-1).requestId"), await evaluate("fixture.requests.at(-2).requestId"));

      // 8. Escape closes the dialog (native cancel is routed through onClose).
      await evaluate("document.querySelector('.handoff-dialog').dispatchEvent(new Event('cancel', { cancelable: true }))");
      await closedDialog();

      // 9. Layout: fits a narrow window without horizontal scroll, and the footer stays visible.
      await evaluate("openDialog()");
      await until("Boolean(document.querySelector('.handoff-dialog textarea'))");
      win.setSize(420, 640);
      await new Promise(done => setTimeout(done, 100));
      assert.equal(await evaluate("(() => { const body = document.querySelector('.handoff-body'); return body.scrollWidth <= body.clientWidth + 1; })()"), true);
      assert.equal(await evaluate("(() => { const r = document.querySelector('.handoff-dialog footer').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })()"), true);
      if (process.env.VELA_HANDOFF_CAPTURE) writeFileSync(process.env.VELA_HANDOFF_CAPTURE, (await win.webContents.capturePage()).toPNG());
      console.log("PASS handoff pack dialog: loading and cancel, fact checkboxes, edit and preview, IME guard, failed confirm, seeded input, facts-only notice, retry and narrow layout");
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
