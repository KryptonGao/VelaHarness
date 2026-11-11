/** Real Electron coverage for the opt-in version-control review layout. No Git or network is used. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(desktop, "package.json"));
const temporaryKey = "VELA_VC_LAYOUT_UI_TEMP";
const preferenceKey = "vela.versionControlLayout";

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-vc-layout-ui-"));
  try {
    const { build } = await import("esbuild");
    await build({
      entryPoints: [join(desktop, "test/version-control-preview.tsx")],
      alias: { "@vela/shared": resolve(desktop, "../../packages/shared/src/index.ts") },
      loader: { ".svg": "dataurl" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"),
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
      logLevel: "error",
    });
    writeFileSync(join(temporary, "index.html"), `<!doctype html><html lang="zh-CN" data-scheme="light"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="ui.css"><style>
      html,body,#root { height:100%; margin:0; } body { background:var(--bg-chat); }
      .fixture { height:100vh; display:flex; }
      </style></head><body><div id="root"></div><script src="ui.js"></script></body></html>`);
    const env = { ...process.env, [temporaryKey]: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    try {
      const code = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      assert.equal(code, 0, "Version-control layout Electron checks failed");
    } finally { clearTimeout(timer); }
  } finally {
    // Only this freshly-created, absolute temporary test directory is removed.
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + "/vela-vc-layout-ui-"));
    rmSync(resolve(temporary), { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env[temporaryKey];
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1440, height: 940, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    const requests = [];
    win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      if (/^https?:/i.test(details.url)) requests.push(details.url);
      callback({ cancel: /^https?:/i.test(details.url) });
    });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    let currentCase = "loading";
    const cases = [];
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`Timed out (${currentCase}): ${code}`);
    };
    const nextFrame = () => evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    const reload = () => new Promise(done => {
      win.webContents.once("did-finish-load", done);
      win.webContents.reload();
    });
    const contrast = ({color, background}) => {
      const luminance = css => {
        const channels = css.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255)
          .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const values = [luminance(color), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const check = async (name, fn) => {
      currentCase = name;
      await fn();
      cases.push(name);
      console.log(`PASS ${name}`);
    };
    const click = selector => evaluate(`(() => {
      const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility({visibilityProperty:true}));
      if(!node)throw new Error('No visible control: '+${JSON.stringify(selector)});node.click();
    })()`);
    const key = (selector, value) => evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(value)}, bubbles:true}))`);
    const edit = async (selector, value) => {
      await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select(); })()`);
      await win.webContents.insertText(value);
      await until(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`);
      await nextFrame();
    };
    const layout = async value => {
      await click('.vc-layout-controls [role="combobox"]');
      await until('!!document.querySelector(".settings-menu[role=listbox]")');
      await evaluate(`document.querySelectorAll('.settings-menu [role="option"]')[${value === "classic" ? 0 : 1}].click()`);
      await until(`document.querySelector('.vc-root')?.dataset.vcLayout===${JSON.stringify(value)} && !document.querySelector('.settings-menu')`);
      await nextFrame();
    };
    const page = async value => {
      await click(`.vc-subtabs [data-tab-key="${value}"]`);
      await until(`document.querySelector('.vc-subtabs [data-tab-key="${value}"]').getAttribute('aria-selected')==='true'`);
      await nextFrame();
    };
    const screenshot = async name => {
      const output = process.env.VELA_VC_LAYOUT_SCREENSHOTS;
      if (!output) return;
      mkdirSync(resolve(output), { recursive: true });
      await nextFrame();
      writeFileSync(join(resolve(output), `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const bounds = () => evaluate(`(() => {
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
      return {root:rect('.vc-root'), files:rect('.vc-files'), composer:rect('.vc-composer'), diff:rect('.vc-diff-content'),
        header:rect('.vc-diff-head'), scroll:rect('.vc-diff-scroll'), title:rect('.vc-commit-title')};
    })()`);
    const visible = selector => evaluate(`!![...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility({visibilityProperty:true}))`);
    const noOverflow = async name => {
      const result = await evaluate(`(() => {
        const root=document.querySelector('.vc-root'), box=root.getBoundingClientRect();
        const selectors=['.vc-repo-bar','.vc-page-tabs','.vc-layout-controls','.vc-review-toolbar','.vc-review-sync-actions','.vc-composer','.vc-files','.vc-pr','.vc-pr-grid','.vc-pr-form','.vc-pr-scope','.vc-pr-actions'];
        const outside=selectors.flatMap(selector=>{const n=document.querySelector(selector);if(!n?.checkVisibility({visibilityProperty:true}))return [];const r=n.getBoundingClientRect();return r.left < box.left-1 || r.right > box.right+1 ? [{selector,left:r.left,right:r.right}] : []});
        return {width:box.width,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,rootWidth:root.clientWidth,rootScroll:root.scrollWidth,outside};
      })()`);
      assert.ok(result.width > 0, `${name}: component remains visible`);
      assert.ok(result.pageWidth <= result.viewport + 1, `${name}: no page overflow: ${JSON.stringify(result)}`);
      assert.ok(result.rootScroll <= result.rootWidth + 1, `${name}: no root overflow: ${JSON.stringify(result)}`);
      assert.deepEqual(result.outside, [], `${name}: chrome and rail stay inside component`);
    };
    const withinRoot = async selector => {
      const result = await evaluate(`(() => {
        const root=document.querySelector('.vc-root').getBoundingClientRect();
        const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.checkVisibility({visibilityProperty:true}));
        if(!node)return null;
        const box=node.getBoundingClientRect();
        return {root:{left:root.left,right:root.right},box:{left:box.left,right:box.right,width:box.width}};
      })()`);
      assert.ok(result, `${currentCase}: visible ${selector}`);
      assert.ok(result.box.left >= result.root.left - 1 && result.box.right <= result.root.right + 1,
        `${currentCase}: ${selector} stays inside its component: ${JSON.stringify(result)}`);
    };
    const menuOpen = async () => {
      await click('.vc-review-menu-anchor > button');
      await until('!!document.querySelector(".vc-review-menu[role=menu]")');
    };
    try {
      await win.loadFile(join(temporary, "index.html"), { query: { conflicts: "0" } });
      await until('!!window.vcFixture && !!document.querySelector(".vc-commit-title") && document.querySelectorAll(".vc-file-row").length===7');
      await check("classic remains the default with original toolbar and composer placement", async () => {
        assert.equal(await evaluate("document.querySelector('.vc-root').dataset.vcLayout"), "classic");
        assert.equal(await evaluate("document.querySelector('.vc-composer-compact')"), null);
        assert.equal(await visible('.vc-repo-tools'), true);
        const b = await bounds();
        assert.ok(b.composer.left >= b.files.right - 1, JSON.stringify(b));
        assert.ok(b.composer.top >= b.scroll.bottom - 1, JSON.stringify(b));
        await screenshot("classic-light");
      });
      await check("real layout select preserves draft node, text, filter and selected scope in both directions", async () => {
        await edit('.vc-commit-title', 'feat: preserve live review draft');
        await edit('.vc-commit-body', 'Unsubmitted details survive the optional layout switch.');
        await edit('.vc-files .vc-search input', 'ChatView');
        await until('document.querySelectorAll(".vc-file-row").length===2');
        await click('.vc-group:last-child .vc-file-row');
        await evaluate(`window.__vcDraftNode=document.querySelector('.vc-commit-title');window.__vcSelectedScope=document.querySelector('.vc-file-row.selected .vc-file-dir').textContent`);
        for (const value of ['review', 'classic', 'review']) {
          await layout(value);
          assert.equal(await evaluate("document.querySelector('.vc-commit-title')===window.__vcDraftNode"), true, value);
          assert.equal(await evaluate("document.querySelector('.vc-commit-title').value"), 'feat: preserve live review draft', value);
          assert.equal(await evaluate("document.querySelector('.vc-commit-body').value"), 'Unsubmitted details survive the optional layout switch.', value);
          assert.equal(await evaluate("document.querySelector('.vc-files .vc-search input').value"), 'ChatView', value);
          assert.equal(await evaluate("document.querySelector('.vc-file-row.selected .vc-file-dir').textContent===window.__vcSelectedScope"), true, value);
          assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(preferenceKey)})`), JSON.stringify(value), value);
          await until('!!document.querySelector(".vc-diff-scroll .changes-diff-body")');
          assert.equal(await evaluate('document.querySelectorAll(".vc-diff-scroll .diff-line-number").length>0'),value==='review',
            `${value}: only review opts into shared diff line numbers`);
        }
      });
      await check("review has a left file/commit rail and a full-height right diff", async () => {
        const b = await bounds();
        assert.ok(Math.abs(b.files.left - b.composer.left) < 1, JSON.stringify(b));
        assert.ok(Math.abs(b.files.width - b.composer.width) < 1, JSON.stringify(b));
        assert.ok(b.composer.top >= b.files.bottom - 1, JSON.stringify(b));
        assert.ok(b.diff.left >= b.files.right - 1, JSON.stringify(b));
        assert.ok(b.diff.bottom >= b.composer.bottom - 1, JSON.stringify(b));
        await noOverflow('review desktop');
        await screenshot('review-light');
      });
      await check("review diff gutters stay distinct and pure deletions use the full split width", async () => {
        const gutters = await evaluate(`(() => {const n=document.querySelector('.vc-diff-scroll .diff-line-number');const s=getComputedStyle(n);return {display:s.display,width:n.getBoundingClientRect().width,padding:parseFloat(s.paddingRight)}})()`);
        assert.equal(gutters.display, 'inline-block');
        assert.ok(gutters.width >= 24 && gutters.padding >= 6, JSON.stringify(gutters));
        await edit('.vc-files .vc-search input', '');
        const deletion = ['diff --git a/scripts/legacy.mjs b/scripts/legacy.mjs','--- a/scripts/legacy.mjs','+++ /dev/null','@@ -4,2 +0,0 @@','-export const legacy = true;','-console.log(legacy);'].join('\n');
        await evaluate(`window.__vcOriginalDiff=window.vcFixture.project.fileDiff;window.vcFixture.project.fileDiff=async()=>${JSON.stringify(deletion)};[...document.querySelectorAll('.vc-file-row')].find(n=>n.textContent.includes('legacy.mjs')).click();void 0`);
        await until(`document.querySelector('.vc-diff-path').textContent.includes('legacy.mjs') && document.querySelector('.vc-diff-scroll .diff-line-number')?.textContent==='4'`);
        await click('.vc-diff-options button:nth-child(2)');
        await until(`!!document.querySelector('.vc-diff-scroll .diff-split-single')`);
        const rows = await evaluate(`[...document.querySelectorAll('.vc-diff-scroll .diff-split-row')].map(row=>({width:row.getBoundingClientRect().width,cell:row.querySelector('.diff-split-cell')?.getBoundingClientRect().width,count:row.querySelectorAll('.diff-split-cell').length}))`);
        assert.equal(rows.length, 2);
        for (const row of rows) { assert.equal(row.count, 1); assert.ok(Math.abs(row.width-row.cell)<1, JSON.stringify(row)); }
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('.vc-diff-scroll .diff-line-number')].map(n=>n.textContent)`), ['4','5']);
        await evaluate(`window.vcFixture.project.fileDiff=window.__vcOriginalDiff;[...document.querySelectorAll('.vc-file-row')].find(n=>n.textContent.includes('ChatView.tsx')).click();void 0`);
        await until(`document.querySelector('.vc-diff-path').textContent.includes('ChatView.tsx') && document.querySelector('.vc-diff-scroll .diff-line-number')?.textContent==='184'`);
        await click('.vc-diff-options button:first-child');
        await edit('.vc-files .vc-search input', 'ChatView');
      });
      await check("new primary and toolbar buttons use App rounded borderless shadowless controls", async () => {
        const styles = await evaluate(`['.vc-composer-actions > .vc-btn-primary','.vc-review-sync-actions > .vc-btn:last-of-type','.vc-review-toolbar .vc-branch-btn'].map(selector=>{
          const n=document.querySelector(selector),s=getComputedStyle(n);return {selector,height:n.getBoundingClientRect().height,border:s.borderTopWidth,radius:s.borderTopLeftRadius,shadow:s.boxShadow};})`);
        for (const style of styles) {
          assert.ok(style.height >= 32 && style.height < 48, JSON.stringify(style));
          assert.equal(style.border, '0px', style.selector);
          assert.equal(style.shadow, 'none', style.selector);
          assert.equal(style.radius, '12px', style.selector);
        }
      });
      await check("filtering and actual guarded stage/unstage functions retain path and scope", async () => {
        await evaluate(`window.__vcMutations=[];window.__vcGuardRequests=0;
          window.vcFixture.project.stageFiles=async paths=>{window.__vcMutations.push(['stage',paths]);return true};
          window.vcFixture.project.unstageFiles=async paths=>{window.__vcMutations.push(['unstage',paths]);return true};
          window.vela.getGitGuard=async()=>{window.__vcGuardRequests++;return {agentRunning:false,conversationId:null,reason:null}};void 0`);
        await click('.vc-group:first-child .vc-file-row .vc-file-actions button:last-child');
        await until('window.__vcMutations.length===1');
        await click('.vc-group:last-child .vc-file-row .vc-file-actions button:last-child');
        await until('window.__vcMutations.length===2');
        assert.deepEqual(await evaluate('window.__vcMutations'), [
          ['stage', ['apps/desktop/src/renderer/components/ChatView.tsx']],
          ['unstage', ['apps/desktop/src/renderer/components/ChatView.tsx']],
        ]);
        assert.equal(await evaluate('window.__vcGuardRequests'), 2);
        await edit('.vc-files .vc-search input', 'no-such-file');
        await until('document.querySelectorAll(".vc-file-row").length===0');
        await edit('.vc-files .vc-search input', 'ChatView');
        await until('document.querySelectorAll(".vc-file-row").length===2');
      });
      await check("running-agent guard blocks staging without invoking project mutation", async () => {
        await evaluate(`window.vela.getGitGuard=async()=>{window.__vcGuardRequests++;return {agentRunning:true,conversationId:'guarded',reason:null}};void 0`);
        await click('.vc-group:first-child .vc-file-row .vc-file-actions button:last-child');
        await until('!!document.querySelector(".vc-error-banner") && window.__vcGuardRequests===3');
        assert.equal(await evaluate('window.__vcMutations.length'), 2);
        await evaluate(`window.vela.getGitGuard=async()=>({agentRunning:false,conversationId:null,reason:null});void 0`);
        await click('.vc-error-banner .vc-link');
      });
      await check("repository menu supports keyboard traversal, Escape and focus restoration", async () => {
        const trigger = '.vc-review-menu-anchor > button';
        await evaluate(`document.querySelector(${JSON.stringify(trigger)}).focus()`);
        await key(trigger, 'ArrowDown');
        await until('!!document.querySelector(".vc-review-menu") && document.activeElement===document.querySelector(".vc-review-menu button")');
        assert.ok(await evaluate('document.querySelectorAll(".vc-review-menu [role=menuitem]").length') >= 10);
        await key('.vc-review-menu', 'End');
        assert.equal(await evaluate('document.activeElement===document.querySelector(".vc-review-menu button:last-child")'), true);
        await key('.vc-review-menu', 'ArrowDown');
        assert.equal(await evaluate('document.activeElement===document.querySelector(".vc-review-menu button:first-child")'), true);
        await key('.vc-review-menu', 'Escape');
        await until('!document.querySelector(".vc-review-menu")');
        assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(trigger)})`), true);
      });
      await check("branch and remote management remain reachable from the new overflow menu", async () => {
        await menuOpen();
        await click('.vc-review-menu button:first-child');
        await until('!!document.querySelector(".vc-branch-panel[role=dialog]")');
        assert.ok(await evaluate('document.querySelector(".vc-branch-panel").textContent.includes("main")'));
        await click('.vc-branch-panel .vc-ops-head button:last-child');
        await menuOpen();
        await click('.vc-review-menu button:nth-child(2)');
        await until('!!document.querySelector(".vc-remote-popover[role=dialog]")');
        assert.ok(await evaluate('document.querySelector(".vc-remote-popover").textContent.includes("origin")'));
        await click('.vc-remote-popover .vc-ops-head button:last-child');
      });
      await check("history and PR pages remain available in both layouts", async () => {
        for (const value of ['review', 'classic']) {
          if (await evaluate("document.querySelector('.vc-root').dataset.vcLayout") !== value) await layout(value);
          await page('history');
          await until('document.querySelectorAll(".vc-commit-row").length>0');
          await click('.vc-commit-row');
          await until('!!document.querySelector(".vc-detail-head h2")');
          assert.ok(await evaluate('document.querySelector(".vc-detail-head h2").textContent.includes("version control")'));
          await screenshot(`${value}-history`);
          await page('pr');
          await until('!!document.querySelector(".vc-pr")');
          assert.ok(await evaluate('document.querySelector(".vc-pr").textContent.includes("Pull Request")'));
          await page('changes');
          await until('!!document.querySelector(".vc-commit-title")');
        }
        await layout('review');
      });
      await check("native checkbox, radio and select retain keyboard focus outlines in review mode", async () => {
        // Hidden BrowserWindows have document.hasFocus() === false, so Chromium suppresses
        // :focus-visible. Emulate a focused page while exercising the real keyboard and CSS.
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
        const focusNative = async selector => {
          win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
          win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
          const style = await evaluate(`(() => {
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
            const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.checkVisibility({visibilityProperty:true}));
            if(!node)throw new Error('No visible native control: '+${JSON.stringify(selector)});
            node.focus();const style=getComputedStyle(node);
            return {outline:style.outlineStyle,width:style.outlineWidth,focused:document.activeElement===node,
              focusVisible:node.matches(':focus-visible'),keyboardFocus:document.documentElement.hasAttribute('data-keyboard-focus'),documentFocused:document.hasFocus()};
          })()`);
          assert.equal(style.focused,true,selector);
          assert.notEqual(style.outline,'none',`${selector}: ${JSON.stringify(style)}`);
          assert.ok(parseFloat(style.width)>=2,`${selector}: ${JSON.stringify(style)}`);
        };
        await focusNative('.vc-diff-options input[type="checkbox"]');
        await click('.vc-composer-options-toggle');
        await click('.vc-composer-style > button');
        await until('!!document.querySelector(".vc-undo-panel input[type=radio]")');
        await focusNative('.vc-undo-panel input[type="radio"]');
        await click('.vc-undo-panel .vc-dialog-actions > button:first-child');
        await click('.vc-composer-options-toggle');
        await page('history');
        await focusNative('.vc-history-tools select');
        await page('changes');
        await until('!!document.querySelector(".vc-commit-title")');
        await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:false});
        win.webContents.debugger.detach();
      });
      await check("saved review layout and commit draft survive renderer reload", async () => {
        await edit('.vc-commit-title', 'feat: restore persisted review layout');
        await until(`localStorage.getItem(${JSON.stringify(preferenceKey)})==='"review"'`);
        await new Promise(done => setTimeout(done, 450));
        await reload();
        await until('!!document.querySelector(".vc-commit-title") && document.querySelector(".vc-root").dataset.vcLayout==="review"');
        assert.equal(await evaluate('document.querySelector(".vc-commit-title").value'), 'feat: restore persisted review layout');
      });
      await check("light and dark themes keep review controls and code readable", async () => {
        const colors = [];
        for (const scheme of ['light', 'dark']) {
          await evaluate(`document.documentElement.dataset.scheme=${JSON.stringify(scheme)}`);
          await nextFrame();
          colors.push(await evaluate(`(() => {const n=document.querySelector('.vc-root'),s=getComputedStyle(n);return {background:s.backgroundColor,color:s.color}})()`));
          assert.equal(await visible('.vc-composer-actions > .vc-btn-primary'), true);
          await noOverflow(`review ${scheme}`);
          await screenshot(`review-${scheme}`);
        }
        assert.notEqual(colors[0].background, colors[1].background);
        assert.notEqual(colors[0].color, colors[1].color);
        for (const color of colors) assert.ok(contrast(color) >= 4.5, `Body text contrast is at least 4.5:1: ${JSON.stringify(color)}`);
        await evaluate('document.documentElement.dataset.scheme="light"');
      });
      for (const width of [600, 375]) {
        await check(`review narrow-window files, commit and diff navigation at ${width}px`, async () => {
          win.setContentSize(width, 900);
          await nextFrame();
          // Returning from the diff reveals both the files and commit composer.
          if (await visible('.vc-review-diff-navigation button')) await click('.vc-review-diff-navigation button');
          assert.equal(await visible('.vc-files'), true);
          assert.equal(await visible('.vc-composer'), true);
          assert.equal(await visible('.vc-diff-content'), false);
          await noOverflow(`${width}px rail`);
          const b = await bounds();
          assert.ok(b.composer.bottom <= 901, JSON.stringify(b));
          await screenshot(`review-${width}-files`);
          await click('.vc-file-row');
          await until('!!document.querySelector(".vc-changes.show-diff")');
          assert.equal(await visible('.vc-diff-content'), true);
          assert.equal(await visible('.vc-files'), false);
          assert.equal(await visible('.vc-composer'), false);
          assert.equal(await visible('.vc-review-diff-navigation button'), true);
          await noOverflow(`${width}px diff`);
          await screenshot(`review-${width}-diff`);
          await click('.vc-review-diff-navigation button');
          await until('document.activeElement===document.querySelector(".vc-file-row.selected")');
        });
      }
      for (const width of [600, 375]) {
        await check(`file and history navigation use ${width}px component width in a 1440px window`, async () => {
          win.setContentSize(1440, 940);
          await evaluate(`document.querySelector('.fixture').style.width='${width}px'`);
          await nextFrame();
          assert.equal(await visible('.vc-files'), true);
          assert.equal(await visible('.vc-composer'), true);
          assert.equal(await visible('.vc-diff-content'), false);
          await noOverflow(`${width}px pane / 1440px window`);
          await click('.vc-review-toolbar .vc-branch-btn');
          await until('!!document.querySelector(".vc-branch-popover")');
          await withinRoot('.vc-branch-popover');
          await screenshot(`review-${width}-pane-branches`);
          await click('.vc-review-toolbar .vc-branch-btn');
          await menuOpen();
          await withinRoot('.vc-review-menu');
          await click('.vc-review-menu button:nth-child(2)');
          await until('!!document.querySelector(".vc-remote-popover")');
          await withinRoot('.vc-remote-popover');
          await screenshot(`review-${width}-pane-remotes`);
          await click('.vc-remote-popover .vc-ops-head button:last-child');
          await screenshot(`review-${width}-pane-files`);
          await click('.vc-file-row');
          await until('!!document.querySelector(".vc-changes.show-diff")');
          assert.equal(await visible('.vc-review-diff-navigation button'), true);
          assert.equal(await visible('.vc-files'), false);
          await screenshot(`review-${width}-pane-diff`);
          await click('.vc-review-diff-navigation button');
          await until('document.activeElement===document.querySelector(".vc-file-row.selected")');
          assert.equal(await visible('.vc-files'), true);
          assert.equal(await visible('.vc-composer'), true);
          await page('history');
          await until('!!document.querySelector(".vc-commit-row")');
          assert.equal(await visible('.vc-history-list'), true);
          assert.equal(await visible('.vc-commit-detail'), false);
          await click('.vc-commit-row');
          await until('!!document.querySelector(".vc-detail-head h2")');
          assert.equal(await visible('.vc-history-list'), false);
          assert.equal(await visible('.vc-commit-detail'), true);
          assert.equal(await visible('.vc-review-history-navigation button'), true);
          await noOverflow(`${width}px history pane / 1440px window`);
          await screenshot(`review-${width}-pane-history`);
          await click('.vc-review-history-navigation button');
          await until('document.activeElement===document.querySelector(".vc-commit-row.selected")');
          assert.equal(await visible('.vc-history-list'), true);
          assert.equal(await visible('.vc-commit-detail'), false);
          await page('pr');
          await until('!!document.querySelector(".vc-pr")');
          await noOverflow(`${width}px PR pane / 1440px window`);
          const outside = await evaluate(`(() => {
            const root=document.querySelector('.vc-root').getBoundingClientRect();
            return [...document.querySelectorAll('.vc-pr input,.vc-pr textarea,.vc-pr select')]
              .filter(n=>n.checkVisibility({visibilityProperty:true}))
              .map(n=>({tag:n.tagName,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right}))
              .filter(box=>box.left<root.left-1||box.right>root.right+1);
          })()`);
          assert.deepEqual(outside,[],`${width}px PR inputs remain inside the narrow component`);
          await screenshot(`review-${width}-pane-pr`);
          await page('changes');
          await until('!!document.querySelector(".vc-commit-title")');
          await evaluate("document.querySelector('.fixture').style.width=''");
          await nextFrame();
        });
      }
      for (const [name,width,height,scale] of [
        ['short 1024x500 window',1024,500,1],
        ['150 percent UI scale',1440,940,1.5],
      ]) {
        await check(`review composer and commit action remain visible in ${name}`, async () => {
          win.setContentSize(width,height);
          await evaluate(`document.documentElement.style.setProperty('--ui-scale',${JSON.stringify(String(scale))})`);
          await nextFrame();
          assert.equal(await visible('.vc-composer'),true);
          assert.equal(await visible('.vc-composer-actions > .vc-btn-primary'),true);
          const boxes = await evaluate(`(() => {
            const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
            return {root:rect(document.querySelector('.vc-root')),composer:rect(document.querySelector('.vc-composer')),
              action:rect(document.querySelector('.vc-composer-actions > .vc-btn-primary'))};
          })()`);
          for(const child of [boxes.composer,boxes.action]) {
            assert.ok(child.left>=boxes.root.left-1 && child.right<=boxes.root.right+1 && child.top>=boxes.root.top-1 && child.bottom<=boxes.root.bottom+1,
              `${name}: composer and commit action stay inside root: ${JSON.stringify(boxes)}`);
          }
          assert.ok(boxes.action.top>=boxes.composer.top-1 && boxes.action.bottom<=boxes.composer.bottom+1,
            `${name}: commit action is not clipped by composer scrolling: ${JSON.stringify(boxes)}`);
          await noOverflow(name);
          await screenshot(scale===1?'review-short-1024x500':'review-ui-scale-150');
        });
      }
      await evaluate("document.documentElement.style.removeProperty('--ui-scale')");
      win.setContentSize(1440,940);
      await nextFrame();
      await check("classic remains selectable and persists after review use", async () => {
        await layout('classic');
        assert.equal(await visible('.vc-repo-tools'), true);
        assert.equal(await evaluate('document.querySelector(".vc-composer-compact")'), null);
        await reload();
        await until('document.querySelector(".vc-root")?.dataset.vcLayout==="classic"');
        assert.equal(await evaluate('document.querySelector(".vc-composer-compact")'), null);
      });
      assert.deepEqual(errors, [], "No renderer console errors");
      assert.deepEqual(requests, [], "No external HTTP requests or real Git endpoints");
      console.log(`Version-control layout UI: ${cases.length} real Electron regression cases passed`);
      app.exit(0);
    } catch (error) {
      console.error(`Version-control layout UI failed during: ${currentCase}`);
      console.error(error);
      console.error(await evaluate(`(() => { const root=document.querySelector('.vc-root');return {layout:root?.dataset.vcLayout,viewport:[innerWidth,innerHeight],text:root?.textContent.slice(0,1800),errors:${JSON.stringify(errors)}}})()`));
      await screenshot('failure').catch(() => {});
      app.exit(1);
    }
  });
}
