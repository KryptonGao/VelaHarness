import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { app, BrowserWindow } from "electron";

const dir = mkdtempSync(join(tmpdir(), "vela-codex-usage-ui-"));
const home = join(dir, "vela");
process.env.VELA_USER_DATA = home;
process.env.VELA_CWD = dir;
app.setPath("userData", dir);
process.env.CODEX_HOME = join(dir, "codex");
process.env.PI_OFFLINE = "1";
delete process.env.ELECTRON_RENDERER_URL;
mkdirSync(home);
mkdirSync(join(process.env.CODEX_HOME, "archived_sessions"), { recursive: true });
writeFileSync(join(home, "ui-state.json"), JSON.stringify({
  "vela.onboarding.complete": "true", "vela.locale": "en", "vela.settingsPage": '"usage"',
  "vela.navLayout": '"classic"', "vela.borderlessInterface": "false",
}));
const usage = { input_tokens: 1000000, cached_input_tokens: 250000, output_tokens: 100, total_tokens: 1000100 };
const cumulative = requests => Object.fromEntries(Object.entries(usage).map(([key, count]) => [key, count * requests]));
const lines = [
  ["session_meta", { originator: "Codex Desktop", id: "test", model_provider: "offline-provider" }],
  ["turn_context", { turn_id: "test-turn", model: "desktop-only", service_tier: "default" }],
  ["event_msg", { type: "token_count", info: { last_token_usage: usage, total_token_usage: usage } }],
  ["turn_context", { turn_id: "fast-turn", model: "desktop-only", service_tier: "priority" }],
  ["event_msg", { type: "token_count", info: { last_token_usage: usage, total_token_usage: cumulative(2) } }],
  ["turn_context", { turn_id: "unnamed-turn" }],
  ["event_msg", { type: "token_count", info: { last_token_usage: usage, total_token_usage: cumulative(3) } }],
].map(([type, payload], ordinal) => JSON.stringify({ timestamp: new Date().toISOString(), ordinal, type, payload }));
writeFileSync(join(process.env.CODEX_HOME, "archived_sessions", "test.jsonl.zst"), zstdCompressSync(lines.join("\n") + "\n"));

const damagedArchive = join(process.env.CODEX_HOME, "archived_sessions", "damaged.jsonl.zst");
writeFileSync(damagedArchive, "invalid zstd");

async function until(test, label) {
  const end = Date.now() + 12_000;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error("Timed out waiting for " + label);
}

async function runSmoke() {
  await import("../out/main/index.mjs");
  await until(() => BrowserWindow.getAllWindows().length, "main window");
  const win = BrowserWindow.getAllWindows()[0];
  const run = code => win.webContents.executeJavaScript(code, true);
  await until(() => run("Boolean(document.querySelector('.sidebar-user-pill'))"), "settings entry");
  await run("document.querySelector('.sidebar-user-pill').click()");
  const toggle = "document.querySelector('[role=switch][aria-label=\"Sync local Codex App usage\"]')";
  await until(() => run(`Boolean(${toggle})`), "usage settings");
  assert.equal(await run(`${toggle}.getAttribute('aria-checked')`), "false");
  assert.deepEqual(await run("window.vela.getCodexAppUsage()"), { buckets: [], incompleteFiles: 0 });
  assert.equal(existsSync(join(home, "codex-usage-v1.sqlite")), false);
  await run(`${toggle}.click()`);
  const row = "document.querySelector('.usage-model-table tbody tr')";
  await until(() => run(`${row}?.textContent.includes('desktop-only')`), "archived Codex usage");
  async function pick(label, option) {
    const trigger = `document.querySelector('[role=combobox][aria-label="${label}"]')`;
    await run(`${trigger}.scrollIntoView({ block: 'center', behavior: 'instant' });
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    await run(`${trigger}.click()`);
    const options = `[...document.querySelectorAll('[role=listbox][aria-label="${label}"] .settings-menu-label')]`;
    const labels = await run(`${options}.map(n => n.textContent)`);
    assert.equal(labels.filter(text => text === option).length, 1, `${label} options: ${labels.join(", ")}`);
    await run(`${options}.find(n => n.textContent === '${option}').closest('[role=option]').click()`);
  }
  const warning = "document.querySelector('.usage-incomplete-warning')";
  await until(() => run(`Boolean(${warning})`), "incomplete metering warning");
  assert.equal(await run(`${warning} === document.querySelector('.settings-usage').lastElementChild
    && ${toggle}.closest('.settings-group') === ${warning}.previousElementSibling`), true);
  assert.equal(await run(`getComputedStyle(${warning}).borderRadius === getComputedStyle(${toggle}.closest('.settings-card')).borderRadius`), true);
  assert.equal(await run(`${warning}.querySelector('button').textContent`), "Ignore");
  await run(`${warning}.querySelector('button').click()`);
  await until(() => run(`!${warning}`), "dismissed warning");
  await pick("Source", "Vela");
  await until(() => run(`!${row}`), "Vela-only totals");
  await pick("Source", "Codex App");
  await until(() => run(`Boolean(${row})`), "Codex-only totals");
  assert.deepEqual(await run("[...document.querySelectorAll('.usage-model-table tbody th')].map(n => n.textContent)"), ["desktop-only", "Not reported"]);
  assert.equal(await run("[...document.querySelectorAll('.usage-summary-card')].find(n => n.querySelector('span').textContent === 'Not reported').querySelector('strong').textContent"), "1");
  assert.equal(await run(`${row}.cells[4].textContent`), "2");
  assert.equal(await run(`Boolean(${warning})`), false);
  const refresh = "document.querySelector('.usage-heading button')";
  await run(`${refresh}.click()`);
  await until(() => run(`Boolean(${warning})`), "warning on next refresh with the same incomplete file");
  rmSync(damagedArchive);
  await run(`${refresh}.click()`);
  await until(() => run(`!${warning}`), "warning cleared when refreshed data is complete");
  async function registerInputPrice(price) {
    await run(`[...document.querySelectorAll('.pricing-number input')].forEach((el,i) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, i === 0 ? '${price}' : '0');
      el.dispatchEvent(new Event('input', { bubbles:true }));
    })`);
    await run("document.querySelector('.pricing-form [type=submit]').click()");
  }
  await pick("Model", "desktop-only");
  await registerInputPrice(2);
  await until(() => run(`${row}?.textContent.includes('¥1.50')`), "registered standard tier estimate");
  await pick("Model", "desktop-only");
  await pick("Response speed", "Fast");
  await registerInputPrice(4);
  await until(() => run(`${row}?.textContent.includes('¥4.50')`), "one model estimate across speed tiers");
  assert.deepEqual(await run("[...document.querySelectorAll('.pricing-table tbody th')].map(cell => cell.rowSpan)"), [2]);
  await run(`${toggle}.click()`);
  await until(() => run(`!${row}`), "import hidden when disabled");
  assert.deepEqual(await run("window.vela.getCodexAppUsage()"), { buckets: [], incompleteFiles: 0 });
  console.log("PASS Codex opt-in, archive import, source filters, model registration, estimated cost and opt-out");
}

app.once("will-quit", () => rmSync(dir, { recursive: true, force: true }));
void app.whenReady().then(runSmoke).then(() => app.quit(), error => {
  console.error(error);
  rmSync(dir, { recursive: true, force: true });
  app.exit(1);
});

