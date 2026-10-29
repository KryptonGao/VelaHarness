/** 分类视图图标栏检查：node apps/desktop/test/nav-rail-ui.mjs（VELA_NAV_RAIL_SCREENSHOT=路径 可截图） */
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
  const temporary = mkdtempSync(join(tmpdir(), "vela-nav-rail-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Sidebar } from './apps/desktop/src/renderer/components/Sidebar';
        import { NavRail } from './apps/desktop/src/renderer/components/NavRail';
        import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
        localStorage.setItem('vela.sidebarView', JSON.stringify('workspaces'));
        const now = Date.now();
        const conversations = ['Respond to greeting', '增加变更分类筛选', '统一界面设计'].map((title, index) =>
          ({id: 'a' + index, title, cwd: '/projects/VelaHarness', updatedAt: now - index, archivedAt: null, status: 'ready'}));
        const root = createRoot(document.getElementById('root'));
        window.selected = [];
        function Fixture() {
          const [category, setCategory] = useState('home');
          const away = category !== 'home';
          window.setCategory = setCategory;
          return <AppLocaleProvider locale="zh-CN"><div className={'vela-window platform-darwin nav-rail-layout right-collapsed' + (away ? ' rail-away left-collapsed' : '')} style={{height:'100vh'}}>
            <NavRail active={category} platform="darwin" agentInboxBadge={3} onSelect={next => { window.selected.push(next); setCategory(next); }} />
            <Sidebar railMode collapsed={away} platform="darwin" resize={{widths:{left:248,right:300,workbench:500},startResize(){},nudge(){},reset(){}}}
              conversations={conversations} activeConversationId="a0" settingsOpen={false} settingsLabel="设置"
              onToggle={()=>{}} onOpenSettings={()=>{}} onNewChat={()=>{ window.newChatCalls = (window.newChatCalls || 0) + 1; }} onSwitchConversation={()=>{}}
              onArchiveConversation={()=>{}} onOpenPrInbox={()=>{}} prInboxOpen={false} onOpenAgentInbox={()=>{}} agentInboxOpen={false} agentInboxBadge={3}
              onOpenRecipes={()=>{}} recipesOpen={false} onOpenScheduledTasks={()=>{}} scheduledTasksOpen={false}/>
            <div className="main-stage"><div className="main-stage-pane is-hidden is-overlay" inert><div id="ghost-header" style={{ WebkitAppRegion: "drag" }} /></div><div className="main-stage-pane"><main className="main-chat-view" style={{flex:1}}><div className="main-chat-header"><span className="chat-active-title" id="stage-title">{category}</span></div></main></div></div>
          </div></AppLocaleProvider>;
        }
        setActiveLocale('zh-CN');
        root.render(<Fixture/>);
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><style>' +
      // 真实应用里 App（连同 NavRail 的样式）先于 styles.css 被引入，nav-rail.css 排在前面：等优先级时 styles.css 会赢，夹具必须保持同样的顺序。
      readFileSync(join(here, "../src/renderer/nav-rail.css"), "utf8") + readFileSync(join(here, "../src/renderer/styles.css"), "utf8") +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_NAV_RAIL_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Nav rail checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_NAV_RAIL_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 640, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    try {
      await win.loadFile(join(process.env.VELA_NAV_RAIL_TEMP, "index.html"));
      const evaluate = code => win.webContents.executeJavaScript(code);
      const until = async code => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (await evaluate(code)) return;
          await new Promise(done => setTimeout(done, 20));
        }
        throw new Error(`Timed out: ${code}`);
      };
      await until("document.querySelector('.nav-rail')");
      const labels = await evaluate("[...document.querySelectorAll('.nav-rail-item')].map(item => item.getAttribute('aria-label'))");
      assert.deepEqual(labels.map(label => label.split('，')[0]), ["主页", "定时任务", "任务配方", "Agent 收件箱", "Pull Request", "设置"]);
      assert.equal(await evaluate("document.querySelector('.nav-rail-item[aria-current=page]').getAttribute('aria-label')"), "主页");
      assert.equal(await evaluate("document.querySelector('.nav-rail-badge').textContent"), "3");
      assert.equal(await evaluate("document.querySelector('.sidebar-quick-actions')"), null, "Quick actions move into the rail");
      assert.equal(await evaluate("document.querySelector('.sidebar-left-footer')"), null, "Settings moves into the rail");
      assert.equal(await evaluate("document.querySelectorAll('.sidebar-header-actions > button').length"), 3);
      await evaluate("document.querySelector('.sidebar-new-chat-trigger').click()");
      assert.equal(await evaluate("window.newChatCalls"), 1);
      assert.ok(await evaluate("document.querySelector('.sidebar-left').getBoundingClientRect().width") > 200, "Home keeps the sidebar");
      assert.equal(await evaluate("document.querySelector('.nav-rail').getBoundingClientRect().width"), 52);
      const midline = await evaluate("(() => { const box = document.querySelector('.titlebar-drag-row .icon-btn-ghost').getBoundingClientRect(); return box.top + box.height / 2; })()");
      assert.equal(midline, 26, "Sidebar collapse button sits on the 52px top bar midline");
      const screenshot = process.env.VELA_NAV_RAIL_SCREENSHOT;
      if (screenshot) writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      // 玻璃只在窗口上画一层，各区域不再各自叠一层半透明。
      assert.deepEqual(await evaluate("['.nav-rail', '.sidebar-left', '.main-stage', '.main-chat-view'].map(selector => getComputedStyle(document.querySelector(selector)).backdropFilter)"), ["none", "none", "none", "none"], "Only the window draws glass");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.main-chat-view'), '::before').backdropFilter"), "none");
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.vela-window')).backdropFilter"), "none");
      // 被隐藏、inert 的页面（如一直挂载的 PR 收件箱）不能再占着拖动区，否则会盖住主页顶栏的按钮。
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#ghost-header')).getPropertyValue('-webkit-app-region')"), "none", "Hidden inert panes leave no drag region");
      const measure = () => evaluate("(() => { const rect = selector => document.querySelector(selector).getBoundingClientRect(); const sidebar = rect('.sidebar-left'); const header = document.querySelector('.sidebar-left-header'); return { sidebarLeft: sidebar.left, sidebarWidth: sidebar.width, contentLeft: rect('.sidebar-left-header').left, contentWidth: rect('.sidebar-left-header').width, contentOpacity: getComputedStyle(header).opacity, railRight: rect('.nav-rail').right, paperLeft: rect('.main-chat-view').left, paperRadius: getComputedStyle(document.querySelector('.main-chat-view'), '::after').borderTopLeftRadius, cardLeft: sidebar.left }; })()");
      const open = await measure();
      assert.equal(open.cardLeft, open.railRight + 6, "Card sits 6px from the rail");
      assert.equal(open.paperLeft, open.sidebarLeft + open.sidebarWidth, "Paper lies flush against the open sidebar");
      assert.equal(open.paperRadius, "12px", "Paper keeps its rounded corner while open");
      await evaluate("document.querySelector('.nav-rail-item[aria-label=\"定时任务\"]').click()");
      // 收起时纸面向左滑过去盖住侧栏：侧栏原地不动、内容不挤压不淡出，纸面形状不变，只有左缘在移动。
      let sawSliding = false;
      let previousLeft = open.paperLeft;
      const slideDeadline = Date.now() + 5000;
      for (;;) {
        const now = await measure();
        assert.equal(now.sidebarLeft, open.sidebarLeft, "Sidebar never moves while collapsing");
        assert.equal(now.sidebarWidth, open.sidebarWidth, "Sidebar never shrinks while collapsing");
        assert.equal(now.contentLeft, open.contentLeft, "Sidebar content never moves while collapsing");
        assert.equal(now.contentWidth, open.contentWidth, "Sidebar content is covered, not squeezed");
        assert.equal(now.contentOpacity, "1", "Sidebar content never fades");
        assert.equal(now.paperRadius, "12px", "Paper keeps one shape the whole time");
        assert.ok(now.paperLeft <= previousLeft + 0.01, "Paper only moves left");
        previousLeft = now.paperLeft;
        if (now.paperLeft > now.railRight + 7 && now.paperLeft < open.paperLeft - 1) sawSliding = true;
        if (now.paperLeft === now.railRight + 6) break;
        assert.ok(Date.now() < slideDeadline, "Paper slides over the sidebar");
        await new Promise(done => setTimeout(done, 16));
      }
      assert.ok(sawSliding, "Paper edge animates over the sidebar instead of jumping");
      const closed = await measure();
      assert.equal(closed.paperLeft, open.cardLeft, "Paper and card share the same left edge, open or closed");
      assert.equal(await evaluate("document.querySelector('.sidebar-left').inert"), true, "Hidden sidebar leaves the tab order");
      assert.equal(await evaluate("document.querySelector('.nav-rail-item[aria-current=page]').getAttribute('aria-label')"), "定时任务");
      await evaluate("document.querySelector('.nav-rail-item[aria-label=\"主页\"]').click()");
      await until("(() => { const paper = document.querySelector('.main-chat-view').getBoundingClientRect().left; const sidebar = document.querySelector('.sidebar-left').getBoundingClientRect(); return paper === sidebar.right; })()");
      assert.deepEqual(await evaluate("window.selected"), ["scheduledTasks", "home"]);
      console.log("Passed nav rail checks: category items, badge, sidebar header actions, away collapse, home restore.");
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
