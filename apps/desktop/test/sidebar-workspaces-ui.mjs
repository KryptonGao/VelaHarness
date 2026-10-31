/** Focused workspace folder and overflow checks: node apps/desktop/test/sidebar-workspaces-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-sidebar-workspaces-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Sidebar } from './apps/desktop/src/renderer/components/Sidebar';
        import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
        localStorage.setItem('vela.sidebarView', JSON.stringify('workspaces'));
        const now = Date.now();
        const titles = ['Respond to greeting', '增加变更分类筛选', '统一界面设计', '构思 Vela 新功能', '发布 Vela 1.2.6', '检查历史记录', '优化工作区'];
        const conversations = titles.map((title, index) => ({id: 'a' + index, title, cwd: '/projects/VelaHarness', updatedAt: now - index, archivedAt: null, status: 'ready'}));
        conversations.push(...Array.from({length: 6}, (_, index) => ({id: 'b' + index, title: '项目笔记 ' + index, cwd: '/projects/Notes', updatedAt: now - 100 - index, archivedAt: null, status: 'ready'})));
        const root = createRoot(document.getElementById('root'));
        function Fixture({locale}) {
          const [items, setItems] = useState(conversations);
          const [active, setActive] = useState('a0');
          window.selectChat = setActive;
          window.setChats = setItems;
          return <AppLocaleProvider locale={locale}><div className="vela-window platform-darwin right-collapsed" style={{height:'100vh'}}>
            <Sidebar collapsed={false} platform="darwin" resize={{widths:{left:248,right:300,workbench:500},startResize(){},nudge(){},reset(){}}}
              conversations={items} activeConversationId={active} settingsOpen={false} settingsLabel="设置"
              workspaces={[{path:'/projects/VelaHarness',name:'VelaHarness',lastUsedAt:now,folders:['/projects/shared-lib']}]} onEditWorkspace={cwd=>{window.edited=cwd;}}
              onToggle={()=>{}} onOpenSettings={()=>{}} onNewChat={()=>{}} onSwitchConversation={setActive}
              onArchiveConversation={id=>setItems(items=>items.map(item=>item.id===id?{...item,archivedAt:now}:item))}
              onOpenPrInbox={()=>{}} prInboxOpen={false} onOpenAgentInbox={()=>{}} agentInboxOpen={false} agentInboxBadge={0}
              onOpenRecipes={()=>{}} recipesOpen={false} onOpenScheduledTasks={()=>{}} scheduledTasksOpen={false}/>
          </div></AppLocaleProvider>;
        }
        window.renderLocale = locale => {setActiveLocale(locale); root.render(<Fixture locale={locale}/>);};
        window.renderLocale('zh-CN');
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><style>' +
      readFileSync(join(here, "../src/renderer/styles.css"), "utf8") +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_SIDEBAR_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Sidebar workspace interaction checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_SIDEBAR_TEMP, "profile"));
  void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 820, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    win.webContents.debugger.attach("1.3");
    const reducedMotion = value => win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value }],
    });
    await win.loadFile(join(process.env.VELA_SIDEBAR_TEMP, "index.html"));
    await reducedMotion("no-preference");
    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`Timed out: ${code}`);
    };
    const group = "document.querySelector('.session-group')";
    const rows = `${group}.querySelectorAll('.subchat-row:not([inert] .subchat-row)')`;
    const more = `${group}.querySelector('.session-group-show-more')`;
    await until(`${rows}.length === 5`);
    assert.equal(await evaluate(`${more}.textContent`), "展开显示");
    assert.equal(await evaluate(`${group}.querySelectorAll('.session-group-folder svg').length`), 1);
    assert.equal(await evaluate(`document.getElementById(${more}.getAttribute('aria-controls')).contains(${rows}[0])`), true);
    await evaluate(`${more}.focus()`);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
    await until(`${rows}.length === 7`);
    assert.equal(await evaluate(`${more}.textContent`), "收起");
    assert.equal(await evaluate("document.querySelectorAll('.session-group')[1].querySelectorAll('.subchat-item').length"), 5, "Expanding one workspace leaves others capped");
    await evaluate("window.selectChat('a6')");
    await until(`${group}.querySelector('.subchat-item.active')?.textContent === '优化工作区'`);
    await evaluate(`${more}.click()`);
    await until(`${rows}.length === 5 && ${group}.querySelectorAll('.is-closing').length === 0`);
    assert.equal(await evaluate(`${group}.querySelector('.subchat-item.active')?.textContent`), "优化工作区", "Older selected chat stays visible after shrinking");
    await evaluate(`${more}.click()`);
    await until(`${rows}.length === 7`);
    await evaluate(`${group}.querySelector('.session-group-header').click()`);
    await until(`${group}.querySelector('.session-group-header').getAttribute('aria-expanded') === 'false'`);
    assert.equal(await evaluate(`${rows}.length`), 0, "Closing content is immediately inert");
    await until(`${group}.querySelector('.session-group-content').getBoundingClientRect().height === 0`);
    const closedIcon = await evaluate(`${group}.querySelector('.session-group-folder').innerHTML`);
    await evaluate(`${group}.querySelector('.session-group-header').click()`);
    await until(`${rows}.length === 5`);
    assert.notEqual(await evaluate(`${group}.querySelector('.session-group-folder').innerHTML`), closedIcon, "Folder reflects group expansion");
    assert.equal(await evaluate(`${more}.getAttribute('aria-expanded')`), 'false', "Reopening a workspace resets show more");
    assert.equal(await evaluate(`${more}.textContent`), "展开显示");
    assert.equal(await evaluate(`${group}.querySelector('.subchat-item.active')?.textContent`), "优化工作区", "Reset keeps the selected older chat visible");
    for (const [locale, label] of [['en', 'Show more'], ['zh-TW', '展開顯示'], ['ja', 'もっと見る'], ['ko', '더 보기'], ['zh-CN', '展开显示']]) {
      await evaluate(`window.renderLocale(${JSON.stringify(locale)})`);
      await until(`${more}.textContent === ${JSON.stringify(label)}`);
    }
    await evaluate("window.selectChat('a0')");
    await until(`${group}.querySelector('.subchat-item.active')?.textContent === 'Respond to greeting'`);
    await evaluate("document.querySelectorAll('.session-group')[1].querySelector('.session-group-header').click()");
    await until("document.querySelectorAll('.session-group')[1].classList.contains('collapsed')");
    await until("document.querySelectorAll('.session-group .is-closing').length === 0");
    await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    assert.equal(await evaluate(`${group}.querySelector('.subchat-item.active')?.textContent`), "Respond to greeting");
    // Inspect real animation frames, including both directions and interrupted transitions.
    const content = `${group}.querySelector('.session-group-content')`;
    const settle = () => evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    const sampleHeightTransition = async (target, trigger, expanding) => {
      const before = await evaluate(`${target}.getBoundingClientRect().height`);
      await evaluate(trigger);
      await until(`${target}.getAnimations().some(animation => animation.transitionProperty === 'grid-template-rows')`);
      const frames = await evaluate(`(() => {
        const node = ${target};
        const animation = node.getAnimations().find(animation => animation.transitionProperty === 'grid-template-rows');
        animation.pause();
        const duration = animation.effect.getTiming().duration;
        animation.currentTime = duration * 0.5;
        const middle = node.getBoundingClientRect().height;
        animation.currentTime = duration;
        const after = node.getBoundingClientRect().height;
        animation.finish();
        return {middle, after};
      })()`);
      assert.ok(expanding ? before < frames.middle && frames.middle < frames.after : before > frames.middle && frames.middle > frames.after,
        `Continuous ${expanding ? 'expansion' : 'collapse'}: ${JSON.stringify({before, ...frames})}`);
      await settle();
    };
    await sampleHeightTransition(content, `${group}.querySelector('.session-group-header').click()`, false);
    await sampleHeightTransition(content, `${group}.querySelector('.session-group-header').click()`, true);
    // Overflow rows must grow into place rather than reserving their full height immediately.
    await evaluate(`${more}.click()`);
    await until(`${group}.querySelector('.workspace-chat-list > [data-motion-key="a5"]')?.getAnimations().some(animation => animation.transitionProperty === 'grid-template-rows')`);
    const entryFrames = await evaluate(`(() => {
      const row = ${group}.querySelector('.workspace-chat-list > [data-motion-key="a5"]');
      const animation = row.getAnimations().find(animation => animation.transitionProperty === 'grid-template-rows');
      if (!animation) return null;
      animation.pause();
      const duration = animation.effect.getTiming().duration;
      animation.currentTime = 0;
      const start = row.getBoundingClientRect().height;
      animation.currentTime = duration * 0.5;
      const middle = row.getBoundingClientRect().height;
      animation.currentTime = duration;
      const end = row.getBoundingClientRect().height;
      animation.finish();
      return {start, middle, end};
    })()`);
    assert.ok(entryFrames && entryFrames.start < entryFrames.middle && entryFrames.middle < entryFrames.end,
      `Overflow expansion has intermediate heights: ${JSON.stringify(entryFrames)}`);
    await evaluate(`${more}.click()`);
    await until(`${rows}.length === 5 && ${group}.querySelectorAll('.is-closing').length === 0`);
    await evaluate(`(async () => {
      const header = ${group}.querySelector('.session-group-header');
      header.click();
      await new Promise(done => requestAnimationFrame(done));
      header.click();
    })()`);
    await until(`${content}.getAnimations().length === 0 && ${content}.getBoundingClientRect().height > 0`);
    assert.equal(await evaluate(`${rows}.length`), 5, "Rapid close/reopen preserves accessible chats");
    await reducedMotion("reduce");
    await until("matchMedia('(prefers-reduced-motion: reduce)').matches");
    await evaluate(`${group}.querySelector('.session-group-header').click()`);
    await until(`${content}.getBoundingClientRect().height === 0`);
    assert.equal(await evaluate(`${content}.getAnimations().length`), 0);
    await evaluate(`${group}.querySelector('.session-group-header').click()`);
    await until(`${content}.getBoundingClientRect().height > 0`);
    assert.equal(await evaluate(`${content}.getAnimations().length`), 0);
    await evaluate(`${more}.click()`);
    await until(`${rows}.length === 7`);
    assert.equal(await evaluate(`${group}.querySelector('.workspace-chat-list > .is-entering').getAnimations().length`), 0);
    await evaluate(`${more}.click()`);
    await until(`${rows}.length === 5 && ${group}.querySelectorAll('.is-closing').length === 0`);
    await reducedMotion("no-preference");
    await settle();
    const screenshot = process.env.VELA_SIDEBAR_SCREENSHOT;
    if (screenshot) writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
    // Workspace hover card and pinning.
    const rowCenter = async index => evaluate(`(() => { const r = document.querySelectorAll('.session-group-header')[${index}].getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), right: r.right}; })()`);
    const hoverRow = async index => {
      const point = await rowCenter(index);
      win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
      return point;
    };
    const card = "document.querySelector('.workspace-hover-card')";
    const point = await hoverRow(0);
    await until(`${card}?.matches(':popover-open')`);
    assert.ok(await evaluate(`${card}.getBoundingClientRect().left >= ${point.right}`), "Card opens to the right of the row");
    const cardText = await evaluate(`${card}.textContent`);
    assert.ok(cardText.includes("7 次聊天") && cardText.includes("/projects/VelaHarness") && cardText.includes("/projects/shared-lib"), cardText);
    const cardScreenshot = process.env.VELA_SIDEBAR_CARD_SCREENSHOT;
    if (cardScreenshot) await new Promise(done => setTimeout(done, 300));
    if (cardScreenshot) writeFileSync(cardScreenshot, (await win.webContents.capturePage()).toPNG());
    win.webContents.sendInputEvent({ type: "mouseMove", x: 700, y: 700 });
    await until(`!${card}`);
    await hoverRow(0);
    await until(`${card}`);
    await evaluate(`${card}.querySelector('.workspace-hover-card-edit').click()`);
    assert.equal(await evaluate("window.edited"), "/projects/VelaHarness");
    await until(`!${card}`);
    // Pinning moves the workspace into the Pinned section and persists.
    await hoverRow(1);
    await until(`${card}?.textContent.includes('6 次聊天')`);
    await evaluate(`${card}.querySelector('.workspace-hover-card-pin').click()`);
    await until("document.querySelectorAll('.sidebar-pinned-workspaces .session-group').length === 1");
    assert.equal(await evaluate("document.querySelector('.sidebar-pinned-workspaces .session-group-name').textContent"), "Notes");
    assert.equal(await evaluate("document.querySelector('.sidebar-pinned-workspaces .sidebar-section-toggle').textContent"), "置顶");
    assert.equal(await evaluate("localStorage.getItem('vela.pinnedWorkspaces')"), JSON.stringify({ '/projects/Notes': true }));
    assert.equal(await evaluate("document.querySelector('.sidebar-workspaces-title').textContent"), "工作区");
    await until("document.querySelectorAll('.session-group').length === 2");
    await evaluate("document.querySelector('.sidebar-pinned-workspaces .sidebar-section-toggle').click()");
    await until("document.querySelectorAll('.sidebar-pinned-workspaces .session-group').length === 0");
    await evaluate("document.querySelector('.sidebar-pinned-workspaces .sidebar-section-toggle').click()");
    await until("document.querySelectorAll('.sidebar-pinned-workspaces .session-group').length === 1");
    // The pointer last rested on the unmounted card; a fresh hover must still open the next one.
    await hoverRow(0);
    await until(`${card}?.querySelector('.workspace-hover-card-pin[aria-pressed="true"]')`);
    await evaluate(`${card}.querySelector('.workspace-hover-card-pin').click()`);
    await until("!document.querySelector('.sidebar-pinned-workspaces') && !document.querySelector('.sidebar-workspaces-title')");
    win.webContents.sendInputEvent({ type: "mouseMove", x: 700, y: 700 });
    await until(`!${card}`);
    // Boundary and live updates: the control disappears as the group drops to five.
    await evaluate("window.setChats(items => items.filter(item => !['a5','a6'].includes(item.id)))");
    await until(`${rows}.length === 5 && !${more}`);
    await evaluate("window.setChats(items => items.filter(item => item.id === 'a0' || item.cwd !== '/projects/VelaHarness'))");
    await until(`${rows}.length === 1`);
    await evaluate("window.setChats([])");
    await until("document.querySelectorAll('.session-group').length === 0 && document.querySelector('.sidebar-empty-hint')");
    console.log('Passed sidebar workspace checks: folder states, 5/6+ overflow, independent expansion, selected older chat, live updates, empty state, five locales, show-more reset on reopen, animation frames, interrupted transitions, reduced motion, workspace hover card, pinning.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  });
}
