/** Run after building: node_modules/.bin/electron apps/desktop/test/settings-electron-smoke.mjs */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const temporary = mkdtempSync(join(tmpdir(), "vela-settings-smoke-"));
const electronData = join(temporary, "electron"); const velaData = join(temporary, "vela");
mkdirSync(electronData); mkdirSync(velaData);
app.setPath("userData", electronData);
process.env.VELA_USER_DATA = velaData; process.env.VELA_CWD = temporary;
delete process.env.ELECTRON_RENDERER_URL; delete process.env.VELA_CAPTURE;
writeFileSync(join(velaData, "ui-state.json"), JSON.stringify({
  "vela.onboarding.complete": "true", "vela.appearance": "light", "vela.locale": "en",
  "vela.navLayout": '"classic"', "vela.borderlessInterface": "false",
}));
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label) { for (let i = 0; i < 100; i++) { if (await check()) return; await pause(50); } throw new Error(`Timed out: ${label}`); }

async function run() {
const watchdog = setTimeout(() => app.exit(1), 60000);
try {
  await import("../out/main/index.mjs");
  await until(() => BrowserWindow.getAllWindows().length > 0, "window");
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1200, 800);
  const errors = [];
  win.webContents.on("console-message", e => { if (e.level === "error") errors.push(e.message); });
  const ev = code => win.webContents.executeJavaScript(code, true);
  await until(() => ev("!!document.querySelector('.sidebar-user-pill')"), "renderer");
  await ev("document.querySelector('.sidebar-user-pill').click()");
  await until(() => ev("!!document.querySelector('.settings-nav-item')"), "settings");
  assert.equal(await ev("document.querySelector('.settings-header button')"), null, "settings header has no Done button");
  // Observe the write itself: checking only after the IPC resolves misses a one-frame Saving label.
  await ev(`(() => {
    window.inlineSavingFlashed = false;
    const content = document.querySelector('.settings-content');
    new MutationObserver(() => {
      if ([...content.querySelectorAll('.settings-autosave, [data-setting-id="global-prompt"] .settings-note')]
        .some(node => node.textContent.trim() === 'Saving')) window.inlineSavingFlashed = true;
    }).observe(content, { childList: true, characterData: true, subtree: true });
  })()`);
  const savedToasts = "[...document.querySelectorAll('.window-toast-stack:popover-open .window-toast-message[role=status]')].filter(node => node.textContent === 'Saved')";
  const checkSavedToast = async () => {
    await until(() => ev(`${savedToasts}.length === 1`), 'one save confirmation in the window toast stack');
    assert.equal(await ev('window.inlineSavingFlashed'), false, 'autosave does not flash an inline Saving label');
    assert.equal(await ev("[...document.querySelectorAll('.settings-content [role=status]')].some(node => node.textContent.trim() === 'Saved')"), false);
    await ev(`${savedToasts}[0].closest('.window-toast').querySelector('.window-toast-close').click()`);
    await until(() => ev(`!${savedToasts}.length`), 'save confirmation dismissed');
  };
  const labels = await ev("[...document.querySelectorAll('.settings-nav-group-label')].map(n => n.textContent)");
  const development = await ev("Boolean(window.vela.development)");
  assert.deepEqual(labels, ["General", "Agent", "Models & extensions", "Data & workspace", ...(development ? ["Development"] : [])]);
  const items = await ev("[...document.querySelectorAll('.settings-nav-item')].map(n => n.textContent)");
  assert.equal(items.length, development ? 22 : 21);
  assert.ok(items.includes("Hooks"));
  assert.ok(items.includes("Notifications"));
  await ev("[...document.querySelectorAll('.settings-nav-item')].find(n => n.textContent === 'Subagents').click()");
  await until(() => ev("!!document.querySelector('.custom-agent-add:enabled')"), "subagent settings loaded");
  await ev("document.querySelector('.custom-agent-add').click()");
  await ev(`(() => {
    const field = document.querySelector('.custom-agent-identity input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Smoke reviewer');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await ev("document.querySelector('.custom-agent-editor button[type=submit]').click()");
  await until(() => ev("document.querySelector('.custom-agent-list strong')?.textContent === 'Smoke reviewer'"), "custom profile saved");
  const [profile] = (await ev("window.vela.getAgentSettings()")).customSubagents;
  assert.equal(profile.name, "Smoke reviewer");
  assert.equal(profile.permission, "general");
  assert.ok(profile.icon);
  console.log("PASS custom subagent created through desktop settings and read back over IPC");
  const namingStyle = '[data-setting-id="subagent-naming-style"]';
  await until(() => ev("!!document.querySelector('" + namingStyle + " [role=radio]')"), "subagent naming style");
  const namingText = await ev("document.querySelector('" + namingStyle + "').textContent");
  assert.match(namingText, /Practical/);
  assert.match(namingText, /Artistic/);
  assert.match(namingText, /Curie/);
  assert.match(namingText, /Turing/);
  assert.match(namingText, /new subagents/);
  await ev("document.querySelector('" + namingStyle + " [role=radio]:nth-child(2)').click()");
  await until(() => ev("window.vela.getAgentSettings().then(s => s.subagentNamingStyle === 'artistic')"), "artistic naming style saved");
  assert.equal((await ev("window.vela.getAgentSettings()")).customSubagents[0].name, "Smoke reviewer");
  await checkSavedToast();
  console.log("PASS subagent naming style saves and shows a window toast");
  await ev("[...document.querySelectorAll('.settings-nav-item')].find(n => n.textContent === 'Notifications').click()");
  const completionSwitch = "document.querySelector('[data-setting-id=system-notifications] [aria-label=\"Also notify when tasks finish\"]')";
  await until(() => ev("!!" + completionSwitch), "notification settings");
  assert.equal(await ev(completionSwitch + ".getAttribute('aria-checked')"), "false");
  await ev(completionSwitch + ".click()");
  await until(() => ev("window.vela.resident.getSettings().then(s => s.notifications.notifyResults)"), "saved completion preference");
  console.log("PASS global notification settings save the shared completion preference");
  // the update page talks to the real main-process service over IPC
  await ev("[...document.querySelectorAll('.settings-nav-item')].find(n => n.textContent === 'About & updates').click()");
  await until(() => ev("!!document.querySelector('.update-card')"), "updates page");
  assert.match(await ev("document.querySelector('.update-version').textContent"), /^Vela \d+\.\d+\.\d+/);
  assert.equal(await ev("document.querySelector('[data-setting-id=\"update-auto\"] [role=switch]').getAttribute('aria-checked')"), "true");
  console.log("PASS updates page renders the current version and the automatic-update switch");

  // the storage page reads real checkpoint usage from the main process and cleans only after a confirmation
  await ev("[...document.querySelectorAll('.settings-nav-item')].find(n => n.textContent === 'Storage').click()");
  await until(() => ev("/^Using /.test(document.querySelector('[data-setting-id=\"checkpoint-storage\"] [role=status]')?.textContent ?? '')"), "storage usage");
  await ev("[...document.querySelectorAll('[data-setting-id=\"checkpoint-storage\"] button')].find(n => n.textContent === 'Clean up').click()");
  await until(() => ev("[...document.querySelectorAll('[data-setting-id=\"checkpoint-storage\"] button')].some(n => n.textContent === 'Confirm cleanup')"), "cleanup confirmation");
  await ev("[...document.querySelectorAll('[data-setting-id=\"checkpoint-storage\"] button')].find(n => n.textContent === 'Confirm cleanup').click()");
  await until(() => ev("[...document.querySelectorAll('.window-toast-message[role=status]')].some(node => node.textContent === 'Nothing to clean up.')"), "cleanup toast");
  assert.equal(await ev("document.querySelector('[data-setting-id=\"checkpoint-storage\"] .settings-saved')"), null);
  console.log("PASS storage page shows checkpoint usage and cleans after confirmation");

  // Hooks: the production renderer/preload/main/runtime chain, including an actual native command.
  await ev("[...document.querySelectorAll('.settings-nav-item')].find(n => n.textContent === 'Hooks').click()");
  await until(() => ev("!!document.querySelector('.hooks-config')"), "hooks config");
  const hooksConfig = JSON.stringify({ version: 1, hooks: [{ id: "smoke", event: "PreToolUse", command: "printf verified > hooks-smoke-marker", enabled: true }] }, null, 2);
  await ev(`(() => { const i=document.querySelector('.hooks-config');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(i,${JSON.stringify(hooksConfig)});i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const clickHook = text => ev(`[...document.querySelectorAll('.hooks-settings button')].find(n=>n.textContent===${JSON.stringify(text)}).click()`);
  await clickHook("Save configuration");
  await until(() => ev("[...document.querySelectorAll('.hooks-settings button')].some(n=>n.textContent==='Review and authorize' && !n.disabled)"), "hooks saved");
  await clickHook("Review and authorize");
  await until(() => ev("!!document.querySelector('.hooks-confirm pre')"), "hooks review");
  await clickHook("Authorize native execution");
  await until(() => ev("[...document.querySelectorAll('.hooks-settings button')].some(n=>n.textContent==='Revoke authorization')"), "hooks authorized");
  await clickHook("Test run");
  await until(() => ev("!!document.querySelector('.hooks-confirm')"), "hooks test confirmation");
  await clickHook("Run commands now");
  await until(() => ev("document.querySelector('.hooks-run')?.textContent.includes('Passed')"), "hooks test result");
  assert.equal(readFileSync(join(temporary, "hooks-smoke-marker"), "utf8"), "verified");
  await clickHook("Revoke authorization");
  await until(async () => !(await ev(`window.vela.getHooksCatalog({cwd:${JSON.stringify(temporary)}})`)).documents[1].trusted, "hooks revoked");
  console.log("PASS production Hooks settings save, reviewed approval, real command test, live history and revocation");

  // search → jump (permissions sits at the bottom of "Defaults & permissions")
  await ev("document.querySelector('.settings-search-input').focus()");
  const type = async text => { await ev(`(() => { const i = document.querySelector('.settings-search-input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', {bubbles:true})); })()`); await pause(100); };
  await type("sandbox");
  const first = await ev("document.querySelector('[role=option]')?.textContent");
  console.log("first result:", first);
  assert.match(first, /Execution permissions/);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  await until(() => ev("document.querySelector('.settings-nav-item.active')?.textContent === 'Defaults & permissions'"), "jump page");
  await pause(900);
  const geo = await ev(`(() => { const c = document.querySelector('.settings-content'); const p = document.querySelector('[data-setting-id="permissions"]'); const r = p.getBoundingClientRect(); const cr = c.getBoundingClientRect(); return { scrollTop: c.scrollTop, canScroll: c.scrollHeight > c.clientHeight, inView: r.top >= cr.top && r.bottom <= cr.bottom, view: document.querySelector('.settings-view').scrollTop, doc: document.scrollingElement.scrollTop, body: document.querySelector('.settings-body').scrollTop, headerTop: Math.round(document.querySelector('.settings-header').getBoundingClientRect().top), flash: p.classList.contains('setting-flash') }; })()`);
  console.log("geometry:", JSON.stringify(geo));
  assert.ok(geo.inView, "permissions block visible");
  assert.equal(geo.view, 0); assert.equal(geo.doc, 0); assert.equal(geo.body, 0);
  console.log("PASS search jumps and scrolls only the content pane");
  const dividers = await ev(`(() => {
    const list = document.querySelector('.settings-group-title + .settings-card');
    const widths = el => { const s = getComputedStyle(el); return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth]; };
    return [widths(list), widths(list.children[0]), widths(list.children[1])];
  })()`);
  assert.deepEqual(dividers, [["1px", "0px", "0px", "0px"], ["0px", "0px", "0px", "0px"], ["1px", "0px", "0px", "0px"]], "single dividers below the heading and between settings, without an outer frame");

  // scrollbars only show while scrolling
  const thumb = selector => ev(`getComputedStyle(document.querySelector('${selector}'), '::-webkit-scrollbar-thumb').backgroundColor`);
  const scrolling = selector => ev(`document.querySelector('${selector}').classList.contains('is-scrolling')`);
  await pause(1500);
  for (const selector of [".settings-content", ".settings-nav"]) {
    assert.equal(await scrolling(selector), false, `${selector} idle`);
    assert.equal(await thumb(selector), "rgba(0, 0, 0, 0)", `${selector} thumb hidden at rest`);
  }
  await ev("(() => { const c = document.querySelector('.settings-content'); c.scrollTop = c.scrollTop > 40 ? 0 : 40; })()");
  await pause(300);
  assert.equal(await scrolling(".settings-content"), true);
  assert.notEqual(await thumb(".settings-content"), "rgba(0, 0, 0, 0)", "thumb shows while scrolling");
  await pause(1600);
  assert.equal(await scrolling(".settings-content"), false);
  assert.equal(await thumb(".settings-content"), "rgba(0, 0, 0, 0)", "thumb hides again");
  console.log("PASS scrollbars appear only while scrolling");

  // autosave
  await ev("document.querySelector('.settings-content').scrollTop = 0");
  const setTextarea = (selector, value) => ev(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await setTextarea('textarea[aria-label="Extra instructions"]', "Prefer concise answers.");
  await pause(1500);
  assert.equal((await ev("window.vela.getAgentSettings()")).instructions, "Prefer concise answers.");
  await checkSavedToast();
  console.log("PASS instructions auto-save after typing stops");
  // 思考强度档位多时是下拉框(点开后在 body 下的列表里选),少时是单选按钮组
  await ev(`(() => { const g = document.querySelector('[aria-label="Default thinking level"]'); if (g.getAttribute('role') === 'combobox') g.click(); else [...g.querySelectorAll('[role=radio]')].find(b => b.textContent === 'High').click(); })()`);
  await pause(200);
  await ev(`(() => { const o = [...document.querySelectorAll('.settings-menu [role=option]')].find(b => b.textContent.trim() === 'High'); if (o) o.click(); })()`);
  await until(async () => (await ev("window.vela.getAgentSettings()")).thinkingLevel === "high", "thinking saved");
  await checkSavedToast();
  console.log("PASS thinking level saves immediately");

  const globalField = '[data-setting-id="global-prompt"] textarea[aria-label="Global prompt"]';
  const globalFieldValue = () => ev(`document.querySelector(${JSON.stringify(globalField)})?.value`);
  const storedGlobalPrompt = () => ev("window.vela.uiStorage.getItem('vela.globalPrompt')");
  const prompt = "Use metric units.\nExplain unfamiliar abbreviations.";
  assert.equal(await globalFieldValue(), "", "global prompt starts empty");
  await setTextarea(globalField, prompt);
  await until(async () => (await storedGlobalPrompt()) === prompt, "global prompt saved");
  await checkSavedToast();
  const invalidPromptError = await ev(`(() => {
    try { window.vela.uiStorage.setItem('vela.globalPrompt', 'x'.repeat(16001)); }
    catch (error) { return error.message; }
    return '';
  })()`);
  assert.match(invalidPromptError, /Invalid global prompt/);
  assert.equal(await storedGlobalPrompt(), prompt, "invalid IPC write preserves the saved global prompt");

  // remembered page
  await ev("document.querySelector('.nav-history-buttons button:first-child').click()");
  await until(() => ev("!document.querySelector('.settings-view')"), "back leaves settings");
  await ev("document.querySelector('.sidebar-user-pill').click()");
  await until(() => ev("!!document.querySelector('.settings-nav-item')"), "reopen");
  assert.equal(await ev("document.querySelector('.settings-nav-item.active').textContent"), "Defaults & permissions");
  assert.equal(await ev("window.vela.uiStorage.getItem('vela.settingsPage')"), '"defaults"');
  console.log("PASS remembers last page");
  await until(async () => (await globalFieldValue()) === prompt, "reopened global prompt");
  assert.equal(await ev(`${savedToasts}.length`), 0, 'opening saved settings must not replay feedback');
  await setTextarea(globalField, "");
  await until(async () => (await storedGlobalPrompt()) === null, "global prompt cleared");
  assert.equal((await ev("window.vela.getAgentSettings()")).instructions, "Prefer concise answers.");
  console.log("PASS global prompt persists across Settings visits and clears independently of extra instructions");
  assert.deepEqual(errors, []);
  console.log("ALL OK");
  clearTimeout(watchdog); app.quit();
} catch (error) { console.error("FAIL", error); clearTimeout(watchdog); app.exit(1); }
}
app.on("will-quit", () => rmSync(temporary, { recursive: true, force: true }));
app.whenReady().then(run);
