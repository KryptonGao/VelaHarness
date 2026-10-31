/** Real-Electron checks for Intelligent UI: node apps/desktop/test/intelligent-ui-ui.mjs */
import { readStyles } from "./read-styles.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));

const nd = lines => lines.join("\n");
const fence = lines => `\`\`\`vela-ui\n${nd(lines)}\n\`\`\``;
const billSplit = [
  '{"op":"begin","id":"split","version":1,"title":"账单平摊"}',
  '{"op":"state","name":"amount","kind":"number","initial":240,"min":0}',
  '{"op":"state","name":"people","kind":"number","initial":5,"min":1}',
  '{"op":"node","id":"root","type":"column","props":{}}',
  '{"op":"node","id":"a","parent":"root","type":"number_input","props":{"label":"总额","unit":"元","bind":"amount"}}',
  '{"op":"node","id":"p","parent":"root","type":"number_input","props":{"label":"人数","bind":"people"}}',
  '{"op":"node","id":"t","parent":"root","type":"stat","props":{"label":"每人金额","unit":"元","digits":2,"derive":{"op":"round","args":[{"op":"divide","args":[{"ref":"amount"},{"ref":"people"}]},2]}}}',
  '{"op":"node","id":"go","parent":"root","type":"button","props":{"label":"按这个人数继续","variant":"primary","action":{"type":"submit_to_agent","text":"按当前人数继续规划","include":["people"]}}}',
  '{"op":"commit"}',
];
const compare = [
  '{"op":"begin","id":"cmp","version":1,"title":"模型比较"}',
  '{"op":"state","name":"tier","kind":"string","initial":"all","options":["all","fast","cheap"]}',
  '{"op":"node","id":"root","type":"column","props":{}}',
  '{"op":"node","id":"seg","parent":"root","type":"segmented","props":{"bind":"tier","label":"类型","options":[{"value":"all","label":"全部"},{"value":"fast","label":"快"},{"value":"cheap","label":"便宜"}]}}',
  '{"op":"node","id":"tbl","parent":"root","type":"table","props":{"caption":"费用与速度","searchable":true,"filter":{"bind":"tier","column":"tier","allValue":"all"},"columns":[{"key":"name","label":"模型"},{"key":"tier","label":"类型"},{"key":"price","label":"价格","align":"right","sortable":true,"prefix":"$","digits":2},{"key":"speed","label":"速度","align":"right","sortable":true,"unit":"t/s"}],"rows":[{"name":"Alpha","tier":"fast","price":15,"speed":120,"detail":"**适合**交互场景"},{"name":"Beta","tier":"cheap","price":1.5,"speed":60},{"name":"Gamma","tier":"cheap","price":0.5,"speed":30,"detail":"批处理"}],"source":{"label":"厂商定价页","url":"https://example.com/pricing"}}}',
  '{"op":"commit"}',
];
const hostile = [
  '{"op":"begin","id":"evil","version":1}',
  '{"op":"node","id":"root","type":"column","props":{}}',
  '{"op":"node","id":"x","parent":"root","type":"text","props":{"text":"<img src=x onerror=\\"window.__pwned=1\\"><script>window.__pwned=2</script> [点我](javascript:window.__pwned=3) **粗体**"}}',
  '{"op":"node","id":"y","parent":"root","type":"iframe","props":{"src":"https://evil.example"}}',
  '{"op":"node","id":"z","parent":"root","type":"button","props":{"label":"危险","action":{"type":"open_external","url":"javascript:window.__pwned=4"}}}',
  '{"op":"node","id":"ok","parent":"root","type":"text","props":{"text":"其余内容仍然显示"}}',
  '{"op":"commit"}',
];

