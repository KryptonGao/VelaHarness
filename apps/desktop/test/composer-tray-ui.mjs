/** 胶囊布局的托盘随宽度逐级简化：控件不重叠、不溢出，模型名始终可见。真实 Electron 检查。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStyles } from "./read-styles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-composer-tray-ui-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { ModeChip } from './apps/desktop/src/renderer/components/composer/ModeChip';
        import { SandboxPill } from './apps/desktop/src/renderer/components/composer/SandboxPill';
        import { ComposerStatsRow } from './apps/desktop/src/renderer/components/composer/ComposerStatsRow';
        import { ModelControls } from './apps/desktop/src/renderer/components/ModelControls';
        import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
        const hour = 3600000;
        window.vela = { getUsageLimits: async () => ({
          provider: 'openai-codex', plan: 'plus', fetchedAt: Date.now(),
          windows: [{windowMinutes: 300, usedPercent: 40, resetsAt: Date.now() + hour}, {windowMinutes: 10080, usedPercent: 25, resetsAt: Date.now() + 80 * hour}],
        }) };
        const noop = async () => undefined;
        const root = createRoot(document.getElementById('root'));
        const usage = {tokens: 52000, contextWindow: 200000, percent: 26, outputSpeed: 241, sessionTokens: 257000, cacheHitRate: 0.97};
        window.mount = (locale, thinkingLevel, sandbox, width) => {
          setActiveLocale(locale);
          document.documentElement.dataset.composerLayout = 'capsule';
          flushSync(() => root.render(
            <AppLocaleProvider locale={locale}>
              <div id="lane" style={{width: width + 'px', paddingTop: '420px'}}>
                <form className="floating-input-card layout-capsule">
                  <div className="composer-capsule"><div className="composer-capsule-main">x</div></div>
                  <div className="composer-tray">
                    <div className="composer-tray-left">
                      <div className="composer-tray-chips">
                        <ModeChip mode="agent" disabled={false} onChange={() => {}} />
                        <SandboxPill project={{sandboxMode: sandbox, setSandboxMode: noop}} />
                      </div>
                    </div>
                    <div className="composer-tray-right">
                      <ComposerStatsRow usage={usage} contextPopover={false} />
                      <ModelControls
                        modelLabel="GPT-6.1 Sol" modelProvider="openai-codex" modelId="gpt-6.1-sol"
                        thinkingLevel={thinkingLevel} thinkingLevels={['low', 'medium', 'high', 'xhigh']}
                        disabled={false} catalog={null} catalogError={null} actionError={null} hiddenModels={[]}
                        login={{active: false, notices: [], progress: null, prompt: null, error: null}}
                        onSelect={noop} onThinking={noop} onAdd={async () => null} onRemove={noop} onLogout={noop}
                        onLogin={noop} onReplyLogin={noop} onCancelLogin={noop} onDismissLogin={() => {}}
                      />
                    </div>
                  </div>
                </form>
              </div>
            </AppLocaleProvider>
          ));
        };
        window.setWidth = width => { document.getElementById('lane').style.width = width + 'px'; };
        // 托盘可见控件的矩形，按从左到右排列，供测试判断是否重叠或溢出。
        window.measure = () => {
          const rect = el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, width: r.width}; };
          const visible = el => el && el.getBoundingClientRect().width > 0;
          const tray = document.querySelector('.composer-tray');
          const style = getComputedStyle(tray);
          const bounds = tray.getBoundingClientRect();
          const controls = [...tray.querySelectorAll('.mode-pill, .sandbox-pill, .composer-stats-row, .model-choice-pill, .usage-ring-button')]
            .filter(visible)
            .map(el => ({name: el.className.toString().split(' ').slice(0, 2).join(' '), ...rect(el)}));
          const label = document.querySelector('.model-pill-label');
          return {
            trayLeft: bounds.left + parseFloat(style.paddingLeft),
            trayRight: bounds.right - parseFloat(style.paddingRight),
            controls,
            modelLabelWidth: visible(label) ? label.getBoundingClientRect().width : 0,
            sandboxText: visible(document.querySelector('.sandbox-pill > span')),
            thinkingText: visible(document.querySelector('.thinking-label')),
            statsVisible: visible(document.querySelector('.composer-stats-row')),
            overflowed: label ? label.scrollWidth > label.clientWidth : false,
          };
        };
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(temporary, "ui.js"),
      loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".css": "text" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" }, logLevel: "error",
    });
    const styles = readStyles(join(here, "../src/renderer/styles.css")) + readStyles(join(here, "../src/renderer/usage-limit.css"));
    writeFileSync(join(temporary, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body style="overflow:auto"><div id="root"></div><script src="ui.js"></script></body></html>`);
    const env = { ...process.env, VELA_COMPOSER_TRAY_UI_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "托盘 Electron 检查失败");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_COMPOSER_TRAY_UI_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", details => { if (details.level === "error" && !details.message.includes("Electron Security Warning")) errors.push(details.message); });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const settle = () => evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    const shots = process.env.VELA_COMPOSER_TRAY_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });
    try {
      await win.loadFile(join(process.env.VELA_COMPOSER_TRAY_UI_TEMP, "index.html"));
      const failures = [];
      const widths = [800, 700, 640, 560, 520, 480, 440, 400, 360, 340, 318, 300, 280, 260, 240];
      for (const [locale, sandbox, level] of [["zh-CN", "full", "high"], ["en", "ask", "medium"], ["en", "smart", "xhigh"], ["zh-TW", "full", "high"], ["ja", "ask", "medium"], ["ko", "ask", "xhigh"]]) {
        await evaluate(`window.mount(${JSON.stringify(locale)}, ${JSON.stringify(level)}, ${JSON.stringify(sandbox)}, 800); window.setWidth(800)`);
        // 用量环是异步拉取的，等它出现后再量，否则看不到最挤的情况。
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline && !(await evaluate("Boolean(document.querySelector('.usage-ring-button'))"))) await new Promise(done => setTimeout(done, 20));
        for (const width of widths) {
          await evaluate(`window.setWidth(${width})`);
          await settle();
          const m = await evaluate("window.measure()");
          const tag = `${locale}/${sandbox}/${level}@${width}`;
          const ordered = [...m.controls].sort((a, b) => a.left - b.left);
          for (let i = 1; i < ordered.length; i++) {
            if (ordered[i].left < ordered[i - 1].right - 0.5) failures.push(`${tag}: ${ordered[i - 1].name} 与 ${ordered[i].name} 重叠`);
          }
          if (ordered[0].left < m.trayLeft - 0.5) failures.push(`${tag}: 超出左边界`);
          if (ordered.at(-1).right > m.trayRight + 0.5) failures.push(`${tag}: 超出右边界`);
          // 模型名要能认得出：至少留下约 4 个字符。
          if (m.modelLabelWidth < 28) failures.push(`${tag}: 模型名只剩 ${m.modelLabelWidth}px`);
          if (shots && locale === "zh-CN" && [640, 480, 400, 340, 318, 260].includes(width)) {
            const image = await win.webContents.capturePage();
            writeFileSync(join(shots, `tray-${width}.png`), image.toPNG());
          }
          if (process.env.VELA_COMPOSER_TRAY_DUMP) console.log(tag, Math.round(m.trayRight - m.trayLeft), "label", Math.round(m.modelLabelWidth), "sandbox", m.sandboxText, "thinking", m.thinkingText, "stats", m.statsVisible);
        }
      }
      // 宽度足够时不应无故收起文字。
      await evaluate("window.mount('zh-CN', 'high', 'full', 800); window.setWidth(800)");
      await settle();
      const wide = await evaluate("window.measure()");
      assert.ok(wide.sandboxText && wide.thinkingText && wide.statsVisible, "宽托盘应保留全部文字");
      assert.equal(await evaluate("document.querySelector('.sandbox-pill').getAttribute('aria-label')"), "完全访问", "权限芯片需要可读名称");
      assert.match(await evaluate("document.querySelector('.model-choice-pill').title"), /高/, "思考强度提示需要包含当前档位");
      // 只剩图标时仍然打得开菜单。
      await evaluate("window.setWidth(300)");
      await settle();
      const narrow = await evaluate("window.measure()");
      assert.ok(!narrow.sandboxText && !narrow.thinkingText, "窄托盘应收起权限和思考强度文字");
      await evaluate("document.querySelector('.sandbox-pill').click()");
      const sandboxOpen = Date.now() + 2000;
      while (Date.now() < sandboxOpen && !(await evaluate("Boolean(document.querySelector('.sandbox-popover'))"))) await new Promise(done => setTimeout(done, 20));
      assert.ok(await evaluate("Boolean(document.querySelector('.sandbox-popover'))"), "收起文字后权限菜单仍可打开");
      assert.deepEqual(failures, []);
      assert.deepEqual(errors, []);
      console.log(`PASS: 托盘 ${widths.length} 档宽度 × 6 组语言/权限/强度无重叠、无溢出，模型名可见`);
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { win.destroy(); app.exit(process.exitCode ?? 0); }
  }).catch(error => { console.error(error); app.exit(1); });
}
