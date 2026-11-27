/** Exercise conversation tools and workspace-scoped Git through the production renderer and IPC. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const temporary = realpathSync(mkdtempSync(join(tmpdir(), "vela-conversation-workbench-")));
const home = join(temporary, "data");
const first = join(temporary, "Alpha"), second = join(temporary, "Beta");
process.env.VELA_USER_DATA = home;
process.env.VELA_CWD = first;
process.env.PI_OFFLINE = "1";
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.VELA_CAPTURE;
mkdirSync(home);
app.setPath("userData", home);
const pause = ms => new Promise(done => setTimeout(done, ms));
const writeJson = (name, value) => writeFileSync(join(home, name), JSON.stringify(value));

async function run() {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const conversations = [first, second].map((cwd, index) => {
    mkdirSync(cwd);
    execFileSync("git", ["init", "-q", "-b", "main", cwd]);
    writeFileSync(join(cwd, `file-${index}.txt`), "workspace-specific change\n");
    const manager = SessionManager.create(cwd, join(home, "sessions"));
    const turns = index === 0 ? 10 : 1;
    for (let turn = 0; turn < turns; turn++) {
      manager.appendMessage({ role: "user", content: `Review change ${turn + 1}.`, timestamp: Date.now() });
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "The workspace contains a new file. Open the file in the workbench to review it alongside this conversation." }],
        stopReason: "stop", timestamp: Date.now() });
    }
    return { id: manager.getSessionId(), cwd, hasWorkspace: true, title: `Conversation ${index}`,
      createdAt: 1000, updatedAt: 2000 - index, messageCount: turns * 2, toolCallCount: 0, sessionFile: manager.getSessionFile(),
      instructions: "", mode: "agent", plans: [], executionPlans: [], latestProposedPlanId: null,
      activeExecutionPlanId: null, goal: null, archivedAt: null };
  });
  writeJson("conversations.json", { version: 2, conversations });
  writeJson("ui-state.json", { "vela.onboarding.complete": "true", "vela.locale": "zh-CN", "vela.appearance": "light",
    "vela.navLayout": '"classic"', "vela.infoLayout": "sidebar", "vela.composerLayout": '"classic"',
    "vela.conversationWorkbenchTabs": "false", "vela.borderlessInterface": "false", "vela.sidebarCardGlass": "false",
    "vela.pinnedWorkspaces": JSON.stringify({ [second]: true }) });
  await import("../out/main/index.mjs");
  while (!BrowserWindow.getAllWindows().length) await pause(50);
  const win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(1440, 900);
  const js = code => win.webContents.executeJavaScript(code, true);
  const until = async expression => {
    const end = Date.now() + 12000;
    do {
      if (await js(expression)) return;
      await pause(50);
    } while (Date.now() < end);
    throw new Error(`Timed out waiting for ${expression}`);
  };
  const button = (selector, label) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(b =>
    b.checkVisibility() && !b.closest('[inert]') && b.textContent.trim() === ${JSON.stringify(label)})`;
  const click = async expression => { await until(expression); await js(`(${expression}).click()`); };
  const el = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const capture = async name => {
    if (!process.env.VELA_CONVERSATION_TABS_CAPTURE) return;
    await pause(350);
    writeFileSync(join(process.env.VELA_CONVERSATION_TABS_CAPTURE, name + ".png"), (await win.webContents.capturePage()).toPNG());
  };
  const rect = selector => `${el(selector)}.getBoundingClientRect()`;
  const assertFloatingTitle = async (title, scroller) => {
    await until(`getComputedStyle(${el(title)}, '::before').backgroundImage.includes('linear-gradient')
      && getComputedStyle(${el(title)}, '::before').pointerEvents === 'none'`);
    if (scroller) await until(`Math.abs(${rect(scroller)}.top - ${rect(title)}.top) < 1`);
  };
  const openInterface = async () => {
    await click(el(".sidebar-user-pill"));
    await click(button(".settings-nav-item", "界面"));
    await until(el('[data-setting-id="info-layout"]'));
  };
  const setUiStateAndReload = async entries => {
    const loaded = new Promise(done => win.webContents.once("did-finish-load", done));
    await js(`(() => { for (const [k, v] of Object.entries(${JSON.stringify(entries)})) window.vela.uiStorage.setItem(k, v); window.location.reload(); })()`);
    await loaded;
    await until(el(".main-chat-view, .settings-view"));
  };
  const leaveSettings = async () => {
    await click(el(".nav-history-buttons button:first-child:not(:disabled)"));
    await until("!document.querySelector('.settings-view')");
  };
  const openStart = () => click(el(".workbench-new-tab, .workbench-expand"));
  const option = label => button(".start-option", label);
  const pane = ".workbench-tabpanel:not(.is-inactive) ";
  const chatVersionControl = el('.chat-header-actions button[title="版本控制"]');
  await until(el(".conversation-view-tabs"));
  await js(`window.vela.switchConversation(${JSON.stringify(conversations[0].id)})`);
  await until(`${el('[data-tab-key="trace"]')}.getAttribute('aria-disabled') === null`);
  assert.equal(await js("document.querySelectorAll('.conversation-view-tabs [role=tab]').length"), 6);
  const sidebarToggle = '.window-navigation > button';
  await until(`${el('.app-screen-main')}.getAnimations().length === 0`);
  const anchor = await js(`${rect(sidebarToggle)}.toJSON()`);
  await click(el(sidebarToggle));
  await until(`${rect('.sidebar-left')}.width === 0 && ${el(sidebarToggle)}.ariaExpanded === 'false'`);
  assert.deepEqual(await js(`${rect(sidebarToggle)}.toJSON()`), anchor);
  await click(el(sidebarToggle));
  await until(`!${el('.sidebar-left')}.inert`);
  await openInterface();
  assert.equal(await js(el('[data-setting-id="conversation-workbench-tabs"]')), null);
  assert.equal(await js(el('[data-setting-id="borderless-interface"]')), null);
  assert.equal(await js(el('[data-setting-id="nav-layout"]')), null);
  await setUiStateAndReload({ "vela.conversationWorkbenchTabs": "true", "vela.borderlessInterface": "false" });
  await until("!document.querySelector('.conversation-view-tabs')");
  assert.equal(await js(chatVersionControl), null);
  await capture("framed");
  await setUiStateAndReload({ "vela.borderlessInterface": "true" });
  await openInterface();
  await assertFloatingTitle(".settings-header", ".settings-content");
  assert.equal(await js(`${el(".settings-header h2")}.textContent`), "界面");
  await js(`${el(".settings-content")}.scrollTo(0, 420)`);
  await until(`${el(".settings-content")}.scrollTop >= 400 && ${rect(".settings-header")}.top === 0`);
  await capture("settings-scrolled");
  await leaveSettings();
  await until("!document.querySelector('.conversation-view-tabs')");
  assert.equal(await js("window.vela.uiStorage.getItem('vela.conversationWorkbenchTabs')"), "true");
  const header = rect(".main-stage-pane > .main-chat-view > .main-chat-header");
  const scroll = ".main-stage-pane > .main-chat-view .chat-scroll-area";
  const assertFloatingHeader = async () => {
    await until(`${rect(scroll)}.top === ${header}.top && ${header}.top === 0
      && ${header}.right === innerWidth && ${rect(".main-chat-view")}.bottom === innerHeight`);
    await assertFloatingTitle(".main-stage-pane > .main-chat-view > .main-chat-header", scroll);
  };
  await assertFloatingHeader();
  await js(`${el(scroll)}.scrollTop = ${el(scroll)}.scrollHeight / 2`);
  await until(`${el(scroll)}.scrollTop > 100`);
  await capture("borderless-chat");
  await until(`${chatVersionControl}?.nextElementSibling.matches('.chat-project-link')`);
  await click(chatVersionControl);
  await until(`${el('.wo-shell .vc-files')}?.textContent.includes('file-0.txt')`);
  await click(el(".nav-history-buttons button:first-child"));
  await until(`${chatVersionControl}?.checkVisibility() && !${chatVersionControl}.closest('[inert]')`);

  const plain = join(temporary, "Plain");
  mkdirSync(plain);
  await js(`window.vela.selectWorkspace(${JSON.stringify(plain)})`);
  await until(`${el('.chat-project-name')}?.textContent === 'Plain'`);
  assert.equal(await js(chatVersionControl), null);
  await until(`window.vela.getState().then(state => state.session.cwd === ${JSON.stringify(plain)})`);
  await js(`window.vela.switchConversation(${JSON.stringify(conversations[0].id)})`);
  await until(`${chatVersionControl}?.getAttribute('aria-label') === ${JSON.stringify("版本控制 · " + first)}`);
  console.log("PASS borderless chat shortcut opens the current Git workspace and hides for ordinary folders");
  await click(el(".chat-dock-wrapper .mode-pill"));
  await until(el(".dock-popover"));
  assert.ok(await js(`(() => {
    const title = document.querySelector('.chat-title-rename');
    const r = title.getBoundingClientRect();
    return title.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })()`), "the scrolling transcript stays behind the title while the composer menu is open");
  await click(el(".chat-dock-wrapper .mode-pill"));
  for (const [label, selector] of [["轨迹", ".trace-view"], ["使用统计", ".usage-view"], ["上限设置", ".tb-tab"], ["上下文", ".ctx-tab"]]) {
    await openStart();
    await click(option(label));
    await until(el(pane + selector));
    assert.equal(await js(`${el('.main-chat-view > .chat-conversation-pane')}.checkVisibility()`), true);
  }
  const tabs = rect(".workbench-group[data-top-row=true] .workbench-tabbar");
  for (const width of [980, 1440]) {
    win.setContentSize(width, 900);
    await until(`innerWidth === ${width} && Math.abs(${header}.right - ${tabs}.left) < 1
      && ${header}.bottom === ${tabs}.bottom && ${tabs}.right === innerWidth
      && ${rect(scroll)}.top === ${header}.top && ${rect(".workbench-panel")}.bottom === innerHeight`);
    await assertFloatingTitle(".workbench-group[data-top-row=true]", pane + ".ctx-tab");
  }
  await capture("context");
  await click(el(".workbench-collapse"));
  await assertFloatingHeader();
  await click(el(".workbench-expand"));
  await until(`${rect(scroll)}.top === ${header}.top && ${rect(".workbench-tabbar")}.width > 0`);
  console.log("PASS borderless edges, floating and split headers, scroll fade and workbench folding");
  await openStart();
  await capture("new-tab");
  await click(option("轨迹"));
  await until(el(pane + ".trace-view"));
  assert.equal(await js("document.querySelectorAll('.workbench-tab').length"), 4);
  await capture("trace");
  await click(el('.workbench-tab-close[aria-label="关闭 轨迹"]'));
  await until("document.querySelectorAll('.workbench-tab').length === 3");
  await openStart();
  await click(option("轨迹"));
  await until(el(pane + ".trace-view"));
  console.log("PASS four workbench pages, duplicate selection, main conversation remains visible");

  // Sort away from creation order, leave a non-last tab active, then reload the production renderer.
  const strip = `[...document.querySelectorAll('.workbench-tab')].map(t => t.textContent.trim())`;
  await click(el('.workbench-fullscreen-button'));
  await until(el('.workbench-restore'));
  const beforeSort = await js(strip);
  await js(`${el('.workbench-tab[aria-selected=true]')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }))`);
  await until(`JSON.stringify(${strip}) !== ${JSON.stringify(JSON.stringify(beforeSort))}`);
  const sorted = await js(strip);
  const restored = `${el('.workbench-restore')} && ${el('.workbench-tab[aria-selected=true]')}?.textContent.trim() === '轨迹'
    && JSON.stringify(${strip}) === ${JSON.stringify(JSON.stringify(sorted))}`;
  await setUiStateAndReload({});
  await until(restored);

  await js(`window.vela.createConversation(${JSON.stringify(first)})`);
  await until("!document.querySelector('.workbench-tab')");
  await openStart();
  for (const label of ["轨迹", "使用统计", "上下文"]) {
    await until(`${option(label)}?.disabled`);
  }
  await click(option("上限设置"));
  await until(el(pane + ".tb-tab"));
  assert.equal(await js("document.querySelectorAll('.workbench-tab').length"), 1);
  await js(`window.vela.switchConversation(${JSON.stringify(conversations[0].id)})`);
  await until(restored);
  await click(el('.workbench-pinned-chat'));
  await setUiStateAndReload({});
  await until(el('.showing-pinned-chat'));
  await click(el('.workbench-restore'));
  await click(el('.workbench-collapse'));
  await setUiStateAndReload({});
  await until(el('.workbench-panel.is-collapsed'));
  await click(el('.workbench-expand'));
  await until(`JSON.stringify(${strip}) === ${JSON.stringify(JSON.stringify(sorted))}`);
  console.log("PASS fullscreen, pinned chat, folded panel, active tab and sorted order survive a renderer restart and conversation round trip");
  console.log("PASS tabs follow the conversation and limit settings work before the first message");

  await click(el('.sidebar-activity-trigger[aria-pressed="true"]'));
  await click(el('.session-group-overview[aria-label$="Beta"]'));
  await until(button(".wo-actions button", "切换到此工作区并打开版本控制"));
  await assertFloatingTitle(".wo-shell > header", ".wo-shell .scheduled-tasks-page-scroll");
  await js(`${el(".wo-shell .scheduled-tasks-page-scroll")}.scrollTop = 160`);
  await capture("overview");
  await click(button(".wo-actions button", "切换到此工作区并打开版本控制"));
  await until(`${el('.wo-shell .vc-files')}?.textContent.includes('file-1.txt')
    && !${el('.wo-shell .vc-files')}.textContent.includes('file-0.txt')`);
  assert.equal(await js("window.vela.getWorkspaceState().then(state => state.current)"), second);
  await capture("version-control");
  await click(button(".wo-shell .vc-files button", "全部暂存"));
  await until(button(".wo-shell .vc-files button", "取消全部"));
  const staged = cwd => execFileSync("git", ["-C", cwd, "diff", "--cached", "--name-only"], { encoding: "utf8" }).trim();
  assert.equal(staged(second), "file-1.txt");
  assert.equal(staged(first), "");
  await click(el('.wo-shell .main-chat-header button[aria-label="工作区总览"]'));
  await until(el(".wo-page h1"));
  await click(button(".wo-actions button", "版本控制"));
  await until(el(".wo-shell .vc-root"));
  console.log("PASS version control opens the repository shown in the overview, including inactive workspaces");

  const clickRepositoryShortcut = async name => {
    const shortcut = el(`.session-group-version-control[aria-label="版本控制 · ${name}"]`);
    const center = node => js(`(() => {
      const r = (${node}).getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    const row = `${shortcut}.closest('.session-group-row')`;
    win.webContents.sendInputEvent({ type: "mouseMove", ...await center(row) });
    await until(`${shortcut}.getBoundingClientRect().width >= 24 && getComputedStyle(${shortcut}).opacity === "1"`);
    assert.ok(await js(`${shortcut}.nextElementSibling.matches('.session-group-settings')
      && ${shortcut}.nextElementSibling.nextElementSibling.matches('.session-group-new-chat')`));
    const point = await center(shortcut);
    win.webContents.sendInputEvent({ type: "mouseMove", ...point });
    win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
  };
  await click(el('.session-group-overview[aria-label$="Beta"]'));
  await until(`${el('.wo-page h1')}.checkVisibility()`);
  await clickRepositoryShortcut("Beta");
  await until(`${el('.wo-shell .vc-files')}?.textContent.includes('file-1.txt')`);
  await clickRepositoryShortcut("Alpha");
  await until(`${el('.wo-shell .vc-files')}?.textContent.includes('file-0.txt')`);
  assert.equal(await js("window.vela.getWorkspaceState().then(state => state.current)"), first);
  await click(el(".nav-history-buttons button:first-child"));
  await until(`${el('.wo-shell .vc-files')}?.textContent.includes('file-1.txt')`);
  console.log("PASS pinned and unpinned workspace hover shortcuts open the selected repository, including via history");

  await js("window.location.reload()");
  await until(el(".main-chat-view"));
  assert.equal(await js(el(".conversation-view-tabs")), null);
  await until(el(".borderless-interface"));
  if (process.platform === "darwin") {
    await setUiStateAndReload({ "vela.navLayout": '"rail"' });
    await click(el('.nav-rail-item[aria-label^="设置"]'));
    const material = `${el('.vela-window')}.dataset.trafficLightMaterial`;
    const divider = `getComputedStyle(${el('.nav-rail')}, '::after')`;
    const settledSettings = `${material} === 'list' && ${rect('.settings-nav')}.left === 58 && getComputedStyle(${el('.settings-stage')}).opacity === '1' && !document.querySelector('.main-stage-pane.is-overlay') && getComputedStyle(${el('.settings-view')}.closest('.main-stage-pane')).opacity === '1'`;
    await until(settledSettings);
    await js(`document.documentElement.style.setProperty('--glass-opacity', '0.4'); document.documentElement.dataset.windowFocused = 'true'`);
    // Vary what is behind the window glass. A gray card or a white layer under the navigator has zero response.
    const transmission = async () => {
      const sample = async color => {
        await js(`document.body.style.backgroundColor = '${color}'; new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
        const image = await win.webContents.capturePage();
        const data = image.toBitmap({ scaleFactor: 1 }), { width } = image.getSize();
        return [[12, 24], [55, 24], [65, 24], [60, 350], [600, 24]].map(([x, y]) => data[(y * width + x) * 4]);
      };
      const black = await sample('black'), white = await sample('white');
      return white.map((v, i) => v - black[i]);
    };
    const settings = await transmission();
    assert.ok(settings.slice(0, 4).every(v => Math.abs(v - 255 * 0.33) < 3), `Both settings columns transmit the desktop: ${settings}`);
    assert.equal(settings[4], 0, 'The detail titlebar stays opaque');
    assert.deepEqual(await js(`[${divider}.width, ${divider}.top]`), ['1px', '52px']);
    await capture('borderless-settings-rail');
    const nav = '.page-stage:not(.is-overlay) .page-nav';
    const detail = '.page-stage:not(.is-overlay) .page-content';
    const settingsWidth = await js(`${rect(nav)}.width`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const checkSidebarMotion = async label => {
      const slide = `${el(nav)}.closest('.page-view').getAnimations().find(a => a.transitionProperty === '--page-nav-open')`;
      const open = await js(`${rect(nav)}.toJSON()`);
      const started = await js(`${el(sidebarToggle)}.click(); new Promise(requestAnimationFrame).then(() => {
        const animation = ${slide};
        if (!animation) return false;
        animation.pause(); animation.currentTime = 0; return true;
      })`);
      assert.ok(started, `${label} starts a sidebar transition`);
      assert.equal(await js(`${rect(detail)}.left`), open.right, label);
      assert.deepEqual((await transmission()).slice(0, 4), [0, 0, 0, 0], `${label} rail, gutter and list are opaque on the first frame`);
      await js(`${slide}.currentTime = ${slide}.effect.getTiming().duration / 2`);
      const edge = await js(`${rect(detail)}.left`);
      assert.ok(edge > 65 && edge < open.right, `${label} detail slides over the exposed list`);
      assert.deepEqual(await js(`${rect(nav)}.toJSON()`), open, `${label} list stays in place at its full width`);
      assert.deepEqual((await transmission()).slice(0, 4), [0, 0, 0, 0], `${label} columns stay opaque during the slide`);
      if (label === '设置') await capture('category-sidebar-midpoint');
      await js(`${slide}.play()`);
      await until(`!${el(nav)}.checkVisibility() && ${el(sidebarToggle)}.ariaExpanded === 'false'`);
      assert.deepEqual(await js(`${rect(sidebarToggle)}.toJSON()`), anchor, label);
      assert.equal(await js(`${rect(detail)}.left`), open.left, label);
      assert.ok(await js(`${rect('.window-navigation')}.right <= ${rect('.page-stage:not(.is-overlay) .page-header :is(.chat-active-title, .page-topbar-title)')}.left`), label);
      await click(el(sidebarToggle));
      await until(`${rect(detail)}.left === ${open.right} && ${el(sidebarToggle)}.ariaExpanded === 'true'`);
    };
    const selectCategory = async label => {
      const item = el(`.nav-rail-item[aria-label^="${label}"]`);
      const frame = await js(`new Promise(resolve => {
        ${item}.click();
        requestAnimationFrame(() => {
          const pane = document.querySelector('.main-stage-pane:not(.is-overlay)');
          const sidebar = document.querySelector('.sidebar-left').getBoundingClientRect();
          const list = pane.querySelector('.page-nav');
          const detail = pane.querySelector('.page-content') || pane;
          resolve({
            active: ${item}.getAttribute('aria-current'),
            listInPlace: list ? list.getBoundingClientRect().left === sidebar.left : !document.querySelector('.sidebar-left').inert,
            detailInPlace: detail.getBoundingClientRect().left === sidebar.right,
            opacity: getComputedStyle(pane).opacity,
            oldPaneVisible: [...document.querySelectorAll('.main-stage-pane.is-overlay')].some(old => getComputedStyle(old).opacity !== '0')
          });
        });
      })`);
      assert.deepEqual(frame, { active: 'page', listInPlace: true, detailInPlace: true, opacity: '1', oldPaneVisible: false },
        `${label} replaces the sidebar and detail in place on the first frame`);
    };
    for (const label of ["定时任务", "任务配方", "Agent 收件箱", "Pull Request", "设置"]) {
      await selectCategory(label);
      await until(`${material} === 'list' && ${el(nav)}?.getBoundingClientRect().width === ${settingsWidth}
        && getComputedStyle(${el(nav)}.closest('.page-stage')).opacity === '1'`);
      const values = await transmission();
      assert.ok(values.every((v, i) => Math.abs(v - settings[i]) < 3), `${label} matches settings glass and opaque detail: ${values}`);
      assert.equal(await js(`getComputedStyle(${el(nav)}).borderRightWidth`), '0px');
      assert.equal(await js(`${divider}.content`), '""');
      await checkSidebarMotion(label);
    }
    await selectCategory("主页");
    await until(`!${el('.settings-view')} && ${material} === 'list' && ${rect('.main-stage')}.left === ${rect('.sidebar-left')}.right`);
    const homeGlass = await transmission();
    assert.ok(homeGlass.slice(0, 4).every((v, i) => Math.abs(v - settings[i]) < 3), `Settings glass matches home: ${settings} vs ${homeGlass}`);
    await setUiStateAndReload({ "vela.borderlessInterface": "false" });
    await click(el('.nav-rail-item[aria-label^="设置"]'));
    await until(`${el('.settings-nav')} && !${el('.borderless-interface')} && !document.querySelector('.main-stage-pane.is-overlay') && getComputedStyle(${el('.settings-view')}.closest('.main-stage-pane')).opacity === '1'`);
    await js(`document.documentElement.style.setProperty('--glass-opacity', '0.4'); document.documentElement.dataset.windowFocused = 'true'`);
    assert.equal(await js(`${divider}.content`), 'none', 'Framed settings has no rail divider');
    assert.equal((await transmission())[3], 0, 'Framed settings retains its original opaque navigation card');
    await selectCategory("定时任务");
    await checkSidebarMotion("Framed scheduled tasks");
    win.webContents.debugger.detach();
    await js(`document.body.style.removeProperty('background-color'); document.documentElement.style.removeProperty('--glass-opacity')`);
    console.log('PASS settings rail and page list match home glass, clear the traffic lights, and restore framed styles');
  }
  await setUiStateAndReload({ "vela.navLayout": '"classic"', "vela.borderlessInterface": "true", "vela.conversationWorkbenchTabs": "false" });
  await until(el(".conversation-view-tabs"));
  assert.equal(await js(el(".borderless-interface")), null);
  assert.equal(await js(el(".session-group-version-control")), null);
  assert.equal(await js("document.querySelectorAll('.conversation-view-tabs [role=tab]').length"), 6);
  await until("window.vela.getState().then(state => state.session.status === 'ready')");
  console.log("PASS preference survives reload and switching off restores the original tabs");
  await win.loadURL("about:blank");
}

const watchdog = setTimeout(() => { console.error("Smoke test deadline"); app.exit(1); }, 90000);
app.whenReady().then(run).then(() => { clearTimeout(watchdog); app.quit(); }, error => {
  clearTimeout(watchdog); console.error(error); app.exit(1);
});
app.on("quit", () => rmSync(temporary, { recursive: true, force: true }));
