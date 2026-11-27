/** 真实 Electron 信息卡片响应式/动画检查：node apps/desktop/test/info-cards-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const require = createRequire(join(desktop, "package.json"));
const pause = ms => new Promise(done => setTimeout(done, ms));

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(resolve(tmpdir()), "vela-info-cards-ui-"));
  let server;
  try {
    const { createServer } = await import("vite");
    const { default: react } = await import("@vitejs/plugin-react");
    server = await createServer({
      root: desktop,
      configFile: false,
      plugins: [react(), {
        name: "info-cards-ui-memory-ipc",
        transform(code, id) {
          if (!id.split("?")[0].endsWith("/test/info-cards-preview.tsx")) return;
          // 预览 fixture 较早创建,补齐后来新增的无关只读 IPC;只改内存响应,不写 fixture 文件。
          return `${code}\nwindow.vela.estimateTaskCost = async () => null;`;
        },
      }],
      resolve: { alias: { "@vela/shared": resolve(desktop, "../../packages/shared/src/index.ts") } },
      optimizeDeps: { entries: ["test/info-cards-preview.html"] },
      server: { port: 0, host: "127.0.0.1" },
      logLevel: "warn",
    });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== "string");
    const env = { ...process.env, VELA_INFO_CARDS_PROFILE: temporary, VELA_INFO_CARDS_URL: `http://127.0.0.1:${address.port}/test/info-cards-preview.html` };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    try {
      const result = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", (code, signal) => done({ code, signal })); });
      assert.equal(result.code, 0, `信息卡片 Electron UI 检查失败：${JSON.stringify(result)}`);
    } finally { clearTimeout(timer); }
  } finally {
    await server?.close();
    // 只删除本次创建的绝对临时路径,不碰工作区和已有 Electron 用户资料。
    assert.ok(isAbsolute(temporary) && dirname(temporary) === resolve(tmpdir()) && basename(temporary).startsWith("vela-info-cards-ui-"));
    console.log(`清理已确认的临时目录：${temporary}`);
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_INFO_CARDS_PROFILE, "profile"));
  void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1550, height: 1000,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const diagnostics = [];
  win.webContents.on("console-message", event => { if (event.level === "error") diagnostics.push(event.message); });
  win.webContents.on("render-process-gone", (_event, details) => diagnostics.push(JSON.stringify(details)));
  const evaluate = code => win.webContents.executeJavaScript(code, true);
  const until = async (code, label = code) => {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (await evaluate(code)) return;
      await pause(15);
    }
    throw new Error(`等待超时：${label}`);
  };
  const metricsCode = `(() => {
    const root = document.querySelector('.info-drawer');
    const pane = root?.parentElement;
    const surface = pane?.querySelector('.chat-message-surface');
    const scroller = pane?.querySelector('.chat-scroll-area');
    if (!root || !surface || !scroller) return null;
    const style = getComputedStyle(root), paneStyle = getComputedStyle(pane);
    const gap = parseFloat(getComputedStyle(scroller).paddingLeft);
    const cardWidth = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const region = root.offsetLeft + parseFloat(style.paddingLeft);
    const natural = Math.min(surface.getBoundingClientRect().width, parseFloat(paneStyle.getPropertyValue('--chat-lane-max')) || 760);
    const x = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41;
    const message = pane.querySelector('.user-msg-container');
    const messageWidth = message.getBoundingClientRect().width;
    const composer = pane.querySelector('.floating-input-card').getBoundingClientRect();
    return { paneWidth: pane.getBoundingClientRect().width, rootWidth: root.offsetWidth, cardWidth, gap, region, natural,
      textWidth: Math.min(natural, region - gap * 2), threshold: cardWidth * 1.25,
      concealed: root.dataset.concealed === 'true', inert: root.inert, ariaHidden: root.getAttribute('aria-hidden'),
      shift: parseFloat(getComputedStyle(message).marginRight) / 2, shrink: natural - messageWidth,
      messageWidth, replyRight: pane.querySelector('.assistant-block').getBoundingClientRect().right,
      composerCenter: composer.left + composer.width / 2,
      x, opacity: parseFloat(style.opacity), visibility: style.visibility, transition: style.transitionDuration,
      sameRoot: window.__infoRoot === root };
  })()`;
  const metrics = () => evaluate(metricsCode);
  const settled = async concealed => {
    await until(`(() => { const m = ${metricsCode}; return m && m.concealed === ${concealed} && m.opacity === ${concealed ? 0 : 1} && m.visibility === '${concealed ? "hidden" : "visible"}' && ${concealed ? "m.x > m.rootWidth" : "Math.abs(m.x) < 0.01"}; })()`, `卡片${concealed ? "隐藏" : "显示"}动画完成`);
  };
  const resize = async (width, height = 1000) => {
    win.setContentSize(Math.round(width), height);
    await until(`window.innerWidth === ${Math.round(width)} && window.innerHeight === ${height}`, "窗口尺寸更新");
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  };
  const setPaneWidth = async width => {
    await evaluate(`window.__infoRoot.parentElement.style.width = ${JSON.stringify(width === null ? "" : `${width}px`)}; true`);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  };
  // 在渲染帧中取样,不靠任意睡眠碰运气读取某一个中间帧。
  const capture = async (action, sample = metricsCode) => {
    await evaluate(`window.__infoCapture = new Promise(resolve => {
      const frames = [], start = performance.now();
      const tick = () => {
        frames.push({ ...${sample}, time: performance.now() - start });
        if (performance.now() - start < 550) requestAnimationFrame(tick); else resolve(frames);
      };
      requestAnimationFrame(tick);
    }); true`);
    await action();
    return evaluate("window.__infoCapture");
  };
  const assertSlide = (frames, concealed, label) => {
    const moving = frames.filter(frame => frame.concealed === concealed && frame.x > 0.5 && frame.x < frame.rootWidth + 23.5);
    assert.ok(moving.length >= 2, `${label}必须有真实位移中间帧：${JSON.stringify(frames)}`);
    assert.ok(moving.some(frame => frame.opacity > 0 && frame.opacity < 1), `${label}必须有透明度中间帧`);
    assert.ok(concealed ? moving.at(-1).x > moving[0].x : moving.at(-1).x < moving[0].x, `${label}方向错误`);
    assert.ok(frames.every(frame => frame.sameRoot), `${label}不应卸载卡片栈`);
  };
  const checkToggle = async (action, concealed, label) => {
    const before = await metrics();
    const frames = await capture(action);
    assertSlide(frames, concealed, label);
    await settled(concealed);
    const after = await metrics();
    const moving = frames.filter(frame => frame.opacity > 0.05 && frame.opacity < 0.95);
    assert.ok(moving.length >= 2, `${label}应有可测的联动中间帧`);
    for (const key of ['messageWidth', 'replyRight', 'composerCenter']) {
      assert.ok(Math.abs(after[key] - before[key]) > 2, `${label}: ${key} 应随卡片移动`);
      for (const frame of moving) {
        const progress = concealed ? 1 - frame.opacity : frame.opacity;
        const expected = before[key] + progress * (after[key] - before[key]);
        assert.ok(Math.abs(frame[key] - expected) < 1, `${label}: ${key} 未同步 (${frame[key]} vs ${expected})`);
      }
    }
  };
  try {
    await win.loadURL(`${process.env.VELA_INFO_CARDS_URL}?reset=1&quota`);
    await until("!!document.querySelector('.info-card-stack .info-card')", "全 App 内存 IPC fixture 挂载");
    await evaluate("window.__infoRoot = document.querySelector('.info-card-stack'); true");
    await settled(false);
    const initial = await metrics();
    console.log(`初始卡片几何：${JSON.stringify(initial)}`);
    assert.equal(initial.inert, false);
    assert.equal(initial.ariaHidden, null);

    // 以实测留白和实体宽推导边界,不依赖侧栏宽、滚动条或主题密度的硬编码。
    const outerExtra = (await evaluate("window.innerWidth")) - initial.paneWidth;
    const cardInset = initial.paneWidth - initial.region;
    const boundary = outerExtra + cardInset + initial.gap * 2 + initial.threshold;
    const wide = Math.round(boundary + 130);
    // 真实窗口缩放使用远离边界的尺寸,避免系统窗口约束/布局断点带来的误差。
    const narrow = Math.round(boundary - 80);
    await resize(wide, 680);
    await settled(false);
    const squeezed = await metrics();
    assert.ok(squeezed.textWidth >= squeezed.threshold);
    assert.ok((squeezed.natural - squeezed.region) / squeezed.natural > 0.1, "新规则应允许超过旧 10% 收窄预算仍显示");
    assert.ok(squeezed.shrink > squeezed.natural * 0.1);
    assert.ok(Math.abs(squeezed.messageWidth - squeezed.textWidth) < 1, "可见文字列应正确避让卡片");

    const stackBounds = `(() => {
      const root = window.__infoRoot, pane = root.parentElement;
      const dock = pane.querySelector('.chat-dock-wrapper');
      const composer = dock.querySelector('.floating-input-card').getBoundingClientRect();
      const stack = root.getBoundingClientRect(), card = root.querySelector('.info-card').getBoundingClientRect();
      const divider = pane.closest('.main-chat-view').getBoundingClientRect().right;
      const hit = x => root.contains(document.elementFromPoint(x, card.top + 24));
      const message = pane.querySelector('.user-msg-container').getBoundingClientRect();
      return { left: card.left, right: card.right, divider,
        messageWidth: message.width, messageCenter: message.left + message.width / 2, composerCenter: composer.left + composer.width / 2,
        replyWidth: pane.querySelector('.assistant-block').getBoundingClientRect().width, composerWidth: composer.width,
        coveredHit: divider < card.right - 2 && hit(Math.max(card.left + 1, divider + 1)),
        exposedHit: divider > card.left + 2 && hit(card.left + 1),
        inShadow: composer.right > stack.left, overlaps: composer.right > card.left,
        scrollable: root.scrollHeight > root.clientHeight, bottom: stack.bottom,
        paneBottom: pane.getBoundingClientRect().bottom, dockTop: dock.getBoundingClientRect().top };
    })()`;
    const beside = await evaluate(stackBounds);
    assert.ok(beside.scrollable && beside.inShadow && !beside.overlaps, `输入框只进入阴影留白：${JSON.stringify(beside)}`);
    assert.ok(beside.paneBottom - beside.bottom <= 16, `并排时卡片应使用面板全高：${JSON.stringify(beside)}`);
    // Scroll a real card behind the title. Sampling the change between black and white
    // at its inside edge measures how much card is visible, independent of theme.
    const probe = await evaluate(`(() => {
      const root = window.__infoRoot, header = root.closest('main').querySelector('.main-chat-header');
      const title = header.getBoundingClientRect(), first = root.querySelector('.info-card');
      const height = Math.ceil(parseFloat(getComputedStyle(header, '::before').height)) + 8;
      const card = [...root.querySelectorAll('.info-card')].find(el => el.offsetHeight > height + 24);
      const firstGap = first.getBoundingClientRect().top - title.bottom;
      root.scrollTop += card.getBoundingClientRect().top - title.top + 12;
      card.dataset.fadeProbe = '';
      return { firstGap, rect: { x: Math.ceil(card.getBoundingClientRect().left) + 6,
        y: Math.round(title.top), width: 1, height } };
    })()`);
    assert.equal(probe.firstGap, 12, 'First card keeps its inset below the title');
    const checkTitleFade = async () => {
      const sample = async color => {
        await evaluate(`document.querySelector('[data-fade-probe]').style.backgroundColor = '${color}';
          new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))`);
        const pixels = (await win.webContents.capturePage(probe.rect)).toBitmap({ scaleFactor: 1 });
        return [5, Math.round(probe.rect.height * .65), probe.rect.height - 2].map(y => pixels[y * 4]);
      };
      const dark = await sample('black'), light = await sample('white');
      const [top, middle, below] = light.map((v, i) => v - dark[i]);
      assert.ok(top < 15 && middle > top + 20 && middle < below - 20 && below > 245,
        `Card fades continuously beneath the title: ${[top, middle, below]}`);
      assert.ok(await evaluate(`(() => {
        const button = document.querySelector('.main-chat-header button[aria-label*="信息卡片"]');
        const r = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      })()`), 'Scrolled cards must not intercept titlebar controls');
    };
    await checkTitleFade();
    // Compare the painted fade, not hit testing: the opaque dock backing ignores pointer events.
    const fadeRect = await evaluate(`(() => {
      const card = window.__infoRoot.querySelector('.info-card').getBoundingClientRect();
      return { x: Math.ceil(card.left), y: Math.floor(${beside.bottom}) - 30, width: Math.floor(card.width), height: 30 };
    })()`);
    const fadePixels = async () => (await win.webContents.capturePage(fadeRect)).toBitmap();
    const baseline = await fadePixels();
    assert.ok(baseline.length > 0, 'Expected a painted card stack');
    for (const [trigger, menu] of [
      ['.model-pill', '.model-popover, .combined-model-popover'],
      ['.usage-ring-button', '.usage-popover'],
      ['.mode-combined', '.mode-popover'],
    ]) {
      const click = () => evaluate(`document.querySelector('.chat-dock-wrapper ${trigger}').click(); true`);
      await click();
      await until(`(() => {
        const el = document.querySelector('${menu}'); if (!el) return false;
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      })()`, `Visible and interactive ${menu}`);
      await checkTitleFade();
      assert.ok(baseline.equals(await fadePixels()), `${menu} must not cover the info card fade`);
      await click();
      await until(`!document.querySelector('${menu}')`, `Dismiss ${menu}`);
    }
    await evaluate(`document.querySelector('[data-fade-probe]').style.removeProperty('background-color');
      window.__infoRoot.scrollTop = 0; true`);
    console.log('PASS Scrolled cards share the title fade; composer menus preserve both card fades');
    await evaluate(`window.__infoRoot.parentElement.querySelector('.chat-dock-wrapper').style.setProperty('--composer-overhang', '48px'); true`);
    await until(`(() => { const b = ${stackBounds}; return b.overlaps && b.bottom <= b.dockTop; })()`, "输入框实际压到卡片时才预留底部空间");
    await evaluate(`window.__infoRoot.parentElement.querySelector('.chat-dock-wrapper').style.removeProperty('--composer-overhang'); true`);
    await until(`(() => { const b = ${stackBounds}; return !b.overlaps && b.bottom === ${beside.bottom}; })()`, "输入框不再重叠时恢复卡片高度");

    const assertLaneMotion = (frames, full, split) => {
      const progress = f => (full.divider - f.divider) / (full.divider - split.divider);
      assert.ok(frames.filter(f => progress(f) > 0.05 && progress(f) < 0.95).length >= 2, 'Exercise intermediate panel widths');
      for (const key of ['messageWidth', 'replyWidth', 'composerWidth', 'messageCenter', 'composerCenter']) {
        assert.ok(Math.abs(full[key] - split[key]) > 2, `Exercise a visible change in ${key}`);
        for (const frame of frames) {
          const expected = full[key] + progress(frame) * (split[key] - full[key]);
          assert.ok(Math.abs(frame[key] - expected) < 1, `${key}: expected ${expected} at ${frame.divider}, got ${frame[key]}`);
        }
      }
    };
    const panelToggle = '.panel-layout-actions > button';
    for (const close of [panelToggle, '.workbench-tab-close']) {
      const opening = await capture(() => evaluate(`document.querySelector('${panelToggle}').click()`),
        `({ ...${stackBounds}, opacity: Number(getComputedStyle(window.__infoRoot).opacity), visibility: getComputedStyle(window.__infoRoot).visibility })`);
      const partial = opening.filter(f => f.divider < beside.right - 1 && f.divider > beside.left + 1);
      assert.ok(partial.length >= 2, 'The advancing divider must cross the stationary card');
      const pushed = opening.find(f => f.divider > beside.left + 1 && (Math.abs(f.left - beside.left) > 0.5 || f.opacity !== 1 || f.visibility !== 'visible' || f.coveredHit));
      assert.ok(!pushed, `Opening moved a visible card from ${beside.left}: ${JSON.stringify(pushed)}`);
      await settled(true);
      const split = await evaluate(stackBounds);
      assertLaneMotion(opening, beside, split);
      if (close === panelToggle) {
        const toggle = () => evaluate(`document.querySelector('${panelToggle}').click()`);
        const reversed = await capture(async () => {
          await toggle();
          await until(`(${stackBounds}).divider > ${(split.divider + beside.divider) / 2} && !!document.querySelector('.workbench-panel.is-closing')`, 'Reverse a moving panel');
          await toggle();
        }, stackBounds);
        assertLaneMotion(reversed, beside, split);
        await settled(true);
      }
      const frames = await capture(() => evaluate(`document.querySelector('${close}').click()`),
        `({ ...${stackBounds}, closing: !!document.querySelector('.workbench-panel.is-closing'), opacity: Number(getComputedStyle(window.__infoRoot).opacity) })`);
      const closing = frames.filter(f => f.closing);
      assert.ok(closing.some(f => f.divider <= beside.left), `${close}: start behind the workbench`);
      assert.ok(closing.some(f => f.divider > beside.left && f.divider < beside.right && f.exposedHit), `${close}: reveal a slice of the card: ${JSON.stringify(closing.map(({ divider, left, exposedHit, opacity }) => [divider, left, exposedHit, opacity]))}`);
      const moved = frames.slice(frames.indexOf(closing[0])).find(f => f.opacity !== 1 || Math.abs(f.left - beside.left) > 0.5 || Math.abs(f.right - beside.right) > 0.5 || f.coveredHit);
      assert.ok(!moved, `${close}: cards must stay at rest behind the moving divider: ${JSON.stringify(moved)}`);
      assertLaneMotion(frames, beside, split);
      const shifted = closing.find(f => !f.overlaps && f.bottom !== beside.bottom);
      assert.ok(!shifted, `Closing the workbench moved the bottom fade despite no overlap: ${JSON.stringify(shifted)}`);
      await settled(false);
    }
    console.log('PASS Opening and reopening cover stationary cards; folding or closing the last tab uncovers them');

    await resize(1550, 680);
    const previousWidth = await evaluate(`document.documentElement.style.getPropertyValue('--workbench-width')`);
    await evaluate(`document.documentElement.style.setProperty('--workbench-width', '320px')`);
    const room = await capture(() => evaluate(`document.querySelector('${panelToggle}').click()`));
    assert.ok(room.every(f => !f.concealed && !f.inert && f.opacity === 1), 'Keep cards alongside the workbench when both fit');
    assert.ok(room[0].paneWidth - room.at(-1).paneWidth > 300, 'Exercise a real split and not just the closed layout');
    await capture(() => evaluate(`document.querySelector('.workbench-tab-close').click()`));
    await evaluate(`document.documentElement.style.setProperty('--workbench-width', ${JSON.stringify(previousWidth)})`);
    await resize(wide, 680);
    await settled(false);

    const checkNoReveal = async label => {
      await evaluate(`document.querySelector('${panelToggle}').click()`);
      await until(`!!document.querySelector('.workbench-tab-close')`, 'Workbench opened');
      const frames = await capture(() => evaluate(`document.querySelector('.workbench-tab-close').click()`));
      assert.ok(frames.every(f => f.concealed && f.inert && f.opacity === 0), `${label}: keep the cards hidden throughout the close`);
    };
    const toggleCards = () => evaluate(`document.querySelector('.main-chat-header button[aria-label*="信息卡片"]').click()`);
    await toggleCards();
    await settled(true);
    await checkNoReveal('Manually hidden');
    await toggleCards();
    await settled(false);
    await resize(narrow);
    await settled(true);
    await checkNoReveal('Too narrow even without the workbench');
    assert.ok((await metrics()).textWidth < (await metrics()).threshold);
    await resize(wide);
    await settled(false);
    console.log("PASS 真实 Electron 窗口宽→窄→宽自动显隐");

    // 精确边界单独用 pane 的 CSS 宽度测试,无需窗口系统支持恰好某个整数尺寸。
    const beforeExact = await metrics();
    const paneBoundary = beforeExact.paneWidth - beforeExact.region + beforeExact.gap * 2 + beforeExact.threshold;
    await setPaneWidth(paneBoundary);
    await settled(false);
    const exact = await metrics();
    console.log(`精确边界几何：${JSON.stringify(exact)}`);
    assert.equal(exact.textWidth, exact.threshold, "精确测到 1.25 倍边界");
    assert.equal(exact.concealed, false, "恰好 1.25 倍时显示");
    const exitFrames = await capture(() => setPaneWidth(paneBoundary - 1));
    assertSlide(exitFrames, true, "自动向右退出");
    await settled(true);
    const hidden = await metrics();
    assert.ok(hidden.textWidth < hidden.threshold);
    assert.equal(hidden.shift, 0, "隐藏时应释放左移");
    assert.equal(hidden.shrink, 0, "隐藏时应释放收窄");
    assert.ok(Math.abs(hidden.messageWidth - hidden.natural) < 1, "隐藏后文字恢复自然宽度");
    assert.equal(hidden.inert, true);
    assert.equal(hidden.ariaHidden, "true");
    assert.equal(await evaluate(`(() => {
      const button = window.__infoRoot.querySelector('button'); button.focus();
      return window.__infoRoot.contains(document.activeElement);
    })()`), false, "隐藏卡片不能获得键盘焦点");
    const enterFrames = await capture(() => setPaneWidth(null));
    assertSlide(enterFrames, false, "自动从右进入");
    await settled(false);
    assert.equal((await metrics()).inert, false);
    console.log("PASS 宽→窄→宽、10% 预算替换、1.25 倍精确边界、释放文字宽度、inert/a11y 和双向动画");

    // 动画进行中反转,同一个栈从当前位置返回;稳定宽度不产生显隐振荡。
    await evaluate(`window.__infoChanges = []; window.__infoObserver = new MutationObserver(() => {
      window.__infoChanges.push(window.__infoRoot.dataset.concealed === 'true');
    }); window.__infoObserver.observe(window.__infoRoot, { attributes: true, attributeFilter: ['data-concealed'] }); true`);
    await resize(narrow);
    await until(`(() => { const m = ${metricsCode}; return m.concealed && m.x > 2 && m.x < m.rootWidth - 2; })()`, "反转前退出动画已开始");
    const beforeReverse = await metrics();
    await resize(wide);
    await until("!window.__infoRoot.hasAttribute('data-concealed')", "动画中途改为显示");
    const afterReverse = await metrics();
    assert.ok(afterReverse.x > 0 && afterReverse.x < afterReverse.rootWidth + 24, "反转不应瞬间跳到起点/终点");
    assert.ok(afterReverse.opacity > 0, "反转不应闪成全透明");
    assert.ok(beforeReverse.sameRoot && afterReverse.sameRoot);
    await settled(false);
    await pause(450);
    assert.deepEqual(await evaluate("window.__infoChanges"), [true, false], "快速反转之后不应自动振荡");
    await evaluate("window.__infoObserver.disconnect(); true");
    console.log("PASS 动画中途快速反转保持连续、卡片栈不卸载且稳定后不振荡");

    // 手动切换同样滑动,且卡片折叠状态与 DOM 节点都保留。
    await evaluate(`window.__stateCard = window.__infoRoot.querySelector('.info-card');
      window.__stateCard.querySelector('.info-card-title').click(); true`);
    await until("window.__stateCard.hasAttribute('data-collapsed')", "卡片内部折叠状态");
    await evaluate("window.__cardState = localStorage.getItem('vela.infoCards'); true");
    await checkToggle(toggleCards, true, "手动向右退出");
    assert.equal((await metrics()).inert, true);
    await checkToggle(toggleCards, false, "手动从右进入");
    assert.equal(await evaluate("window.__stateCard === window.__infoRoot.querySelector('.info-card') && window.__stateCard.hasAttribute('data-collapsed')"), true);
    assert.equal(await evaluate("localStorage.getItem('vela.infoCards') === window.__cardState"), true);
    console.log("PASS 手动按钮折叠/展开双向动画并保留卡片内部状态");

    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await until("matchMedia('(prefers-reduced-motion: reduce)').matches", "减少动态效果媒体查询");
    await resize(narrow);
    await until("window.__infoRoot.dataset.concealed === 'true'", "减少动态效果模式隐藏");
    const reducedHidden = await metrics();
    assert.equal(reducedHidden.x, 0);
    assert.equal(reducedHidden.opacity, 0);
    assert.equal(reducedHidden.visibility, "hidden");
    // 全局 reduced-motion 的 !important 可能把 none 统一为 0.01ms,仍应小于一个可见帧。
    assert.ok(reducedHidden.transition.split(",").every(value => parseFloat(value) <= 0.00001));
    await resize(wide);
    await until("!window.__infoRoot.hasAttribute('data-concealed')", "减少动态效果模式显示");
    const reducedShown = await metrics();
    assert.equal(reducedShown.x, 0);
    assert.equal(reducedShown.opacity, 1);
    assert.equal(reducedShown.inert, false);
    assert.ok(reducedShown.transition.split(",").every(value => parseFloat(value) <= 0.00001));
    const instantOpen = await capture(() => evaluate(`document.querySelector('${panelToggle}').click()`), stackBounds);
    const instantClose = await capture(() => evaluate(`document.querySelector('.workbench-tab-close').click()`), stackBounds);
    for (const key of ['messageWidth', 'replyWidth', 'composerWidth']) {
      const from = instantOpen.at(-1)[key], to = instantClose.at(-1)[key];
      assert.ok(Math.abs(from - to) > 2);
      const intermediate = [...instantOpen, ...instantClose].find(f => Math.min(Math.abs(f[key] - from), Math.abs(f[key] - to)) >= 1);
      assert.ok(!intermediate, `Reduced motion: unexpected ${key} ${intermediate?.[key]} between ${from} and ${to}`);
    }
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    win.webContents.debugger.detach();
    console.log("PASS prefers-reduced-motion 无位移、无可见 transition, 显隐与交互状态正确");

    // Match the reported layout: 52px navigation rail, 6px inset and 264px sidebar.
    await evaluate(`localStorage.setItem('vela.navLayout', JSON.stringify('rail'));
      localStorage.setItem('vela.sidebar.widths', JSON.stringify({ left: 264 })); true`);
    win.setContentSize(1280, 800);
    await win.loadURL(`${process.env.VELA_INFO_CARDS_URL}?layout=floating&table`);
    await until(`!!document.querySelector('.nav-rail-layout .floating-environment')
      && !!document.querySelector('.assistant-block .md-table-scroll table')
      && document.querySelector('.chat-conversation-pane').getBoundingClientRect().left === 322`, "截图中的导航、侧栏和表格");
    await evaluate("window.__infoRoot = document.querySelector('.floating-environment'); true");
    await settled(false);
    const geometry = await evaluate(`(() => {
      const pane = document.querySelector('.chat-conversation-pane');
      const card = pane.querySelector('.floating-environment').getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(pane.querySelector('.chat-scroll-area')).paddingLeft);
      const selectors = ['.user-msg-container', '.assistant-block', '.md-table-scroll'];
      const gaps = selectors.map(selector => card.left - pane.querySelector(selector).getBoundingClientRect().right);
      return { gap, gaps, width: window.innerWidth, height: window.innerHeight };
    })()`);
    assert.deepEqual([geometry.width, geometry.height], [1280, 800]);
    assert.ok(geometry.gap > 0 && geometry.gaps.every(gap => gap >= geometry.gap - 1),
      `Floating information must clear messages and the table: ${JSON.stringify(geometry)}`);
    console.log(`PASS 1280 × 800 floating information gaps: ${geometry.gaps.join(", ")} px`);
    const toggleEnvironment = () => evaluate(`document.querySelector('.main-chat-header button[aria-label*="环境卡片"]').click(); true`);
    await checkToggle(toggleEnvironment, true, "单张环境卡向右退出");
    assert.equal((await metrics()).inert, true);
    await checkToggle(toggleEnvironment, false, "单张环境卡从右进入");
    console.log("PASS 单卡与卡片栈进退场时消息、回复和输入框逐帧同步");
    await resize(narrow);
    await until(`(() => {
      const m = ${metricsCode};
      return !document.querySelector('.info-card-stack') && m.shift === 0 && m.shrink === 0;
    })()`, "单张环境卡达到收窄上限");
    const legacy = await evaluate(`(() => {
      const card = document.querySelector('.floating-environment'), pane = card.parentElement;
      const natural = Math.min(pane.querySelector('.chat-message-surface').getBoundingClientRect().width, 760);
      const region = card.getBoundingClientRect().left - pane.getBoundingClientRect().left;
      return { cardShrink: Math.max(0, natural - region), natural, concealed: card.hasAttribute('data-concealed') };
    })()`);
    assert.ok(legacy.cardShrink >= legacy.natural * 0.4, "窄面板达到 40% 收窄上限时应保留文字宽度");
    assert.equal(legacy.concealed, false);
    assert.deepEqual(diagnostics, [], "预览页面不应产生渲染错误");
    console.log("PASS layout=floating 窄面板保留文字宽度");
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { console.error(`失败时几何：${JSON.stringify(await metrics())}`); } catch { /* 渲染进程可能已退出 */ }
    if (diagnostics.length) console.error(`渲染诊断：\n${diagnostics.join("\n")}`);
    app.exit(1);
  }
  });
}
