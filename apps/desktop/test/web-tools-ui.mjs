/** Focused renderer behavior checks for the Web tools settings section: node apps/desktop/test/web-tools-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));

const mockScript = String.raw`
(() => {
  const deepseek = {
    id: "deepseek", name: "DeepSeek", builtin: true,
    search: { url: "https://api.deepseek.com/v1/tools/search", method: "POST", auth: { type: "bearer" }, body: {}, resultsPath: "results", fields: { title: "title", url: "url" } },
    fetch: { url: "https://api.deepseek.com/v1/tools/fetch", method: "POST", auth: { type: "bearer" }, body: {}, contentPath: "content" },
  };
  const f = window.fixture = {
    calls: [],
    config: { enabled: false, searchProviderId: null, fetchProviderId: null, providers: [] },
    keys: {},
    keysAvailable: true,
    failSave: null,
    testResult: null,
  };
  const view = () => ({
    enabled: f.config.enabled,
    searchProviderId: f.config.searchProviderId,
    fetchProviderId: f.config.fetchProviderId,
    keysAvailable: f.keysAvailable,
    providers: [deepseek, ...f.config.providers].map((provider) => ({ ...provider, hasKey: !!f.keys[provider.id] })),
  });
  window.vela = {
    webTools: {
      get: async () => { f.calls.push({ method: "get" }); return { ok: true, value: view() }; },
      save: async (config) => {
        f.calls.push({ method: "save", input: JSON.parse(JSON.stringify(config)) });
        if (f.failSave) return { ok: false, ...f.failSave };
        f.config = JSON.parse(JSON.stringify(config));
        return { ok: true, value: view() };
      },
      setApiKey: async (input) => {
        f.calls.push({ method: "setApiKey", input: { ...input } });
        if (input.apiKey) f.keys[input.providerId] = input.apiKey; else delete f.keys[input.providerId];
        return { ok: true, value: view() };
      },
      test: async (input) => {
        f.calls.push({ method: "test", input: { ...input } });
        return f.testResult ?? { ok: true, value: { durationMs: 120, size: input.capability === "search" ? 5 : 4321, title: null } };
      },
    },
  };
})();
`;

if (!process.versions.electron) {
  const temp = mkdtempSync(join(tmpdir(), "vela-web-tools-ui-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { WebToolsSettingsSection } from './apps/desktop/src/renderer/components/WebToolsSettingsSection';
      const root = createRoot(document.getElementById('root'));
      window.renderWeb = (locale) => root.render(<WebToolsSettingsSection locale={locale} />);
      window.unmountWeb = () => root.render(null);
      window.renderWeb('en');
    `,
        resolveDir: resolve(here, "../../.."),
        loader: "tsx",
      },
      loader: { ".svg": "dataurl" },
      bundle: true,
      outfile: join(temp, "ui.js"),
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    });
    writeFileSync(
      join(temp, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"><style>' +
        readFileSync(resolve(here, "../src/renderer/styles.css"), "utf8") +
        '</style></head><body><div id="root" style="padding:24px;max-width:800px;overflow:auto;height:100vh"></div><script>' +
        mockScript +
        '</script><script src="ui.js"></script></body></html>',
    );
    const env = { ...process.env, VELA_WEB_UI_TEMP: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    const code = await new Promise((res, rej) => {
      child.once("error", rej);
      child.once("exit", res);
    });
    clearTimeout(timer);
    assert.equal(code, 0, "Web tools renderer behavior checks failed");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_WEB_UI_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1000,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    try {
      await win.loadFile(join(process.env.VELA_WEB_UI_TEMP, "index.html"));
      const evaluate = (code) => win.webContents.executeJavaScript(code);
      const until = async (code) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (await evaluate(code)) return;
          await new Promise((res) => setTimeout(res, 20));
        }
        throw new Error("Timed out: " + code);
      };
      const click = (label, scope = "document") =>
        evaluate(`Array.from(${scope}.querySelectorAll('button')).find(node => node.textContent === ${JSON.stringify(label)}).click()`);
      const setValue = (selector, value, proto = "HTMLInputElement") =>
        evaluate(
          "(() => { const control = " + selector + ";" +
          "Object.getOwnPropertyDescriptor(" + proto + ".prototype,'value').set.call(control," + JSON.stringify(value) + ");" +
          "control.dispatchEvent(new Event(" + JSON.stringify(proto === "HTMLSelectElement" ? "change" : "input") + ",{bubbles:true}));return control.value; })()",
        );
      const selects = () => "document.querySelectorAll('.web-tools-settings .settings-form select')";
      const saves = () => evaluate("fixture.calls.filter(call => call.method === 'save')");

      // 初始：关闭，DeepSeek 内置且没有密钥，密钥输入框是密码框。
      await until("document.querySelectorAll('.web-tools-provider').length === 1");
      assert.equal(await evaluate("document.querySelector('[role=switch]').getAttribute('aria-checked')"), "false");
      const deepseekText = await evaluate("document.querySelector('.web-tools-provider').textContent");
      assert.ok(deepseekText.includes("DeepSeek") && deepseekText.includes("Built-in") && deepseekText.includes("No key"), deepseekText);
      assert.ok(deepseekText.includes("5 RMB per 1,000"));
      assert.equal(await evaluate("document.querySelector('.web-tools-key-row input').type"), "password");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.web-tools-tests button')).every(node => node.disabled)"), true);
      console.log("PASS initial state shows the built-in DeepSeek provider without a key");

      // 保存密钥：只发送一次，输入框清空，界面不回显密钥。
      await setValue("document.querySelector('.web-tools-key-row input')", "sk-ui-secret");
      await click("Save key");
      await until("document.querySelector('.web-tools-provider').textContent.includes('Key saved')");
      assert.deepEqual(await evaluate("fixture.calls.find(call => call.method === 'setApiKey').input"), { providerId: "deepseek", apiKey: "sk-ui-secret" });
      assert.equal(await evaluate("document.querySelector('.web-tools-key-row input').value"), "");
      assert.ok(!(await evaluate("document.body.innerText + document.body.innerHTML")).includes("sk-ui-secret"));
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.web-tools-key-row button')).map(node => node.textContent).join('|')"), "Replace key|Remove key");
      console.log("PASS saving a key is write-only and clears the field");

      // 选择提供商，再打开总开关。
      await setValue(selects() + "[0]", "deepseek", "HTMLSelectElement");
      await until("fixture.config.searchProviderId === 'deepseek'");
      await setValue(selects() + "[1]", "deepseek", "HTMLSelectElement");
      await until("fixture.config.fetchProviderId === 'deepseek'");
      await evaluate("document.querySelector('[role=switch]').click()");
      await until("fixture.config.enabled === true && document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true'");
      const lastSave = (await saves()).at(-1).input;
      assert.deepEqual(lastSave, { enabled: true, searchProviderId: "deepseek", fetchProviderId: "deepseek", providers: [] });
      console.log("PASS provider selection and master switch persist through save");

      // 测试按钮：成功与失败。
      await evaluate("Array.from(document.querySelectorAll('.web-tools-tests button')).find(node => node.textContent === 'Test search').click()");
      await until("document.querySelector('.web-tools-tests').textContent.includes('Search worked: 5 results in 120 ms')");
      await evaluate("fixture.testResult = { ok: false, code: 'auth', message: 'HTTP 401' }");
      await evaluate("Array.from(document.querySelectorAll('.web-tools-tests button')).find(node => node.textContent === 'Test fetch').click()");
      await until("document.querySelector('.web-tools-tests').textContent.includes('rejected the key')");
      await evaluate("fixture.testResult = null");
      console.log("PASS test buttons report success and mapped failures");

      // 保存失败时回滚显示并给出错误。
      await evaluate("fixture.failSave = { code: 'storage', message: 'disk' }");
      await evaluate("document.querySelector('[role=switch]').click()");
      await until("!!document.querySelector('.web-tools-settings [role=alert]')");
      assert.ok((await evaluate("document.querySelector('.web-tools-settings [role=alert]').textContent")).includes("encrypted storage"));
      assert.equal(await evaluate("document.querySelector('[role=switch]').getAttribute('aria-checked')"), "true");
      await evaluate("fixture.failSave = null");
      console.log("PASS a failed save keeps the real state and shows the error");

      // 自定义提供商：校验错误、保存、被选用、删除时清除选择。
      await click("Add custom provider");
      await until("!!document.querySelector('.web-tools-editor')");
      await click("Save provider");
      await until("!!document.querySelector('.web-tools-editor [role=alert]')");
      assert.ok((await evaluate("document.querySelector('.web-tools-editor [role=alert]').textContent")).includes("Enter a name"));
      await setValue("document.querySelector('.web-tools-editor input')", "My Search");
      await click("Save provider");
      await until("!!document.querySelector('.web-tools-editor [role=alert]') && document.querySelector('.web-tools-editor [role=alert]').textContent.includes('endpoint URL')");
      await setValue("document.querySelector('.web-tools-editor input[placeholder=\"https://api.example.com/v1/search\"]')", "https://search.example.com/v1/q");
      await setValue("document.querySelector('.web-tools-editor textarea.web-tools-code')", '{"q":"{{query}}","n":"{{count}}"}', "HTMLTextAreaElement");
      const fieldInputs = "Array.from(document.querySelectorAll('.web-tools-editor .web-tools-grid input'))";
      await setValue(fieldInputs + "[0]", "name");
      await setValue(fieldInputs + "[1]", "link");
      await setValue("document.querySelectorAll('.web-tools-editor .settings-optional')[0].querySelectorAll('input')[2]", "data.items");
      await click("Save provider");
      await until("!document.querySelector('.web-tools-editor')");
      const added = (await saves()).at(-1).input;
      assert.equal(added.providers.length, 1);
      assert.equal(added.providers[0].name, "My Search");
      assert.equal(added.providers[0].search.url, "https://search.example.com/v1/q");
      assert.equal(added.providers[0].search.resultsPath, "data.items");
      assert.equal(added.providers[0].fetch, undefined);
      assert.ok(!("hasKey" in added.providers[0]));
      await until("document.querySelectorAll('.web-tools-provider').length === 2");
      const customId = added.providers[0].id;
      // 没有密钥的自定义提供商在选择框里带「无密钥」标记，且只出现在搜索选择框。
      assert.ok((await evaluate(selects() + "[0].textContent")).includes("My Search (no key)"));
      assert.ok(!(await evaluate(selects() + "[1].textContent")).includes("My Search"));
      console.log("PASS custom provider is validated, saved and offered only for its capability");

      await setValue(selects() + "[0]", customId, "HTMLSelectElement");
      await until("fixture.config.searchProviderId === " + JSON.stringify(customId));
      await evaluate("Array.from(document.querySelectorAll('.web-tools-provider')[1].querySelectorAll('button')).find(node => node.textContent === 'Delete').click()");
      await until("Array.from(document.querySelectorAll('button')).some(node => node.textContent === 'Confirm delete')");
      await click("Confirm delete");
      await until("document.querySelectorAll('.web-tools-provider').length === 1");
      assert.equal(await evaluate("fixture.config.searchProviderId"), null);
      assert.equal(await evaluate("fixture.config.providers.length"), 0);
      console.log("PASS deleting a selected custom provider clears the selection");

      // 删除密钥。
      await click("Remove key");
      await until("document.querySelector('.web-tools-provider').textContent.includes('No key')");
      assert.equal(await evaluate("fixture.keys.deepseek"), undefined);
      console.log("PASS removing the key resets the provider");

      // 加密存储不可用：提示错误，密钥输入禁用。
      await evaluate("fixture.keysAvailable = false; window.unmountWeb()");
      await until("!document.querySelector('.web-tools-settings')");
      await evaluate("window.renderWeb('en')");
      await until("document.querySelectorAll('.web-tools-provider').length === 1");
      assert.equal(await evaluate("document.querySelector('.web-tools-key-row input').disabled"), true);
      assert.ok((await evaluate("document.querySelector('.web-tools-settings').textContent")).includes("System encrypted storage is unavailable"));
      await evaluate("fixture.keysAvailable = true");
      console.log("PASS unavailable encrypted storage disables key entry");

      // 中文界面文案。
      await evaluate("window.renderWeb('zh-CN')");
      await until("document.querySelector('.web-tools-settings')?.textContent.includes('启用网页搜索与抓取')");
      const zhText = await evaluate("document.querySelector('.web-tools-settings').textContent");
      assert.ok(zhText.includes("内置") && zhText.includes("添加自定义提供商"), zhText);
      console.log("PASS Chinese copy renders for the web tools section");

      // 没有预加载 API 时给出提示而不是崩溃。
      await evaluate("window.vela = undefined; window.renderWeb('en')");
      await until("document.querySelector('.web-tools-settings')?.textContent.includes('not available')");
      console.log("PASS missing API renders a notice");

      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
