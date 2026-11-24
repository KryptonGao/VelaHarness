/** 真实 App 的聊天标签与会话隔离：node apps/desktop/test/workbench-chat-ui.mjs */
import assert from "node:assert/strict";
import { providerIconsPlugin } from "./provider-icons-plugin.mjs";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-workbench-chat-"));
  try {
    const { build } = await import("esbuild");
    await build({ plugins: [providerIconsPlugin], entryPoints: [join(here, "workbench-chat-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_WORKBENCH_CHAT_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 55000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Workbench chat UI checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_WORKBENCH_CHAT_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1440, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error" || event.level >= 3) errors.push(event.message); });
    const evaluate = async code => {
      try { return await win.webContents.executeJavaScript(code); }
      catch (error) { console.error(`Renderer check failed: ${code}\n${errors.join("\n")}`); throw error; }
    };
    const until = async code => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
      throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
    };
    const click = async selector => {
      await until(`document.querySelector(${JSON.stringify(selector)})`);
      return evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    };
    const input = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el.isContentEditable) el.textContent = ${JSON.stringify(value)}; else Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    const capture = async name => {
      if (!process.env.VELA_WORKBENCH_CHAT_CAPTURE) return;
      mkdirSync(process.env.VELA_WORKBENCH_CHAT_CAPTURE, { recursive: true });
      await evaluate("new Promise(done => setTimeout(done, 250))");
      writeFileSync(join(process.env.VELA_WORKBENCH_CHAT_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const panel = '.workbench-tabpanel:not(.is-inactive) .panel-chat-view';
    const newTab = async () => {
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyT', key:'t', metaKey:true, bubbles:true}))");
      await until("document.querySelector('.workbench-tabpanel:not(.is-inactive) .start-view')");
    };
    const chatOption = ".workbench-tabpanel:not(.is-inactive) .start-option:first-child";
    try {
      await win.loadFile(join(temporary, "index.html"));
      await until("document.querySelector('.chat-active-title')?.textContent === '主聊天'");
      await evaluate("window.vela.prompt('first turn'); chatFixture.setOverlaps(['a.ts'])");
      await until("!!document.querySelector('.chat-dock-wrapper > .conflict-banner + .floating-input-card')");
      assert.ok(await evaluate(`(() => {
        const banner = document.querySelector('.conflict-banner');
        const gap = banner.nextElementSibling.getBoundingClientRect().top - banner.getBoundingClientRect().bottom;
        return gap >= 0 && gap <= 10;
      })()`));
      await evaluate("document.querySelector('.conflict-banner button[aria-label]').click()");
      await until("!document.querySelector('.conflict-banner')");
      await evaluate("chatFixture.setOverlaps(['b.ts', 'a.ts']); new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
      assert.equal(await evaluate("!!document.querySelector('.conflict-banner')"), false);
      await evaluate("chatFixture.finish('main-chat'); window.vela.prompt('next turn')");
      await until("document.querySelector('.conflict-banner-files')?.textContent.includes('b.ts')");
      await win.loadFile(join(temporary, "index.html"));
      await until("document.querySelector('.chat-active-title')?.textContent === '主聊天'");
      // The inner capsule carries the shadow on both the start page and the conversation.
      assert.deepEqual(await evaluate(`(() => {
        const root = document.documentElement;
        const previous = { scheme: root.dataset.scheme, theme: root.dataset.theme };
        const fixture = document.createElement('div');
        fixture.className = 'chat-conversation-pane';
        fixture.innerHTML = '<form class="floating-input-card layout-capsule"><div class="composer-capsule"></div></form>';
        document.body.append(fixture);
        try {
          return ['light', 'dark'].map(scheme => {
            root.dataset.scheme = scheme;
            root.dataset.theme = scheme === 'dark' ? 'midnight' : 'default';
            fixture.dataset.home = '';
            const card = fixture.firstElementChild;
            const capsule = card.firstElementChild;
            const homeShadow = getComputedStyle(capsule).boxShadow;
            const flat = getComputedStyle(card).boxShadow === 'none' && homeShadow !== 'none';
            const bordered = getComputedStyle(capsule).borderTopWidth === '1px';
            delete fixture.dataset.home;
            const dockShadow = getComputedStyle(capsule).boxShadow;
            const floating = dockShadow !== 'none' && dockShadow !== homeShadow;
            return { flat, bordered, floating };
          });
        } finally {
          fixture.remove();
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete root.dataset[key]; else root.dataset[key] = value;
          }
        }
      })()`), Array.from({ length: 2 }, () => ({ flat: true, bordered: true, floating: true })));
      // Verify the actual overlap, not just the dock's z-index: the scrollport must run
      // behind the input, and the lower shield must start inside the rounded surface.
      const overlapChecks = await evaluate(`(() => {
        const pane = document.createElement('section');
        pane.className = 'chat-conversation-pane';
        pane.style.cssText = 'position:fixed;inset:0 auto auto 0;height:480px;display:flex;flex-direction:column;--composer-clearance:160px';
        pane.innerHTML = '<div class="chat-scroll-area"><div class="chat-message-surface"><article class="assistant-block" style="min-height:1200px">Reply</article></div></div><div class="chat-dock-wrapper"><form class="floating-input-card layout-capsule"><div class="composer-capsule" style="min-height:64px"></div></form></div>';
        document.body.append(pane);
        try {
          const list = pane.querySelector('.chat-scroll-area'), reply = pane.querySelector('article');
          const form = pane.querySelector('form'), dock = form.parentElement, checks = [];
          for (const width of [400, 1000]) {
            pane.style.width = width + 'px';
            const surface = form.firstElementChild.getBoundingClientRect();
            const shield = dock.getBoundingClientRect().top + parseFloat(getComputedStyle(dock, '::after').top);
            list.scrollTop = 0;
            const row = reply.getBoundingClientRect();
            const overlap = row.left > surface.left && row.right < surface.right && row.bottom > surface.bottom && list.getBoundingClientRect().bottom >= surface.bottom;
            list.scrollTop = list.scrollHeight;
            checks.push({width, overlap, shieldInside: shield > surface.top && shield < surface.bottom, lastVisible: reply.getBoundingClientRect().bottom <= surface.top});
          }
          return checks;
        } finally { pane.remove(); }
      })()`);
      for (const c of overlapChecks) assert.ok(c.overlap && c.shieldInside && c.lastVisible, JSON.stringify(c));
      const expandSidebar = 'button[aria-label="展开侧边栏"]';
      const collapseSidebar = 'button[aria-label="收起侧边栏"]';
      const fillsWorkspace = "document.querySelector('.workbench-canvas').clientWidth === document.querySelector('.main-stage-pane').clientWidth";
      const sidebarUsable = `(() => {
        const item = document.querySelector('.sidebar-left .subchat-item');
        const rect = item.getBoundingClientRect();
        const panel = document.querySelector('.workbench-canvas').getBoundingClientRect();
        return item.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) && panel.left >= rect.right;
      })()`;
      await click(expandSidebar);
      await newTab(); await capture("start-light");
      const panelWidth = () => evaluate("document.querySelector('.workbench-panel').getBoundingClientRect().width");
      await until("document.querySelector('.workbench-panel').getAnimations().length === 0");
      const splitWidth = await panelWidth();
      await click(".workbench-fullscreen-button");
      await until(fillsWorkspace);
      await until(sidebarUsable);
      const collapsedFloat = '.main-chat-view[data-floating-chat="collapsed"]';
      const expandedFloat = '.main-chat-view[data-floating-chat="expanded"]';
      const doubleClickHeader = () => evaluate("document.querySelector('.floating-chat-header').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))");
      const checkSettingsResize = async () => {
        const result = await evaluate(`(async () => {
          const chat = document.querySelector("[data-floating-chat]");
          const button = chat.querySelector(".floating-composer-options");
          const dock = chat.querySelector(".chat-dock-wrapper");
          const measure = () => [chat.offsetHeight, dock.offsetHeight];
          await new Promise(requestAnimationFrame);
          await Promise.allSettled(chat.getAnimations({ subtree: true }).filter(a => a instanceof CSSTransition).map(a => a.finished));
          const before = measure();
          async function toggle() {
            button.click();
            const frames = [];
            do {
              await new Promise(requestAnimationFrame);
              frames.push(measure());
            } while (chat.querySelector(".floating-composer-settings").getAnimations().length);
            return frames;
          }
          const opening = await toggle(), closing = await toggle();
          return { before, opening, closing, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
        })()`);
        const { before, opening, closing } = result;
        const opened = opening.at(-1);
        assert.ok(opened[1] > before[1] && Math.abs((opened[0] - before[0]) - (opened[1] - before[1])) <= 1, JSON.stringify(result));
        assert.deepEqual(closing.at(-1), before);
        for (const frames of [opening, closing]) {
          assert.ok(frames.every(([height, dock]) => Math.abs((height - before[0]) - (dock - before[1])) <= 1), JSON.stringify(result));
          if (!result.reduced) assert.ok(frames.some(([height]) => height > before[0] && height < opened[0]), JSON.stringify(result));
        }
      };
      const checkContextUsage = async () => {
        const trigger = "[data-floating-chat] .context-usage-trigger";
        await until(`(() => {
          const button = document.querySelector('${trigger}');
          const rect = button?.getBoundingClientRect();
          return rect?.width > 0 && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })()`);
        await evaluate(`(() => {
          const rect = document.querySelector('${trigger}').getBoundingClientRect();
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).click();
        })()`);
        await until(`(() => {
          const button = document.querySelector('${trigger}[aria-expanded=true]');
          const dialog = button && document.getElementById(button.getAttribute("aria-controls"));
          const rect = dialog?.getBoundingClientRect();
          return rect?.height > 0 && dialog.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })()`);
        await click(".context-popover-close");
        await until(`document.activeElement.matches('${trigger}[aria-expanded=false]') && !document.querySelector('.context-usage-popover')`);
      };
      const checkCollapsed = () => until(`(() => {
        const chat = document.querySelector(${JSON.stringify(collapsedFloat)});
        if (!chat || chat.offsetHeight > 100 || chat.querySelector(".chat-scroll-area").offsetHeight) return false;
        const input = chat.querySelector(".rich-input"), rect = input.getBoundingClientRect();
        return rect.width > 50 && rect.height > 20 && input.contains(document.elementFromPoint(rect.x + 10, rect.y + 10));
      })()`);
      await checkCollapsed();
      await capture("fullscreen-panel");
      const floatRect = "document.querySelector('[data-floating-chat]').getBoundingClientRect()";
      const origin = await evaluate(`${floatRect}.toJSON()`);
      const start = { x: Math.round(origin.x + 35), y: Math.round(origin.y + 20) };
      function dragPointer(from, to) {
        win.webContents.sendInputEvent({ type: "mouseMove", ...from });
        win.webContents.sendInputEvent({ type: "mouseDown", ...from, button: "left", clickCount: 1 });
        win.webContents.sendInputEvent({ type: "mouseMove", ...to, button: "left" });
        win.webContents.sendInputEvent({ type: "mouseUp", ...to, button: "left", clickCount: 1 });
      }
      dragPointer(start, { x: start.x - 64, y: start.y - 96 });
      await until(`Math.abs(${floatRect}.x - ${origin.x - 64}) < 1 && Math.abs(${floatRect}.bottom - ${origin.bottom - 96}) < 1`);
      await input(collapsedFloat + " .rich-input", "浮窗草稿");
      await click(".floating-chat-hide");
      await until(`${floatRect}.width === 0 && document.activeElement.matches('.floating-chat-restore')`);
      await click(".floating-chat-restore");
      await checkCollapsed();
      assert.equal(await evaluate("document.activeElement.textContent"), "浮窗草稿");
      assert.ok(await evaluate(`Math.abs(${floatRect}.x - ${origin.x - 64}) < 1 && Math.abs(${floatRect}.bottom - ${origin.bottom - 96}) < 1`));
      await input(collapsedFloat + " .rich-input", "");
      const edgePoint = () => evaluate(`(() => {
        const rect = document.querySelector('.floating-chat-resize').getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 3) };
      })()`);
      const beforeResize = await evaluate(`${floatRect}.toJSON()`);
      const edge = await edgePoint();
      dragPointer(edge, { x: edge.x + 15, y: edge.y - 180 });
      const resized = (delta) => `Math.abs(${floatRect}.height - ${beforeResize.height + delta}) <= 1 &&
        Math.abs(${floatRect}.bottom - ${beforeResize.bottom}) <= 1 && Math.abs(${floatRect}.left - ${beforeResize.left}) <= 1`;
      await until(resized(180));
      const raised = await edgePoint();
      dragPointer(raised, { x: raised.x, y: raised.y + 60 });
      await until(resized(120));
      await click(".floating-chat-hide");
      await click(".floating-chat-restore");
      await until(resized(120));
      const lowered = await edgePoint();
      dragPointer(lowered, { x: lowered.x, y: 1 });
      await until(`Math.abs(${floatRect}.top - document.querySelector('.workbench-tabbar').getBoundingClientRect().bottom - 12) <= 1 &&
        Math.abs(${floatRect}.bottom - ${beforeResize.bottom}) <= 1`);
      const ceiling = await edgePoint();
      dragPointer(ceiling, { x: ceiling.x, y: Math.round(beforeResize.bottom) });
      await checkCollapsed();
      await until(resized(0));
      await checkSettingsResize();
      // Sample both directions and reverse an in-flight close. Reduced motion settles immediately.
      for (const [surface, toggle] of [
        ["[data-floating-chat] .chat-scroll-area", ".floating-chat-header button[aria-expanded]"],
        [".floating-composer-settings", ".floating-composer-options"],
      ]) {
        const sizes = await evaluate(`(async () => {
          const el = document.querySelector(${JSON.stringify(surface)}), button = document.querySelector(${JSON.stringify(toggle)});
          const height = () => el.getBoundingClientRect().height;
          const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
          async function toggleAndMeasure(finish) {
            button.click();
            await Promise.resolve();
            height();
            const animation = el.getAnimations().find(a => a.transitionProperty === "height");
            if (reduced) {
              if (animation) throw new Error("Unexpected disclosure animation with reduced motion");
            } else {
              if (!animation) throw new Error("Missing height transition for " + el.className);
              animation.pause();
              animation.currentTime = animation.effect.getTiming().duration / 3;
            }
            const mid = height();
            if (finish) animation?.finish();
            return mid;
          }
          const closed = height(), opening = await toggleAndMeasure(true), opened = height();
          const closing = await toggleAndMeasure(false);
          await toggleAndMeasure(true);
          const reopened = height();
          await toggleAndMeasure(true);
          return { reduced, closed, opening, opened, closing, reopened, final: height() };
        })()`);
        assert.ok(sizes.opened > sizes.closed && Math.abs(sizes.final - sizes.closed) <= 1 && Math.abs(sizes.reopened - sizes.opened) <= 1, JSON.stringify(sizes));
        if (!sizes.reduced) for (const mid of [sizes.opening, sizes.closing]) {
          assert.ok(mid > sizes.closed && mid < sizes.opened, JSON.stringify(sizes));
        }
      }
      await doubleClickHeader();
      await until(`document.querySelector('${expandedFloat} .chat-scroll-area')?.clientHeight > 100`);
      await capture("fullscreen-floating-history");
      await checkSettingsResize();
      await click(".floating-chat-header button[aria-expanded]");
      await checkCollapsed();
      await click(".floating-composer-options");
      await until("document.querySelector('[data-floating-chat] .mode-pill')?.clientWidth > 0");
      await checkContextUsage();
      await click(".floating-composer-options");
      const parked = await evaluate(`${floatRect}.toJSON()`);
      dragPointer({ x: Math.round(parked.x + 35), y: Math.round(parked.y + 20) }, { x: 1, y: 1 });
      const atWorkspaceCorner = `(() => {
        const chat = document.querySelector('[data-floating-chat]'), rect = chat.getBoundingClientRect();
        const stage = chat.offsetParent.getBoundingClientRect(), tabs = document.querySelector('.workbench-tabbar').getBoundingClientRect();
        return Math.abs(rect.left - stage.left - 12) <= 1 && Math.abs(rect.top - tabs.bottom - 12) <= 2;
      })()`;
      await until(atWorkspaceCorner);
      await input(collapsedFloat + " .rich-input", "检查浮窗");
      await click(collapsedFloat + " .send");
      await until(`document.querySelector('${expandedFloat} .stop')?.disabled === false`);
      await until(`${floatRect}.height > 400 && ${atWorkspaceCorner}`);
      await click(".floating-chat-hide");
      await evaluate("chatFixture.finish('main-chat')");
      await until(`document.querySelector('${collapsedFloat}')?.hidden && ${floatRect}.width === 0`);
      await click(".floating-chat-restore");
      await checkCollapsed();
      const mainInput = ".main-stage-pane > .main-chat-view .rich-input";
      await click(".sidebar-left .subchat-item");
      await until("document.querySelector('.workbench-pinned-chat[aria-pressed=true]') && document.querySelector('.main-stage-pane > .main-chat-view').clientHeight > 100");
      await input(mainInput, "全屏聊天草稿");
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', metaKey: true, bubbles: true }))");
      await until("!document.querySelector('.showing-pinned-chat') && document.querySelector('.workbench-tabpanel:not(.is-inactive) .start-view')");
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', metaKey: true, bubbles: true }))");
      await until("document.querySelector('.showing-pinned-chat')");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(mainInput)}).textContent`), "全屏聊天草稿");
      await capture("fullscreen-chat");
      await click(".workbench-restore");
      await until("!document.querySelector('.workbench-fullscreen') && document.querySelector('.workbench-panel').getAnimations().length === 0");
      assert.equal(await panelWidth(), splitWidth);
      await until(sidebarUsable);
      await click(collapseSidebar);
      await input(mainInput, "");

      await click(chatOption);
      await until(`document.querySelector(${JSON.stringify(panel + ' .rich-input')}) && !document.querySelector(${JSON.stringify(panel + ' .rich-input')}).disabled`);
      assert.equal(await evaluate("chatFixture.active()"), "main-chat");
      assert.deepEqual(await evaluate("chatFixture.calls.find(c => c.name === 'create').options"), { activate: false });
      await input(panel + " .rich-input", "第一条独立聊天");
      await click(panel + " .send");
      await until("chatFixture.calls.some(c => c.name === 'prompt' && c.id === 'panel-1')");
      await evaluate("chatFixture.emit({type:'text_delta', conversationId:'panel-1', delta:'独立回复只在右侧出现。'})");
      await until(`document.querySelector(${JSON.stringify(panel)})?.textContent.includes('独立回复只在右侧出现。')`);
      assert.equal(await evaluate("document.querySelector('.main-stage-pane > .main-chat-view').textContent.includes('独立回复只在右侧出现。')"), false);
      await click(panel + " .stop");
      await until("chatFixture.calls.some(c => c.name === 'abort' && c.id === 'panel-1')");
      await input(panel + " .rich-input", "保留这段草稿");
      await capture("chat-light");
      await newTab(); await click(chatOption);
      await until("document.querySelectorAll('.panel-chat-view').length === 2");
      assert.equal(await evaluate("(() => {const ids = [...document.querySelectorAll('div.input-textarea')].map(el => el.id); return new Set(ids).size === ids.length;})()"), true);
      const first = await evaluate("document.querySelectorAll('.workbench-tab')[0].id");
      await click(`#${first}`);
      await until(`document.querySelector(${JSON.stringify(panel + ' .rich-input')})?.textContent === '保留这段草稿'`);
      // 模式、模型和思考强度都必须使用该标签绑定的 ID。
      await click(panel + " .mode-pill"); await click(panel + " .mode-option:nth-of-type(4)");
      await until("chatFixture.state('panel-1').session.mode === 'plan'");
      assert.equal(await evaluate("chatFixture.state('main-chat').session.mode"), "agent");
      await click(panel + " .model-pill");
      await until(`Array.from(document.querySelectorAll(${JSON.stringify(panel + ' button')})).some(b => b.textContent.includes('Model Two'))`);
      await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(panel + ' button')})).find(b => b.textContent.includes('Model Two')).click()`);
      await until("chatFixture.state('panel-1').session.modelId === 'two'");
      assert.equal(await evaluate("chatFixture.state('main-chat').session.modelId"), "one");
      await click(panel + " .model-choice-pill:not(.model-pill)");
      await until(`document.querySelector(${JSON.stringify(panel + ' .thinking-slider-input')})`);
      await evaluate(`(() => {const el = document.querySelector(${JSON.stringify(panel + ' .thinking-slider-input')}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '3'); el.dispatchEvent(new Event('input', {bubbles:true}));})()`);
      await until("chatFixture.state('panel-1').session.thinkingLevel === 'high'");
      assert.equal(await evaluate("chatFixture.state('main-chat').session.thinkingLevel"), "medium");
      // Ultra 提示只由滑杆切入触发：到期后、尚未到期时重新打开都不能重播。
      const thinkingValue = `document.querySelector(${JSON.stringify(panel + ' .thinking-level-value')})?.textContent`;
      const setThinkingSlider = value => evaluate(`(() => {const el = document.querySelector(${JSON.stringify(panel + ' .thinking-slider-input')}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event('input', {bubbles:true}));})()`);
      await setThinkingSlider(4);
      await until(`${thinkingValue} === '更快使用算力'`);
      await until(`${thinkingValue} === 'Ultra'`);
      await click(panel + " .model-choice-pill:not(.model-pill)");
      await until(`!document.querySelector(${JSON.stringify(panel + ' .thinking-popover')})`);
      await click(panel + " .model-choice-pill:not(.model-pill)");
      await until(`document.querySelector(${JSON.stringify(panel + ' .thinking-popover')})`);
      assert.equal(await evaluate(thinkingValue), "Ultra");
      await setThinkingSlider(3);
      await until(`${thinkingValue} === '高'`);
      await setThinkingSlider(4);
      await until(`${thinkingValue} === '更快使用算力'`);
      await click(panel + " .model-choice-pill:not(.model-pill)");
      await until(`!document.querySelector(${JSON.stringify(panel + ' .thinking-popover')})`);
      await click(panel + " .model-choice-pill:not(.model-pill)");
      await until(`document.querySelector(${JSON.stringify(panel + ' .thinking-popover')})`);
      assert.equal(await evaluate(thinkingValue), "Ultra");
      await setThinkingSlider(3);
      await until(`${thinkingValue} === '高'`);
      await click(panel + " .model-choice-pill:not(.model-pill)");
      await evaluate("chatFixture.changeMain()");
      await until("document.querySelector('.main-stage-pane > .main-chat-view .chat-active-title')?.textContent === '另一条主聊天'");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel + ' .rich-input')}).textContent`), "保留这段草稿");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel + ' .chat-active-title')}).textContent`), "第一条独立聊天");
      await evaluate("document.documentElement.dataset.scheme = 'dark'; document.documentElement.dataset.theme = 'midnight'");
      await capture("chat-dark");
      await evaluate("document.documentElement.style.setProperty('--workbench-width', '360px')");
      await evaluate("new Promise(done => setTimeout(done, 300))");
      assert.equal(await evaluate(`(() => {const el = document.querySelector(${JSON.stringify(panel)}); return el.scrollWidth <= el.clientWidth;})()`), true);
      assert.equal(await evaluate(`Math.round(document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect().width)`), 360);
      assert.equal(await evaluate(`(() => {const view = document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect(); const send = document.querySelector(${JSON.stringify(panel + ' .send')}).getBoundingClientRect(); return send.left >= view.left && send.right <= view.right && send.bottom <= view.bottom;})()`), true);
      await capture("chat-narrow");
      if (process.env.VELA_WORKBENCH_CHAT_CAPTURE) {
        win.setContentSize(2880, 1800);
        win.webContents.setZoomFactor(2);
        await capture("chat-zoom-200");
        win.webContents.setZoomFactor(1);
        win.setContentSize(1440, 900);
      }
      // 同一对话在主区与 Panel 同时打开时，重新发送会同步替换两处历史。
      await evaluate("document.documentElement.style.removeProperty('--workbench-width'); window.vela.switchConversation('panel-1')");
      const main = '.main-stage-pane > .main-chat-view';
      await until(`document.querySelector(${JSON.stringify(main)})?.textContent.includes('第一条独立聊天')`);
      assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(main + ' .user-msg-container')}).length`), 1);
      assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(panel + ' .user-msg-container')}).length`), 1);
      // 时间、复制和编辑默认隐藏；消息、间隙和操作栏悬停都保持显示，且只影响当前消息。
      const actions = view => `getComputedStyle(document.querySelector(${JSON.stringify(view + ' .user-message-actions')}))`;
      const movePointer = async (selector, atGap = false) => {
        const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.right - 12), y: Math.round(${atGap ? 'r.bottom + 4' : 'r.top + r.height / 2'}) }; })()`);
        win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      };
      await evaluate("document.activeElement?.blur()");
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
      for (const view of [main, panel]) {
        await until(`${actions(view)}.opacity === '0'`);
        assert.equal(await evaluate(`${actions(view)}.pointerEvents`), 'none');
      }
      // Switching the main conversation can restore a collapsed workbench. Hover only once it is on screen.
      await evaluate("document.querySelector('.main-stage-pane > .main-chat-view .workbench-expand')?.click()");
      await until(`document.querySelector(${JSON.stringify(panel + ' .user-bubble')}).getBoundingClientRect().right <= innerWidth && !document.querySelector('.workbench-clip.is-animating')`);
      await movePointer(panel + ' .user-bubble');
      await until(`${actions(panel)}.opacity === '1'`);
      assert.equal(await evaluate(`${actions(main)}.opacity`), '0');
      await movePointer(panel + ' .user-bubble', true);
      assert.equal(await evaluate(`${actions(panel)}.opacity`), '1');
      await movePointer(panel + ' .user-message-actions');
      assert.equal(await evaluate(`${actions(panel)}.pointerEvents`), 'auto');
      await capture('user-actions-hover');
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
      await until(`${actions(panel)}.opacity === '0'`);
      // 隐藏的按钮仍在 Tab 顺序里，键盘聚焦后整排显示。
      await evaluate(`document.querySelector(${JSON.stringify(panel + " .user-message-action[aria-label='复制消息']")}).focus()`);
      await until(`${actions(panel)}.opacity === '1'`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await until(`document.activeElement === document.querySelector(${JSON.stringify(panel + " .user-message-action[aria-label='修改消息']")})`);
      await evaluate("document.activeElement.blur()");
      await until(`${actions(panel)}.opacity === '0'`);
      await movePointer(main + ' .user-bubble');
      await until(`${actions(main)}.opacity === '1'`);
      assert.equal(await evaluate(`${actions(panel)}.opacity`), '0');
      await click(panel + " .user-message-action[aria-label='修改消息']");
      await until(`document.querySelector(${JSON.stringify(panel + ' .user-message-editor textarea')})`);
      await input(panel + " .user-message-editor textarea", "修改后的独立聊天");
      await click(panel + " .user-edit-submit");
      await until(`document.querySelector(${JSON.stringify(main)})?.textContent.includes('修改后的独立聊天')`);
      await until(`!document.querySelector(${JSON.stringify(main)})?.textContent.includes('第一条独立聊天')`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent.includes('独立回复只在右侧出现。')`), false);
      await evaluate("chatFixture.finish('panel-1')");
      await click(main + " .user-message-action[aria-label='修改消息']");
      await until(`document.querySelector(${JSON.stringify(main + ' .user-message-editor textarea')})`);
      await input(main + " .user-message-editor textarea", "从主区再次修改");
      await click(main + " .user-edit-submit");
      await until(`document.querySelector(${JSON.stringify(panel)})?.textContent.includes('从主区再次修改')`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent.includes('修改后的独立聊天')`), false);
      await evaluate("chatFixture.finish('panel-1'); chatFixture.changeMain()");
      // 方向键切换标签保留标准 tablist 语义。
      await evaluate(`document.getElementById(${JSON.stringify(first)}).dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))`);
      await until("document.activeElement.matches('.workbench-tab[aria-selected=true]')");
      assert.equal(await evaluate("document.querySelectorAll('.workbench-tab[aria-selected=true]').length"), 1);
      // 创建失败可重试，关闭待创建标签不会在请求完成后重新出现。
      await newTab(); await evaluate("chatFixture.failCreate = true"); await click(chatOption);
      await until("document.querySelector('.start-error')?.textContent === '新建对话失败'");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(chatOption)}).disabled`), false);
      await evaluate("chatFixture.failCreate = false; chatFixture.deferCreate = true"); await click(chatOption);
      await until("document.querySelector('.start-options[aria-busy=true]')");
      await click(".workbench-tab-close:last-child");
      await evaluate("chatFixture.releaseCreate()");
      await until("chatFixture.calls.filter(c => c.name === 'create').length === 4");
      await evaluate("new Promise(done => setTimeout(done, 200))");
      assert.equal(await evaluate("document.querySelectorAll('.panel-chat-view').length"), 2);
      assert.equal(await evaluate("chatFixture.calls.filter(c => c.name === 'abort').length"), 1);
      // 关闭已创建标签只移除视图，仍保留历史与另一条聊天。
      await click(".workbench-tab-close:first-child");
      await until("document.querySelectorAll('.panel-chat-view').length === 1");
      assert.equal(await evaluate("chatFixture.state().conversations.some(c => c.id === 'panel-1')"), true);
      await input(panel + " .rich-input", "关闭标签后继续运行"); await click(panel + " .send");
      await until("chatFixture.state('panel-2').session.status === 'streaming'");
      await click(".workbench-tab-close");
      await until("!document.querySelector('.workbench-panel')");
      assert.equal(await evaluate("chatFixture.state('panel-2').session.status"), "streaming");
      assert.equal(await evaluate("chatFixture.calls.filter(c => c.name === 'abort').length"), 1);
      // 最后一个入口在退出动画中完成创建，也不能重新打开面板。
      await newTab(); await click(chatOption);
      await until("document.querySelector('.start-options[aria-busy=true]')");
      await click(".workbench-tab-close");
      await evaluate("chatFixture.releaseCreate()");
      await until("!document.querySelector('.workbench-panel')");
      await evaluate("new Promise(done => setTimeout(done, 220))");
      assert.equal(await evaluate("document.querySelector('.workbench-panel') === null"), true);
      for (const [locale, label] of [["en", "New chat"], ["zh-TW", "新對話"], ["ja", "新しいチャット"], ["ko", "새 채팅"]]) {
        await win.loadFile(join(temporary, "index.html"), { query: { locale } });
        await until("document.querySelector('.main-chat-view')"); await newTab();
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(chatOption + ' .start-option-title')}).textContent`), label);
      }
      // The default combined picker shares the panel's choices and keeps both pages within the narrow pane.
      await win.loadFile(join(temporary, "index.html"));
      await until("document.querySelector('.chat-active-title')?.textContent === '主聊天'");
      await newTab(); await click(chatOption);
      await until(`document.querySelector(${JSON.stringify(panel + ' .combined-model-pill')})?.textContent.includes('Model One')`);
      await evaluate("document.documentElement.style.setProperty('--workbench-width', '360px'); document.documentElement.dataset.scheme = 'dark'; document.documentElement.dataset.theme = 'midnight'");
      const combinedPill = panel + " .combined-model-pill";
      const combinedPopover = panel + " .combined-model-popover";
      const openInterface = async () => {
        await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key:',', code:'Comma', metaKey:true }))");
        await until("document.querySelector('.settings-nav-item')");
        await evaluate("[...document.querySelectorAll('.settings-nav-item')].find(n => n.textContent === '界面').click()");
        await until("document.querySelector('[data-setting-id=\"info-layout\"]')");
      };
      await openInterface();
      assert.equal(await evaluate('document.querySelector(\'[data-setting-id="combined-model-picker"]\')'), null);
      await click(".nav-history-buttons button:first-child");
      await until("!document.querySelector('.settings-view')");
      await click(combinedPill);
      await until(`${thinkingValue} === '中'`);
      assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(panel + ' .model-choice-pill')}).length`), 1);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel + ' .thinking-model-label')}).textContent`), "Model One");
      await capture("combined-reasoning");
      await setThinkingSlider(1);
      await until("chatFixture.state('panel-1').session.thinkingLevel === 'low'");
      const motion = await evaluate(`(() => {
        const frame = window.openPickerPanel = document.querySelector(${JSON.stringify(combinedPopover)});
        frame.querySelector('.combined-thinking-heading').click();
        return new Promise(done => requestAnimationFrame(() => {
          const properties = ['height', 'transform'];
          const animated = [frame, frame.firstElementChild].flatMap((el, index) => el.getAnimations()
            .filter(animation => animation.effect.getKeyframes().some(keyframe => properties[index] in keyframe && !(animation instanceof CSSTransition))));
          if (${Boolean(process.env.VELA_WORKBENCH_CHAT_CAPTURE)}) {
            animated.forEach(animation => { animation.pause(); animation.currentTime = 65; });
          }
          done({ active: animated.length, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches });
        }));
      })()`);
      assert.equal(motion.active, motion.reduced ? 0 : 2);
      if (motion.active && process.env.VELA_WORKBENCH_CHAT_CAPTURE) {
        await capture("combined-transition");
        await evaluate("window.openPickerPanel.getAnimations({subtree:true}).filter(a => a.playState === 'paused').forEach(a => a.finish())");
      }
      await until(`document.querySelector(${JSON.stringify(combinedPopover + ' .menu-row[aria-current=true]')})?.textContent.includes('Model One')`);
      assert.equal(await evaluate(`window.openPickerPanel === document.querySelector(${JSON.stringify(combinedPopover)})`), true);
      assert.deepEqual(await evaluate(`Array.from(window.openPickerPanel.querySelectorAll('.menu-row'), n => n.textContent)`), ["Model One", "Model Two", "unnamed"]);
      assert.equal(await evaluate("window.openPickerPanel.querySelectorAll('input, .menu-footer-btn').length"), 0);
      await capture("combined-models");
      assert.equal(await evaluate(`(() => { const frame = document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect(); const popover = window.openPickerPanel.getBoundingClientRect(); return popover.left >= frame.left && popover.right <= frame.right; })()`), true);
      await click(panel + " .combined-model-back");
      await until(`${thinkingValue} === '低'`);
      await click(panel + " .combined-thinking-heading");
      await until(`document.activeElement === document.querySelector(${JSON.stringify(combinedPopover + ' .combined-model-back')})`);
      await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      await until(`${thinkingValue} === '低'`);
      await click(panel + " .combined-thinking-heading");
      await click(combinedPopover + " .menu-row:not([aria-current])");
      await until("chatFixture.state('panel-1').session.modelId === 'two'");
      await until(`document.querySelector(${JSON.stringify(combinedPopover + ' .thinking-model-label')})?.textContent === 'Model Two'`);
      assert.equal(await evaluate(`window.openPickerPanel === document.querySelector(${JSON.stringify(combinedPopover)})`), true);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(combinedPill)}).getAttribute('aria-expanded')`), "true");
      assert.equal(await evaluate(thinkingValue), "中");
      assert.match(await evaluate(`document.querySelector(${JSON.stringify(combinedPill)}).textContent`), /Model Two/);
      await setThinkingSlider(1);
      await until("chatFixture.state('panel-1').session.thinkingLevel === 'minimal'");
      await evaluate("localStorage.setItem('vela.combinedModelPicker', 'false')");
      await win.loadFile(join(temporary, "index.html"));
      await until(`document.querySelectorAll(${JSON.stringify(main + ' .model-choice-pill')}).length === 2`);
      await evaluate("localStorage.removeItem('vela.combinedModelPicker')");
      console.log("PASS combined picker adjusts effort, navigates to configured models, stays hidden in Settings, and honors config override to separate controls");
      await evaluate("localStorage.setItem('vela.workbenchSplit', 'true'); localStorage.setItem('vela.navLayout', JSON.stringify('rail'))");
      await win.loadFile(join(temporary, "index.html"));
      await until("document.querySelector('.main-chat-view')");
      await newTab();
      await newTab();
      await until("document.querySelectorAll('.workbench-tab').length === 2");
      await evaluate("document.querySelector('.workbench-tab[aria-selected=true]').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', altKey:true, shiftKey:true, bubbles:true}))");
      await until("document.querySelectorAll('.workbench-group').length === 2");
      await evaluate("document.querySelector('.workbench-split-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
      const groups = () => evaluate("({tabs: Array.from(document.querySelectorAll('.workbench-group'), g => [g.dataset.workbenchPane, g.querySelector('.workbench-tab').id]), ratio: document.querySelector('.workbench-split-handle').ariaValueNow})");
      const splitGroups = await groups();
      await click(".workbench-fullscreen-button");
      await until("document.querySelectorAll('.workbench-group').length === 1 && document.querySelectorAll('.workbench-tab').length === 2");
      win.setSize(900, 900);
      await until(`innerWidth <= 900 && ${fillsWorkspace}`);
      await until("document.querySelector('.workbench-fullscreen.nav-rail-layout.left-collapsed .nav-rail').clientWidth > 0");
      await click(expandSidebar);
      await until(sidebarUsable);
      await click(".workbench-pinned-chat");
      win.setContentSize(1280, 840);
      await evaluate(`(async () => {
        await window.vela.prompt("长表格");
        const rows = Array.from({length: 48}, (_, i) => "| Item " + i + " | " + i + " |");
        chatFixture.emit({type:"text_delta", conversationId:"main-chat", delta:["", "", "| Item | Value |", "| --- | --- |", ...rows, "", "End of table"].join("\\n")});
      })()`);
      const pinned = ".showing-pinned-chat > .main-chat-view";
      await until(`document.querySelector(${JSON.stringify(pinned + " table")})?.rows.length >= 48`);
      const composerLayout = await evaluate(`(() => {
        const chat = document.querySelector(${JSON.stringify(pinned)});
        const scroll = chat.querySelector(".chat-scroll-area");
        return { composerBottom: chat.querySelector(".floating-input-card").getBoundingClientRect().bottom,
          viewportBottom: innerHeight, scrollable: scroll.scrollHeight > scroll.clientHeight };
      })()`);
      assert.ok(composerLayout.composerBottom <= composerLayout.viewportBottom && composerLayout.scrollable, JSON.stringify(composerLayout));
      await capture("fullscreen-chat-long-table");
      await click(".workbench-restore");
      await until("document.querySelectorAll('.workbench-group').length === 2");
      assert.deepEqual(await groups(), splitGroups);
      await click(".workbench-fullscreen-button");
      await until(`document.querySelector('${expandedFloat} table')?.rows.length >= 48`);
      await checkSettingsResize();
      await click(".floating-composer-options");
      await checkContextUsage();
      await click(".floating-composer-options");
      assert.ok(await evaluate(`(() => {
        const chat = document.querySelector('${expandedFloat}'), scroll = chat.querySelector(".chat-scroll-area");
        return scroll.scrollHeight > scroll.clientHeight && scroll.getBoundingClientRect().bottom <= chat.querySelector(".rich-input").getBoundingClientRect().top;
      })()`));
      await evaluate("chatFixture.finish('main-chat')");
      await checkCollapsed();
      await doubleClickHeader();
      await evaluate("chatFixture.changeMain()");
      await until("document.querySelector('.floating-chat-header .chat-active-title')?.textContent === '另一条主聊天'");
      await checkCollapsed();
      await click(".workbench-tab-close");
      await until("document.querySelectorAll('.workbench-tab').length === 1");
      await click(".workbench-tab-close");
      await until("!document.querySelector('.workbench-panel') && !document.querySelector('.workbench-fullscreen') && document.querySelector('.main-chat-view').clientWidth > 0");
      console.log("PASS workbench fullscreen, pinned chat, numbered shortcuts, draft retention, split restoration and last-tab close");
      assert.equal(errors.length, 0, errors.join("\n"));
      console.log("PASS chat creation, isolated streams/controls, shared rewind history, retained drafts, keyboard tabs, failure/retry and close races");
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(await evaluate("JSON.stringify({titles: [...document.querySelectorAll('.chat-active-title')].map(el => el.textContent), main: document.querySelector('.main-stage-pane')?.className, text: document.body.textContent.slice(-1800)})"));
      await capture("failure"); win.destroy(); app.exit(1);
    }
  });
}
