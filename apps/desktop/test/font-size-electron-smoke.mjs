/** Run after building: node_modules/.bin/electron apps/desktop/test/font-size-electron-smoke.mjs */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const temporary = mkdtempSync(join(tmpdir(), "vela-font-size-"));
const electronData = join(temporary, "electron"); const velaData = join(temporary, "vela");
mkdirSync(electronData); mkdirSync(velaData);
app.setPath("userData", electronData);
process.env.VELA_USER_DATA = velaData; process.env.VELA_CWD = temporary;
delete process.env.ELECTRON_RENDERER_URL; delete process.env.VELA_CAPTURE;
writeFileSync(join(velaData, "ui-state.json"), JSON.stringify({
  "vela.onboarding.complete": "true", "vela.appearance": "light", "vela.locale": "en",
  "vela.font.ui.size": "12", "vela.font.code.size": "20",
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
  const ev = code => win.webContents.executeJavaScript(code, true);
  await until(() => ev("!!document.querySelector('.sidebar-user-pill')"), "renderer");
  // stored sizes are applied before first paint
  assert.equal(Number(await ev("document.documentElement.style.getPropertyValue('--ui-scale')")), 12 / 15);
  assert.equal(Number(await ev("document.documentElement.style.getPropertyValue('--code-scale')")), 20 / 14);
  assert.equal(await ev("getComputedStyle(document.body).fontSize"), "12px");
  console.log("PASS stored sizes apply to the root scale variables and body text");

  await ev("document.querySelector('.sidebar-user-pill').click()");
  await until(() => ev("!!document.querySelector('.settings-nav-item')"), "settings");
  await ev("[...document.querySelectorAll('.settings-nav-item')].find(n => n.textContent === 'Appearance').click()");
  await until(() => ev("!!document.querySelector('[data-setting-id=\"ui-font-size\"] input')"), "appearance page");
  const setNumber = (id, value) => ev(`(() => { const i = document.querySelector('[data-setting-id="${id}"] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(String(value))}); i.dispatchEvent(new Event('input', {bubbles:true})); i.dispatchEvent(new FocusEvent('focusout', {bubbles:true})); i.blur(); })()`);
  await setNumber("ui-font-size", 99);
  await until(() => ev("document.documentElement.style.getPropertyValue('--ui-scale') === '1'"), "ui clamp to 15");
  assert.equal(await ev("document.querySelector('[data-setting-id=\"ui-font-size\"] input').value"), "15");
  await setNumber("code-font-size", 3);
  await until(() => ev("document.documentElement.style.getPropertyValue('--code-scale') === String(8 / 14)"), "code clamp to 8");
  assert.equal(await ev("document.querySelector('[data-setting-id=\"code-font-size\"] input').value"), "8");
  assert.equal(await ev("getComputedStyle(document.body).fontSize"), "15px");
  const stored = JSON.parse((await import("node:fs")).readFileSync(join(velaData, "ui-state.json"), "utf8"));
  console.log("PASS out-of-range input clamps to 15 / 8; stored:", stored["vela.font.ui.size"], stored["vela.font.code.size"]);
  // a monospace rule follows the code scale, a sans rule the ui scale
  const sizes = await ev(`(() => { const probe = (cls) => { const e = document.createElement('div'); e.className = cls; document.body.append(e); const s = getComputedStyle(e).fontSize; e.remove(); return s; }; return { code: probe('settings-path'), ui: probe('tb-limit-label') }; })()`);
  console.log("probe sizes:", JSON.stringify(sizes));
  assert.ok(Math.abs(Number.parseFloat(sizes.code) - 8) < 0.01, sizes.code);
  assert.equal(sizes.ui, "13px");
  console.log("PASS monospace text follows the code size, interface text follows the interface size");
  console.log("ALL OK");
  clearTimeout(watchdog);
  app.quit();
} catch (error) {
  console.error("FAIL", error);
  clearTimeout(watchdog);
  app.exit(1);
}
}
app.on("will-quit", () => rmSync(temporary, { recursive: true, force: true }));
app.whenReady().then(run);
