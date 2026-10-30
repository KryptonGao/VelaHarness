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
    const root = document.querySelector('.info-card-stack');
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
    return { paneWidth: pane.getBoundingClientRect().width, rootWidth: root.offsetWidth, cardWidth, gap, region, natural,
      textWidth: Math.min(natural, region - gap * 2), threshold: cardWidth * 1.25,
      concealed: root.dataset.concealed === 'true', inert: root.inert, ariaHidden: root.getAttribute('aria-hidden'),
      shift: parseFloat(paneStyle.getPropertyValue('--chat-lane-shift')) || 0,
      shrink: parseFloat(paneStyle.getPropertyValue('--chat-lane-shrink')) || 0,
      messageWidth: pane.querySelector('.user-msg-container')?.getBoundingClientRect().width,
      x, opacity: parseFloat(style.opacity), visibility: style.visibility, transition: style.transitionDuration,
      sameRoot: window.__infoRoot === root };
  })()`;
  const metrics = () => evaluate(metricsCode);
  const settled = async concealed => {
    await until(`(() => { const m = ${metricsCode}; return m && m.concealed === ${concealed} && m.opacity === ${concealed ? 0 : 1} && m.visibility === '${concealed ? "hidden" : "visible"}' && ${concealed ? "m.x > m.rootWidth" : "Math.abs(m.x) < 0.01"}; })()`, `卡片${concealed ? "隐藏" : "显示"}动画完成`);
  };
  const resize = async width => {
    win.setContentSize(Math.round(width), 1000);
    await until(`window.innerWidth === ${Math.round(width)}`, "窗口尺寸更新");
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  };
  const setPaneWidth = async width => {
    await evaluate(`window.__infoRoot.parentElement.style.width = ${JSON.stringify(width === null ? "" : `${width}px`)}; true`);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  };
  // 在渲染帧中取样,不靠任意睡眠碰运气读取某一个中间帧。
  const capture = async action => {
    await evaluate(`window.__infoCapture = new Promise(resolve => {
      const frames = [], start = performance.now();
      const tick = () => {
        frames.push({ ...${metricsCode}, time: performance.now() - start });
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
  try {
    await win.loadURL(`${process.env.VELA_INFO_CARDS_URL}?reset=1`);
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
    await resize(wide);
    await settled(false);
    const squeezed = await metrics();
    assert.ok(squeezed.textWidth >= squeezed.threshold);
    assert.ok((squeezed.natural - squeezed.region) / squeezed.natural > 0.1, "新规则应允许超过旧 10% 收窄预算仍显示");
    assert.ok(squeezed.shrink > squeezed.natural * 0.1);
    assert.ok(Math.abs(squeezed.messageWidth - squeezed.textWidth) < 1, "可见文字列应正确避让卡片");

    await resize(narrow);
    await settled(true);
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
    const toggle = () => evaluate(`(() => {
      const button = document.querySelector('.main-chat-header button[aria-label*="信息卡片"]');
      if (!button) throw new Error('缺少信息卡片切换按钮'); button.click(); return true;
    })()`);
    assertSlide(await capture(toggle), true, "手动向右退出");
    await settled(true);
    assert.equal((await metrics()).inert, true);
    assertSlide(await capture(toggle), false, "手动从右进入");
    await settled(false);
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
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    win.webContents.debugger.detach();
    console.log("PASS prefers-reduced-motion 无位移、无可见 transition, 显隐与交互状态正确");

    // 旧环境卡仍采用 10% 预算:过窄时保持文字自然宽度,不套用新卡片规则。
    await win.loadURL(`${process.env.VELA_INFO_CARDS_URL}?layout=floating`);
    await until("!!document.querySelector('.floating-environment') && !!document.querySelector('.chat-message-surface')", "旧悬浮环境卡模式");
    await resize(narrow);
    await until(`(() => {
      const pane = document.querySelector('.chat-conversation-pane');
      const style = getComputedStyle(pane);
      return !document.querySelector('.info-card-stack') &&
        (parseFloat(style.getPropertyValue('--chat-lane-shift')) || 0) === 0 &&
        (parseFloat(style.getPropertyValue('--chat-lane-shrink')) || 0) === 0;
    })()`, "旧环境卡保留 10% 收窄预算");
    const legacy = await evaluate(`(() => {
      const card = document.querySelector('.floating-environment'), pane = card.parentElement;
      const natural = Math.min(pane.querySelector('.chat-message-surface').getBoundingClientRect().width, 760);
      const region = card.getBoundingClientRect().left - pane.getBoundingClientRect().left;
      return { cardShrink: Math.max(0, natural - region), natural, concealed: card.hasAttribute('data-concealed') };
    })()`);
    assert.ok(legacy.cardShrink >= legacy.natural * 0.1, "旧模式应实际触发 10% 预算边界而不避让");
    assert.equal(legacy.concealed, false);
    assert.deepEqual(diagnostics, [], "预览页面不应产生渲染错误");
    console.log("PASS layout=floating 保留旧环境卡布局规则");
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { console.error(`失败时几何：${JSON.stringify(await metrics())}`); } catch { /* 渲染进程可能已退出 */ }
    if (diagnostics.length) console.error(`渲染诊断：\n${diagnostics.join("\n")}`);
    app.exit(1);
  }
  });
}
