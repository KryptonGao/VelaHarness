/** Deterministic real-Electron result details checks: node apps/desktop/test/tool-result-details-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQGQAAAAASUVORK5CYII=";
const rawShell = "shell bg-ui-1 (exited with code 1): node apps/desktop/test-center/server.mjs --run ui:stream-performance\n\n(no new output)";
const longPath = "/workspace/" + "long-project-segment/".repeat(18) + "memory.md";
const timestamp = Date.UTC(2026, 0, 2, 12, 30);
const malicious = '<img src="https://invalid.example/never-fetch" onerror="window.__toolResultXss=true"><script>window.__toolResultXss=true</script>';
const presentation = (kind, fields, source = "result") => ({ version: 1, source, kind, ...fields });
const tool = (name, value, body, status = "done", extra = {}) => ({
  id: name, name, status, activity: { ...(value ? { presentation: value } : {}), ...(body !== undefined ? { body } : {}), ...extra },
});
const shell = { id: "bg-ui-1", command: "node apps/desktop/test-center/server.mjs --run ui:stream-performance", cwd: longPath, status: "exited", exitCode: 1, startedAt: timestamp, endedAt: timestamp + 1000 };
const tasks = [
  { kind: "once", at: "2026-01-03T22:00:00+08:00" },
  { kind: "daily", time: "22:00", timezone: "Asia/Shanghai" },
  { kind: "weekly", time: "21:00", weekdays: [1, 3], timezone: "Asia/Tokyo" },
  { kind: "cron", expression: "0 8 * * 1", timezone: "Asia/Seoul" },
].map((schedule, index) => ({
  id: `task-${index + 1}`, title: `UI task ${index + 1}`, prompt: `Reminder body ${index + 1}`,
  workspace: longPath, schedule, status: index === 2 ? "paused" : "active", missedPolicy: "skip",
  nextRunAt: timestamp + 86_400_000, createdAt: timestamp, updatedAt: timestamp,
}));
const runs = [{ id: "run-1", taskId: "task-1", trigger: "scheduled", scheduledAt: timestamp, startedAt: timestamp, finishedAt: timestamp + 1000, status: "failed", error: "Deterministic run failed", conversationId: null }];
const fixtures = {
  shell: [tool("bash_output", presentation("shell", { operation: "read", shell, output: "" }), rawShell)],
  "shell-output": [tool("bash_output", presentation("shell", { operation: "read", shell, output: "first log line\nsecond log line", truncated: true }), rawShell + "\nfirst log line\nsecond log line")],
  "shell-kill": [tool("bash_kill", presentation("shell", { operation: "kill", shell: { ...shell, status: "killed", exitCode: null }, killed: true }), "Stopped background shell bg-ui-1.")],
  "shell-error": [tool("bash_output", presentation("shell", { operation: "read", shell: { id: "bg-missing" } }, "request"), "Unknown shell bg-missing", "error")],
  schedule: [tool("list_scheduled_tasks", presentation("schedule", { operation: "list", tasks, runs }), JSON.stringify({ tasks, runs }))],
  "schedule-delete": [tool("delete_scheduled_task", presentation("schedule", { operation: "delete", tasks: [], runs: [], deletedId: "task-deleted" }), '{"deleted":"task-deleted"}')],
  "schedule-empty": [tool("list_scheduled_tasks", presentation("schedule", { operation: "list", tasks: [], runs: [] }), '{"tasks":[],"runs":[]}')],
  memory: [tool("memory_read", presentation("memory", { operation: "read", entries: [
    { scope: "global", path: longPath, revision: "rev-ui-global", bytes: 24, exists: true, content: "# UI preference\n\nUse **clear** reports.", status: "read" },
    { scope: "project", path: longPath, status: "failed", error: "Project memory could not be read" },
  ] }), "scope: global\npath: " + longPath + "\nrevision: rev-ui-global\ncontent:\n# UI preference")],
  "memory-empty": [tool("memory_read", presentation("memory", { operation: "read", entries: [{ scope: "project", exists: true, content: "", bytes: 0 }] }), "Empty memory")],
  "memory-unchanged": [tool("memory_update", presentation("memory", { operation: "unchanged", entries: [{ scope: "project", path: longPath, revision: "same", bytes: 3 }] }), "Memory unchanged")],
  discovery: [tool("tool_search", presentation("discovery", { query: "UI discovery query", tools: Array.from({ length: 45 }, (_, index) => ({ name: `fixture_tool_${String(index + 1).padStart(2, "0")}`, description: `Deterministic description ${index + 1}` })) }), "Loaded 45 tools. Raw discovery protocol")],
  "discovery-empty": [tool("tool_search", presentation("discovery", { query: "Nothing matches", tools: [] }), "No matching tools found.")],
  resource: [tool("list_mcp_resources", presentation("resource", { operation: "list", server: "fixture-docs", value: {
    resources: [{ name: "UI resource", uri: "doc://guide", mimeType: "text/markdown", description: "A local fixture" }, { name: "Unsafe URI remains text", uri: "javascript:window.__toolResultXss=true", mimeType: "text/plain" }],
    nextCursor: "fixture-next-page", errors: [{ server: "offline-docs", error: "Deterministic resource error" }],
  } }), "RAW RESOURCE RESPONSE")],
  "resource-read": [tool("read_mcp_resource", presentation("resource", { operation: "read", server: "fixture-docs", uri: "doc://guide", value: { contents: [{ uri: "doc://guide", mimeType: "text/markdown", text: "# Resource heading\n\n**Resource body**" }] }, images: [{ mimeType: "image/png", data: image }], fullOutputPath: longPath }), "RAW RESOURCE READ")],
  goal: [tool("record_goal_validation", presentation("goal", { goal: { objective: "UI goal snapshot", status: "active", note: "Execution-time note" }, validation: {
    risk: "medium", status: "known_issues", checkedAt: timestamp, workRevision: 3,
    checks: [{ category: "test", toolCallId: "check-1", command: "pnpm test:fixture", result: "passed", output: "Fixture check passed", completedAt: timestamp }],
    skipped: [{ category: "build", reason: "No build changed" }], knownIssues: [{ toolCallId: "check-2", reason: "Pre-existing fixture issue" }],
  } }), "Goal validation recorded")],
  "goal-legacy": [tool("record_goal_validation", presentation("goal", { requested: { risk: "low", checks: [{ category: "test", toolCallId: "old-check" }] } }, "request"), "Legacy summary without execution snapshot")],
  json: [tool("mcp__fixture__data", presentation("json", { value: { emptyString: "", missing: null, array: [], object: {}, enabled: true, html: malicious, path: longPath, nested: { second: { third: { leaf: "Deep fixture value" } } } } }), JSON.stringify({ source: "raw JSON fixture" }))],
  "json-null": [tool("fixture_json", presentation("json", { value: null }), "null")],
  "json-empty-array": [tool("fixture_json", presentation("json", { value: [] }), "[]")],
  "json-empty-object": [tool("fixture_json", presentation("json", { value: {} }), "{}")],
  "json-empty-string": [tool("fixture_json", presentation("json", { value: "" }), '""')],
  "json-table": [tool("fixture_json", presentation("json", { value: Array.from({ length: 45 }, (_, index) => ({ name: `row-${index + 1}`, count: index, enabled: index % 2 === 0 })) }), "RAW TABLE JSON")],
  "json-mixed": [tool("fixture_json", presentation("json", { value: [null, "", [], {}, true, { nested: "mixed value" }] }), "RAW MIXED JSON")],
  "mcp-structured": [tool("mcp__fixture__nested", presentation("json", { value: { nested: { items: [{ name: "Structured MCP row", value: null }] } } }), undefined, "done", { mcp: { server: "fixture", tool: "nested" } })],
  "mcp-search": [tool("mcp__fixture__search", undefined, JSON.stringify({ results: [{ title: "UI search result", url: "https://example.test/result", highlight: "A **search** snippet", type: "page" }] }), "done", { mcp: { server: "fixture", tool: "search" } })],
  "browser-json": [tool("browser_repl", undefined, JSON.stringify({ browserValue: null, browserList: [{ name: "Browser JSON row" }] }), "done", { command: "nodeRepl.write({ browserValue: null })" })],
  "browser-shot": [tool("browser_repl", undefined, `Browser fixture output\n\n![Browser screenshot](data:image/png;base64,${image})`, "done", { command: "await tab.screenshot()" })],
  "browser-reset": [tool("browser_repl_reset", presentation("notice", { code: "browser-reset" }), "Browser REPL context reset; pages retained.")],
  diff: [tool("edit", undefined, undefined, "done", { path: "fixture.ts", diff: "-1 const oldValue = 1;\n+1 const newValue = 2;" })],
  checklist: [tool("update_todos", undefined, "Fixture checklist", "done", { plan: [{ text: "Completed fixture step", status: "completed" }, { text: "Active fixture step", status: "in_progress" }, { text: "Pending fixture step", status: "pending" }] })],
};

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-tool-results-ui-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { ToolList } from './apps/desktop/src/renderer/components/ToolCard';
        import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
        const fixtures = ${JSON.stringify(fixtures)};
        const root = createRoot(document.getElementById('root'));
        let revision = 0;
        window.fixtureNames = Object.keys(fixtures);
        window.fixtureErrors = [];
        window.__toolResultXss = false;
        window.copiedText = null;
        window.copyShouldFail = false;
        // Keep the OS clipboard untouched; exercise the real component's Clipboard API call deterministically.
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
          if (window.copyShouldFail) throw new Error('Fixture clipboard unavailable');
          window.copiedText = text;
        } } });
        window.addEventListener('error', event => window.fixtureErrors.push(event.message));
        window.addEventListener('unhandledrejection', event => window.fixtureErrors.push(String(event.reason)));
        window.renderCase = (name, display = 'card', scheme = 'light', width = 720, locale = 'zh-CN') => {
          if (!fixtures[name]) throw new Error('Unknown fixture: ' + name);
          setActiveLocale(locale);
          document.documentElement.dataset.scheme = scheme;
          document.documentElement.dataset.theme = scheme === 'dark' ? 'graphite' : 'paper';
          document.documentElement.dataset.toolFixture = name;
          window.copiedText = null;
          window.copyShouldFail = false;
          flushSync(() => root.render(<AppLocaleProvider locale={locale}>
            <div key={++revision} className="thinking-group-rail" data-fixture={name}
              style={{width, maxWidth:'100%', minWidth:0, padding:12, boxSizing:'border-box', '--tool-detail-height':'1000px'}}>
              <ToolList tools={fixtures[name]} display={display} fold="none" />
            </div>
          </AppLocaleProvider>));
        };
        window.renderCase('shell');
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(temporary, "ui.js"),
      loader: { ".svg": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" }, logLevel: "error",
    });
    assert.ok(existsSync(join(temporary, "ui.css")), "The component-imported stylesheet must be emitted");
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
      readFileSync(resolve(here, "../src/renderer/styles.css"), "utf8") +
      '</style><link rel="stylesheet" href="./ui.css"></head><body style="margin:0;min-width:0"><div id="root"></div><script src="./ui.js"></script></body></html>');
    const env = { ...process.env, VELA_TOOL_RESULTS_UI_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    try {
      const result = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", (code, signal) => done({ code, signal })); });
      assert.equal(result.code, 0, `Tool result details UI checks failed (signal: ${result.signal ?? "none"})`);
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const temporary = process.env.VELA_TOOL_RESULTS_UI_TEMP;
  assert.ok(temporary, "The fixture runner must provide a temporary directory");
  app.setPath("userData", join(temporary, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 1100,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const externalRequests = [];
    const rendererFailures = [];
    win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
      externalRequests.push(details.url); callback({ cancel: true });
    });
    win.webContents.on("render-process-gone", (_event, details) => rendererFailures.push(details.reason));
    const evaluate = code => win.webContents.executeJavaScript(code);
    const wait = ms => new Promise(done => setTimeout(done, ms));
    const until = async (code, label = code) => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await wait(25); }
      const snapshot = await evaluate("document.querySelector('[data-fixture]')?.innerText ?? document.body.innerText");
      throw new Error(`Timed out: ${label}\n${snapshot}`);
    };
    const visibleText = () => evaluate("document.querySelector('[data-fixture]')?.innerText ?? ''");
    const keyboard = async keyCode => {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode });
      if (keyCode === "Enter") win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode });
      await wait(30);
    };
    const openCase = async (name, display = "card", scheme = "light", width = 720, locale = "zh-CN") => {
      await evaluate(`window.renderCase(${JSON.stringify(name)},${JSON.stringify(display)},${JSON.stringify(scheme)},${width},${JSON.stringify(locale)})`);
      await until(`document.documentElement.dataset.toolFixture === ${JSON.stringify(name)} && !!document.querySelector('[data-fixture] button[aria-expanded]')`);
      await evaluate("(() => { const button = document.querySelector('[data-fixture] .tool-card-head, [data-fixture] .browser-call-head, [data-fixture] .tool-compact-line[aria-expanded], [data-fixture] .tool-compact-text-toggle[aria-expanded]'); if (!button) throw new Error('No tool expand button'); if (button.getAttribute('aria-expanded') !== 'true') button.click(); })()");
      await until("!!document.querySelector('[data-fixture] .tool-collapse [inert]') === false && !!document.querySelector('[data-fixture] .tool-collapse-inner')", "tool expanded");
      await wait(320);
    };
    const clickSummary = async (selector, label) => {
      await evaluate(`(() => { const detail = document.querySelector(${JSON.stringify(selector)}); if (!detail) throw new Error('Missing details: ' + ${JSON.stringify(label)}); if (!detail.open) detail.querySelector(':scope > summary').click(); })()`);
      await until(`document.querySelector(${JSON.stringify(selector)})?.open === true`, label);
    };
    const assertFits = async label => {
      const bounds = await evaluate("(() => { const fixture=document.querySelector('[data-fixture]'); const result=fixture.querySelector('.tool-result-details, .mcp-tool-details, .browser-call-body'); return {fixtureWidth:fixture.clientWidth, fixtureScroll:fixture.scrollWidth, resultWidth:result?.clientWidth, resultScroll:result?.scrollWidth, viewport:innerWidth, documentWidth:document.documentElement.scrollWidth}; })()");
      assert.ok(bounds.fixtureScroll <= bounds.fixtureWidth + 2, `${label}: fixture horizontal overflow ${JSON.stringify(bounds)}`);
      if (bounds.resultWidth && bounds.resultScroll > bounds.resultWidth + 2) {
        const offenders = await evaluate("(() => { const result=document.querySelector('[data-fixture] .tool-result-details, [data-fixture] .mcp-tool-details, [data-fixture] .browser-call-body'); const limit=result.getBoundingClientRect().right+2; return [...result.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > limit && !el.closest('.tool-value-table-scroll, .tool-result-raw-text, .tool-result-content-text')).slice(0,5).map(el => { const chain=[]; for (let n=el; n && n!==result; n=n.parentElement) chain.push(n.tagName+'.'+n.className+'['+Math.round(n.getBoundingClientRect().width)+','+getComputedStyle(n).display+','+getComputedStyle(n).gridTemplateColumns+']'); return chain.join(' < '); }); })()");
        assert.fail(`${label}: result horizontal overflow ${JSON.stringify(bounds)} ${JSON.stringify(offenders)}`);
      }
      assert.ok(bounds.documentWidth <= bounds.viewport + 2, `${label}: document horizontal overflow ${JSON.stringify(bounds)}`);
    };
    try {
      await win.loadFile(join(temporary, "index.html"));
      await until("typeof window.renderCase === 'function'");
      win.webContents.debugger.attach("1.3");
      await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      assert.equal(await evaluate("[...document.styleSheets].some(sheet => sheet.href?.endsWith('/ui.css'))"), true, "Load the emitted component CSS, not only the base stylesheet");

      for (const display of ["card", "compact"]) {
        for (const scheme of ["light", "dark"]) {
          for (const width of [720, 360]) {
            await openCase("shell", display, scheme, width);
            await until("!!document.querySelector('.tool-shell-result.is-process-failed')");
            const text = await visibleText();
            assert.match(text, /读取完成/);
            assert.match(text, /进程状态/);
            assert.match(text, /已退出/);
            assert.match(text, /退出码\s*1/);
            assert.match(text, /暂无新增输出/);
            assert.ok(!text.includes("shell bg-ui-1 (exited with code 1)"), "The default view does not expose the shell protocol");
            assert.ok(!text.includes("(no new output)"), "The no-output sentinel is localized");
            assert.equal(await evaluate("document.querySelector('.tool-card').classList.contains('is-done')"), true, "Reading succeeded even though the process failed");
            assert.equal(await evaluate("document.querySelector('.tool-result-raw').open"), false, "Raw response starts collapsed");
            assert.equal(await evaluate("document.querySelector('.tool-result-call').open"), false, "Call info starts collapsed");
            assert.equal(await evaluate("getComputedStyle(document.querySelector('.tool-result-fields > div')).display"), "grid", "Component CSS is applied");
            await assertFits(`${display}/${scheme}/${width}`);
          }
        }
        console.log(`PASS ${display}: process failure is independent of successful reading, both schemes and widths fit`);

        await openCase("shell", display, "light", 360);
        await evaluate("document.querySelector('.tool-result-raw > summary').focus()");
        assert.equal(await evaluate("document.activeElement === document.querySelector('.tool-result-raw > summary')"), true, "Raw response summary receives keyboard focus");
        await keyboard("Enter");
        await until("document.querySelector('.tool-result-raw').open", "native keyboard opens raw response");
        assert.equal(await evaluate("document.querySelector('.tool-result-raw-text').textContent"), rawShell);
        await evaluate("document.querySelector('.tool-result-raw .tool-result-more').focus()");
        await keyboard("Enter");
        await until("window.copiedText !== null", "keyboard activates copy");
        assert.equal(await evaluate("window.copiedText"), rawShell, "Copy preserves the exact original response");
        await until("document.querySelector('.tool-result-copy-row [role=status]').textContent === '已复制'");
        await evaluate("window.copyShouldFail = true; document.querySelector('.tool-result-raw .tool-result-more').click()");
        await until("document.querySelector('.tool-result-copy-row [role=status]').textContent.includes('复制失败')");
        await evaluate("document.querySelector('.tool-result-raw > summary').focus()");
        await keyboard("Enter");
        await until("!document.querySelector('.tool-result-raw').open");
        await clickSummary(".tool-shell-result > .tool-result-aux", "process details");
        assert.ok((await visibleText()).includes(longPath), "Long cwd remains inspectable");
        await assertFits(`${display}: long path`);

        await openCase("shell-output", display);
        assert.match(await visibleText(), /first log line\nsecond log line/);
        assert.match(await visibleText(), /部分内容已省略/);
        await openCase("shell-kill", display);
        assert.match(await visibleText(), /已停止后台命令/);
        await openCase("shell-error", display);
        assert.match(await visibleText(), /Unknown shell bg-missing/);
        assert.match(await visibleText(), /不代表执行成功/);
        assert.ok(!(await visibleText()).includes("读取完成"));
        console.log(`PASS ${display}: native keyboard, exact raw copy, copy failure, shell output/kill/error`);

        await openCase("schedule", display, "dark", 360);
        assert.equal(await evaluate("document.querySelectorAll('.tool-result-schedule > .tool-result-list > .tool-result-list-item').length"), 4);
        const scheduleText = await visibleText();
        for (const expected of ["UI task 1", "UI task 4", "一次性", "每日", "每周", "Cron", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul"]) assert.ok(scheduleText.includes(expected), expected);
        assert.ok(!scheduleText.includes('"tasks":['), "Schedule defaults to readable fields rather than JSON");
        await clickSummary(".tool-result-schedule > .tool-result-aux:not(.tool-result-call):not(.tool-result-raw)", "schedule history");
        assert.match(await visibleText(), /Deterministic run failed/);
        await assertFits(`${display}: scheduled tasks`);
        await openCase("schedule-delete", display);
        assert.match(await visibleText(), /任务已删除/);
        assert.match(await visibleText(), /task-deleted/);
        await openCase("schedule-empty", display);
        assert.match(await visibleText(), /暂无定时任务/);

        await openCase("memory", display, "light", 360);
        assert.equal(await evaluate("document.querySelector('.tool-result-memory .tool-markdown h1')?.textContent"), "UI preference");
        assert.equal(await evaluate("document.querySelector('.tool-result-memory .tool-markdown strong')?.textContent"), "clear");
        assert.match(await visibleText(), /全局记忆/);
        assert.match(await visibleText(), /项目记忆/);
        assert.match(await visibleText(), /Project memory could not be read/);
        assert.ok(!(await visibleText()).includes("rev-ui-global"), "Memory metadata is not mixed into the default document");
        await clickSummary(".tool-result-memory .tool-result-list-item:first-child .tool-result-aux", "memory source");
        assert.match(await visibleText(), /rev-ui-global/);
        await assertFits(`${display}: memory metadata and Markdown`);
        await openCase("memory-empty", display);
        assert.match(await visibleText(), /记忆内容为空/);
        await openCase("memory-unchanged", display);
        assert.match(await visibleText(), /内容未变化/);
        console.log(`PASS ${display}: scheduled tasks and memory separate readable results, metadata, errors, and empty states`);

        await openCase("discovery", display, "dark", 360);
        assert.match(await visibleText(), /UI discovery query/);
        assert.equal(await evaluate("document.querySelectorAll('.tool-result-discovery > .tool-result-list > .tool-result-list-item').length"), 20);
        assert.ok(!(await visibleText()).includes("fixture_tool_21"));
        await evaluate("document.querySelector('.tool-result-discovery > .tool-result-more').focus()");
        await keyboard("Enter");
        await until("document.querySelectorAll('.tool-result-discovery > .tool-result-list > .tool-result-list-item').length === 40");
        assert.match(await visibleText(), /fixture_tool_40/);
        await evaluate("document.querySelector('.tool-result-discovery > .tool-result-more').click()");
        await until("document.querySelectorAll('.tool-result-discovery > .tool-result-list > .tool-result-list-item').length === 45");
        assert.equal(await evaluate("document.querySelectorAll('.tool-result-discovery > .tool-result-more').length"), 0);
        await openCase("discovery-empty", display);
        assert.match(await visibleText(), /未找到匹配工具/);

        await openCase("resource", display, "light", 360);
        assert.match(await visibleText(), /UI resource/);
        assert.match(await visibleText(), /fixture-docs/);
        assert.match(await visibleText(), /还有后续资源/);
        assert.match(await visibleText(), /Deterministic resource error/);
        assert.equal(await evaluate("document.querySelectorAll('.tool-result-resource a[href^=\"javascript:\"]').length"), 0);
        await assertFits(`${display}: resource list`);
        await openCase("resource-read", display, "dark", 360);
        assert.equal(await evaluate("document.querySelector('.tool-result-resource h1')?.textContent"), "Resource heading");
        assert.equal(await evaluate("document.querySelector('.tool-result-image')?.getAttribute('alt')"), "资源图片 1");
        await until("document.querySelector('.tool-result-image')?.complete && document.querySelector('.tool-result-image')?.naturalWidth === 1");
        assert.match(await visibleText(), /完整输出路径/);
        await assertFits(`${display}: resource image and long output path`);

        await openCase("goal", display, "light", 360);
        assert.match(await visibleText(), /UI goal snapshot/);
        assert.match(await visibleText(), /中风险/);
        assert.match(await visibleText(), /存在已知问题/);
        assert.match(await visibleText(), /pnpm test:fixture/);
        await clickSummary(".tool-result-goal .tool-result-list-item .tool-result-aux", "goal check output");
        assert.match(await visibleText(), /Fixture check passed/);
        await openCase("goal-legacy", display);
        assert.match(await visibleText(), /没有执行时的目标快照/);
        assert.match(await visibleText(), /不代表执行成功/);
        console.log(`PASS ${display}: discovery pages by 20, resources stay safe and render images, goal snapshots preserve meaning`);

        await openCase("json", display, "dark", 360);
        const jsonText = await visibleText();
        for (const expected of ["null", "空字符串", "空数组", "空对象", malicious]) assert.ok(jsonText.includes(expected), expected);
        assert.equal(await evaluate("document.querySelectorAll('.tool-result-json img, .tool-result-json script, .tool-result-json iframe').length"), 0);
        assert.equal(await evaluate("window.__toolResultXss"), false);
        assert.equal(await evaluate("document.querySelectorAll('.tool-result-json .tool-value-branch:not([open])').length > 0"), true, "Deeper JSON branches are collapsed");
        assert.ok(!jsonText.includes("Deep fixture value"));
        await evaluate("document.querySelectorAll('.tool-result-json details.tool-value-branch:not([open])').forEach(detail => detail.querySelector(':scope > summary').click())");
        await evaluate("document.querySelectorAll('.tool-result-json details.tool-value-branch:not([open])').forEach(detail => detail.querySelector(':scope > summary').click())");
        assert.match(await visibleText(), /Deep fixture value/);
        await assertFits(`${display}: JSON HTML text and long path`);
        for (const [name, expected] of [["json-null", "null"], ["json-empty-array", "空数组"], ["json-empty-object", "空对象"], ["json-empty-string", "空字符串"]]) {
          await openCase(name, display);
          assert.match(await visibleText(), new RegExp(expected));
        }
        await openCase("json-table", display, "light", 360);
        assert.equal(await evaluate("document.querySelectorAll('.tool-value-table tbody tr').length"), 20);
        assert.equal(await evaluate("document.querySelectorAll('.tool-value-table th').length"), 3);
        await evaluate("document.querySelector('.tool-result-json .tool-value-children > .tool-result-more').click()");
        await until("document.querySelectorAll('.tool-value-table tbody tr').length === 40");
        await assertFits(`${display}: structured table local scrolling`);
        await openCase("json-mixed", display);
        assert.equal(await evaluate("document.querySelectorAll('.tool-result-json .tool-value-list > li').length"), 6);
        assert.equal(await evaluate("document.querySelectorAll('.tool-result-json .tool-value-table').length"), 0);
        console.log(`PASS ${display}: JSON null/empty/mixed/deep values, safe text and table pagination`);

        await openCase("mcp-structured", display);
        assert.match(await visibleText(), /nested/);
        assert.equal(await evaluate("document.querySelectorAll('.mcp-result-list').length"), 0);
        assert.ok(!(await visibleText()).includes("工具未返回内容"), "Structured MCP content is shown even without a text body");
        await openCase("mcp-search", display);
        assert.equal(await evaluate("document.querySelector('.mcp-result-title')?.textContent"), "UI search result");
        assert.equal(await evaluate("document.querySelector('.mcp-result-title')?.getAttribute('href')"), "https://example.test/result");
        assert.equal(await evaluate("document.querySelector('.mcp-result-snippet strong')?.textContent"), "search");
        await openCase("browser-json", display);
        assert.match(await visibleText(), /browserValue/);
        assert.ok(await evaluate("!!document.querySelector('.browser-call-output .tool-result-json')"));
        await openCase("browser-shot", display);
        assert.match(await visibleText(), /Browser fixture output/);
        await until("document.querySelector('.browser-call-shot img')?.complete && document.querySelector('.browser-call-shot img')?.naturalWidth === 1");
        assert.equal(await evaluate("document.querySelector('.browser-call-shot img').getAttribute('alt')"), "浏览器截图");
        await evaluate("document.querySelector('.browser-call-shot').click()");
        assert.equal(await evaluate("document.querySelector('.browser-call-frame').classList.contains('zoomed')"), true);
        await openCase("browser-reset", display);
        assert.match(await visibleText(), /执行上下文已重置，页面与登录状态保留/);
        await openCase("checklist", display);
        assert.equal(await evaluate("document.querySelectorAll('.plan-checklist-item').length"), 3);
        assert.equal(await evaluate("document.querySelectorAll('.plan-checklist-item.is-in_progress').length"), 1);
        await openCase("diff", display);
        await until("document.querySelectorAll('.tool-diff-line').length >= 2");
        assert.match(await visibleText(), /newValue/);
        assert.ok(await evaluate("!!document.querySelector('.tool-diff-line.add, .tool-diff-line.added')"));
        console.log(`PASS ${display}: MCP search/structured results, browser JSON/screenshots, checklist and diff regressions`);
      }

      for (const locale of ["en", "zh-TW", "ja", "ko"]) {
        await openCase("shell", "compact", "dark", 360, locale);
        const text = await visibleText();
        assert.ok(!text.includes("暂无新增输出"), `${locale}: new labels do not fall back to Simplified Chinese`);
        assert.match(text, /bg-ui-1/);
        await assertFits(`${locale}: translated narrow result`);
      }
      assert.deepEqual(await evaluate("window.fixtureErrors"), [], "No renderer errors or unhandled rejections");
      assert.deepEqual(rendererFailures, [], "Renderer did not crash");
      assert.deepEqual(externalRequests, [], "All data is local; no model/service/remote image request was made");
      if (process.env.VELA_TOOL_RESULTS_CAPTURE) {
        await openCase("shell", "compact", "dark", 360);
        writeFileSync(join(process.env.VELA_TOOL_RESULTS_CAPTURE, "tool-result-shell-dark-narrow.png"), (await win.webContents.capturePage()).toPNG());
        await openCase("schedule", "card", "light", 720);
        writeFileSync(join(process.env.VELA_TOOL_RESULTS_CAPTURE, "tool-result-schedule-light.png"), (await win.webContents.capturePage()).toPNG());
      }
      console.log("PASS tool result details: all deterministic Electron UI checks passed");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    } finally { if (!win.isDestroyed()) win.destroy(); }
  }).catch(error => { console.error(error); app.exit(1); });
}
