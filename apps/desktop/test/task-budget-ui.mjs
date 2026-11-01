/** 会话上限页：SubAgents 独立开关、保留限制、会话隔离与保存失败反馈。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStyles } from "./read-styles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-task-budget-ui-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { defaultTaskBudgetSettings, parseTaskBudgetSettings } from './packages/shared/src/index';
        import { TaskBudgetTab } from './apps/desktop/src/renderer/components/TaskBudgetTab';
        import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
        const root = createRoot(document.getElementById('root'));
        const global = { ...defaultTaskBudgetSettings, enabled: false, maxSubagents: 7, allowNestedSubagents: false };
        const overrides = new Map();
        const conversation = id => ({global, override: overrides.get(id) ?? null, effective: overrides.get(id) ?? global});
        window.commits = [];
        window.failSave = false;
        window.readBudget = conversation;
        window.vela = {
          getConversationTaskBudget: async id => conversation(id),
          setConversationTaskBudget: async (id, next) => {
            if (window.failSave) throw new Error('保存失败');
            const parsed = next === null ? null : parseTaskBudgetSettings(next);
            overrides.set(id, parsed);
            window.commits.push({id, next: parsed});
            return conversation(id);
          },
        };
        let revision = 0;
        window.mount = (id, locale, theme) => {
          setActiveLocale(locale);
          document.documentElement.dataset.scheme = theme;
          flushSync(() => root.render(<AppLocaleProvider locale={locale}><TaskBudgetTab key={++revision} conversationId={id} budget={null} /></AppLocaleProvider>));
        };
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(temporary, "ui.js"),
      loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" }, logLevel: "error",
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>' + readStyles(join(here, "../src/renderer/styles.css")) + '</style></head><body><div id="root" style="height:100vh;display:flex"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_TASK_BUDGET_UI_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "会话上限页 Electron 检查失败");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_TASK_BUDGET_UI_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 960, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", details => { if (details.level === "error" && !details.message.includes("Electron Security Warning")) errors.push(details.message); });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`超时: ${code}`);
    };
    const toggle = '.tb-subagents [role="switch"]';
    const clickToggle = () => evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
    const checked = state => `document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-checked') === '${state}'`;
    try {
      await win.loadFile(join(process.env.VELA_TASK_BUDGET_UI_TEMP, "index.html"));
      for (const [locale, label] of [["zh-CN", "启用 SubAgents"], ["en", "Enable SubAgents"], ["zh-TW", "啟用 SubAgents"], ["ja", "SubAgents を有効にする"], ["ko", "SubAgents 사용"]]) {
        for (const theme of ["light", "dark"]) {
          const id = `${locale}-${theme}`;
          await evaluate(`window.mount(${JSON.stringify(id)}, ${JSON.stringify(locale)}, ${JSON.stringify(theme)})`);
          await until(checked(true));
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-label')`), label);
          assert.equal(await evaluate("window.commits.length"), 0, "加载设置不应写入自定义值");
          assert.equal(await evaluate("document.querySelector('.tb-fields > .tb-enable [role=switch]').getAttribute('aria-checked')"), "false", "用量上限关闭不影响 SubAgents");
          await clickToggle();
          await until(checked(false));
          assert.equal(await evaluate("document.querySelector('.tb-subagents input').disabled"), true);
          assert.equal(await evaluate("document.querySelectorAll('.tb-subagents [role=switch]')[1].disabled"), true);
          assert.deepEqual(await evaluate(`(() => {const s = window.readBudget(${JSON.stringify(id)}).override; return [s.subagentsEnabled, s.maxSubagents, s.allowNestedSubagents, s.enabled];})()`), [false, 7, false, false]);
          await evaluate(`window.mount('other', ${JSON.stringify(locale)}, ${JSON.stringify(theme)})`);
          await until(checked(true));
          assert.equal(await evaluate("window.readBudget('other').override"), null, "其他对话不受影响");
          await evaluate(`window.mount(${JSON.stringify(id)}, ${JSON.stringify(locale)}, ${JSON.stringify(theme)})`);
          await until(checked(false));
          assert.equal(await evaluate("document.querySelector('.tb-subagents input').value"), "7", "重载保留数量");
          await clickToggle();
          await until(checked(true));
          assert.equal(await evaluate("document.querySelector('.tb-subagents input').disabled"), false);
          assert.equal(await evaluate("document.querySelectorAll('.tb-subagents [role=switch]')[1].getAttribute('aria-checked')"), "false", "重开保留嵌套设置");
          await evaluate("window.failSave = true");
          await clickToggle();
          await until("Boolean(document.querySelector('.settings-error')?.textContent.trim())");
          assert.ok(await evaluate(checked(true)), "失败不应假装已关闭");
          await evaluate("window.failSave = false; window.commits = []");
          assert.equal(await evaluate("window.readBudget('other').global.subagentsEnabled"), true, "未修改全局默认");
        }
      }
      await evaluate("window.mount('global-check', 'en', 'light')");
      await until(checked(true));
      await clickToggle();
      await until(checked(false));
      // 关闭的全局值在摘要里不能仍显示为启用。
      await evaluate("window.readBudget('global-check').global.subagentsEnabled = false; document.querySelectorAll('.tb-seg [role=radio]')[1].click()");
      await until("document.querySelector('.tb-note')?.textContent.includes('SubAgents off')");
      assert.deepEqual(errors, []);
      console.log("PASS: SubAgents 会话开关，五种语言 × 两种主题、独立保存、重载、会话隔离、恢复限制、失败反馈和全局摘要");
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { win.destroy(); app.exit(process.exitCode ?? 0); }
  }).catch(error => { console.error(error); app.exit(1); });
}
