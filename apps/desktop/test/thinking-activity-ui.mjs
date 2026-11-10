/** Real Electron regression coverage for live tool activity in thinking group headlines. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStyles } from "./read-styles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-thinking-activity-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { flushSync } from 'react-dom';
          import { ThinkingGroup, CoherentGroup } from './apps/desktop/src/renderer/components/Thinking';
          import { ToolList } from './apps/desktop/src/renderer/components/ToolCard';
          import { ThinkingActivityDelayContext } from './apps/desktop/src/renderer/hooks/useDelayedThinkingActivity';
          import { defaultThinkingActivityDelayMs } from './apps/desktop/src/renderer/thinking-activity-delay';
          import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
          // Control only the headline delay; leave animations and unrelated timers real.
          window.activityDelay = defaultThinkingActivityDelayMs;
          const realSetTimeout = window.setTimeout.bind(window);
          const realClearTimeout = window.clearTimeout.bind(window);
          const activityTimers = new Map();
          let clock = 0;
          let nextTimerId = -1;
          window.setTimeout = (callback, delay, ...args) => {
            if (delay !== window.activityDelay || typeof callback !== 'function') {
              return realSetTimeout(callback, delay, ...args);
            }
            const id = nextTimerId--;
            activityTimers.set(id, {at: clock + delay, fire: () => callback(...args)});
            return id;
          };
          window.clearTimeout = id => {
            if (!activityTimers.delete(id)) realClearTimeout(id);
          };
          window.pendingActivityTimers = () => activityTimers.size;
          window.advanceActivityTime = ms => {
            const target = clock + ms;
            while (true) {
              const next = [...activityTimers].sort((a, b) => a[1].at - b[1].at)[0];
              if (!next || next[1].at > target) break;
              clock = next[1].at;
              activityTimers.delete(next[0]);
              flushSync(next[1].fire);
            }
            clock = target;
          };
          const root = createRoot(document.getElementById('root'));
          const thought = '**Planning the change**\\n\\nInspect files, then update and verify.';
          let revision = 0;
          let state;
          function Fixture({mode, locale, tools, live, delayMs}) {
            const children = <div data-tool-body><ToolList tools={tools} display="compact" fold="none" /></div>;
            const entries = [{type: 'thinking', id: 'thought', messageId: 'message', text: thought},
              ...tools.map(tool => ({type: 'tool', id: tool.id, messageId: 'message', tool}))];
            return <AppLocaleProvider locale={locale}>
              <ThinkingActivityDelayContext.Provider value={delayMs}>
              <main className="main-chat-view" data-tool-display="compact" style={{width: 390, padding: 20}}>
                <article className="assistant-block">
                  {mode === 'single'
                    ? <ThinkingGroup model="gpt-6.1" messageId="message" text={thought}
                        active={false} live={live} tools={tools} showActivityIndicator>{children}</ThinkingGroup>
                    : <CoherentGroup entries={entries} live={live} showActivityIndicator codex={mode === 'codex'}>
                        {children}
                      </CoherentGroup>}
                </article>
              </main>
              </ThinkingActivityDelayContext.Provider>
            </AppLocaleProvider>;
          }
          function paint() {
            setActiveLocale(state.locale);
            window.activityDelay = state.delayMs;
            flushSync(() => root.render(<Fixture key={revision} {...state} />));
          }
          window.beginCase = (mode, locale, tools = [], live = true) => {
            revision += 1;
            state = {mode, locale, tools, live, delayMs: defaultThinkingActivityDelayMs};
            paint();
          };
          window.updateCase = patch => { state = {...state, ...patch}; paint(); };
        `,
        resolveDir: resolve(here, "../../.."), loader: "tsx",
      },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
      logLevel: "error",
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><style>' +
      readStyles(join(here, "../src/renderer/styles.css")) +
      '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_THINKING_ACTIVITY_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const code = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      assert.equal(code, 0, "Thinking activity Electron checks failed");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_THINKING_ACTIVITY_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 650, height: 650,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => {
      if (event.level === "error") errors.push(event.message);
    });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const headline = ".thinking-header > .thinking-headline-trigger";
    const excerpt = `${headline} .thinking-summary-excerpt`;
    let currentCase = "loading";
    const until = async code => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`Timed out (${currentCase}): ${code}`);
    };
    const tool = (name, id = name, activity = {}, status = "running") => ({ id, name, status, activity });
    const rich = `${headline} .thinking-tool-activity`;
    const body = "[data-tool-body]";
    const labels = {
      "zh-CN": { read: "正在读取", edit: "正在编辑", write: "正在创建", bash: "正在运行命令", other: "正在使用工具", search: "正在搜索", list: "正在列出目录" },
      en: { read: "Reading", edit: "Editing", write: "Creating", bash: "Running commands", other: "Using tools", search: "Searching for", list: "Listing directory" },
    };
    const update = patch => evaluate(`window.updateCase(${JSON.stringify(patch)})`);
    const assertHeaderIsolation = async () => {
      const state = await evaluate(`(() => {
        const header = document.querySelector(${JSON.stringify(headline)});
        return { nested: header.querySelectorAll('button, [role="button"]').length,
          stats: header.querySelectorAll('.tool-stat, .tool-compact-stat, .tool-stat-add, .tool-stat-del, .thinking-group-stat, .compact-diff-card-stat').length };
      })()`);
      assert.equal(state.nested, 0, `${currentCase}: rich details never nest interactive controls inside the group button`);
      assert.equal(state.stats, 0, `${currentCase}: group headline never displays diff or streaming statistics`);
    };
    const expectSummary = async expected => {
      await until(`document.querySelector(${JSON.stringify(excerpt)})?.textContent === ${JSON.stringify(expected)}`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(headline)}).title`), expected,
        `${currentCase}: summary tooltip matches its title`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rich)}) === null`), true,
        `${currentCase}: inactive headline restores the plain summary`);
      await assertHeaderIsolation();
    };
    const expectActivity = async (label, detail) => {
      await evaluate("window.advanceActivityTime(window.activityDelay)");
      const full = label + (detail ? ` · ${detail}` : "");
      await until(`document.querySelector(${JSON.stringify(rich)})?.querySelector('.tool-compact-action')?.textContent === ${JSON.stringify(label)}`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(headline)}).title`), full,
        `${currentCase}: tooltip retains the full raw path/command independently of rich details`);
      await assertHeaderIsolation();
    };
    const compareDetails = async (topSelector, bottomSelector, properties = ["text"]) => {
      const pair = await evaluate(`(() => {
        const read = (root, selector) => {
          const node = document.querySelector(root)?.querySelector(selector);
          if (!node) return null;
          const style = getComputedStyle(node);
          return {text: node.textContent, src: node.getAttribute('src'), font: style.fontFamily,
            plain: node.classList.contains('is-plain'), svg: node.outerHTML};
        };
        return [read(${JSON.stringify(rich)}, ${JSON.stringify(topSelector)}), read(${JSON.stringify(body)}, ${JSON.stringify(bottomSelector)})];
      })()`);
      assert.ok(pair[0], `${currentCase}: top details contain ${topSelector}`);
      assert.ok(pair[1], `${currentCase}: lower tool details contain ${bottomSelector}`);
      for (const property of properties) {
        assert.deepEqual(pair[0][property], pair[1][property], `${currentCase}: rich headline shares lower ${property} for ${topSelector}`);
      }
      return pair[0];
    };
    const compareFile = async (name, dir = "") => {
      const icon = await compareDetails('.file-type-icon', '.tool-compact-line .file-type-icon', ['src']);
      assert.ok(icon.src, `${currentCase}: file icon has an actual image source`);
      const file = await compareDetails('.tool-compact-name', '.tool-compact-line .tool-compact-name');
      assert.equal(file.text, name, `${currentCase}: basename matches the file below`);
      const dirs = await evaluate(`[document.querySelector(${JSON.stringify(rich)})?.querySelector('.tool-compact-dir')?.textContent ?? '', document.querySelector(${JSON.stringify(body)})?.querySelector('.tool-compact-line .tool-compact-dir')?.textContent ?? '']`);
      assert.deepEqual(dirs, [dir, dir], `${currentCase}: top and lower file directories match`);
    };
    const compareBash = async (name, dir, code = false) => {
      const cmd = await compareDetails('.tool-compact-cmd', '.tool-compact-line .tool-compact-cmd', ['text', 'font', 'plain']);
      assert.equal(cmd.text, name, `${currentCase}: command headline uses the same intent subject`);
      assert.equal(cmd.plain, !code, `${currentCase}: search/command subjects retain code styling`);
      const dirs = await evaluate(`[document.querySelector(${JSON.stringify(rich)})?.querySelector('.tool-compact-dir')?.textContent ?? '', document.querySelector(${JSON.stringify(body)})?.querySelector('.tool-compact-line .tool-compact-dir')?.textContent ?? '']`);
      assert.deepEqual(dirs, [dir, dir], `${currentCase}: command intent scope matches the lower row`);
      if (code) {
        const mono = await evaluate(`(() => { const probe = document.createElement('span'); probe.style.fontFamily = 'var(--font-mono)'; document.body.append(probe); const font = getComputedStyle(probe).fontFamily; probe.remove(); return font; })()`);
        assert.equal(cmd.font, mono, `${currentCase}: actual computed subject font is the configured monospace font`);
      }
    };
    const assertIdentity = async () => {
      assert.equal(await evaluate(`window.savedHeadline === document.querySelector(${JSON.stringify(headline)})`), true,
        `${currentCase}: live updates preserve the same headline DOM node`);
      assert.equal(await evaluate(`window.savedBlock === document.querySelector('.thinking-block')`), true,
        `${currentCase}: live updates preserve the same group DOM node`);
    };
    try {
      await win.loadFile(join(process.env.VELA_THINKING_ACTIVITY_TEMP, "index.html"));
      await until("typeof window.beginCase === 'function'");
      for (const locale of ["zh-CN", "en"]) {
        for (const mode of ["single", "coherent", "codex"]) {
          currentCase = `${locale}/${mode}`;
          const label = labels[locale];
          await evaluate(`window.beginCase(${JSON.stringify(mode)}, ${JSON.stringify(locale)})`);
          await expectSummary("Planning the change");
          await evaluate(`window.savedHeadline = document.querySelector(${JSON.stringify(headline)}); window.savedBlock = document.querySelector('.thinking-block')`);
          const path = "/workspace/apps/desktop/src/renderer/components/Thinking.tsx";
          const dir = "/workspace/apps/desktop/src/renderer/components";

          // Fast completed/failed calls must never replace the thought, even after their old deadline.
          const quick = await evaluate(`(() => {
            const titles = [];
            const capture = () => titles.push(document.querySelector(${JSON.stringify(headline)}).title);
            for (const [index, name] of ['read', 'edit', 'write', 'bash'].entries()) {
              const call = {id: 'quick-' + name, name, status: 'running', activity: {path: 'quick.ts', command: 'pnpm test'}};
              window.updateCase({tools: [call]});
              capture();
              window.advanceActivityTime(window.activityDelay - 1);
              capture();
              window.updateCase({tools: [{...call, status: index === 1 ? 'error' : 'done'}]});
              window.advanceActivityTime(window.activityDelay + 1);
              capture();
            }
            return {titles, pending: window.pendingActivityTimers()};
          })()`);
          assert.ok(quick.titles.every(title => title === "Planning the change"), `${currentCase}: quick calls never flash a tool headline`);
          assert.equal(quick.pending, 0, `${currentCase}: quick calls leave no stale timers`);
          await expectSummary("Planning the change");

          // Replacing a pending call starts a fresh delay; updates to that same call do not.
          const pending = await evaluate(`(() => {
            const first = {id: 'pending-first', name: 'read', status: 'running', activity: {path: 'first.ts'}};
            const second = {id: 'pending-second', name: 'edit', status: 'running', activity: {path: 'before.ts'}};
            window.updateCase({tools: [first]});
            window.advanceActivityTime(window.activityDelay * 0.4);
            window.updateCase({tools: [second]});
            window.advanceActivityTime(window.activityDelay * 0.7);
            const beforeThreshold = document.querySelector(${JSON.stringify(excerpt)}).textContent;
            const timersAfterReplacement = window.pendingActivityTimers();
            window.updateCase({tools: [{...second, activity: {path: 'after.ts'}}]});
            window.advanceActivityTime(window.activityDelay * 0.3 - 1);
            const beforeBoundary = document.querySelector(${JSON.stringify(excerpt)}).textContent;
            window.advanceActivityTime(1);
            return {beforeThreshold, beforeBoundary, timersAfterReplacement,
              title: document.querySelector(${JSON.stringify(headline)}).title};
          })()`);
          assert.equal(pending.beforeThreshold, "Planning the change", `${currentCase}: each new call waits its own full delay`);
          assert.equal(pending.timersAfterReplacement, 1, `${currentCase}: replacing a pending call cancels its timer`);
          assert.equal(pending.beforeBoundary, "Planning the change", `${currentCase}: the thought remains until the exact delay boundary`);
          assert.equal(pending.title, label.edit + " · after.ts", `${currentCase}: streaming updates keep the original timer and show fresh details`);
          await update({tools: []});
          await expectSummary("Planning the change");

          // Unmounting the group cancels its pending activity timer.
          await update({tools: [tool("read", "unmounted", {path: "stale.ts"})]});
          await evaluate(`window.beginCase(${JSON.stringify(mode)}, ${JSON.stringify(locale)})`);
          assert.equal(await evaluate("window.pendingActivityTimers()"), 0, `${currentCase}: unmount cancels the pending timer`);
          await evaluate("window.advanceActivityTime(window.activityDelay + 1)");
          await expectSummary("Planning the change");
          await evaluate(`window.savedHeadline = document.querySelector(${JSON.stringify(headline)}); window.savedBlock = document.querySelector('.thinking-block')`);

          for (const delayMs of [100, 1200, 5000]) {
            await update({tools: [tool("edit", "custom-delay-" + delayMs, {path})], delayMs});
            await expectSummary("Planning the change");
            await evaluate(`window.advanceActivityTime(${delayMs - 1})`);
            await expectSummary("Planning the change");
            await evaluate("window.advanceActivityTime(1)");
            await expectActivity(label.edit, path);
          }
          // A changed threshold invalidates the old visible state; disabling it is immediate.
          await update({delayMs: 1200});
          await expectSummary("Planning the change");
          await evaluate("window.advanceActivityTime(1199)");
          await expectSummary("Planning the change");
          await update({delayMs: 0});
          await expectActivity(label.edit, path);
          assert.equal(await evaluate("window.pendingActivityTimers()"), 0, `${currentCase}: disabling cancels the delay timer`);
          await update({tools: [tool("read", "no-delay", {path})]});
          await expectActivity(label.read, path);
          await update({delayMs: 1200});
          await expectSummary("Planning the change");
          await expectActivity(label.read, path);
          await update({tools: [], delayMs: 500});
          await expectSummary("Planning the change");

          for (const name of ["read", "edit", "write"]) {
            await update({ tools: [tool(name, name, { path })] });
            await expectActivity(label[name], path);
            await compareFile("Thinking.tsx", dir);
            await assertIdentity();
          }
          for (const name of ["read", "edit", "write", "bash"]) {
            await update({ tools: [tool(name)] });
            await expectActivity(label[name]);
          }

          const skill = "/workspace/.vela/skills/ui-ux-pro-max/SKILL.md";
          await update({ tools: [tool("read", "skill", { path: skill })] });
          await expectActivity(label.read, skill);
          await compareFile("ui-ux-pro-max");
          const skillIcons = await evaluate(`[
            document.querySelector(${JSON.stringify(headline)})?.querySelector('.tool-compact-icon svg')?.outerHTML,
            document.querySelector(${JSON.stringify(body)})?.querySelector('.tool-compact-icon svg')?.outerHTML
          ]`);
          assert.ok(skillIcons[0], `${currentCase}: skill action uses an icon`);
          assert.equal(skillIcons[0], skillIcons[1], `${currentCase}: skill action icon matches the lower row`);

          const search = 'rg -n "thinkingActivity" apps/desktop/src';
          await update({ tools: [tool("bash", "search", { command: search })] });
          await expectActivity(label.search, search);
          await compareBash("thinkingActivity", locale === "en" ? "in apps/desktop/src" : "于 apps/desktop/src", true);
          for (const [command, action, subject] of [["ls apps/desktop/src", label.list, "apps/desktop/src"], ["cat src/fixture.ts", label.read, "src/fixture.ts"]]) {
            await update({ tools: [tool("bash", "intent", { command })] });
            await expectActivity(action, command);
            await compareBash(subject, "");
          }

          await update({ tools: [tool("inspect_project", "generic", { path: "/workspace/project.json" })] });
          await expectActivity(label.other, "inspect_project · /workspace/project.json");
          const generic = await compareDetails('.tool-card-name', '.tool-card-head .tool-card-name', ['text', 'font']);
          assert.equal(generic.text, "project.json", `${currentCase}: generic tool uses its lower subject`);
          await compareDetails('.tool-card-dir', '.tool-card-head .tool-card-dir');
          await update({ tools: [tool("web_search", "web", { command: "real-time tool activity" })] });
          await expectActivity(label.other, "web_search · real-time tool activity");
          await compareDetails('.tool-card-name', '.tool-card-head .tool-card-name');

          await update({ tools: [tool("mcp__fixture__lookup", "mcp", { mcp: { server: "fixture", tool: "lookup" }, command: "project" })] });
          await expectActivity(label.other, "fixture / lookup · project");
          const mcp = await compareDetails('.tool-card-name', '.tool-card-head .tool-card-name');
          assert.equal(mcp.text, "lookup", `${currentCase}: MCP headline shows the actual tool identity`);
          const server = await compareDetails('.tool-mcp-source', '.tool-card-head .tool-mcp-source');
          assert.equal(server.text, "fixture", `${currentCase}: MCP source matches the lower card`);

          await update({ tools: [tool("spawn_agent", "agent", { agent: "general", agentId: "activity-agent", agentPath: "/root/activity-agent", body: "Verify headline presentation" })] });
          await expectActivity(label.other, "spawn_agent");
          const agent = await compareDetails('.agent-compact-name', '.agent-compact-name');
          assert.equal(agent.text, "/root/activity-agent", `${currentCase}: agent headline retains the agent path`);
          const avatar = await evaluate(`[
            document.querySelector(${JSON.stringify(headline)})?.querySelector('.agent-avatar')?.getAttribute('src'),
            document.querySelector(${JSON.stringify(body)})?.querySelector('.agent-avatar')?.getAttribute('src')
          ]`);
          assert.ok(avatar[0], `${currentCase}: agent headline displays an avatar`);
          assert.equal(avatar[0], avatar[1], `${currentCase}: agent headline shares the lower avatar`);
          const agentKinds = await evaluate(`[
            Array.from(document.querySelector(${JSON.stringify(rich)}).querySelectorAll('.tool-compact-action')).at(-1)?.textContent,
            document.querySelector(${JSON.stringify(body)})?.querySelector('.agent-compact-line .tool-compact-action')?.textContent
          ]`);
          assert.equal(agentKinds[0], agentKinds[1], `${currentCase}: agent subtype label matches the lower row`);

          const browser = 'await tab.goto("https://example.com/docs"); await tab.snapshot(); await tab.screenshot();';
          await update({ tools: [tool("browser_repl", "browser", { command: browser })] });
          await expectActivity(label.other, `browser_repl · ${browser}`);
          const steps = await evaluate(`[
            Array.from(document.querySelector(${JSON.stringify(rich)})?.querySelectorAll('.browser-call-step') ?? [], node => ({text: node.textContent, kind: node.className})),
            Array.from(document.querySelector(${JSON.stringify(body)})?.querySelectorAll('.browser-call-head .browser-call-step') ?? [], node => ({text: node.textContent, kind: node.className}))
          ]`);
          assert.equal(steps[0].length, 3, `${currentCase}: browser headline contains the parsed open/snapshot/screenshot steps`);
          assert.deepEqual(steps[0], steps[1], `${currentCase}: browser summary shares the lower chips`);
          await assertIdentity();

          const diff = "-1 old\n+1 first\n+2 second";
          const editing = tool("edit", "stat-edit", { path, diff, streaming: { added: 2, removed: 1 } });
          await update({ tools: [editing] });
          await expectActivity(label.edit, path);
          await compareFile("Thinking.tsx", dir);
          await until(`Boolean(document.querySelector(${JSON.stringify(body)})?.querySelector('.tool-stat-add'))`);
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(body)}).querySelector('.tool-stat-add').textContent`), "+2",
            `${currentCase}: lower streaming diff keeps its added lines`);
          await assertHeaderIsolation();
          await update({ tools: [{ ...editing, activity: { path, streaming: { added: 7, removed: 3 } } }] });
          await expectActivity(label.edit, path);
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(body)}).querySelector('.tool-stat-add').textContent`), "+7",
            `${currentCase}: lower row still shows live streamed line counts`);
          await assertHeaderIsolation();
          await update({ tools: [tool("edit", "stat-edit", { path, diff }, "done")], live: false });
          await expectSummary(mode === "single" ? "Planning the change" : locale === "en" ? "Edited files" : "编辑了文件");
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(body)}).querySelector('.tool-stat-add').textContent`), "+2",
            `${currentCase}: ended tool row keeps its diff statistics`);
          await assertHeaderIsolation();
          await update({ live: true });

          const reader = tool("read", "parallel-read", { path });
          const editor = tool("edit", "parallel-edit", { path: "src/current.ts" });
          await update({ tools: [reader, editor] });
          await expectActivity(label.edit, "src/current.ts");
          await update({ tools: [reader, { ...editor, status: "done" }] });
          await expectActivity(label.read, path);
          await update({ tools: [{ ...reader, status: "done" }, { ...editor, status: "error" }] });
          await expectSummary("Planning the change");
          await assertIdentity();

          const command = `pnpm --filter @vela/desktop exec node ${"packages/very-long-directory/".repeat(16)}test.mjs --verify`;
          await update({ tools: [tool("bash", "long-command", { command })] });
          await expectActivity(label.bash, command);
          await compareBash(command, "", true);
          const overflow = await evaluate(`(() => {
            const text = document.querySelector(${JSON.stringify(rich)})?.querySelector('.tool-compact-cmd');
            const style = getComputedStyle(text);
            const button = document.querySelector(${JSON.stringify(headline)});
            return { overflow: style.overflow, ellipsis: style.textOverflow, nowrap: style.whiteSpace,
              clipped: text.scrollWidth > text.clientWidth, width: button.getBoundingClientRect().width,
              container: document.querySelector('.assistant-block').getBoundingClientRect().width };
          })()`);
          assert.equal(overflow.overflow, "hidden", `${currentCase}: long rich command clips`);
          assert.equal(overflow.ellipsis, "ellipsis", `${currentCase}: long rich command uses ellipsis`);
          assert.equal(overflow.nowrap, "nowrap", `${currentCase}: long rich command remains one line`);
          assert.equal(overflow.clipped, true, `${currentCase}: long rich command actually overflows its subject`);
          assert.ok(overflow.width <= overflow.container + 1, `${currentCase}: long title does not widen the group`);

          const open = await evaluate(`document.querySelector(${JSON.stringify(headline)}).getAttribute('aria-expanded') === 'true'`);
          if (!open) await evaluate(`document.querySelector(${JSON.stringify(headline)}).click()`);
          await until(`document.querySelector(${JSON.stringify(headline)}).getAttribute('aria-expanded') === 'true'`);
          await evaluate(`document.querySelector(${JSON.stringify(headline)}).click()`);
          await until(`document.querySelector(${JSON.stringify(headline)}).getAttribute('aria-expanded') === 'false'`);
          await update({ tools: [reader] });
          await expectActivity(label.read, path);
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(headline)}).getAttribute('aria-expanded')`), "false",
            `${currentCase}: live activity updates preserve manual collapse`);
          await evaluate(`document.querySelector(${JSON.stringify(headline)}).click()`);
          await until(`document.querySelector(${JSON.stringify(headline)}).getAttribute('aria-expanded') === 'true'`);
          await assertIdentity();

          await update({ live: false });
          await expectSummary(mode === "single" ? "Planning the change" : locale === "en" ? "Read files" : "读取了文件");
          await assertIdentity();
        }
      }
      assert.deepEqual(errors, [], "No renderer console errors");
      console.log("Thinking activity UI: single/coherent/codex × zh-CN/en; configurable delays, immediate activity when disabled, delayed headlines, quick-call suppression, timer cancellation/replacement, uninterrupted streaming, shared rich file/skill/bash/generic/MCP/agent/browser details, code fonts, statistics isolation, no nested controls, stable nodes, parallel fallback, stale completion, truncation/tooltips and disclosure passed");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
