/** Real Electron regression coverage for configurable thinking activity headline delays. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStyles } from "./read-styles.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(desktop, "package.json"));

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-thinking-activity-settings-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
          import { useContext, useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { flushSync } from 'react-dom';
          import { usePreferences } from './src/renderer/hooks/usePreferences';
          import { ThinkingActivityDelayContext } from './src/renderer/hooks/useDelayedThinkingActivity';
          import { ConversationDisplayPage } from './src/renderer/components/settings/ConversationDisplayPage';
          import { settingsCopy } from './src/renderer/components/settings-copy';
          import { resolveSettingsEntries, searchSettings } from './src/renderer/components/settings/settings-search';
          import { ThinkingGroup } from './src/renderer/components/Thinking';
          import { AppLocaleProvider, setActiveLocale } from './src/renderer/locale';
          const root = createRoot(document.getElementById('root'));
          let revision = 0;
          function Probe({preferences}) {
            const effectiveMs = useContext(ThinkingActivityDelayContext);
            return <output id="delay-probe" data-enabled={String(preferences.thinkingActivityDelayEnabled)}
              data-saved-ms={preferences.thinkingActivityDelayMs} data-effective-ms={effectiveMs} />;
          }
          function Fixture() {
            const preferences = usePreferences();
            const [sampleId, setSampleId] = useState(0);
            const copy = settingsCopy(preferences.locale);
            setActiveLocale(preferences.locale);
            window.fixturePreferences = preferences;
            window.nextSampleCall = () => flushSync(() => setSampleId(id => id + 1));
            window.searchDelaySettings = query => searchSettings(query, resolveSettingsEntries(copy)).map(result => result.entry.id);
            const tools = [{id: 'sample-' + sampleId, name: 'edit', status: 'running', activity: {path: 'src/sample.ts'}}];
            return <AppLocaleProvider locale={preferences.locale}>
              <ThinkingActivityDelayContext.Provider value={preferences.thinkingActivityDelayEnabled ? preferences.thinkingActivityDelayMs : 0}>
                <Probe preferences={preferences} />
                <ConversationDisplayPage copy={copy} preferences={preferences} catalog={null} />
                <div id="activity-sample" className="main-chat-view" data-tool-display="compact">
                  <ThinkingGroup model="gpt-6.1" messageId="sample" text={'**Planning the change**\\n\\nUpdate and verify.'}
                    active={false} live tools={tools} showActivityIndicator><div>Sample tool body</div></ThinkingGroup>
                </div>
              </ThinkingActivityDelayContext.Provider>
            </AppLocaleProvider>;
          }
          window.flushFixture = flushSync;
          window.remountFixture = () => { revision += 1; flushSync(() => root.render(<Fixture key={revision} />)); };
          window.remountFixture();
        `,
        resolveDir: desktop,
        loader: "tsx",
      },
      alias: { "@vela/shared": resolve(desktop, "../../packages/shared/src/index.ts") },
      loader: { ".svg": "dataurl" },
      bundle: true,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      outfile: join(temporary, "ui.js"),
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
      logLevel: "error",
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>' +
      readStyles(join(desktop, "src/renderer/styles.css")) +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_THINKING_ACTIVITY_SETTINGS_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const code = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      assert.equal(code, 0, "Thinking activity settings Electron checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_THINKING_ACTIVITY_SETTINGS_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1100, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    const block = '[data-setting-id="thinking-activity-delay"]';
    const sampleHeadline = '#activity-sample .thinking-headline-trigger';
    let currentCase = "loading";
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`Timed out (${currentCase}): ${code}`);
    };
    const expectPreference = async (enabled, savedMs) => {
      await until(`document.querySelector('#delay-probe')?.dataset.enabled === ${JSON.stringify(String(enabled))}
        && document.querySelector('#delay-probe')?.dataset.savedMs === ${JSON.stringify(String(savedMs))}
        && document.querySelector('#delay-probe')?.dataset.effectiveMs === ${JSON.stringify(String(enabled ? savedMs : 0))}
        && localStorage.getItem('vela.thinkingActivityDelayEnabled') === ${JSON.stringify(String(enabled))}
        && localStorage.getItem('vela.thinkingActivityDelayMs') === ${JSON.stringify(String(savedMs))}`);
    };
    const reloadFixture = () => new Promise(done => {
      win.webContents.once("did-finish-load", done);
      win.webContents.reload();
    });
    try {
      await win.loadFile(join(process.env.VELA_THINKING_ACTIVITY_SETTINGS_TEMP, "index.html"));
      await until("typeof window.remountFixture === 'function' && !!document.querySelector('#delay-probe')");
      currentCase = "hidden from settings UI and search";
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(block)})`), null);
      for (const query of ["门槛", "防闪烁", "threshold", "flicker"]) {
        assert.equal(await evaluate(`window.searchDelaySettings(${JSON.stringify(query)}).includes('thinking-activity-delay')`), false,
          `settings search hides ${query}`);
      }
      currentCase = "defaults";
      await expectPreference(true, 500);

      currentCase = "config storage updates 1200ms across remount and reload";
      await evaluate("localStorage.setItem('vela.thinkingActivityDelayMs', '1200')");
      await reloadFixture();
      await expectPreference(true, 1200);
      await evaluate("window.remountFixture()");
      await expectPreference(true, 1200);

      currentCase = "turning delay off in config preserves threshold and makes new calls immediate";
      await evaluate("window.flushFixture(() => window.fixturePreferences.setLocale('en'))");
      await evaluate("localStorage.setItem('vela.thinkingActivityDelayEnabled', 'false')");
      await reloadFixture();
      await expectPreference(false, 1200);
      const immediate = await evaluate(`(() => {
        window.nextSampleCall();
        const headline = document.querySelector(${JSON.stringify(sampleHeadline)});
        const activity = headline.querySelector('.thinking-tool-activity');
        return {text: activity?.textContent, children: activity?.childElementCount, title: headline.title,
          marked: headline.classList.contains('has-tool-activity'), icon: !!headline.querySelector('.tool-compact-icon'),
          saved: window.fixturePreferences.thinkingActivityDelayMs};
      })()`);
      assert.deepEqual(immediate, {text: "Editing files", children: 0, title: "Editing files", marked: true, icon: true, saved: 1200},
        "a new call immediately shows only the generic operation and tooltip, keeps its icon and preserves the saved threshold");

      currentCase = "turning delay back on restores 1200ms";
      await evaluate("window.flushFixture(() => window.fixturePreferences.setThinkingActivityDelayEnabled(true))");
      await expectPreference(true, 1200);

      currentCase = "setter normalizes invalid bounds";
      await evaluate("window.flushFixture(() => window.fixturePreferences.setThinkingActivityDelayMs(-100))");
      await expectPreference(true, 100);
      await evaluate("window.flushFixture(() => window.fixturePreferences.setThinkingActivityDelayMs(99999))");
      await expectPreference(true, 5000);
      assert.deepEqual(errors, [], "No renderer console errors");
      console.log("Thinking activity settings UI: hidden from Settings UI/search while config-backed defaults, reload persistence, immediate activity when off and bounds normalization passed");
      app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(await evaluate(`(() => ({
        probe: {...document.querySelector('#delay-probe')?.dataset},
        storedEnabled: localStorage.getItem('vela.thinkingActivityDelayEnabled'),
        storedMs: localStorage.getItem('vela.thinkingActivityDelayMs'),
      }))()`));
      app.exit(1);
    }
  });
}
