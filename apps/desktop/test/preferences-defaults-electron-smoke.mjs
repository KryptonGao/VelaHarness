import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow } from "electron";

const temporary = mkdtempSync(join(tmpdir(), "vela-preference-defaults-"));
const home = join(temporary, "data");
mkdirSync(home);
process.env.VELA_USER_DATA = home;
process.env.VELA_CWD = temporary;
process.env.PI_OFFLINE = "1";
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.VELA_CAPTURE;
writeFileSync(join(home, "ui-state.json"), JSON.stringify({ "vela.onboarding.complete": "true" }));
app.on("will-quit", () => rmSync(temporary, { recursive: true, force: true }));

async function until(check, label) {
  const deadline = Date.now() + 10_000;
  do {
    const result = await check();
    if (result) return result;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for " + label);
}

async function run() {
  await import("../out/main/index.mjs");
  const window = await until(() => BrowserWindow.getAllWindows()[0], "app window");
  const evaluate = (fn, arg) => window.webContents.executeJavaScript("(" + fn + ")(" + (arg === undefined ? "" : JSON.stringify(arg)) + ")");
  const readPreferences = expected => evaluate(keys => Object.fromEntries(
    keys.map(key => [key, window.vela.uiStorage.getItem("vela." + key)]),
  ), Object.keys(expected));

  const defaults = {
    appearance: "system", locale: "zh-TW", "theme.light": "daylight", "theme.dark": "midnight",
    "theme.custom": "[]", "font.code.size": "15", glassTint: "neutral", sidebarCardGlass: "true",
    unfocusedGlassMode: "absolute", unfocusedGlassIncrease: "40",
    infoLayout: "floating", environmentCollapsed: "true", conversationWorkbenchTabs: "true",
    borderlessInterface: "true", soundEffects: "false", raceEnabled: "false",
    toolDisplay: "compact", toolFold: "none", toolIconColor: "gray", filePath: "false",
    runView: "true", thinkingGroupMode: "codex", thinkingTitleStyle: "normal-muted",
    thinkingGroupHeight: "280", commandDetailHeight: "240", toolDetailHeight: "240",
    thinkingGroupHeightGrow: "true", replyPop: "false", thinkingPop: "false",
    thinkingSummaryStyle: "prose", thinkingSummaryModel: "null", inputPredictionModel: "null",
  };

  await until(() => evaluate(() => Boolean(document.querySelector(".nav-rail-layout.layout-floating.borderless-interface"))), "default layout");
  assert.deepEqual(await readPreferences(defaults), defaults);
  const sendIcon = () => evaluate(() => document.querySelector(".send-action-blue-btn.send [data-icon]")?.getAttribute("data-icon"));
  const hasCapsuleComposer = () => evaluate(() => Boolean(document.querySelector(".floating-input-card > .composer-capsule:has([role=textbox]) + .composer-tray")));
  assert.equal(await sendIcon(), "arrow-up");
  assert.ok(await hasCapsuleComposer(), "the default start page uses the capsule composer");
  assert.deepEqual(await evaluate(() => {
    const root = document.documentElement;
    return {
      lang: root.lang,
      startPage: document.querySelector("[data-home-style]")?.dataset.homeStyle,
      codeScale: Number(root.style.getPropertyValue("--code-scale")),
      focusedGlass: getComputedStyle(root).getPropertyValue("--focused-glass-fill").trim(),
    };
  }), {
    lang: "zh-TW", startPage: "atelier", codeScale: 15 / 14,
    focusedGlass: await evaluate(() => document.documentElement.dataset.scheme === "dark")
      ? "rgb(0 0 0 / 0.15)" : "rgb(255 255 255 / 0.15)",
  });
  await evaluate(() => document.querySelector(".nav-rail-footer .nav-rail-item:last-child").click());
  await until(() => evaluate(() => Boolean(document.querySelector('[data-setting-id="theme"]'))), "appearance settings");
  assert.deepEqual(await evaluate(() => ({
    glassTint: Boolean(document.querySelector('[data-setting-id="glass-tint"]')),
    glassOpacity: Boolean(document.querySelector('[data-setting-id="glass-opacity"]')),
    unfocusedGlass: Boolean(document.querySelector('[data-setting-id="unfocused-glass"]')),
    sidebarCardGlass: Boolean(document.querySelector('[data-setting-id="sidebar-card-glass"]')),
    unifiedIcons: Boolean(document.querySelector('[data-setting-id="unified-icons"]')),
  })), { glassTint: false, glassOpacity: false, unfocusedGlass: false, sidebarCardGlass: false, unifiedIcons: false });
  await evaluate(() => [...document.querySelectorAll(".settings-nav-item")][1].click());
  await until(() => evaluate(() => Boolean(document.querySelector('[data-setting-id="info-layout"]'))), "interface settings");
  const raceSwitch = '[data-setting-id="race"] [role="switch"]';
  const raceChecked = () => evaluate(selector => document.querySelector(selector)?.getAttribute("aria-checked"), raceSwitch);
  assert.equal(await raceChecked(), "false");
  assert.equal(await evaluate(selector => document.querySelector(selector).closest(".settings-group").querySelector("h3").textContent, raceSwitch), "實驗性功能");
  const startRace = () => evaluate(() => window.vela.races.start({}));
  await assert.rejects(startRace, /实验性功能/);
  await evaluate(selector => document.querySelector(selector).focus(), raceSwitch);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
  await until(async () => await raceChecked() === "true", "Race enabled with the keyboard");
  assert.deepEqual(await evaluate(() => window.vela.races.list()), { races: [], error: null });
  assert.deepEqual(await evaluate(() => ({
    sendButtonIcon: Boolean(document.querySelector('[data-setting-id="send-button-icon"]')),
    composerLayout: Boolean(document.querySelector('[data-setting-id="composer-layout"]')),
    navLayout: Boolean(document.querySelector('[data-setting-id="nav-layout"]')),
    borderlessInterface: Boolean(document.querySelector('[data-setting-id="borderless-interface"]')),
    conversationWorkbenchTabs: Boolean(document.querySelector('[data-setting-id="conversation-workbench-tabs"]')),
    usageRingThreshold: Boolean(document.querySelector('[data-setting-id="usage-ring-threshold"]')),
    combinedModelPicker: Boolean(document.querySelector('[data-setting-id="combined-model-picker"]')),
    infoLayout: Boolean(document.querySelector('[data-setting-id="info-layout"]')),
    startPageStyle: Boolean(document.querySelector('[data-setting-id="start-page-style"]')),
    workbenchSplit: Boolean(document.querySelector('[data-setting-id="workbench-split"]')),
    elasticScroll: Boolean(document.querySelector('[data-setting-id="elastic-scroll"]')),
  })), {
    sendButtonIcon: false, composerLayout: false, navLayout: false, borderlessInterface: false,
    conversationWorkbenchTabs: false, usageRingThreshold: false, combinedModelPicker: false,
    infoLayout: true, startPageStyle: true, workbenchSplit: true, elasticScroll: true,
  });
  console.log("PASS default appearance, interface and conversation preferences on a fresh profile");

  const overrides = {
    locale: "en", navLayout: '"classic"', startPageStyle: '"deck"', "font.code.size": "14",
    infoLayout: "sidebar", toolFold: "message", toolIconColor: "true", soundEffects: "true",
    conversationWorkbenchTabs: "false", borderlessInterface: "false", runView: "false",
    glassTint: "theme", glassOpacity: "42", toolDetailHeight: "320",
  };
  await evaluate(entries => {
    for (const [key, value] of Object.entries(entries)) window.vela.uiStorage.setItem("vela." + key, value);
    window.vela.uiStorage.setItem("vela.sendButtonIcon", "paper-plane");
    window.vela.uiStorage.setItem("vela.composerLayout", JSON.stringify("calm"));
    window.vela.uiStorage.removeItem("vela.commandDetailHeight");
  }, overrides);
  window.webContents.reload();
  await until(() => evaluate(() => Boolean(document.querySelector(".sidebar-user-pill"))), "saved classic layout");
  assert.equal(await sendIcon(), "arrow-up");
  assert.equal(await evaluate(() => document.querySelector("[data-home-style]")?.dataset.homeStyle), "deck");
  assert.ok(await hasCapsuleComposer(), "a saved Calm layout still opens the capsule composer");
  assert.deepEqual(await readPreferences({ ...overrides, commandDetailHeight: "320" }), {
    ...overrides, toolIconColor: "color", commandDetailHeight: "320",
  });
  assert.equal(await evaluate(() => document.documentElement.style.getPropertyValue("--code-scale")), "1");
  await evaluate(() => document.querySelector(".sidebar-user-pill").click());
  await until(async () => await raceChecked() === "true", "saved Race switch after reload");
  await evaluate(selector => document.querySelector(selector).click(), raceSwitch);
  await until(async () => await raceChecked() === "false", "Race switched off again");
  await assert.rejects(startRace, /实验性功能/);
  console.log("PASS experimental Race defaults off, follows the switch immediately and persists across reloads");
  console.log("PASS saved choices and legacy preferences win over new defaults");
}

const watchdog = setTimeout(() => app.exit(1), 40_000);
app.whenReady().then(run).then(() => {
  clearTimeout(watchdog);
  app.quit();
}, error => {
  console.error(error);
  clearTimeout(watchdog);
  app.exit(1);
});
