/** 独立 Electron 夹具:node apps/desktop/test/changes-filter-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-changes-filter-"));
  try {
    const { build } = await import("esbuild");
    await build({ entryPoints: [join(here, "changes-preview.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>body{margin:0}#root{display:flex;padding:16px}.fixture{width:900px;display:flex}</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_CHANGES_FILTER_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 55000);
    try { assert.equal(await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); }), 0); }
    finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_CHANGES_FILTER_TEMP;
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error" || event.level >= 3) errors.push(event.message); });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const until = async code => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
    throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = key => evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)},bubbles:true}))`);
  const choose = async label => {
    await click(".changes-filter-trigger");
    await until("document.querySelector('.changes-filter-menu')");
    await evaluate(`[...document.querySelectorAll('.changes-filter-item')].find(item=>item.textContent.trim()===${JSON.stringify(label)}).click()`);
  };
  const paths = () => evaluate("[...document.querySelectorAll('.turn-review-file-header strong')].map(el=>el.textContent)");
  const assertStripedGaps = async () => {
    const gaps = await evaluate(`Array.from(document.querySelectorAll('.turn-review-view .diff-split-empty'), el => {
      const rect = el.getBoundingClientRect();
      const row = el.parentElement.getBoundingClientRect();
      return { side: el === el.parentElement.firstElementChild ? 'left' : 'right',
        striped: getComputedStyle(el, '::before').backgroundImage.includes('linear-gradient(') &&
          getComputedStyle(el, '::before').backgroundSize.startsWith('16px 16px'),
        sharedOrigin: getComputedStyle(el).clipPath === 'inset(0px)' &&
          Math.abs(parseFloat(getComputedStyle(el, '::before').height) - el.closest('.diff-split').clientHeight) < 1,
        fillsRow: rect.width > 0 && rect.height > 0 && Math.abs(rect.height - row.height) < 1,
        decorative: el.getAttribute('aria-hidden') === 'true' && el.textContent === '' };
    })`);
    assert.ok(gaps.some(gap => gap.side === 'left'), "Added lines leave striped gaps on the left");
    assert.ok(gaps.some(gap => gap.side === 'right'), "Deleted lines leave striped gaps on the right");
    assert.ok(gaps.every(gap => gap.striped && gap.sharedOrigin && gap.fillsRow && gap.decorative), "Stripes share the diff origin and fill every gap without adding readable content");
    assert.equal(await evaluate("[...document.querySelectorAll('.turn-review-view .diff-line.add, .turn-review-view .diff-line.del, .turn-review-view .diff-line.ctx')].every(el => !getComputedStyle(el).backgroundImage.includes('linear-gradient('))"), true, "Actual code lines, including blank lines, are not striped");
    assert.equal(await evaluate("document.querySelectorAll('.turn-review-view .diff-split-single .diff-split-empty').length"), 0, "New files keep full-width content without artificial gaps");
  };
  // 把逐行裁切的实际截图与一次绘制的整块纹理比较，捕捉接缝处的相位重置。
  const assertSeamlessGaps = async () => {
    await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 180))))");
    const rect = await evaluate(`(() => {
      const first = document.querySelector('.turn-review-view .diff-split-empty:first-child');
      let last = first;
      while (last.parentElement.nextElementSibling?.firstElementChild?.classList.contains('diff-split-empty')) {
        last = last.parentElement.nextElementSibling.firstElementChild;
      }
      const a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
      if (first === last) throw new Error('Fixture needs adjacent gaps');
      return { x: Math.ceil(a.left) + 2, y: Math.ceil(a.top) + 2,
        width: Math.floor(a.width) - 4, height: Math.floor(b.bottom - a.top) - 4 };
    })()`);
    const actual = (await win.webContents.capturePage(rect)).toBitmap();
    await evaluate(`(() => {
      const first = document.querySelector('.turn-review-view .diff-split-empty:first-child');
      let last = first;
      while (last.parentElement.nextElementSibling?.firstElementChild?.classList.contains('diff-split-empty')) {
        last = last.parentElement.nextElementSibling.firstElementChild;
      }
      const body = first.closest('.diff-split');
      const p = body.getBoundingClientRect(), a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
      const zoom = p.width / body.offsetWidth;
      const reference = document.createElement('span');
      reference.id = 'stripe-reference';
      Object.assign(reference.style, { position: 'absolute', inset: '0', pointerEvents: 'none',
        background: getComputedStyle(first, '::before').background,
        clipPath: 'inset(' + [(a.top-p.top)/zoom, (p.right-a.right)/zoom, (p.bottom-b.bottom)/zoom, (a.left-p.left)/zoom].map(n => n+'px').join(' ') + ')' });
      body.append(reference);
    })()`);
    try {
      const reference = (await win.webContents.capturePage(rect)).toBitmap();
      assert.equal(actual.length, reference.length);
      const error = actual.reduce((sum, value, index) => sum + Math.abs(value - reference[index]), 0) / actual.length;
      assert.ok(error < 1, `Adjacent gaps must match one continuous texture (pixel error ${error.toFixed(3)})`);
    } finally { await evaluate("document.getElementById('stripe-reference').remove()"); }
  };
  // 比较相隔一个纹理周期的实际像素：每条斜线都应具有相同的宽度、亮度与间距。
  const assertUniformStripes = async () => {
    await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    const { rect, zoom } = await evaluate(`(() => {
      const gap = document.querySelector('.turn-review-view .diff-split-empty:first-child').getBoundingClientRect();
      return { rect: { x: Math.ceil(gap.left) + 4, y: Math.ceil(gap.top) + 3,
        width: Math.floor(gap.width) - 8, height: Math.min(12, Math.floor(gap.height) - 6) },
        zoom: parseFloat(getComputedStyle(document.body).zoom) || 1 };
    })()`);
    const image = await win.webContents.capturePage(rect);
    const { width, height } = image.getSize();
    const pixels = image.toBitmap();
    assert.equal(pixels.length, width * height * 4);
    const period = Math.round(16 * zoom * width / rect.width);
    let error = 0, samples = 0, min = 255, max = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - period; x++) {
        const at = (y * width + x) * 4;
        min = Math.min(min, pixels[at]); max = Math.max(max, pixels[at]);
        for (let channel = 0; channel < 3; channel++) {
          error += Math.abs(pixels[at + channel] - pixels[at + period * 4 + channel]); samples++;
        }
      }
    }
    assert.ok(max - min > 5, "Stripe sample contains visible lines, not a flat background");
    assert.ok(error / samples < 0.6, `Stripe weights and spacing must repeat uniformly (pixel error ${(error / samples).toFixed(3)}, zoom ${zoom})`);
    assert.ok(max - min <= 18, `Stripe contrast stays subtle (channel range ${max - min})`);
  };
  const capture = async name => {
    if (!process.env.VELA_CHANGES_FILTER_CAPTURE) return;
    mkdirSync(process.env.VELA_CHANGES_FILTER_CAPTURE, { recursive: true });
    await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 100))))");
    writeFileSync(join(process.env.VELA_CHANGES_FILTER_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(join(temporary, "index.html"));
    await until("document.querySelectorAll('.turn-review-file').length===3");
    assert.equal(await evaluate("document.querySelector('.changes-filter-trigger').textContent.trim()"), "未提交");
    assert.equal(await evaluate("document.querySelectorAll('.turn-review-file:first-child .turn-review-edit').length"), 2);
    assert.ok(await evaluate("document.querySelectorAll('.turn-review-view .diff-line.hunk').length > 0"), "Fixture includes Git hunk headers");
    assert.equal(await evaluate("[...document.querySelectorAll('.turn-review-view .diff-line.hunk')].every(el => getComputedStyle(el).display === 'none' && el.getBoundingClientRect().height === 0)"), true, "Hunk headers take no space in changes review");
    assert.equal(await evaluate("document.querySelector('.turn-review-view .diff-line-number').textContent"), "12", "Original file line numbers remain intact");
    assert.equal(await evaluate("document.querySelectorAll('.turn-review-side-labels span').length > 0 && document.querySelectorAll('.turn-review-view .diff-line.add').length > 0 && document.querySelectorAll('.turn-review-view .diff-line.del').length > 0"), true, "Before/after labels and diff content remain visible");
    await assertStripedGaps();
    await assertSeamlessGaps();
    await assertUniformStripes();
    // 负向对照：旧的斜向 5px 渐变必须被均匀度检查拒绝。
    await evaluate(`(() => {
      const style = document.createElement('style'); style.id = 'stripe-period-reset';
      style.textContent = '.turn-review-view .diff-split-empty::before { background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--text-muted) 22%, transparent) 4px 5px), var(--bg-surface-subtle) !important; }';
      document.head.append(style);
    })()`);
    try { await assert.rejects(assertUniformStripes, /Stripe weights and spacing must repeat uniformly/); }
    finally { await evaluate("document.getElementById('stripe-period-reset').remove()"); }
    // 负向对照：恢复逐行纹理时，像素检查必须确实能发现断缝。
    await evaluate(`(() => {
      document.querySelectorAll('.diff-split-empty').forEach(el => { el.style.background = getComputedStyle(el, '::before').background; });
      const style = document.createElement('style'); style.id = 'stripe-reset';
      style.textContent = '.turn-review-view .diff-split-empty::before { content: none !important; }';
      document.head.append(style);
    })()`);
    try { await assert.rejects(assertSeamlessGaps, /Adjacent gaps must match one continuous texture/); }
    finally { await evaluate("document.getElementById('stripe-reset').remove(); document.querySelectorAll('.diff-split-empty').forEach(el => el.style.removeProperty('background'))"); }
    await evaluate("document.querySelector('.turn-review-scroll').scrollTop = 17.5");
    await assertSeamlessGaps();
    await assertUniformStripes();
    await evaluate("document.querySelector('.turn-review-scroll').scrollTop = 0");
    await capture("striped-gaps-light");
    await click(".changes-filter-trigger");
    await until("document.querySelector('.changes-filter-menu')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.changes-filter-item')].map(el=>el.textContent.trim())"), ["上一轮", "未提交", "未暂存", "已暂存", "已提交", "分支"]);
    await capture("menu-light");
    await key("End");
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "分支");
    await key("Home");
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "上一轮");
    await key("Escape");
    assert.equal(await evaluate("changesFixture.closed"), 0);
    assert.equal(await evaluate("document.activeElement.className"), "changes-filter-trigger");
    await choose("未暂存");
    await until("document.querySelectorAll('.turn-review-file').length===2");
    assert.deepEqual(await paths(), ["README.md", "apps/desktop/test/new.test.ts"]);
    await choose("已暂存");
    await until("document.querySelector('.turn-review-file:nth-child(2) strong')?.textContent==='apps/desktop/src/index.ts'");
    assert.deepEqual(await paths(), ["README.md", "apps/desktop/src/index.ts"]);
    assert.equal(await evaluate("document.querySelectorAll('.turn-review-file:first-child .turn-review-edit').length"), 1);
    await choose("上一轮");
    await until("document.querySelector('.turn-review-file-header strong')?.textContent==='last-turn.ts'");
    await choose("已提交");
    await until("document.querySelector('.changes-filter-commit')");
    await capture("commits-light");
    await click(".changes-filter-options button:nth-child(2)");
    await until("changesFixture.commitSha==='def5678' && document.querySelector('.turn-review-file-header strong')?.textContent==='README.md'");
    await choose("分支");
    await until("document.querySelector('.changes-filter-options button')");
    await click(".changes-filter-options button");
    await until("changesFixture.comparison[0]==='feature/menu' && document.querySelector('.turn-review-file-header strong')?.textContent==='apps/desktop/src/index.ts'");
    assert.deepEqual(await evaluate("changesFixture.comparison"), ["feature/menu", "HEAD"]);
    // 失败反馈与重试。
    await evaluate("changesFixture.failDiff=true");
    await choose("未提交");
    await until("document.querySelector('.changes-filter-retry')");
    await evaluate("changesFixture.failDiff=false");
    await click(".changes-filter-retry");
    await until("document.querySelectorAll('.turn-review-file').length===3");
    // 点击外部关闭。
    await click(".changes-filter-trigger");
    await evaluate("document.querySelector('.turn-review-count').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    await until("!document.querySelector('.changes-filter-menu')");
    // 窄面板和暗色主题。
    await evaluate("document.querySelector('.fixture').style.width='380px';document.documentElement.dataset.scheme='dark'");
    await until("document.querySelector('.turn-review-view.is-compact')");
    await assertStripedGaps();
    assert.equal(await evaluate("[...document.querySelectorAll('.turn-review-view .diff-split-empty:last-child')].some(el => el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) * 2)"), true, "Deletion gaps fill the height of wrapped code");
    await assertSeamlessGaps();
    await assertUniformStripes();
    await capture("striped-gaps-dark-compact");
    assert.equal(await evaluate("[...document.querySelectorAll('.turn-review-view .diff-line.hunk')].every(el => getComputedStyle(el).display === 'none' && el.getBoundingClientRect().height === 0)"), true, "Hunk headers stay hidden in narrow/dark review");
    await click(".changes-filter-trigger");
    await until("document.querySelector('.changes-filter-menu')");
    assert.equal(await evaluate("document.querySelector('.changes-filter-menu').getBoundingClientRect().right <= document.querySelector('.fixture').getBoundingClientRect().right"), true);
    await capture("menu-dark-compact");
    await key("Escape");
    await until("!document.querySelector('.changes-filter-menu')");
    for (const zoom of [1.25, 1.5, 2]) {
      await evaluate(`document.body.style.zoom='${zoom}'`);
      await assertStripedGaps();
      await assertSeamlessGaps();
      await assertUniformStripes();
    }
    assert.equal(await evaluate("document.querySelector('.changes-filter-trigger').scrollWidth <= document.querySelector('.changes-filter-trigger').clientWidth+1"), true);
    await capture("menu-dark-zoom");
    assert.deepEqual(errors, []);
    console.log("Changes filter UI passed: six categories, mixed staging, commits, branch comparison, keyboard, dismissal, retry, uniform seamless striped addition/deletion gaps (pixel regressions + negative controls), wrapped rows, scrolling, narrow/dark/zoom.");
  } catch (error) { console.error(error); app.exit(1); }
  finally { win.destroy(); }
  app.exit(0);
  });
}
