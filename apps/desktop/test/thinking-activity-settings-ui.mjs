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
    const input = `${block} input[type="number"]`;
    const toggle = `${block} [role="switch"]`;
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
      assert.deepEqual(await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(input)});
        const toggle = document.querySelector(${JSON.stringify(toggle)});
        return {value: input.value, disabled: input.disabled, checked: toggle.getAttribute('aria-checked')};
      })()`), { value: String(savedMs), disabled: !enabled, checked: String(enabled) }, currentCase);
    };
    const reloadFixture = () => new Promise(done => {
      win.webContents.once("did-finish-load", done);
      win.webContents.reload();
    });
    const editInput = async (value, commit = "blur") => {
      const previousMs = await evaluate("window.fixturePreferences.thinkingActivityDelayMs");
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(input)});
        input.focus();
        input.select();
      })()`);
      await win.webContents.insertText(String(value));
      await until(`document.querySelector(${JSON.stringify(input)}).value === ${JSON.stringify(String(value))}`);
      // Let React commit the input draft before dispatching its separate commit event.
      await evaluate("new Promise(done => requestAnimationFrame(() => done()))");
      assert.equal(await evaluate("window.fixturePreferences.thinkingActivityDelayMs"), previousMs, "editing the draft does not save before blur or Enter");
      await evaluate(`window.flushFixture(() => {
        const input = document.querySelector(${JSON.stringify(input)});
        // Hidden windows do not emit native focus events, so dispatch the DOM blur bridge explicitly.
        ${commit === "blur"
          ? "input.dispatchEvent(new FocusEvent('focusout', {bubbles: true, relatedTarget: document.body})); input.blur()"
          : `input.dispatchEvent(new KeyboardEvent('keydown', {key: '${commit === "escape" ? "Escape" : "Enter"}', bubbles: true}))`};
      })`);
    };
    const clickToggle = () => evaluate(`window.flushFixture(() => document.querySelector(${JSON.stringify(toggle)}).click())`);
    try {
      await win.loadFile(join(process.env.VELA_THINKING_ACTIVITY_SETTINGS_TEMP, "index.html"));
      await until(`typeof window.remountFixture === 'function' && !!document.querySelector(${JSON.stringify(input)})`);
      currentCase = "defaults";
      await expectPreference(true, 500);
      assert.deepEqual(await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(input)});
        return {min: input.min, max: input.max, step: input.step};
      })()`), { min: "100", max: "5000", step: "100" });

      currentCase = "blur commits 1200ms";
      await editInput(1200);
      await expectPreference(true, 1200);
      currentCase = "remount restores saved threshold";
      await evaluate("window.remountFixture()");
      await expectPreference(true, 1200);
      currentCase = "reload restores saved threshold";
      await reloadFixture();
      await expectPreference(true, 1200);

      currentCase = "Enter commits threshold";
      await editInput(1700, "enter");
      await expectPreference(true, 1700);
      await editInput(1200, "enter");
      await expectPreference(true, 1200);
      currentCase = "Escape cancels the draft";
      await editInput(2200, "escape");
      await expectPreference(true, 1200);

      currentCase = "turning delay off preserves threshold and makes new calls immediate";
      await clickToggle();
      await expectPreference(false, 1200);
      const immediate = await evaluate(`(() => {
        window.nextSampleCall();
        const headline = document.querySelector(${JSON.stringify(sampleHeadline)});
        return {rich: !!headline.querySelector('.thinking-tool-activity'), title: headline.title,
          saved: window.fixturePreferences.thinkingActivityDelayMs};
      })()`);
      assert.equal(immediate.rich, true, "a new call has rich activity in the same turn without advancing a timer");
      assert.ok(immediate.title.includes("src/sample.ts"), "immediate activity contains the current call details");
      assert.equal(immediate.saved, 1200, "disabling delay does not overwrite the saved threshold");
      currentCase = "reload restores disabled delay and retained threshold";
      await reloadFixture();
      await expectPreference(false, 1200);
      assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(sampleHeadline)})?.querySelector('.thinking-tool-activity')`), true);
      currentCase = "turning delay on restores 1200ms";
      await clickToggle();
      await expectPreference(true, 1200);

      currentCase = "setter normalizes invalid bounds";
      await evaluate("window.flushFixture(() => window.fixturePreferences.setThinkingActivityDelayMs(-100))");
      await expectPreference(true, 100);
      await evaluate("window.flushFixture(() => window.fixturePreferences.setThinkingActivityDelayMs(99999))");
      await expectPreference(true, 5000);
      await editInput(1200);
      await expectPreference(true, 1200);

      const localized = {
        "zh-CN": ["工具动作显示延迟", "门槛（毫秒）"],
        en: ["Tool activity headline delay", "Threshold (ms)"],
        "zh-TW": ["工具動作顯示延遲", "門檻（毫秒）"],
        ja: ["ツール操作の見出しの表示遅延", "しきい値（ミリ秒）"],
        ko: ["도구 작업 제목 표시 지연", "기준 시간(밀리초)"],
      };
      for (const [locale, [title, threshold]] of Object.entries(localized)) {
        currentCase = `localized controls and search/${locale}`;
        await evaluate(`window.flushFixture(() => window.fixturePreferences.setLocale(${JSON.stringify(locale)}))`);
        await until(`document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-label') === ${JSON.stringify(title)}`);
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).getAttribute('aria-label')`), threshold);
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(block)}).querySelector('h3').textContent`), title);
        for (const width of [320, 390]) {
          const layout = await evaluate(`(() => {
            const block = document.querySelector(${JSON.stringify(block)});
            const section = block.closest('.settings-section');
            section.style.width = '${width}px';
            section.style.maxWidth = 'none';
            const bounds = block.getBoundingClientRect();
            const controls = [block.querySelector('[role="switch"]'), block.querySelector('.tb-number'), block.querySelector('input')];
            return {width: bounds.width, clientWidth: block.clientWidth, scrollWidth: block.scrollWidth,
              outside: controls.map(node => ({tag: node.tagName, left: node.getBoundingClientRect().left - bounds.left,
                right: node.getBoundingClientRect().right - bounds.left}))
                .filter(node => node.left < -1 || node.right > bounds.width + 1)};
          })()`);
          assert.ok(layout.width > 0 && layout.width <= width + 1, `${locale}/${width}px: narrow container width is applied`);
          assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${locale}/${width}px: setting must not overflow horizontally: ${JSON.stringify(layout)}`);
          assert.deepEqual(layout.outside, [], `${locale}/${width}px: all controls remain inside the setting`);
        }
        for (const query of ["门槛", "防闪烁", "threshold", "flicker"]) {
          assert.equal(await evaluate(`window.searchDelaySettings(${JSON.stringify(query)}).includes('thinking-activity-delay')`), true,
            `${locale}: settings search finds ${query}`);
        }
      }
      assert.deepEqual(errors, [], "No renderer console errors");
      console.log("Thinking activity settings UI: defaults, real input blur/Enter commits, Escape cancellation, remount/reload persistence, immediate activity when off, retained threshold on re-enable, bounds normalization, five-locale labels, 320/390px container bounds and searchable registry passed");
      app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(input)});
        return {probe: {...document.querySelector('#delay-probe')?.dataset},
          input: input?.outerHTML, active: document.activeElement?.tagName,
          storedEnabled: localStorage.getItem('vela.thinkingActivityDelayEnabled'),
          storedMs: localStorage.getItem('vela.thinkingActivityDelayMs')};
      })()`));
      app.exit(1);
    }
  });
}
