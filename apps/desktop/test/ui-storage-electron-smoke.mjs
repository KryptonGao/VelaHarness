/** Run after building: node_modules/.bin/electron apps/desktop/test/ui-storage-electron-smoke.mjs */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const temporary = mkdtempSync(join(tmpdir(), "vela-ui-storage-smoke-"));
const electronData = join(temporary, "electron"); const velaData = join(temporary, "vela");
mkdirSync(electronData); mkdirSync(velaData);
app.setPath("userData", electronData);
process.env.VELA_USER_DATA = velaData; process.env.VELA_CWD = temporary;
delete process.env.ELECTRON_RENDERER_URL; delete process.env.VELA_CAPTURE;
const stateFile = join(velaData, "ui-state.json");
writeFileSync(stateFile, JSON.stringify({ "vela.onboarding.complete": "true", "vela.locale": "en", "vela.seeded": "yes" }));
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label) { for (let i = 0; i < 100; i++) { if (await check()) return; await pause(50); } throw new Error(`Timed out: ${label}`); }
const saved = () => JSON.parse(readFileSync(stateFile, "utf8"));

async function run() {
  const watchdog = setTimeout(() => app.exit(1), 60000);
  try {
    await import("../out/main/index.mjs");
    await until(() => BrowserWindow.getAllWindows().length > 0, "window");
    const win = BrowserWindow.getAllWindows()[0];
    const ev = code => win.webContents.executeJavaScript(code, true);
    await until(() => ev("!!document.querySelector('.main-stage-pane > .main-chat-view')"), "renderer");
    assert.equal(await ev("window.vela.uiStorage.getItem('vela.seeded')"), "yes", "startup snapshot serves seeded values");
    assert.equal(await ev("window.vela.uiStorage.getItem('vela.neverSaved')"), undefined);
    await ev("window.vela.uiStorage.setItem('vela.smokeKey', 'one')");
    assert.equal(await ev("window.vela.uiStorage.getItem('vela.smokeKey')"), "one", "writes are visible to reads immediately");
    await until(() => saved()["vela.smokeKey"] === "one", "batched write reaches disk");
    // A write made right before quitting must still be on disk.
    await ev("window.vela.uiStorage.setItem('vela.lastWrite', 'before-quit')");
    app.once("will-quit", () => {
      try {
        assert.equal(saved()["vela.lastWrite"], "before-quit", "quit flushes the latest write");
        assert.equal(saved()["vela.seeded"], "yes");
        console.log("PASS quit flushes pending UI storage");
        console.log("ALL OK");
      } catch (error) { console.error("FAIL", error); process.exitCode = 1; }
    });
    clearTimeout(watchdog); app.quit();
  } catch (error) { console.error("FAIL", error); clearTimeout(watchdog); app.exit(1); }
}
app.on("will-quit", () => setTimeout(() => rmSync(temporary, { recursive: true, force: true }), 500));
app.whenReady().then(run);
