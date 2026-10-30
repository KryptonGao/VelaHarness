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
          const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
          const collapsed = away || sidebarCollapsed;
          window.setSidebarCollapsed = setSidebarCollapsed;
          window.setCategory = setCategory;
          return <AppLocaleProvider locale="zh-CN"><div className={'vela-window platform-darwin nav-rail-layout right-collapsed' + (away ? ' rail-away' : '') + (collapsed ? ' left-collapsed' : '')} style={{height:'100vh'}}>
            <NavRail active={category} platform="darwin" agentInboxBadge={3} onSelect={next => { window.selected.push(next); setCategory(next); }} />
            <Sidebar railMode collapsed={collapsed} platform="darwin" resize={{widths:{left:248,right:300,workbench:500},startResize(){},nudge(){},reset(){}}}
              conversations={conversations} activeConversationId="a0" settingsOpen={false} settingsLabel="设置"
              onToggle={()=>setSidebarCollapsed(value => !value)} onOpenSettings={()=>{}} onNewChat={()=>{ window.newChatCalls = (window.newChatCalls || 0) + 1; }} onSwitchConversation={()=>{}}
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
      const checkRailIcons = async () => {
        const icons = await evaluate("[...document.querySelectorAll('.nav-rail-item')].map(item => { const icon = item.querySelector('svg'); const style = getComputedStyle(item); return { active: item.getAttribute('aria-current') === 'page', fill: icon.getAttribute('fill'), stroke: icon.getAttribute('stroke'), border: style.borderWidth, shadow: style.boxShadow }; })");
        assert.equal(icons.filter(icon => icon.active).length, 1);
        for (const icon of icons) {
          assert.equal(icon.fill, icon.active ? "currentColor" : "none", "Only the selected category uses a solid icon");
          assert.equal(icon.stroke, icon.active ? "none" : "currentColor", "Inactive categories keep outline icons");
          assert.equal(icon.border, "0px", "Category buttons have no border");
          if (icon.active) assert.equal(icon.shadow, "rgba(0, 0, 0, 0.08) 0px 1px 5px 0px", "Selection has a soft shadow, not a border-like ring");
          else assert.equal(icon.shadow, "none");
        }
      };
      await until("getComputedStyle(document.querySelector('.nav-rail-item[aria-current=page]')).boxShadow === 'rgba(0, 0, 0, 0.08) 0px 1px 5px 0px'");
      await checkRailIcons();
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
      const shadowBounds = () => evaluate("(() => { const stage = document.querySelector('.main-stage'); const box = stage.getBoundingClientRect(); const style = getComputedStyle(stage, '::before'); return { left: box.left + parseFloat(style.left), right: box.right - parseFloat(style.right), top: box.top + parseFloat(style.top), bottom: box.bottom - parseFloat(style.bottom), shadow: style.boxShadow, pointerEvents: style.pointerEvents }; })()");
      const openShadow = await shadowBounds();
      assert.equal(openShadow.left, open.cardLeft, "One shadow wraps both sidebar card and main paper");
      assert.equal(openShadow.top, 52, "Shadow starts below the glass titlebar");
      assert.equal(openShadow.bottom, await evaluate("document.querySelector('.main-chat-view').getBoundingClientRect().bottom"), "Shadow follows the paper above the bottom glass inset");
      assert.equal(openShadow.pointerEvents, "none", "Shadow does not intercept input");
      assert.equal(openShadow.shadow, "rgba(0, 0, 0, 0.12) 0px 0px 4px 0px", "Small centered shadow reaches all four sides");
      const shadowPixels = async () => {
        const image = await win.webContents.capturePage();
        const { width } = image.getSize();
        const bitmap = image.toBitmap({ scaleFactor: 1 });
        const { left, right, top, bottom } = openShadow;
        return [[left - 2, (top + bottom) / 2], [right + 1, (top + bottom) / 2], [(left + right) / 2, top - 2], [(left + right) / 2, bottom + 1]].map(([x, y]) => {
          const index = (Math.floor(y) * width + Math.floor(x)) * 4;
          return [...bitmap.subarray(index, index + 3)];
        });
      };
      const shaded = await shadowPixels();
      await evaluate("(() => { const style = document.createElement('style'); style.id = 'disable-paper-shadow'; style.textContent = '.nav-rail-layout .main-stage::before { box-shadow: none !important; }'; document.head.append(style); })()");
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const unshaded = await shadowPixels();
      for (let side = 0; side < 4; side++) {
        assert.ok(shaded[side].some((value, channel) => value < unshaded[side][channel]), `Outer shadow is visible on glass: side ${side}`);
      }
      await evaluate("document.querySelector('#disable-paper-shadow').remove()");
      assert.equal(open.cardLeft, open.railRight + 6, "Card sits 6px from the rail");
      assert.equal(open.paperLeft, open.sidebarLeft + open.sidebarWidth, "Paper lies flush against the open sidebar");
      assert.equal(open.paperRadius, "0px", "Category paper has a square top-left corner while open");
      const paperCorners = () => evaluate("(() => { const style = getComputedStyle(document.querySelector('.main-chat-view'), '::after'); return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]; })()");
      assert.deepEqual(await paperCorners(), ["0px", "12px", "12px", "0px"], "Only the category paper's left corners are square");
      await evaluate("document.querySelector('.nav-rail-item[aria-label=\"定时任务\"]').click()");
      // 收起时直角纸面滑到固定的圆角遮罩下，侧栏原地不动、内容不挤压不淡出。
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
        assert.equal(now.paperRadius, "0px", "Paper itself stays square while sliding under the fixed corner mask");
        assert.ok(now.paperLeft <= previousLeft + 0.01, "Paper only moves left");
        previousLeft = now.paperLeft;
        if (now.paperLeft > now.railRight + 7 && now.paperLeft < open.paperLeft - 1) sawSliding = true;
        if (now.paperLeft === now.railRight + 6) break;
        assert.ok(Date.now() < slideDeadline, "Paper slides over the sidebar");
        await new Promise(done => setTimeout(done, 16));
      }
      assert.ok(sawSliding, "Paper edge animates over the sidebar instead of jumping");
      const closed = await measure();
      assert.deepEqual(await shadowBounds(), openShadow, "Outer shadow stays fixed as paper covers the sidebar");
      assert.deepEqual(await paperCorners(), ["0px", "12px", "12px", "0px"], "Collapsed paper stays square underneath the corner mask");
      assert.equal(closed.paperLeft, open.cardLeft, "Paper and card share the same left edge, open or closed");
      assert.equal(await evaluate("document.querySelector('.sidebar-left').inert"), true, "Hidden sidebar leaves the tab order");
      assert.equal(await evaluate("document.querySelector('.nav-rail-item[aria-current=page]').getAttribute('aria-label')"), "定时任务");
      await evaluate("document.querySelector('.nav-rail-item[aria-label=\"主页\"]').click()");
      await until("(() => { const paper = document.querySelector('.main-chat-view').getBoundingClientRect().left; const sidebar = document.querySelector('.sidebar-left').getBoundingClientRect(); return paper === sidebar.right; })()");
      assert.deepEqual(await evaluate("window.selected"), ["scheduledTasks", "home"]);
      assert.deepEqual(await paperCorners(), ["0px", "12px", "12px", "0px"], "Returning home restores square sidebar seams");
      await evaluate("document.querySelector('.titlebar-drag-row .icon-btn-ghost').click()");
      await until("document.querySelector('.vela-window').classList.contains('left-collapsed') && document.querySelector('.main-chat-view').getBoundingClientRect().left === document.querySelector('.nav-rail').getBoundingClientRect().right + 6");
      assert.deepEqual(await paperCorners(), ["0px", "12px", "12px", "0px"], "Manual collapse does not switch the paper's shape");
      await evaluate("window.setSidebarCollapsed(false)");
      await until("!document.querySelector('.vela-window').classList.contains('left-collapsed') && document.querySelector('.main-chat-view').getBoundingClientRect().left === document.querySelector('.sidebar-left').getBoundingClientRect().right");
      assert.deepEqual(await paperCorners(), ["0px", "12px", "12px", "0px"], "Reopening the home sidebar restores square left corners");
      // 定格展开/收起的中间帧并检查真实像素：圆弧留在窗口左侧，不跟纸面走，
      // 同一位移的画面不受 left-collapsed 状态影响（不能先切角再开始移动）。
      for (const collapsing of [false, true]) {
        for (const offset of collapsing ? [open.sidebarWidth, 120, 24, 12, 9, 6, 3, 0] : [0, 3, 6, 9, 12, 24, 120, open.sidebarWidth]) {
          const geometry = await evaluate(`(() => {
            const shell = document.querySelector('.vela-window');
            shell.style.transition = 'none';
            shell.classList.toggle('left-collapsed', ${collapsing});
            shell.style.setProperty('--nav-open', '${offset}px');
            const paper = document.querySelector('.main-chat-view');
            const box = paper.getBoundingClientRect();
            return { left: box.left, right: box.right, top: parseFloat(getComputedStyle(paper).getPropertyValue('--header-height')), bottom: box.bottom };
          })()`);
          await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
          const image = await win.webContents.capturePage();
          const { width, height } = image.getSize();
          const bitmap = image.toBitmap({ scaleFactor: 1 });
          assert.equal(bitmap.length, width * height * 4, "Pixel checks use CSS-pixel resolution");
          const pixel = (x, y) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];
          const paperColor = pixel(Math.ceil(geometry.left) + 24, geometry.top + 24);
          // 除了左右外缘圆角，整条纸面上下边缘必须连续，不能在右侧冒出被错误定位的遮罩缺口。
          for (const y of [geometry.top + 1, geometry.bottom - 2]) {
            for (let x = Math.ceil(geometry.left) + 12; x < Math.floor(geometry.right) - 12; x++) {
              const difference = Math.max(...pixel(x, y).map((value, index) => Math.abs(value - paperColor[index])));
              assert.ok(difference <= 2,
                `Continuous paper edge at offset ${offset}, collapsing=${collapsing}, pixel=${x},${y}, difference=${difference}`);
            }
          }
          for (const bottom of [false, true]) {
            for (const dx of [1, 4, 8, 14]) for (const dy of [1, 4, 8, 14]) {
              const x = Math.ceil(geometry.left) + dx;
              const y = bottom ? geometry.bottom - 1 - dy : geometry.top + dy;
              const cx = open.cardLeft + 12;
              const cy = bottom ? geometry.bottom - 12 : geometry.top + 12;
              const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
              const inCorner = x + 0.5 < cx && (bottom ? y + 0.5 > cy : y + 0.5 < cy);
              if (inCorner && Math.abs(distance - 12) < 1) continue; // 避开抗锯齿边缘。
              const difference = Math.max(...pixel(x, y).map((value, index) => Math.abs(value - paperColor[index])));
              const cutOut = inCorner && distance > 12;
              assert.ok(cutOut ? difference > 4 : difference <= 2,
                `Fixed ${bottom ? 'bottom' : 'top'} corner at offset ${offset}, collapsing=${collapsing}, pixel=${x},${y}, difference=${difference}`);
            }
          }
        }
      }
      // 每个分类在浅色、深色下都切换实心/空心，保留键盘焦点反馈。
      for (const scheme of ["light", "dark"]) {
        await evaluate(`document.documentElement.dataset.scheme = '${scheme}'`);
        for (const category of ["scheduledTasks", "recipes", "agentInbox", "prInbox", "settings", "home"]) {
          await evaluate(`window.setCategory('${category}')`);
          await until(`document.querySelector('.nav-rail-item[aria-current=page]').getAttribute('aria-label') === ${JSON.stringify(labels[["home", "scheduledTasks", "recipes", "agentInbox", "prInbox", "settings"].indexOf(category)])}`);
          await evaluate("new Promise(resolve => setTimeout(resolve, 160))");
          await checkRailIcons();
        }
      }
      // 隐藏的测试窗口没有原生焦点，模拟页面激活后再检查 :focus-visible。
      win.webContents.debugger.attach("1.3");
      await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await evaluate("document.documentElement.dataset.scheme = 'light'; document.querySelector('.nav-rail-item').focus()");
      await win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
      await win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
      await until("document.activeElement === document.querySelectorAll('.nav-rail-item')[1]");
      assert.equal(await evaluate("document.activeElement.matches('.nav-rail-item:focus-visible')"), true, "Keyboard navigation keeps visible focus");
      assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none");
      win.webContents.debugger.detach();
      await evaluate("(() => { const shell = document.querySelector('.vela-window'); shell.classList.remove('left-collapsed'); shell.style.removeProperty('--nav-open'); shell.style.removeProperty('transition'); shell.classList.remove('nav-rail-layout'); })()");
      assert.deepEqual(await paperCorners(), ["12px", "12px", "12px", "12px"], "Classic layout keeps all four rounded corners");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.main-chat-view')).maskImage"), "none", "Classic layout has no corner mask");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.main-stage'), '::before').boxShadow"), "none", "Classic layout has no category paper shadow");
      console.log("Passed nav rail checks: category items, badge, sidebar header actions, away collapse, home restore.");
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
