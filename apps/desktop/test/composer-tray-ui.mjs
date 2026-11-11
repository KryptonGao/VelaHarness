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
        import { ModePicker } from './apps/desktop/src/renderer/components/composer/ModePicker';
        import { ComposerStatsRow } from './apps/desktop/src/renderer/components/composer/ComposerStatsRow';
        import { ComposerTray } from './apps/desktop/src/renderer/components/composer/ComposerTray';
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
        window.mount = (locale, thinkingLevel, sandbox, width, modelLabel = 'GPT-6.1 Sol', outputSpeed = 241) => {
          setActiveLocale(locale);
          document.documentElement.dataset.composerLayout = 'capsule';
          flushSync(() => root.render(
            <AppLocaleProvider locale={locale}>
              <div id="lane" style={{width: width + 'px', paddingTop: '420px'}}>
                <form className="floating-input-card layout-capsule">
                  <div className="composer-capsule"><div className="composer-capsule-main">x</div></div>
                  <ComposerTray>
                    <div className="composer-tray-left">
                      <div className="composer-tray-chips">
                        <ModePicker mode="agent" sandboxMode={sandbox} disabled={false} onMode={() => {}} onSandboxMode={noop} race={{ onStart: () => {}, onShow: () => {}, count: 2 }} />
                      </div>
                    </div>
                    <div className="composer-tray-right">
                      <ComposerStatsRow usage={{...usage, outputSpeed}} contextPopover={false} />
                      <ModelControls
                        modelLabel={modelLabel} modelProvider="openai-codex" modelId="gpt-6.1-sol"
                        thinkingLevel={thinkingLevel} thinkingLevels={['low', 'medium', 'high', 'xhigh']}
                        disabled={false} catalog={null} catalogError={null} actionError={null} hiddenModels={[]}
                        login={{active: false, notices: [], progress: null, prompt: null, error: null}}
                        onSelect={noop} onThinking={noop} onAdd={async () => null} onRemove={noop} onLogout={noop}
                        onLogin={noop} onReplyLogin={noop} onCancelLogin={noop} onDismissLogin={() => {}}
                      />
                    </div>
                  </ComposerTray>
                </form>
                <div id="hover-probe" style={{display: 'flex', gap: '12px', padding: '12px'}}>
                  <button type="button" className="composer-chip"><span>Workspace</span></button>
                  <button type="button" className="attach-btn">+</button>
                  <button type="button" className="mode-pill mode-manual"><span>Manual</span></button>
                  <button type="button" className="mode-pill mode-plan"><span>Plan</span></button>
                </div>
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
          const controls = [...tray.querySelectorAll('.mode-pill, .composer-stats-row, .model-choice-pill, .usage-ring-button')]
            .filter(visible)
            .map(el => ({name: el.className.toString().split(' ').slice(0, 2).join(' '), ...rect(el)}));
          const label = document.querySelector('.model-pill-label');
          const collapsed = tray.dataset.collapsed || '';
          const stages = collapsed.split(' ').filter(Boolean);
          let previousFits = false;
          if (stages.length) {
            // Independently check that restoring the last collapsed item would really overflow.
            tray.dataset.measuring = 'true';
            tray.dataset.collapsed = stages.slice(0, -1).join(' ');
            const right = tray.querySelector('.composer-tray-right');
            const items = [...right.children].filter(visible);
            const first = items[0].getBoundingClientRect();
            const last = items.at(-1).getBoundingClientRect();
            previousFits = first.left >= tray.querySelector('.composer-tray-left').getBoundingClientRect().right + parseFloat(style.columnGap) - 0.5
              && last.right <= bounds.right - parseFloat(style.paddingRight) + 0.5;
            tray.dataset.collapsed = collapsed;
            delete tray.dataset.measuring;
          }
          return {
            trayLeft: bounds.left + parseFloat(style.paddingLeft),
            trayRight: bounds.right - parseFloat(style.paddingRight),
            controls,
            modelLabelWidth: visible(label) ? label.getBoundingClientRect().width : 0,
            sandboxText: visible(document.querySelector('.mode-pill > span')),
            thinkingText: visible(document.querySelector('.thinking-label-text')),
            statsVisible: visible(document.querySelector('.composer-stats-row')),
            speedVisible: visible(document.querySelector('.composer-stats-row > .composer-stat:has(> .composer-stat-text)')),
            collapsed,
            previousFits,
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
      const checkLayout = (m, tag) => {
        const ordered = [...m.controls].sort((a, b) => a.left - b.left);
        for (let i = 1; i < ordered.length; i++) {
          if (ordered[i].left < ordered[i - 1].right - 0.5) failures.push(`${tag}: ${ordered[i - 1].name} 与 ${ordered[i].name} 重叠`);
        }
        if (ordered[0].left < m.trayLeft - 0.5) failures.push(`${tag}: 超出左边界`);
        if (ordered.at(-1).right > m.trayRight + 0.5) failures.push(`${tag}: 超出右边界`);
        if (m.modelLabelWidth < 28) failures.push(`${tag}: 模型名只剩 ${m.modelLabelWidth}px`);
        if (m.previousFits) failures.push(`${tag}: 收起过多 ${m.collapsed}`);
      };
      const widths = [800, 760, 700, 640, 560, 520, 480, 440, 400, 360, 340, 318, 300, 280, 260, 240, 400, 640, 760, 800];
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
          checkLayout(m, tag);
          if (shots && locale === "zh-CN" && [640, 480, 400, 340, 318, 260].includes(width)) {
            const image = await win.webContents.capturePage();
            writeFileSync(join(shots, `tray-${width}.png`), image.toPNG());
          }
          if (process.env.VELA_COMPOSER_TRAY_DUMP) console.log(tag, Math.round(m.trayRight - m.trayLeft), "label", Math.round(m.modelLabelWidth), "sandbox", m.sandboxText, "thinking", m.thinkingText, "stats", m.statsVisible);
        }
      }
      // Intrinsic width changes must refit without changing the lane width.
      for (const locale of ['en', 'ja']) {
        for (const scale of [0.85, 1, 1.3, 1.6]) {
          await evaluate(`document.documentElement.style.setProperty('--ui-scale', '${scale}')`);
          for (const width of [760, 640, 400, 240, 760]) {
            await evaluate(`window.mount('${locale}', 'xhigh', 'full', ${width}, 'A very long model name for the composer regression')`);
            await settle();
            checkLayout(await evaluate('window.measure()'), `${locale}/scale=${scale}/long-model@${width}`);
          }
        }
      }
      await evaluate("document.documentElement.style.removeProperty('--ui-scale')");
      await evaluate("window.mount('en', 'high', 'full', 760, 'GPT-6.1 Sol', 123456789012345)");
      await settle();
      checkLayout(await evaluate('window.measure()'), 'updated-speed');
      // 宽度足够时不应无故收起文字。
      await evaluate("window.mount('zh-CN', 'high', 'full', 800); window.setWidth(800)");
      await settle();
      const wide = await evaluate("window.measure()");
      assert.ok(wide.sandboxText && wide.thinkingText && wide.statsVisible && wide.speedVisible, "宽托盘应保留全部文字和速度");
      // Regression: the old 760px container breakpoint hid speed despite ample free space.
      await evaluate("window.mount('en', 'high', 'full', 760)");
      await settle();
      assert.ok((await evaluate("window.measure()")).speedVisible, "760px 下放得下时仍应显示 tok/s");
      if (shots) writeFileSync(join(shots, 'speed-at-760.png'), (await win.webContents.capturePage()).toPNG());
      // A tray updated while hidden must also refit when it becomes visible.
      await evaluate("document.getElementById('lane').style.display = 'none'; window.mount('en', 'high', 'full', 760, 'GPT-6.1 Sol', 123456789012345)");
      await settle();
      await evaluate("document.getElementById('lane').style.display = ''");
      await settle();
      checkLayout(await evaluate('window.measure()'), 'revealed-tray');
      await evaluate("window.mount('zh-CN', 'high', 'full', 800)");
      await settle();
      assert.equal(await evaluate("document.querySelector('.mode-pill').getAttribute('aria-label')"), "完全访问", "权限芯片需要可读名称");
      assert.match(await evaluate("document.querySelector('.model-choice-pill').title"), /高/, "思考强度提示需要包含当前档位");
      // 输入框周围可点控件的 hover 只有两条规则：
      // 带文字的控件只把文字变成 --text-primary，不加底色、不降低不透明度；带色状态保持色相、向 --text-primary 加深；
      // 纯图标的圆形按钮（加号、额度圆环）圆形底色变 --bg-hover，图标颜色不变。
      const readStyle = selector => evaluate(`(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)})); return {bg: s.backgroundColor, color: s.color, opacity: s.opacity}; })()`);
      const hoverState = async selector => {
        const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
        win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(rect.x), y: Math.round(rect.y) });
        await new Promise(done => setTimeout(done, 350));
        if (shots) writeFileSync(join(shots, `hover-${selector.replace(/[^a-z]+/gi, "-")}.png`), (await win.webContents.capturePage()).toPNG());
        return readStyle(selector);
      };
      const restState = async selector => {
        win.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
        await new Promise(done => setTimeout(done, 350));
        return readStyle(selector);
      };
      const resolved = await evaluate(`(() => { const probe = document.createElement('i'); document.body.append(probe); probe.style.background = 'var(--bg-hover)'; probe.style.color = 'var(--text-primary)'; const s = getComputedStyle(probe); const out = {bg: s.backgroundColor, color: s.color}; probe.remove(); return out; })()`);
      for (const selector of ["#hover-probe .composer-chip", "#hover-probe .mode-manual", ".model-choice-pill:not(.model-pill)", ".model-choice-pill.model-pill"]) {
        const rest = await restState(selector);
        const state = await hoverState(selector);
        assert.equal(state.color, resolved.color, `${selector} hover 文字应为 --text-primary`);
        assert.equal(state.bg, rest.bg, `${selector} hover 不应改变底色`);
        assert.equal(state.opacity, "1", `${selector} hover 不应降低不透明度`);
      }
      const tintedRest = await restState("#hover-probe .mode-plan");
      const tinted = await hoverState("#hover-probe .mode-plan");
      assert.notEqual(tinted.color, tintedRest.color, "带色状态 hover 文字应加深");
      assert.notEqual(tinted.color, resolved.color, "带色状态 hover 文字应保持自己的色相");
      assert.equal(tinted.bg, tintedRest.bg, "带色状态 hover 不应改变底色");
      for (const selector of ["#hover-probe .attach-btn", ".usage-ring-button"]) {
        const rest = await restState(selector);
        const state = await hoverState(selector);
        assert.notEqual(rest.bg, resolved.bg, `${selector} 静止时不应已有 hover 底色`);
        assert.equal(state.bg, resolved.bg, `${selector} hover 圆形底色应为 --bg-hover`);
        assert.equal(state.color, rest.color, `${selector} hover 图标颜色不变`);
      }
      win.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
      // 只剩图标时仍然打得开菜单。
      await evaluate("window.setWidth(240)");
      await settle();
      const narrow = await evaluate("window.measure()");
      assert.ok(!narrow.sandboxText && !narrow.thinkingText, "窄托盘应收起权限和思考强度文字");
      await evaluate("document.querySelector('.mode-pill').click()");
      const sandboxOpen = Date.now() + 2000;
      while (Date.now() < sandboxOpen && !(await evaluate("Boolean(document.querySelector('.mode-popover'))"))) await new Promise(done => setTimeout(done, 20));
      assert.ok(await evaluate("Boolean(document.querySelector('.mode-popover'))"), "收起文字后权限菜单仍可打开");
      assert.equal(await evaluate("document.querySelectorAll('.mode-popover .mode-option').length"), 7, "合并后的模式菜单应有 5 个模式加 2 个赛马入口");
      assert.equal(await evaluate("[...document.querySelectorAll('.mode-popover .mode-option')].every(row => row.querySelector('.mode-option-name') && row.querySelector('.mode-option-key'))"), true, "每一行都要有名称和数字键");
      assert.equal(await evaluate("(() => { const p = document.querySelector('.mode-popover'); return p.scrollHeight <= p.clientHeight + 1; })()"), true, "窗口高度足够时，模式菜单不应出现滚动");
      // 菜单内容超出限高时必须在菜单内滚动，不能溢出到菜单外盖住页面。
      assert.deepEqual(await evaluate("(() => { const s = getComputedStyle(document.querySelector('.mode-popover')); return [s.overflowY, s.maxHeight !== 'none']; })()"), ["auto", true], "模式菜单需要限高并在内部滚动");
      if (shots) {
        await evaluate("window.setWidth(800)");
        await new Promise(done => setTimeout(done, 400));
        writeFileSync(join(shots, "mode-popover.png"), (await win.webContents.capturePage()).toPNG());
      }
      assert.deepEqual(failures, []);
      assert.deepEqual(errors, []);
      console.log(`PASS: 托盘 ${widths.length} 次宽窄切换 × 6 组语言/权限/强度；40 组字号/长模型名；速度恢复和隐藏后重现，无重叠、无溢出、无过度收起`);
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { win.destroy(); app.exit(process.exitCode ?? 0); }
  }).catch(error => { console.error(error); app.exit(1); });
}