const charts = [
  '{"op":"begin","id":"charts","version":1,"title":"图表"}',
  '{"op":"state","name":"budget","kind":"number","initial":40,"min":0,"max":100,"step":1}',
  '{"op":"state","name":"pick","kind":"string","initial":"a","options":["a","b"]}',
  '{"op":"node","id":"root","type":"column","props":{}}',
  '{"op":"node","id":"bar","parent":"root","type":"bar_chart","props":{"title":"季度收入","unit":"万","labels":["Q1","Q2","Q3"],"series":[{"key":"a","label":"产品A","values":[10,20,30]},{"key":"b","label":"产品B","values":[5,{"ref":"budget"},15]}],"draggable":true}}',
  '{"op":"node","id":"val","parent":"root","type":"number_input","props":{"label":"预算","bind":"budget"}}',
  '{"op":"node","id":"pie","parent":"root","type":"pie_chart","props":{"title":"占比","donut":true,"slices":[{"label":"甲","value":60},{"label":"乙","value":30},{"label":"丙","value":10}]}}',
  '{"op":"node","id":"dg","parent":"root","type":"svg_diagram","props":{"title":"结构示意图","description":"两个部件","bind":"pick","width":300,"height":140,"shapes":[{"type":"rect","x":10,"y":20,"w":120,"h":80,"fill":"surface","stroke":"accent"},{"type":"text","x":70,"y":65,"text":"A","anchor":"middle"},{"type":"circle","cx":220,"cy":60,"r":40,"fill":"accent"}],"hotspots":[{"id":"ha","label":"部件A","value":"a","shape":"rect","x":10,"y":20,"w":120,"h":80},{"id":"hb","label":"部件B","description":"右边的圆","value":"b","shape":"circle","cx":220,"cy":60,"r":40}]}}',
  '{"op":"node","id":"sel","parent":"root","type":"text","props":{"text":{"ref":"pick"}}}',
  '{"op":"commit"}',
];
const sources = [
  '{"op":"begin","id":"src","version":1,"title":"项目文件"}',
  '{"op":"source","name":"files","tool":"bash","match":"git ls-files","format":"json","path":["items"]}',
  '{"op":"source","name":"total","tool":"bash","match":"git ls-files","format":"json","path":["count"]}',
  '{"op":"node","id":"root","type":"column","props":{}}',
  '{"op":"node","id":"st","parent":"root","type":"stat","props":{"label":"文件数","from":"total"}}',
  '{"op":"node","id":"tb","parent":"root","type":"table","props":{"caption":"文件","from":"files","columns":[{"key":"name","label":"名称"},{"key":"size","label":"大小","align":"right"}]}}',
  '{"op":"node","id":"ch","parent":"root","type":"bar_chart","props":{"title":"大小","from":"files","x":"name","y":["size"]}}',
  '{"op":"node","id":"rf","parent":"root","type":"button","props":{"label":"刷新数据","action":{"type":"refresh_source","name":"files"}}}',
  '{"op":"node","id":"rt","parent":"root","type":"button","props":{"label":"建议运行测试","action":{"type":"request_tool","tool":"bash","summary":"运行测试","args":{"command":"pnpm test"}}}}',
  '{"op":"commit"}',
];
const rich = [
  '{"op":"begin","id":"rich","version":1,"title":"丰富视图"}',
  '{"op":"node","id":"root","type":"column","props":{}}',
  '{"op":"node","id":"tl","parent":"root","type":"timeline","props":{"title":"发布计划","items":[{"date":"周一","title":"冻结代码","status":"done"},{"date":"周三","title":"回归测试","detail":"**重点**看更新器","status":"current"},{"title":"发布","status":"upcoming"}]}}',
  '{"op":"node","id":"df","parent":"root","type":"diff_view","props":{"fileName":"a.ts","diff":"--- a/a.ts\\n+++ b/a.ts\\n@@ -1,3 +1,3 @@\\n keep\\n-old\\n+new\\n tail"}}',
  '{"op":"node","id":"it","parent":"root","type":"itinerary","props":{"title":"周末行程","days":[{"label":"第一天","stops":[{"name":"咖啡馆","time":"09:00","lat":31.23,"lng":121.47},{"name":"博物馆","time":"11:00","note":"只有名称，没有坐标"},{"name":"公园","lat":31.2,"lng":121.5}]}]}}',
  '{"op":"node","id":"md","parent":"root","type":"media","props":{"kind":"map","alt":"路线图","caption":"示意"}}',
  '{"op":"commit"}',
];
const appHeader = '{"op":"app","id":"probe","version":1,"title":"探针","height":200}';
const probeApp = [appHeader, "<div id=o>probe</div>", `<script>
const r = {};
try { r.parent = typeof parent.document.title; } catch (e) { r.parent = e.name; }
try { r.storage = typeof localStorage; } catch (e) { r.storage = e.name; }
try { r.cookie = typeof document.cookie; } catch (e) { r.cookie = e.name; }
r.require = typeof require; r.process = typeof process; r.rtc = typeof RTCPeerConnection; r.electron = typeof window.electron;
r.velaKeys = Object.keys(window.vela).sort().join();
fetch('https://example.com/x').then(() => { r.fetch = 'ok'; }, () => { r.fetch = 'blocked'; });
try { const ws = new WebSocket('wss://example.com'); ws.onopen = () => { r.ws = 'open'; }; ws.onerror = () => { r.ws = 'blocked'; }; } catch (e) { r.ws = e.name; }
const img = new Image(); img.onload = () => { r.img = 'loaded'; }; img.onerror = () => { r.img = 'blocked'; }; img.src = 'https://example.com/x.png';
try { r.open = String(window.open('https://example.com')); } catch (e) { r.open = e.name; }
try { top.location = 'https://example.com/'; } catch (e) { r.top = e.name; }
try { location.href = 'https://example.com/nav'; } catch (e) { r.nav = e.name; }
setTimeout(() => { window.__r = r; document.getElementById('o').textContent = 'done'; }, 800);
</script>`];
const talkApp = [appHeader.replace('"probe"', '"talk"'), "<button id=a>a</button><script>window.__log = []; window.__ask = (kind, text) => { window.vela[kind](text).then(() => window.__log.push(kind + ':ok'), e => window.__log.push(kind + ':' + e.message)); };</script>"];

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-intelligent-ui-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { AssistantMarkdown } from './apps/desktop/src/renderer/components/intelligent-ui/AssistantMarkdown';
          import { UiHostProvider } from './apps/desktop/src/renderer/components/intelligent-ui/UiRuntime';
          import { publishIntelligentUiState } from './apps/desktop/src/renderer/components/intelligent-ui/ui-settings-store';
          import { setUiInspectorEnabled, uiMetrics } from './apps/desktop/src/renderer/components/intelligent-ui/ui-metrics-instance';
          import { svgToPngBlob } from './apps/desktop/src/renderer/components/intelligent-ui/image-export';
          import { setActiveLocale } from './apps/desktop/src/renderer/locale';
          import { SandboxCapabilityBroker } from '@vela/shared';
          setActiveLocale('zh-CN');
          window.submitted = [];
          window.toolCalls = [];
          window.__broker = new SandboxCapabilityBroker({ token: () => crypto.randomUUID() });
          window.setMicroApps = enabled => { window.__microApps = enabled; publishIntelligentUiState({ preference: 'auto', microApps: enabled }); };
          window.setInspector = setUiInspectorEnabled;
          window.metrics = () => uiMetrics.summary();
          window.pngOf = async selector => {
            const blob = await svgToPngBlob(document.querySelector(selector));
            if (!blob) return null;
            const bytes = new Uint8Array(await blob.arrayBuffer());
            return { type: blob.type, size: blob.size, magic: Array.from(bytes.slice(1, 4)).map(b => String.fromCharCode(b)).join('') };
          };
          const root = createRoot(document.getElementById('root'));
          window.renderMessage = (text, { streaming = false, conversationId = 'c1', ordinal = 'u0', busy = false, canSubmit = true } = {}) => root.render(
            <UiHostProvider value={{ conversationId, stableMessageId: () => ordinal, canSubmit, agentBusy: busy,
              submit: async text => { window.submitted.push(text); }, openLink: () => false, toolCalls: () => window.toolCalls }}>
              <div className="agent-reply-prose" style={{ maxWidth: 640 }}><AssistantMarkdown messageId="m1" text={text} streaming={streaming} /></div>
            </UiHostProvider>);
          window.unmount = () => root.render(null);
        `,
        resolveDir: resolve(here, "../../.."), loader: "tsx",
      },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      alias: { "@vela/shared": resolve(here, "../../../packages/shared/src/index.ts") },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
    });
    await build({
      entryPoints: [resolve(here, "../src/main/ui-sandbox-guard.ts")], bundle: true, platform: "node", format: "cjs", outfile: join(temporary, "guard.cjs"),
    });
    writeFileSync(join(temporary, "fixtures.json"), JSON.stringify({ billSplit, compare, hostile, charts, sources, rich, probeApp, talkApp }));
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><script>' +
      "window.vela = { getIntelligentUi: async () => ({ preference: 'auto', microApps: window.__microApps === true }), " +
      "uiSandboxIssue: (key, capability, size) => Promise.resolve(window.__broker.issue(key, capability, size)), " +
      "uiSandboxRedeem: (token, key, capability, size) => Promise.resolve({ ok: window.__broker.redeem(token, key, capability, size).ok }), " +
      "uiSandboxRevoke: key => Promise.resolve(window.__broker.revoke(key)) };" +
      '</script><style>' +
      readStyles(join(here, "../src/renderer/styles.css")) + readFileSync(join(here, "../src/renderer/components/intelligent-ui/intelligent-ui.css"), "utf8") +
      '</style></head><body><div id="root" style="padding:16px"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_IUI_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Intelligent UI interaction checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temp = process.env.VELA_IUI_TEMP;
  app.setPath("userData", join(temp, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 760, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    // 与 main/index.ts 相同的子框架导航守卫（真实实现，单独打包进来），外加网络「绊线」：任何 http(s)/ws 请求都会被取消并记录。
    const { allowSubframeNavigation } = createRequire(import.meta.url)(join(temp, "guard.cjs"));
    const blockedNavigations = [];
    const networkRequests = [];
    win.webContents.on("will-frame-navigate", event => {
      if (allowSubframeNavigation(event.url, event.isMainFrame)) return;
      event.preventDefault(); blockedNavigations.push(event.url);
    });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
      networkRequests.push(details.url); callback({ cancel: true });
    });
    try {
      await win.loadFile(join(temp, "index.html"));
      const fixtures = JSON.parse(readFileSync(join(temp, "fixtures.json"), "utf8"));
      const fence = lines => "```vela-ui\n" + lines.join("\n") + "\n```";
      const evaluate = async code => {
        try { return await win.webContents.executeJavaScript(code); }
        catch (error) { console.error(`Renderer check failed: ${code}`); throw error; }
      };
      const frame = () => new Promise(done => setTimeout(done, 60));
      const until = async code => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (await evaluate(code)) return;
          await new Promise(done => setTimeout(done, 20));
        }
        throw new Error(`Timed out: ${code}`);
      };
      const render = async (text, options = {}) => { await evaluate(`window.renderMessage(${JSON.stringify(text)}, ${JSON.stringify(options)})`); await frame(); };
      const capture = async name => {
        if (!process.env.VELA_IUI_CAPTURE) return;
        mkdirSync(process.env.VELA_IUI_CAPTURE, { recursive: true });
        writeFileSync(join(process.env.VELA_IUI_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      };
      const typeInto = (label, value) => evaluate(`(() => {
        const input = Array.from(document.querySelectorAll('.iui-field, .iui-table-tools')).find(field => field.querySelector('.iui-label').textContent === ${JSON.stringify(label)}).querySelector('input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const stat = () => evaluate("document.querySelector('.iui-stat-value').textContent.trim()");
      const clickText = (selector, text) => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`);

      // 1. Plain answers do not grow a card.
      await render("只需要一句命令：`pnpm test`");
      assert.equal(await evaluate("document.querySelectorAll('.iui-frame').length"), 0);

      // 2. Markdown → UI → Markdown, streamed in odd chunks; validated nodes appear before commit.
      const text = `先看结果。\n\n${fence(fixtures.billSplit)}\n\n每人 48 元。`;
      const cut = text.indexOf('"id":"p"') + 12;
      await render(text.slice(0, cut), { streaming: true });
      assert.equal(await evaluate("document.querySelectorAll('.iui-frame').length"), 1);
      assert.equal(await evaluate("document.querySelector('.iui-frame').getAttribute('aria-busy')"), "true");
      assert.equal(await evaluate("document.querySelectorAll('.iui-number').length"), 1, "first input visible before the block is complete");
      await render(text.slice(0, text.indexOf('{"op":"commit"}')), { streaming: true });
      assert.equal(await evaluate("document.querySelectorAll('.iui-number').length"), 2);
      assert.equal(await stat(), "48.00 元", "derived value computes before commit");
      // The user starts editing while the model is still writing.
      await typeInto("人数", "8");
      assert.equal(await stat(), "30.00 元");
      await evaluate("document.querySelectorAll('.iui-number')[1].focus()");
      await render(text, { streaming: true });
      await render(text, { streaming: false });
      assert.equal(await evaluate("document.querySelectorAll('.iui-number')[1].value"), "8", "input is not reset by commit");
      assert.equal(await evaluate("document.activeElement === document.querySelectorAll('.iui-number')[1]"), true, "focus is not stolen or lost");
      assert.equal(await stat(), "30.00 元");
      assert.deepEqual(await evaluate("Array.from(document.querySelector('.agent-reply-prose').children).map(el => el.className.includes('iui-frame') ? 'ui' : 'md')"), ["md", "ui", "md"]);
      await capture("calculator-light");

      // 3. Invalid input becomes a readable message, never Infinity or a crash.
      await typeInto("人数", "0");
      assert.match(await stat(), /请先修正输入/);
      assert.equal(await evaluate("document.querySelector('.iui-field-error').textContent.includes('不能小于 1')"), true);
      assert.equal(await evaluate("document.querySelectorAll('.iui-number')[1].getAttribute('aria-invalid')"), "true");
      assert.equal(await evaluate("!document.body.textContent.includes('Infinity')"), true);
      await typeInto("人数", "");
      assert.match(await stat(), /请先修正输入/);
      await typeInto("人数", "5");
      assert.equal(await stat(), "48.00 元");
      await typeInto("总额", "100"); await typeInto("人数", "3");
      assert.equal(await stat(), "33.33 元");

      // 4. Submitting needs an explicit click + confirmation; local edits never send anything.
      assert.deepEqual(await evaluate("window.submitted"), []);
      await clickText(".iui-button", "按这个人数继续");
      assert.equal(await evaluate("document.querySelector('.iui-confirm-text').textContent.includes('人数 (people): 3')"), true);
      assert.equal(await evaluate("document.querySelector('.iui-confirm-text').textContent.includes('总额')"), false, "include limits the snapshot");
      assert.deepEqual(await evaluate("window.submitted"), []);
      await clickText(".iui-confirm .iui-button", "取消");
      assert.equal(await evaluate("document.querySelector('.iui-confirm')"), null);
      await clickText(".iui-button", "按这个人数继续"); await clickText(".iui-confirm .iui-button", "发送");
      assert.equal(await evaluate("window.submitted.length"), 1);
      assert.match(await evaluate("window.submitted[0]"), /^按当前人数继续规划\n\nCurrent parameters \[账单平摊\]:\n- 人数 \(people\): 3$/);

      // 5. Persistence: remount at the same stable position restores the edits; a different conversation does not.
      await evaluate("window.unmount()"); await frame();
      await new Promise(done => setTimeout(done, 500));
      await render(text);
      assert.equal(await evaluate("document.querySelectorAll('.iui-number')[1].value"), "3");
      assert.equal(await evaluate("document.querySelectorAll('.iui-number')[0].value"), "100");
      await render(text, { conversationId: "c2" });
      assert.equal(await evaluate("document.querySelectorAll('.iui-number')[1].value"), "5");
      // Same position but the definition was rewritten (edit & resend): the old snapshot is discarded.
      await render(text.replace('"initial":240', '"initial":999'), { conversationId: "c1" });
      assert.equal(await evaluate("document.querySelectorAll('.iui-number')[0].value"), "999");

      // 6. Comparison table: sort, search, filter (no submission), expand, keyboard.
      await render(fence(fixtures.compare));
      const rows = () => evaluate("Array.from(document.querySelectorAll('.iui-table tbody tr:not(.iui-detail-row)')).map(tr => tr.querySelector('td:nth-child(2)').textContent)");
      assert.deepEqual(await rows(), ["Alpha", "Beta", "Gamma"]);
      await clickText(".iui-sort", "价格 ↕");
      assert.deepEqual(await rows(), ["Gamma", "Beta", "Alpha"]);
      assert.equal(await evaluate("document.querySelector('th[aria-sort=ascending]').textContent.includes('价格')"), true);
      await clickText(".iui-sort", "价格 ↑升序");
      assert.deepEqual(await rows(), ["Alpha", "Beta", "Gamma"]);
      await clickText(".iui-segment", "便宜");
      assert.deepEqual(await rows(), ["Beta", "Gamma"]);
      await typeInto("搜索", "gam");
      assert.deepEqual(await rows(), ["Gamma"]);
      await typeInto("搜索", "");
      await clickText(".iui-segment", "全部");
      await evaluate("document.querySelector('.iui-expand').click()");
      assert.equal(await evaluate("document.querySelector('.iui-detail-row strong').textContent"), "适合");
      assert.equal(await evaluate("document.querySelector('.iui-expand').getAttribute('aria-expanded')"), "true");
      assert.match(await evaluate("document.querySelector('.iui-source').textContent"), /来源: 厂商定价页 · 未验证/);
      assert.equal(await evaluate("window.submitted.length"), 1, "filtering and sorting never submit");
      // Roving arrow keys inside the segmented control.
      await evaluate("document.querySelector('.iui-segment.is-selected').focus()");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Right" }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Right" });
      await frame();
      assert.equal(await evaluate("document.querySelector('.iui-segment.is-selected').textContent"), "快");
      assert.deepEqual(await rows(), ["Alpha"]);
      await capture("compare-light");

      // 7. Hostile content stays inert; unknown components degrade locally.
      await render(fence(fixtures.hostile));
      assert.equal(await evaluate("window.__pwned"), undefined);
      assert.equal(await evaluate("document.querySelector('.iui-frame img, .iui-frame script, .iui-frame iframe')"), null);
      assert.equal(await evaluate("document.querySelector('.iui-text').textContent.includes('<img src=x')"), true);
      assert.equal(await evaluate("document.querySelector('.iui-text a')"), null, "javascript: links are plain text");
      assert.equal(await evaluate("document.querySelector('.iui-text strong').textContent"), "粗体");
      assert.match(await evaluate("document.querySelector('.iui-placeholder').textContent"), /不支持的组件: iframe/);
      assert.equal(await evaluate("document.body.textContent.includes('其余内容仍然显示')"), true);
      // The dangerous link never becomes a confirmation (node was rejected at validation).
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.iui-button')).some(b => b.textContent === '危险')"), false);

      // 8. Broken and oversized blocks fall back to readable text without breaking the rest.
      await render("前文\n\n" + fence(['{"op":"begin","id":"bad","version":1}', "{oops"]) + "\n\n后文");
      assert.match(await evaluate("document.querySelector('.iui-notice-error').textContent"), /无法显示这个界面/);
      assert.equal(await evaluate("document.body.textContent.includes('前文') && document.body.textContent.includes('后文')"), true);
      await clickText(".iui-tool", "查看原始文本");
      assert.equal(await evaluate("document.querySelector('.iui-source-view').textContent.includes('{oops')"), true);
      await render(fence(fixtures.billSplit.slice(0, 5)));
      assert.match(await evaluate("document.querySelector('.iui-notice-warning').textContent"), /生成未完成/);
      assert.equal(await evaluate("document.querySelectorAll('.iui-number').length"), 1, "verified nodes stay visible");

      // 9. A code sample that merely mentions vela-ui is plain code.
      await render("语法示例：\n\n```vela-ui\nnot json\n```\n");
      assert.equal(await evaluate("document.querySelectorAll('.iui-frame').length"), 0);
      assert.equal(await evaluate("document.querySelector('pre code').textContent.includes('not json')"), true);

      // 11. Charts: bars, legend, keyboard tooltip, drag to edit a bound state, accessible data table, PNG export.
      const key = async name => { win.webContents.sendInputEvent({ type: "keyDown", keyCode: name }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: name }); await frame(); };
      const input = async (type, x, y) => { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 }); await frame(); };
      await render(fence(fixtures.charts));
      assert.equal(await evaluate("document.querySelectorAll('.iui-bar').length"), 6);
      assert.equal(await evaluate("document.querySelectorAll('.iui-slice').length"), 3);
      assert.equal(await evaluate("document.querySelector('.iui-chart-plot').getAttribute('role')"), "group");
      assert.match(await evaluate("document.querySelector('.iui-chart-plot').getAttribute('aria-label')"), /季度收入.*3 个数据点，2 个系列/);
      assert.match(await evaluate("document.querySelector('.iui-chart-data table').textContent"), /Q2.*20 万.*40 万/);
      await clickText(".iui-legend-item", "产品A");
      assert.equal(await evaluate("document.querySelectorAll('.iui-bar').length"), 3, "legend hides a series");
      assert.equal(await evaluate("document.querySelector('.iui-legend-item').getAttribute('aria-pressed')"), "false");
      await clickText(".iui-legend-item", "产品A");
      await evaluate("document.querySelector('.iui-chart-plot').focus()");
      await key("Right");
      assert.match(await evaluate("document.querySelector('.iui-chart-tip').textContent"), /Q1 · 产品A: 10 万/, "the first arrow press selects the first point");
      await key("Right"); await key("]");
      assert.match(await evaluate("document.querySelector('.iui-chart-tip').textContent"), /Q2 · 产品B/, "[ and ] switch series in a draggable chart");
      // 拖动：预算状态绑定在产品B的 Q2 柱子上，拖到约 80。
      const barBox = JSON.parse(await evaluate("JSON.stringify((() => { const r = document.querySelector('.iui-bar.is-draggable').getBoundingClientRect(); const s = document.querySelector('.iui-chart-svg').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 2, top: s.top, scale: s.height / 300 }; })())"));
      await input("mouseDown", barBox.x, barBox.y);
      await input("mouseMove", barBox.x, barBox.top + (14 + 240 * 0.2) * barBox.scale);
      await input("mouseUp", barBox.x, barBox.top + (14 + 240 * 0.2) * barBox.scale);
      const dragged = Number(await evaluate("document.querySelectorAll('.iui-number')[0].value"));
      assert.ok(Math.abs(dragged - 80) <= 3, `dragging a bar edits the bound state (got ${dragged})`);
      assert.equal(await evaluate("window.submitted.length"), 1, "dragging never submits");
      // 键盘：选中后上下方向键调整数值。
      await typeInto("预算", "55");
      await evaluate("document.querySelector('.iui-chart-plot').focus()");
      await key("Right"); await key("Right"); await key("]");
      assert.match(await evaluate("document.querySelector('.iui-chart-tip').textContent"), /Q2 · 产品B/);
      await key("Up");
      assert.equal(await evaluate("document.querySelectorAll('.iui-number')[0].value"), "56", "arrow keys step the bound value");
      // 饼图与示意图。
      assert.match(await evaluate("document.querySelector('.iui-pie-legend').textContent"), /甲.*60 · 60\.0%.*乙.*30 · 30\.0%/);
      assert.equal(await evaluate("document.querySelector('.iui-diagram-svg').getAttribute('role')"), "img");
      assert.equal(await evaluate("document.querySelector('.iui-diagram .iui-chip.is-selected').textContent"), "部件A");
      await clickText(".iui-chip", "部件B");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.iui-text')).some(el => el.textContent === 'b')"), true, "choosing a hotspot sets the bound state");
      assert.match(await evaluate("document.querySelector('.iui-diagram .iui-chart-tip').textContent"), /部件B — 右边的圆/);
      assert.equal(await evaluate("document.querySelector('.iui-diagram-svg .iui-hotspot.is-selected') !== null"), true);
      // 保存图片：真实栅格化出 PNG。
      const png = await evaluate("window.pngOf('.iui-chart-svg')");
      assert.equal(png.type, "image/png"); assert.equal(png.magic, "PNG"); assert.ok(png.size > 1500, `png size ${png.size}`);
      assert.equal((await evaluate("window.pngOf('.iui-pie-plot svg')")).magic, "PNG");
      await capture("charts-light");

      // 12. Data sources: only real tool results fill the UI, with provenance, states and confirm-gated refresh.
      const toolBody = JSON.stringify({ items: [{ name: "a.ts", size: 120 }, { name: "b.ts", size: 80 }], count: 2 });
      const completedAt = Date.now();
      await evaluate(`window.toolCalls = []`);
      await render(fence(fixtures.sources), { streaming: true });
      assert.match(await evaluate("document.querySelector('.iui-stat-value').textContent"), /加载中/, "loading while the tool result isn't there yet");
      await render(fence(fixtures.sources));
      assert.match(await evaluate("document.querySelector('.iui-table-block .iui-notice-error').textContent"), /获取失败.*没有找到对应的工具结果/);
      await evaluate(`window.toolCalls = [{ id: 'call_abcdef123456', name: 'bash', status: 'done', command: 'git ls-files --json', body: ${JSON.stringify(toolBody)}, completedAt: ${completedAt} }]`);
      await render(fence(fixtures.sources));
      assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.iui-table-block .iui-table tbody tr')).map(tr => tr.textContent)"), ["a.ts120", "b.ts80"]);
      assert.equal(await evaluate("document.querySelector('.iui-stat-value').textContent.trim()"), "2");
      assert.equal(await evaluate("document.querySelectorAll('.iui-bar').length"), 2);
      assert.match(await evaluate("document.querySelector('.iui-provenance').textContent"), /数据: bash · git ls-files --json/);
      assert.equal(await evaluate("document.querySelector('.iui-provenance').getAttribute('title')"), "记录: call_abcdef1");
      assert.equal(await evaluate("document.querySelector('.iui-badge') === null"), true, "fresh data has no warning badge");
      await clickText(".iui-meta .iui-tool", "刷新");
      assert.match(await evaluate("document.querySelector('.iui-confirm-text').textContent"), /refresh the data source "(total|files)"[\s\S]*Use the normal tool permissions/);
      assert.equal(await evaluate("window.submitted.length"), 1, "refresh needs confirmation");
      await clickText(".iui-confirm .iui-button", "取消");
      await clickText(".iui-button", "建议运行测试");
      assert.match(await evaluate("document.querySelector('.iui-confirm-text').textContent"), /consider running the `bash` tool[\s\S]*command: pnpm test[\s\S]*not from an approval|came from a button/);
      await clickText(".iui-confirm .iui-button", "发送");
      assert.equal(await evaluate("window.submitted.length"), 2);
      assert.equal(await evaluate("window.toolCalls.length"), 1, "the UI never created a tool call");
      // 过期、失败。
      await evaluate(`window.toolCalls[0].completedAt = ${completedAt - 3600_000}`);
      await render(fence(fixtures.sources)); await frame();
      assert.equal(await evaluate("document.querySelector('.iui-badge-stale') !== null"), true);
      assert.match(await evaluate("document.querySelector('.iui-badge-stale').textContent"), /可能已过期/);
      await evaluate("window.toolCalls[0].status = 'error'; window.toolCalls[0].body = 'fatal: not a git repository'");
      await render(fence(fixtures.sources)); await frame();
      assert.match(await evaluate("document.querySelector('.iui-table-block .iui-notice-error').textContent"), /not a git repository/);
      await evaluate("window.toolCalls = []");

      // 13. Timeline, diff, itinerary (no invented coordinates) and the media placeholder.
      await render(fence(fixtures.rich));
      assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.iui-timeline-item')).map(li => li.className.split(' ').pop())"), ["is-done", "is-current", "is-upcoming"]);
      assert.equal(await evaluate("document.querySelector('.iui-timeline-item.is-current').getAttribute('aria-current')"), "step");
      assert.equal(await evaluate("document.querySelector('.iui-timeline-item.is-current strong').textContent"), "重点");
      assert.equal(await evaluate("document.querySelectorAll('.iui-diff-line.is-add').length + ':' + document.querySelectorAll('.iui-diff-line.is-del').length"), "1:1");
      assert.equal(await evaluate("document.querySelector('.iui-diff-add').textContent + document.querySelector('.iui-diff-del').textContent"), "+1−1");
      assert.equal(await evaluate("document.querySelectorAll('.iui-itinerary-stops li').length"), 3);
      assert.equal(await evaluate("document.querySelectorAll('.iui-coords').length"), 2, "only stops with model-given coordinates show coordinates");
      assert.equal(await evaluate("document.querySelector('.iui-plot-svg')"), null, "the sketch is opt-in");
      await clickText(".iui-itinerary-plot .iui-tool", "显示位置示意图");
      assert.equal(await evaluate("document.querySelectorAll('.iui-plot-dot').length"), 2, "the stop without coordinates isn't plotted");
      assert.match(await evaluate("document.querySelector('.iui-itinerary-plot figcaption').textContent"), /不是地图/);
      assert.match(await evaluate("document.querySelector('.iui-media-box').textContent"), /路线图.*没有连接地图服务/);
      assert.equal(await evaluate("document.querySelector('.iui-media img, .iui-media iframe')"), null);
      await capture("rich-light");

      // 14. Observability: local counters, dev inspector, nothing leaves the page.
      const before = await evaluate("window.metrics()");
      const historic = fence(fixtures.rich).replace('"id":"rich"', '"id":"rich-history"');
      const liveText = fence(fixtures.rich).replace('"id":"rich"', '"id":"rich-live"');
      await render(historic);
      assert.equal((await evaluate("window.metrics()")).artifacts, before.artifacts, "history renders are not counted as generated interfaces");
      await render(liveText.slice(0, 60), { streaming: true });
      await render(liveText, { streaming: true });
      await render(liveText, { streaming: false });
      const after = await evaluate("window.metrics()");
      assert.equal(after.artifacts, before.artifacts + 1, "a streamed interface is counted once");
      assert.equal(after.ready, before.ready + 1);
      assert.equal(after.commitRate !== null && after.commitRate <= 1, true);
      assert.equal(JSON.stringify(after).includes("冻结代码"), false, "metrics hold no interface content");
      await evaluate("window.setInspector(true)"); await frame();
      await clickText(".iui-inspector summary", "开发检查器").catch(() => undefined);
      await evaluate("document.querySelector('.iui-inspector').open = true");
      assert.match(await evaluate("document.querySelector('.iui-inspector .iui-source-view').textContent"), /"type": "timeline"/);
      await clickText(".iui-inspector-tabs button", "事件");
      assert.match(await evaluate("document.querySelector('.iui-inspector .iui-source-view').textContent"), /begin[\s\S]*ready/);
      await clickText(".iui-inspector-tabs button", "状态");
      await evaluate("window.setInspector(false)"); await frame();
      assert.equal(await evaluate("document.querySelector('.iui-inspector')"), null);

      // 15. Sandboxed micro-apps: off by default, isolated when on, every side effect needs the user.
      const appFence = lines => "```vela-app\n" + lines.join("\n") + "\n```";
      const frames = () => win.webContents.mainFrame.frames;
      const inFrame = (index, code) => Promise.race([frames()[index].executeJavaScript(code), new Promise((_, reject) => setTimeout(() => reject(new Error(`frame check timed out: ${code}`)), 8000))]);
      const waitFrame = async (index, code) => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const value = await inFrame(index, code).catch(() => undefined);
          if (value) return value;
          await new Promise(done => setTimeout(done, 50));
        }
        throw new Error(`Timed out in frame: ${code}`);
      };
      const mainUrl = win.webContents.getURL();
      await render(appFence(fixtures.probeApp));
      assert.equal(await evaluate("document.querySelector('iframe')"), null, "no iframe while micro-apps are off");
      assert.match(await evaluate("document.querySelector('.iui-app .iui-notice').textContent"), /微应用已关闭/);
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.iui-app button')).some(b => b.textContent === '运行')"), false);
      await clickText(".iui-app .iui-tool", "查看原始文本");
      assert.equal(await evaluate("document.querySelector('.iui-app .iui-source-view').textContent.includes('fetch(')"), true, "the code is viewable as text");
      await evaluate("window.setMicroApps(true)"); await frame();
      assert.equal(await evaluate("document.querySelector('iframe')"), null, "turning the switch on never runs anything by itself");
      assert.match(await evaluate("document.querySelector('.iui-app .iui-description').textContent"), /隔离的沙盒/);
      await clickText(".iui-app .iui-button", "运行");
      await until("document.querySelector('iframe.iui-app-frame')");
      assert.equal(await evaluate("document.querySelector('iframe').getAttribute('sandbox')"), "allow-scripts");
      assert.equal(await evaluate(`document.querySelector('iframe').srcdoc.includes("default-src 'none'")`), true);
      const probe = await waitFrame(0, "window.__r && window.__r.img && window.__r.fetch && window.__r.ws && window.__r");
      assert.equal(probe.parent, "SecurityError", "no access to the parent document");
      assert.equal(probe.storage, "SecurityError", "opaque origin has no storage");
      assert.equal(probe.cookie, "SecurityError");
      assert.deepEqual([probe.require, probe.process, probe.rtc, probe.electron], ["undefined", "undefined", "undefined", "undefined"]);
      assert.equal(probe.velaKeys, "copy,submit", "the bridge exposes exactly two requests, nothing else");
      assert.equal(probe.fetch, "blocked", "CSP blocks fetch");
      assert.equal(probe.img, "blocked", "CSP blocks remote images");
      assert.equal(probe.ws, "blocked", "CSP blocks WebSocket");
      assert.equal(probe.open, "null", "no popups");
      await new Promise(done => setTimeout(done, 400));
      assert.deepEqual(networkRequests, [], "the micro-app produced no network request at all");
      assert.deepEqual(blockedNavigations.filter(url => !/^about:/.test(url)), blockedNavigations, "navigation attempts never reached the network");
      assert.equal(win.webContents.getURL(), mainUrl, "the app window was not navigated");
      assert.equal(await evaluate("window.__pwned"), undefined);
      await clickText(".iui-app .iui-tool", "停止");
      assert.equal(await evaluate("document.querySelector('iframe')"), null, "stopping removes the frame");

      // Capability requests: the user sees the exact text first; denial, rate limits and forged messages do nothing.
      const submittedBefore = await evaluate("window.submitted.length");
      await render(appFence(fixtures.talkApp));
      await clickText(".iui-app .iui-button", "运行");
      await until("document.querySelector('iframe.iui-app-frame')");
      await waitFrame(0, "typeof window.__ask === 'function'");
      await inFrame(0, "window.__ask('submit', 'hello agent')");
      await until("document.querySelector('.iui-app [role=alertdialog]')");
      assert.match(await evaluate("document.querySelector('.iui-app [role=alertdialog]').textContent"), /Agent[\s\S]*hello agent/);
      assert.equal(await evaluate("window.submitted.length"), submittedBefore, "nothing is sent before the user agrees");
      await clickText(".iui-app [role=alertdialog] .iui-button", "发送");
      await until(`window.submitted.length === ${submittedBefore + 1}`);
      assert.equal(await evaluate("window.submitted.at(-1)"), "hello agent");
      assert.equal(await waitFrame(0, "window.__log.includes('submit:ok') && 'yes'"), "yes");
      await inFrame(0, "window.__ask('copy', 'secret text')");
      await until("document.querySelector('.iui-app [role=alertdialog]')");
      await clickText(".iui-app [role=alertdialog] .iui-button", "拒绝");
      assert.equal(await waitFrame(0, "window.__log.includes('copy:denied') && 'yes'"), "yes");
      assert.equal(await evaluate("window.submitted.length"), submittedBefore + 1, "denying sends nothing");
      // 频率限制：每分钟最多 6 次申请（前面已用 2 次）。
      for (let index = 0; index < 4; index += 1) {
        await inFrame(0, "window.__ask('copy', 'again')");
        await until("document.querySelector('.iui-app [role=alertdialog]')");
        await clickText(".iui-app [role=alertdialog] .iui-button", "拒绝");
      }
      await inFrame(0, "window.__ask('copy', 'one too many')");
      assert.equal(await waitFrame(0, "window.__log.at(-1) === 'copy:rate_limited' && 'yes'"), "yes");
      assert.equal(await evaluate("document.querySelector('.iui-app [role=alertdialog]')"), null, "a rate-limited request never reaches the user");
      // 伪造：父页面自己发的消息、超长文本都不会产生确认。
      await evaluate("window.postMessage({ vela: 1, type: 'request', id: 99, capability: 'agent.submit', text: 'forged' }, '*')");
      await inFrame(0, "parent.postMessage({ vela: 1, type: 'request', id: 5, capability: 'agent.submit', text: 'x'.repeat(5000) }, '*')");
      await new Promise(done => setTimeout(done, 300));
      assert.equal(await evaluate("document.querySelector('.iui-app [role=alertdialog]')"), null);
      assert.equal(await evaluate("window.submitted.length"), submittedBefore + 1);
      // 关掉开关：正在运行的立刻停止，令牌全部收回。
      await evaluate("window.setMicroApps(false)"); await frame();
      assert.equal(await evaluate("document.querySelector('iframe')"), null, "switching micro-apps off stops running ones");
      assert.equal(await evaluate("window.__broker.outstanding"), 0);
      await evaluate("window.setMicroApps(true)"); await frame();

      // 同时最多运行两个；失去响应的应用会被看门狗停掉，页面本身不受影响。
      const three = ["a", "b", "c"].map(id => appFence([appHeader.replace('"probe"', `"${id}"`), `<p>app ${id}</p>`])).join("\n\n");
      await render(three);
      const runButtons = "Array.from(document.querySelectorAll('.iui-app .iui-button-primary'))";
      await evaluate(`${runButtons}[0].click()`); await evaluate(`${runButtons}[0].click()`);
      await until("document.querySelectorAll('iframe').length === 2");
      await evaluate(`${runButtons}[0].click()`); await frame();
      assert.equal(await evaluate("document.querySelectorAll('iframe').length"), 2, "a third app can't start");
      assert.match(await evaluate("document.body.textContent"), /最多同时运行 2 个微应用/);
      await render("```text\nplain\n```");
      assert.equal(await evaluate("window.__broker.outstanding"), 0);

      // 16. A micro-app stuck in a busy loop must not freeze Vela, and the watchdog stops it.
      const busy = appFence([appHeader.replace('"probe"', '"busy"'), "<p>busy</p><script>setTimeout(() => { for (;;) {} }, 400)</script>"]);
      await render(busy);
      await clickText(".iui-app .iui-button", "运行");
      await until("document.querySelector('iframe.iui-app-frame')");
      const responsive = async () => Promise.race([evaluate("1 + 1"), new Promise(done => setTimeout(() => done("frozen"), 4000))]);
      await new Promise(done => setTimeout(done, 1200));
      assert.equal(await responsive(), 2, "the app window stays responsive while a micro-app spins");
      const started = Date.now();
      while (Date.now() - started < 15000 && !(await Promise.race([evaluate("document.querySelector('.iui-app .iui-notice-warning')?.textContent ?? ''"), new Promise(done => setTimeout(() => done("frozen"), 4000))])).includes("没有响应")) {
        await new Promise(done => setTimeout(done, 300));
      }
      assert.ok(Date.now() - started < 12000, "the watchdog stops an unresponsive micro-app");
      assert.match(await evaluate("document.querySelector('.iui-app .iui-notice-warning').textContent"), /没有响应，已停止/);
      assert.equal(await evaluate("document.querySelector('iframe')"), null);
      assert.equal(await responsive(), 2);

      // 10. Narrow layout and dark theme: nothing overflows the chat column.
      win.setSize(380, 900);
      await render(fence(fixtures.compare)); await frame();
      assert.equal(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), true);
      assert.equal(await evaluate("document.querySelector('.iui-table-scroll').scrollWidth >= document.querySelector('.iui-table-scroll').clientWidth"), true);
      await evaluate("document.documentElement.dataset.scheme = 'dark'");
      await capture("compare-dark-narrow");
      await render(text); await frame();
      assert.equal(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), true);
      await capture("calculator-dark-narrow");

      console.log("PASS intelligent UI: streaming, local state, calculator errors, explicit submit, persistence, table, XSS, fallbacks, charts and diagrams, data sources, rich views, metrics, sandboxed micro-apps and narrow layout");
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
