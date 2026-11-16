/** Memory distillation dialog UI checks: node apps/desktop/test/memory-distill-ui.mjs */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-memory-distill-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { MemoryDistillDialog } from './apps/desktop/src/renderer/components/MemoryDistillDialog';
          import { HandoffPackDialog } from './apps/desktop/src/renderer/components/HandoffPackDialog';
          import { setActiveLocale } from './apps/desktop/src/renderer/locale';
          setActiveLocale('zh-CN');

          const baseDraft = {
            conversationId: 'chat-a',
            workspace: '/repo',
            path: '/repo/.vela/MEMORY.md',
            exists: true,
            baseContent: '# Project Memory\\n\\n- **[命令]** Run pnpm test.\\n',
            baseRevision: 'rev-1',
            addition: '- **[避坑]** Build before running smoke tests.',
            summary: '提炼了 1 条构建避坑点。',
            source: 'model',
          };
          const basePack = {
            conversationId: 'chat-a', title: 'Smoke fix', cwd: '/repo', generatedAt: 1, source: 'model',
            goal: '修复冒烟测试', decisions: [], files: [], omittedFiles: 0, verifications: [], omittedVerifications: 0,
            unfinished: [], notes: '',
          };

          window.fixture = {
            distillRequests: [],
            distillCancels: [],
            saves: [],
            reads: [],
            mode: 'ok',
            saveBehavior: 'ok',
            latestDoc: {
              scope: 'project',
              workspace: '/repo',
              path: '/repo/.vela/MEMORY.md',
              exists: true,
              content: '# Project Memory\\n\\n- **[命令]** Run pnpm test.\\n- **[规范]** Keep IPC strict.\\n',
              revision: 'rev-2',
            },
            release: null,
          };

          window.vela = {
            distillMemory: request => {
              fixture.distillRequests.push(request);
              if (fixture.mode === 'fail') return Promise.reject(new Error('等当前回复结束后再提炼项目记忆'));
              if (fixture.mode === 'hold') return new Promise(resolve => { fixture.release = () => resolve(structuredClone(baseDraft)); });
              if (fixture.mode === 'empty') return Promise.resolve(structuredClone({ ...baseDraft, exists: false, baseContent: '', baseRevision: 'absent', addition: '', summary: '' }));
              return Promise.resolve(structuredClone(baseDraft));
            },
            cancelMemoryDistill: async id => { fixture.distillCancels.push(id); },
            draftHandoff: async () => structuredClone(basePack),
            cancelHandoff: async () => undefined,
            memory: {
              read: async input => {
                fixture.reads.push(input);
                return { ok: true, value: structuredClone(fixture.latestDoc) };
              },
              save: async input => {
                fixture.saves.push(input);
                if (fixture.saveBehavior === 'conflict') {
                  fixture.saveBehavior = 'ok';
                  return { ok: false, error: { code: 'conflict', message: 'conflict', path: input.workspace + '/.vela/MEMORY.md' } };
                }
                return {
                  ok: true,
                  value: {
                    scope: 'project',
                    workspace: input.workspace,
                    path: input.workspace + '/.vela/MEMORY.md',
                    exists: true,
                    content: input.content,
                    revision: 'rev-saved',
                  },
                };
              },
            },
          };

          function Host() {
            const [distillOpen, setDistillOpen] = useState(false);
            const [handoffOpen, setHandoffOpen] = useState(false);
            const [savedCount, setSavedCount] = useState(0);
            window.openDistill = () => setDistillOpen(true);
            window.openHandoff = () => setHandoffOpen(true);
            return <div>
              <span id="saved-count">{savedCount}</span>
              {handoffOpen ? <HandoffPackDialog
                conversationId="chat-a"
                onDistillMemory={() => setDistillOpen(true)}
                onConfirm={async () => undefined}
                onClose={() => setHandoffOpen(false)}
              /> : null}
              {distillOpen ? <MemoryDistillDialog
                conversationId="chat-a"
                upToTurn={2}
                onSaved={() => setSavedCount(c => c + 1)}
                onClose={() => setDistillOpen(false)}
              /> : null}
            </div>;
          }
          createRoot(document.getElementById('root')).render(<Host />);
        `,
        resolveDir: resolve(here, "../../.."),
        loader: "tsx",
      },
      bundle: true,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      outfile: join(temporary, "ui.js"),
      loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' },
    });
    writeFileSync(
      join(temporary, "index.html"),
      '<!doctype html><html data-scheme="dark"><head><meta charset="utf-8"><style>' +
        readStyles(join(here, "../src/renderer/styles.css")) +
        '</style><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>',
    );
    const env = { ...process.env, VELA_DISTILL_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Memory distill dialog UI checks failed");
    } finally {
      clearTimeout(timer);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_DISTILL_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 760,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    try {
      await win.loadFile(join(process.env.VELA_DISTILL_TEMP, "index.html"));
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
        const prototype = HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${JSON.stringify(value)});
        control.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const button = (label, root = ".memory-distill-dialog") => evaluate(
        `Array.from(document.querySelectorAll(${JSON.stringify(root)} + ' button')).find(b => b.textContent.includes(${JSON.stringify(label)})).click()`,
      );
      const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
      const closedDistill = () => until("!document.querySelector('.memory-distill-dialog')");

      // 1. Loading & cancel passes requestId + upToTurn and cancels on close.
      await evaluate("fixture.mode = 'hold'; openDistill()");
      await until("Boolean(document.querySelector('.memory-distill-dialog[open]'))");
      assert.equal(await text(".memory-distill-state[role=status]"), "正在从对话提炼项目规范…");
      const firstReq = await evaluate("fixture.distillRequests[0]");
      assert.equal(firstReq.conversationId, "chat-a");
      assert.equal(firstReq.upToTurn, 2);
      assert.equal(firstReq.locale, "zh-CN");
      await button("取消");
      await closedDistill();
      assert.ok((await evaluate("fixture.distillCancels")).includes(firstReq.requestId));

      // 2. Load error + retry.
      await evaluate("fixture.mode = 'fail'; openDistill()");
      await until("Boolean(document.querySelector('.memory-distill-state[role=alert]'))");
      assert.ok((await text(".memory-distill-state[role=alert]")).includes("等当前回复结束"));
      await evaluate("fixture.mode = 'ok'");
      await button("重试");
      await until("Boolean(document.querySelector('.memory-distill-diff .diff-line.add'))");
      assert.ok((await text(".memory-distill-diff")).includes("Build before running smoke tests."));
      assert.ok((await text(".memory-distill-meta")).includes("/repo/.vela/MEMORY.md"));

      // 3. Edit addition updates live Diff preview; IME Cmd+Enter does not save.
      await button("编辑追加内容");
      await until("Boolean(document.querySelector('.memory-distill-editor'))");
      await evaluate("document.querySelector('.memory-distill-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, isComposing: true }))");
      assert.equal(await evaluate("fixture.saves.length"), 0);
      await setValue(".memory-distill-editor", "- **[依赖]** Require Node 22+.");
      await button("Diff 预览");
      await until("Boolean(document.querySelector('.memory-distill-diff .diff-line.add'))");
      assert.ok((await text(".memory-distill-diff")).includes("Require Node 22+."));

      // 4. Save conflict -> reload & re-merge -> save succeeds!
      await evaluate("fixture.saveBehavior = 'conflict'");
      await button("确认追加到 MEMORY.md");
      await until("Boolean(document.querySelector('.memory-distill-error-row'))");
      assert.equal(await evaluate("Boolean(document.querySelector('.memory-distill-dialog'))"), true);
      await button("重新读取并合并");
      await until("(document.querySelector('.memory-distill-diff')?.textContent ?? '').includes('Keep IPC strict.')");
      await button("确认追加到 MEMORY.md");
      await closedDistill();
      const lastSave = await evaluate("fixture.saves.at(-1)");
      assert.equal(lastSave.expectedRevision, "rev-2");
      assert.ok(lastSave.content.includes("Keep IPC strict."));
      assert.ok(lastSave.content.includes("Require Node 22+."));
      assert.equal(await text("#saved-count"), "1");

      // 5. Empty extraction notice + manual addition + over-limit guard.
      await evaluate("fixture.mode = 'empty'; openDistill()");
      await until("Boolean(document.querySelector('.memory-distill-empty'))");
      assert.ok((await text(".memory-distill-meta")).includes("新建文件"));
      await button("手动补充");
      await until("Boolean(document.querySelector('.memory-distill-editor'))");
      await setValue(".memory-distill-editor", "x".repeat(17 * 1024));
      await until("Boolean(document.querySelector('.memory-distill-error'))");
      assert.equal(await evaluate("document.querySelector('.memory-distill-dialog footer button.is-primary').disabled"), true);
      await button("取消");
      await closedDistill();

      // 6. HandoffPackDialog integration: button opens MemoryDistillDialog on top while preserving Handoff edits!
      await evaluate("fixture.mode = 'ok'; openHandoff()");
      await until("Boolean(document.querySelector('.handoff-dialog textarea'))");
      await setValue(".handoff-dialog textarea", "保留交接编辑内容");
      await button("提炼规范到项目记忆", ".handoff-dialog");
      await until("Boolean(document.querySelector('.memory-distill-dialog .memory-distill-diff'))");
      // Narrow layout check.
      win.setSize(420, 640);
      await new Promise(done => setTimeout(done, 100));
      assert.equal(await evaluate("(() => { const b = document.querySelector('.memory-distill-body'); return b.scrollWidth <= b.clientWidth + 1; })()"), true);
      assert.equal(await evaluate("(() => { const r = document.querySelector('.memory-distill-dialog footer').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })()"), true);

      await button("确认追加到 MEMORY.md");
      await closedDistill();
      assert.equal(await evaluate("document.querySelector('.handoff-dialog textarea').value"), "保留交接编辑内容");
      assert.equal(await text("#saved-count"), "2");

      console.log("PASS memory distill dialog: loading/cancel, retry, diff preview, live edit, conflict reload, empty+over-limit guard, handoff stacking, narrow layout");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
