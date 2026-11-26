/** Bottts 头像：真实 Electron 加载、跨界面同图、状态与面板切换，完全离线。 */
import { readStyles } from "./read-styles.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
const firstId = "1612940d-b11d-41b0-a34c-9a6b8de2b863";
const secondId = "f9482896-3d88-490f-99b6-95472ebfbbfa";

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-agent-avatar-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { AgentWorkspaceProvider } from './apps/desktop/src/renderer/components/AgentPanel';
        import { WorkbenchPanel } from './apps/desktop/src/renderer/components/WorkbenchPanel';
        import { ToolCard } from './apps/desktop/src/renderer/components/ToolCard';
        import { infoCardDefinitions } from './apps/desktop/src/renderer/components/info-cards/InfoCardContents';
        import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
        import { useTurnReview } from './apps/desktop/src/renderer/hooks/useTurnReview';
        import { createMessageStore, messageScope } from './apps/desktop/src/renderer/hooks/message-store';
        const root = createRoot(document.getElementById('root'));
        const noop = () => {};
        const firstId = ${JSON.stringify(firstId)};
        const secondId = ${JSON.stringify(secondId)};
        const initial = [
          {id: firstId, path: '/root/review', name: 'review', kind: 'general', status: 'running'},
          {id: secondId, path: '/root/research', name: 'research', kind: 'explore', status: 'paused'},
        ].map((agent, index) => ({
          ...agent, parentId: 'root', depth: 1, task: '检查头像与运行状态', steps: [], mutated: false,
          finalText: Array(24).fill('检查完成').join('\\n\\n'), error: null,
          usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2},
          activeMs: 1000, runningSince: agent.status === 'running' ? Date.now() : null,
          pauseRequested: false, createdAt: index + 1, updatedAt: index + 1,
        }));
        const tools = initial.map(agent => ({id: 'spawn-' + agent.id, name: 'spawn_agent', status: 'done',
          activity: {agentId: agent.id, agentPath: agent.path, agent: agent.kind, agentPrompt: agent.task}}));
        window.renderCalls = (display) => {
          setActiveLocale('en');
          const agent = {...initial[0], status: 'completed', effectiveThinkingLevel: 'high'};
          const calls = [
            ['spawn_agent', 'Create\\n  with indentation', 'Spawn receipt'],
            ['send_message', 'Follow-up message', 'Send receipt'],
            ['followup_task', 'Wait for agent', 'Archived result'],
          ];
          flushSync(() => root.render(<AppLocaleProvider locale="en"><AgentWorkspaceProvider agents={[agent]} activeAgentId={null} openAgent={noop} closeAgent={noop}>
            {calls.map(([name, agentPrompt, body]) => <ToolCard key={name} compact={display === 'compact'} tool={{id: name, name, status: 'done',
              activity: {agentId: agent.id, agentPrompt, body, ...(name === 'send_message' && {thinkingLevel: 'low'})}}} />)}
          </AgentWorkspaceProvider></AppLocaleProvider>));
        };
        const chat = 'avatar-fixture', store = createMessageStore();
        const fileEdit = (id, path, diff, status = 'done') => ({id, name: 'edit', status, activity: {path, diff}});
        const reply = (id, tools) => ({id, role: 'assistant', text: '', thinking: '', tools});
        const owned = reply('owned', [fileEdit('a', '/repo/child.ts', '-1 old\\n+1 new')]);
        const inherited = {...reply('fork', [fileEdit('root', 'parent.ts', '+1 parent')]), historical: true};
        const second = reply('second', [fileEdit('b', 'child.ts', '+2 more'), fileEdit('fail', 'failed.ts', '+1 bad', 'error')]);
        window.diffStep = step => {
          store.publish(messageScope(chat, firstId), [inherited, owned, second,
            ...(step >= 2 ? [reply('c', [fileEdit('c', 'next.ts', '+1 another')])] : []),
            ...(step >= 3 ? [{id: 'u2', role: 'user', text: 'next turn', thinking: '', tools: []}] : [])]);
          store.flush();
        };
        function Fixture({display, diff = false}) {
          const [agents, setAgents] = useState(initial);
          const [activeId, setActiveId] = useState(firstId);
          const changeStatus = (id, status) => setAgents(previous => previous.map(agent => agent.id === id
            ? {...agent, status, runningSince: status === 'running' ? Date.now() : null, updatedAt: Date.now()} : agent));
          window.setAgentStatus = (id, status) => flushSync(() => changeStatus(id, status));
          window.activeAgentId = activeId;
          const onControl = (id, action) => {
            window.lastAgentControl = {id, action};
            changeStatus(id, action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'aborted');
          };
          const tabs = agents.map(agent => ({id: agent.id, kind: 'agent', label: agent.name, title: agent.path, agent}));
          const review = useTurnReview('/repo', chat);
          const [showSummary, setShowSummary] = useState(true);
          window.setSummary = setShowSummary;
          if (review.review) tabs.push({id: review.tabId, kind: 'turn-review', label: '审查', review: review.review});
          const Body = infoCardDefinitions.agents.Body;
          return <AppLocaleProvider locale="zh-CN">
            <AgentWorkspaceProvider agents={agents} activeAgentId={activeId} openAgent={setActiveId} closeAgent={noop}>
              <section id="tools" data-tool-display={display} className="main-chat-view">
                {tools.map(tool => <ToolCard key={tool.id} tool={tool} compact={display === 'compact'} />)}
              </section>
              <section id="info"><Body ctx={{agents, onOpenAgent: setActiveId}} /></section>
              <section id="pane" className={display === 'compact' ? 'borderless-interface' : ''} style={{height: 300, display: 'flex'}}> <WorkbenchPanel
                tabs={tabs} activeTabId={activeId} contextOpen={false} leftOpen={false}
                resize={{widths: {left: 220, right: 260, workbench: 640}, workbenchDocked: false, startResize: noop, reset: noop, nudge: noop}}
                project={{workspace: {current: '/repo'}}} busy={false} execution={null} onRevise={noop} onExecutePlan={noop}
                initialDiffPath={null} initialDiffPathRequestKey={0} onShowDiff={noop}
                agents={agents} conversationId={chat} messageStore={diff ? store : undefined}
                showChangeSummary={showSummary} onRefreshReview={review.refresh}
                onReviewTurn={diff ? request => { review.open(request); setActiveId(review.tabId); } : undefined}
                ensureAgentMessages={noop} onControlAgent={onControl} onOpenAgent={setActiveId}
                onNewTab={noop} onStartAction={noop} gitAvailable={false}
                onActivateTab={tab => setActiveId(tab.id)} onCloseTab={noop} /></section>
            </AgentWorkspaceProvider>
          </AppLocaleProvider>;
        }
        window.renderDiff = () => {
          setActiveLocale('zh-CN');
          window.vela = {getAgentMessages: async (conversation, agent, scope) =>
            conversation === chat && agent === firstId && scope === 'owned' ? [owned, ...(window.finalSaved ? [reply('final', [fileEdit('final', 'final.ts', '+1 saved')])] : [])] : []};
          window.diffStep(1);
          flushSync(() => root.render(<Fixture key="diff" display="compact" diff />));
        };
        let revision = 0;
        window.renderCase = (scheme, display) => {
          setActiveLocale('zh-CN');
          document.documentElement.dataset.scheme = scheme;
          window.lastAgentControl = null;
          flushSync(() => root.render(<Fixture key={++revision} display={display} />));
        };
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
      logLevel: "error",
    });
    const css = readStyles(join(here, "../src/renderer/styles.css")) + "\n" +
      readFileSync(join(here, "../src/renderer/info-cards.css"), "utf8");
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>' + css +
      '</style></head><body><div id="root" style="padding:20px"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_AGENT_AVATAR_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Bottts 头像 Electron 检查失败");
    } finally { clearTimeout(timer); }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_AGENT_AVATAR_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1440, height: 850,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const external = [];
    const errors = [];
    win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
      external.push(details.url);
      callback({ cancel: true });
    });
    win.webContents.on("console-message", (details) => {
      if (details.level === "error" && !details.message.includes("Electron Security Warning")) errors.push(details.message);
    });
    const evaluate = code => win.webContents.executeJavaScript(code);
    let currentCase = "启动";
    const until = async code => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(done => setTimeout(done, 20));
      }
      throw new Error(`超时 (${currentCase}): ${code}\n${await evaluate('document.body.innerText.slice(-1600)')}`);
    };
    const imagesReady = "document.querySelectorAll('img.agent-avatar').length >= 5 && [...document.querySelectorAll('img.agent-avatar')].every(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)";
    const menu = "#pane button[aria-haspopup='listbox']";
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const snapshot = () => evaluate(`(() => {
      const imgs = selector => [...document.querySelectorAll(selector)].map(img => ({
        src: img.src, width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height,
        alt: img.alt, hidden: img.getAttribute('aria-hidden'),
      }));
      return {tools: imgs('#tools img.agent-avatar'), info: imgs('#info img.agent-avatar'), pane: imgs('#pane .agent-pane-title img.agent-avatar'), tabs: imgs('#pane .workbench-tab img.agent-avatar')};
    })()`);
    try {
      await win.loadFile(join(process.env.VELA_AGENT_AVATAR_TEMP, "index.html"));
      let canonical;
      for (const scheme of ["light", "dark"]) {
        for (const display of ["compact", "card"]) {
          currentCase = `${scheme}/${display}`;
          await evaluate(`window.renderCase(${JSON.stringify(scheme)}, ${JSON.stringify(display)})`);
          await until(imagesReady);
          const header = await evaluate(`(() => {
            const header = document.querySelector('#pane .agent-pane-header');
            const scroll = document.querySelector('#pane .agent-pane-scroll');
            const stream = scroll.querySelector('.agent-stream');
            const menuButton = header.querySelector('button[aria-haspopup="listbox"]');
            const rect = menuButton.getBoundingClientRect();
            scroll.scrollTop = 0;
            const bounds = header.getBoundingClientRect();
            const firstClear = stream.getBoundingClientRect().top >= bounds.bottom;
            scroll.scrollTop = bounds.height;
            const streamTop = stream.getBoundingClientRect().top;
            return {
              firstClear, underHeader: bounds.top <= streamTop && streamTop < bounds.bottom,
              fixed: header.getBoundingClientRect().top === bounds.top,
              border: getComputedStyle(header).borderBottomWidth,
              fade: getComputedStyle(header, '::before').backgroundImage,
              menuClickable: menuButton.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
            };
          })()`);
          assert.ok(header.firstClear && header.underHeader && header.fixed, `${currentCase}: 消息从悬浮栏下方开始，滚动时经过栏后`);
          assert.equal(header.border, '0px');
          assert.match(header.fade, /linear-gradient/);
          assert.ok(header.menuClickable, `${currentCase}: 渐隐层不遮挡代理列表按钮`);
          const before = await snapshot();
          assert.equal(before.tools.length, 2, `${currentCase}: 两张工具卡都有头像`);
          assert.equal(before.info.length, 2, `${currentCase}: 信息卡中运行与暂停代理都保留头像`);
          assert.equal(before.pane.length, 1, `${currentCase}: 面板标题保留头像`);
          const sources = before.tools.map(img => img.src);
          assert.notEqual(sources[0], sources[1], `${currentCase}: 不同代理具有不同外观`);
          assert.deepEqual(before.info.map(img => img.src), sources, `${currentCase}: 信息卡与工具卡同图`);
          assert.equal(before.pane[0].src, sources[0], `${currentCase}: 面板标题与工具卡同图`);
          assert.deepEqual(before.tabs.map(img => img.src), sources, `${currentCase}: 工作面板标签与工具卡同图`);
          for (const img of before.tabs) {
            assert.equal(img.width, 18, `${currentCase}: 标签头像18px`);
            assert.equal(img.height, 18, `${currentCase}: 标签头像保持方形`);
          }
          assert.ok(await evaluate("Boolean(document.querySelector('.workbench-tab .tool-activity-loader') && document.querySelector('.workbench-tab .agent-status-dot.is-paused'))"), `${currentCase}: 标签头像没有取代独立状态标记`);
          if (canonical) assert.deepEqual(sources, canonical, `${currentCase}: 主题或展示模式变化不改变身份`);
          canonical = sources;
          for (const img of [...before.tools, ...before.info, ...before.pane]) {
            assert.ok(img.src.startsWith("data:image/svg+xml;utf8,"), `${currentCase}: 本地内嵌 SVG`);
            assert.ok(img.width >= 16 && img.height >= 16, `${currentCase}: 小头像没有被布局压扁`);
            assert.equal(img.width, img.height, `${currentCase}: 头像保持方形`);
            assert.equal(img.alt, "");
            assert.equal(img.hidden, "true");
          }
          assert.ok(await evaluate("Boolean(document.querySelector('#tools .tool-activity-loader') && document.querySelector('#pane .agent-pane-title .tool-activity-loader'))"), `${currentCase}: 运行状态独立于头像`);
          assert.ok(await evaluate("Boolean(document.querySelector('#tools .agent-status-dot.is-paused') && document.querySelector('#info .info-card-chip.is-paused'))"), `${currentCase}: 暂停状态独立于头像`);

          // 真正点击暂停与继续控件，头像不跟随运行状态消失或变化。
          await click('#pane .agent-pane-actions button[aria-label="暂停（在下一次调用工具前生效）"]');
          await until("document.querySelector('#pane .agent-pane-title .agent-status-dot.is-paused')");
          assert.deepEqual(await evaluate("window.lastAgentControl"), { id: firstId, action: "pause" });
          assert.equal((await snapshot()).pane[0].src, sources[0]);
          await click('#pane .agent-pane-actions button[aria-label="继续"]');
          await until("document.querySelector('#pane .agent-pane-title .tool-activity-loader')");
          assert.deepEqual(await evaluate("window.lastAgentControl"), { id: firstId, action: "resume" });

          await click(menu);
          await until("document.querySelectorAll('.agent-roster-menu-item img.agent-avatar').length === 2");
          await until(imagesReady);
          assert.deepEqual(await evaluate("[...document.querySelectorAll('.agent-roster-menu-item img.agent-avatar')].map(img => img.src)"), sources, `${currentCase}: roster 同图`);
          assert.ok(await evaluate("Boolean(document.querySelector('.agent-roster-menu-item .tool-activity-loader') && document.querySelector('.agent-roster-menu-item .agent-status-dot.is-paused'))"), `${currentCase}: roster 保留各自状态`);
          await evaluate("document.querySelectorAll('.agent-roster-menu-item')[1].click()");
          await until(`window.activeAgentId === ${JSON.stringify(secondId)} && !document.querySelector('.agent-roster-menu') && document.querySelectorAll('#pane .agent-pane-title img.agent-avatar').length === 1`);
          assert.equal((await snapshot()).pane[0].src, sources[1], `${currentCase}: roster 切换面板使用所选身份`);
          await click(menu);
          await until("document.querySelector('.agent-roster-menu')");
          await click(menu);
          await until("!document.querySelector('.agent-roster-menu')");

          // 点击标签页本身切回另一个代理，再切回来；不只验证 roster 的间接切换。
          await evaluate("document.querySelectorAll('.workbench-tab')[0].click()");
          await until(`window.activeAgentId === ${JSON.stringify(firstId)} && document.querySelectorAll('#pane .agent-pane-title img.agent-avatar').length === 1`);
          assert.equal((await snapshot()).pane[0].src, sources[0], `${currentCase}: 标签切换到第一个代理`);
          await evaluate("document.querySelectorAll('.workbench-tab')[1].click()");
          await until(`window.activeAgentId === ${JSON.stringify(secondId)} && document.querySelectorAll('#pane .agent-pane-title img.agent-avatar').length === 1`);
          assert.equal((await snapshot()).pane[0].src, sources[1], `${currentCase}: 标签切回第二个代理`);

          for (const status of ["idle", "paused", "completed", "failed", "aborted", "running"]) {
            await evaluate(`window.setAgentStatus(${JSON.stringify(secondId)}, ${JSON.stringify(status)})`);
            await until(`document.querySelector('#info .info-card-chip.is-${status}')`);
            assert.equal(await evaluate("document.querySelectorAll('#pane .agent-pane-title .agent-state').length"), 0, `${currentCase}/${status}: 顶栏不重复显示状态文字`);
            const updated = await snapshot();
            assert.equal(updated.pane[0].src, sources[1], `${currentCase}/${status}: 状态更新不改变头像`);
            assert.deepEqual(updated.tabs.map(img => img.src), sources, `${currentCase}/${status}: 标签头像不跟随状态变化`);
            const marker = status === "running" ? ".tool-activity-loader" : `.agent-status-dot.is-${status}`;
            assert.ok(await evaluate(`document.querySelector('#pane .agent-pane-title ${marker}')?.getAttribute('aria-label')`), `${currentCase}/${status}: 顶栏保留带无障碍名称的状态标记`);
            assert.ok(await evaluate(`Boolean(document.querySelectorAll('.workbench-tab')[1].querySelector(${JSON.stringify(marker)}))`), `${currentCase}/${status}: 标签状态标记仍可见`);
          }
          await until(imagesReady);
        }
      }
      for (const display of ['card', 'compact']) {
        currentCase = `call details/${display}`;
        await evaluate(`window.renderCalls('${display}')`);
        const buttons = display === 'compact' ? '.agent-compact-toggle.is-tail' : '.tool-card-open[aria-expanded]';
        await evaluate(`[...document.querySelectorAll('${buttons}')].forEach(button => button.click())`);
        await until(`document.querySelectorAll('.agent-call-details').length === 3 && document.body.innerText.includes('Archived result')`);
        const rows = await evaluate(`[...document.querySelectorAll('.agent-call-details')].map(row => [row.querySelector('strong').textContent, row.querySelector('dt').textContent, row.querySelector('dd').textContent.trim()])`);
        assert.deepEqual(rows, [['High', 'Prompt', 'Create\n  with indentation'], ['Low', 'Prompt', 'Follow-up message'], ['High', 'Result', 'Archived result']], currentCase);
        assert.doesNotMatch(await evaluate('document.body.innerText'), /Spawn receipt|Send receipt|Wait for agent|检查完成/);
      }
      currentCase = '子代理 diff 胶囊';
      await evaluate('window.renderDiff()');
      const badge = '.agent-pane .chat-dock-wrapper > .composer-change-summary';
      await until(`document.querySelector('${badge}')?.textContent === '1 个文件已更改+2−1'`);
      await evaluate('window.setSummary(false)');
      await until(`!document.querySelector('${badge}')`);
      await evaluate('window.setSummary(true)');
      await until(`document.querySelector('${badge}')`);
      await click(badge);
      await until("document.querySelector('.turn-review-view')?.textContent.includes('child.ts') && !document.querySelector('.agent-pane')");
      assert.doesNotMatch(await evaluate("document.querySelector('.turn-review-view').textContent"), /parent\.ts|failed\.ts/);
      await evaluate('window.diffStep(2)');
      await until("document.querySelectorAll('.turn-review-file').length === 2 && document.querySelector('.turn-review-view').textContent.includes('next.ts')");
      await evaluate(`window.finalSaved = true; window.setAgentStatus(${JSON.stringify(firstId)}, 'completed')`);
      await until("document.querySelectorAll('.turn-review-file').length === 3 && document.querySelector('.turn-review-view').textContent.includes('final.ts')");
      await evaluate('window.diffStep(3)');
      await evaluate(`window.setAgentStatus(${JSON.stringify(firstId)}, 'running')`);
      await evaluate("document.querySelectorAll('.workbench-tab')[0].click()");
      await until(`document.querySelector('.agent-pane') && !document.querySelector('${badge}')`);
      console.log('子代理 diff：归属隔离、行数去重、显示开关、实时审查和新回合清空通过。');
      assert.deepEqual(external, [], "头像加载不依赖任何外部网络请求");
      assert.deepEqual(errors, [], "组件加载与交互不产生控制台错误");
      console.log("Bottts 头像 UI：浅/深色 × 紧凑/卡片；图片加载、跨界面同图、六种状态、暂停/继续、roster 与工作面板标签切换全部通过。");
      app.exit(0);
    } catch (error) {
      console.error(error);
      if (errors.length) console.error("渲染错误：", errors);
      app.exit(1);
    }
  });
}
