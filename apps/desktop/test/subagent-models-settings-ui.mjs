/** Exercise model-pool settings and custom subagent editing in the real renderer. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStyles } from "./read-styles.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(here, "package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-subagent-model-settings-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "test/subagent-models-settings-preview.tsx")], bundle: true,
      platform: "browser", format: "iife", jsx: "automatic", outfile: join(temporary, "ui.js"),
      alias: { "@vela/shared": resolve(here, "../../packages/shared/src/index.ts") },
      loader: { ".svg": "dataurl", ".css": "empty" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>' +
      readStyles(join(here, "src/renderer/styles.css")) +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_SUBAGENT_SETTINGS_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Subagent model description UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_SUBAGENT_SETTINGS_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 950, height: 800,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    const until = async code => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`Timed out: ${code}`);
    };
    const input = 'document.querySelector(".subagent-effort-dialog .subagent-description-input")';
    const typeValue = (value, field = input) => evaluate(`(() => {
      const node = ${field};
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value').set.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    })()`);
    const query = selector => `document.querySelector(${JSON.stringify(selector)})`;
    const click = selector => evaluate(`${query(selector)}.click()`);
    const choose = async (label, value) => {
      await click(`.custom-agent-controls [role="combobox"][aria-label="${label}"]`);
      const option = `[...document.querySelectorAll('[role=option]')].find(node => node.textContent.trim() === ${JSON.stringify(value)})`;
      await until(option);
      await evaluate(`${option}.click()`);
    };
    const openSettings = () => evaluate("document.querySelector('.subagent-effort-button').click()");
    const saveSettings = () => evaluate("document.querySelector('.workspace-settings-save').click()");
    const cancelSettings = () => evaluate("document.querySelector('.workspace-settings-cancel').click()");
    try {
      await win.loadFile(join(process.env.VELA_SUBAGENT_SETTINGS_TEMP, "index.html"), { query: { locale: "en" } });
      await until("document.querySelector('.subagent-pool-entry .subagent-pool-row')");
      assert.equal(await evaluate("document.querySelector('.subagent-description-input')"), null, "No textarea is spread across each model row");

      // Keep an unrelated save in flight while the modal draft is edited. Its response must not reset the draft.
      await evaluate("document.querySelector('.subagent-pool-group .subagent-pool-row').click()");
      await openSettings();
      await until(`${input}?.value === "Existing model note"`);
      assert.equal(await evaluate(`${input}.maxLength`), 500);
      const labels = ["Model description (optional)", "模型简介（可选）", "模型簡介（選填）", "モデルの説明（任意）", "모델 설명(선택 사항)"];
      const labelId = await evaluate(`${input}.getAttribute('aria-labelledby')`);
      assert.ok(labels.includes(await evaluate(`document.getElementById(${JSON.stringify(labelId)}).textContent`)), "Visible description label is localized");
      await typeValue("draft survives response");
      await until("window.subagentSettingsTest.getWrites().length === 1 && window.subagentSettingsTest.getSettings().subagentModels.length === 2");
      assert.equal(await evaluate(`${input}.value`), "draft survives response", "An unrelated save response does not reset the open modal draft");
      await cancelSettings();
      await until("!document.querySelector('.subagent-effort-dialog')");
      assert.equal(await evaluate("window.subagentSettingsTest.getSettings().subagentModels[0].description"), "Existing model note", "Cancel discards the draft");

      // Spaces and newlines within the description survive one combined save.
      await openSettings();
      await until(`${input}?.value === "Existing model note"`);
      const savedText = "Words separated by spaces\nand a second line";
      await typeValue(savedText);
      await new Promise(done => setTimeout(done, 300));
      assert.equal(await evaluate("window.subagentSettingsTest.getWrites().length"), 1, "Typing does not persist per keystroke");
      await saveSettings();
      await until(`window.subagentSettingsTest.getSettings().subagentModels[0].description === ${JSON.stringify(savedText)}`);
      assert.equal(await evaluate("window.subagentSettingsTest.getWrites().length"), 2, "Description and model settings save together");

      // Canceling an edited draft leaves the last saved value intact.
      await openSettings();
      await until(`${input}?.value === ${JSON.stringify(savedText)}`);
      await typeValue("Discard this description");
      await cancelSettings();
      await until("!document.querySelector('.subagent-effort-dialog')");
      assert.equal(await evaluate("window.subagentSettingsTest.getSettings().subagentModels[0].description"), savedText);

      // Removing a different model preserves the first model's description.
      await evaluate("document.querySelectorAll('.subagent-pool-entry .subagent-pool-row')[1].click()");
      await until("window.subagentSettingsTest.getSettings().subagentModels.length === 1");
      assert.equal(await evaluate("window.subagentSettingsTest.getSettings().subagentModels[0].description"), savedText);

      // Clearing and changing reasoning effort are committed together.
      await openSettings();
      await until(`${input}?.value === ${JSON.stringify(savedText)}`);
      await typeValue("");
      await evaluate("document.querySelector('.subagent-effort-option[aria-pressed=\"true\"]').click()");
      await saveSettings();
      await until("window.subagentSettingsTest.getSettings().subagentModels[0].thinkingLevels?.length === 3 && !('description' in window.subagentSettingsTest.getSettings().subagentModels[0])");

      await openSettings();
      await until(`${input}?.value === ""`);
      await typeValue("Keep through effort save");
      await evaluate("document.querySelector('.subagent-effort-option[aria-pressed=\"true\"]').click()");
      await saveSettings();
      await until("window.subagentSettingsTest.getSettings().subagentModels[0].thinkingLevels?.length === 2 && window.subagentSettingsTest.getSettings().subagentModels[0].description === 'Keep through effort save'");
      await win.loadFile(join(process.env.VELA_SUBAGENT_SETTINGS_TEMP, "index.html"), { query: { locale: "zh-CN" } });
      await until("document.querySelector('.custom-agent-add:enabled')");
      await click(".custom-agent-add");
      const name = query(".custom-agent-identity input");
      const description = query(".custom-agent-editor input:not([required])");
      const prompt = query(".custom-agent-editor textarea");
      const submit = ".custom-agent-editor button[type=submit]";
      await typeValue("Explore", name);
      await until(`${query(submit)}.disabled && ${name}.getAttribute('aria-invalid') === 'true'`);
      await typeValue("代码审阅", name);
      await typeValue("检查代码变更与现有调用方的兼容性。", description);
      const instructions = "审阅改动时，给出文件和行号。\n说明受影响的调用方。";
      await typeValue(instructions, prompt);
      await click(".custom-agent-pager button:last-child");
      await click(".custom-agent-icon:nth-child(3)");
      const icon = await evaluate("document.querySelector('.custom-agent-icon[aria-pressed=true] img').src");
      await choose("模型", "Claude Opus");
      await choose("推理强度", "高");
      await choose("权限", "Explore · 只读");
      if (process.env.VELA_SUBAGENT_EDITOR_SCREENSHOT) {
        await until("!document.querySelector('[role=listbox]')");
        await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        writeFileSync(process.env.VELA_SUBAGENT_EDITOR_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      }
      await click(submit);
      const profiles = "window.subagentSettingsTest.getSettings().customSubagents";
      await until(`${profiles}?.length === 1 && !document.querySelector('.custom-agent-editor')`);
      const saved = await evaluate(`${profiles}[0]`);
      assert.equal(saved.name, "代码审阅");
      assert.equal(saved.description, "检查代码变更与现有调用方的兼容性。");
      assert.equal(saved.systemPrompt, instructions);
      assert.equal(saved.permission, "explore");
      assert.deepEqual(saved.model, { provider: "anthropic", modelId: "claude-opus", thinkingLevel: "high" });
      assert.equal(await evaluate("document.querySelector('.custom-agent-list img').src"), icon);
      const edit = ".custom-agent-list button[id^=edit-custom-subagent-]";
      await click(edit);
      assert.equal(await evaluate(`${prompt}.value`), instructions);
      await typeValue("Discard", name);
      await click(".custom-agent-actions button[type=button]");
      assert.equal(await evaluate(`${profiles}[0].name`), saved.name);
      await click(edit);
      await choose("模型", "沿用子代理模型设置");
      await click(submit);
      await until(`!${profiles}[0].model && !document.querySelector('.custom-agent-editor')`);
      assert.equal(await evaluate(`${profiles}[0].id`), saved.id);
      await click(".custom-agent-delete");
      await click(".custom-agent-delete.is-armed");
      await until(`${profiles}.length === 0 && !document.querySelector('.custom-agent-list')`);
      assert.deepEqual(errors, [], "No renderer console errors");
      console.log("Subagent settings UI passed for model-pool saves and custom profile creation, editing, cancellation and deletion.");
      app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(await evaluate(`window.subagentSettingsTest?.getSettings?.()`));
      app.exit(1);
    }
  });
}
