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
        import { AppLocaleProvider } from './apps/desktop/src/renderer/locale';
        const root = createRoot(document.getElementById('root'));
        const noop = () => {};
        const firstId = ${JSON.stringify(firstId)};
        const secondId = ${JSON.stringify(secondId)};
        const initial = [
          {id: firstId, path: '/root/review', name: 'review', kind: 'general', status: 'running'},
          {id: secondId, path: '/root/research', name: 'research', kind: 'explore', status: 'paused'},
        ].map((agent, index) => ({
          ...agent, parentId: 'root', depth: 1, task: '检查头像与运行状态', steps: [], mutated: false,
          finalText: '检查完成', error: null,
          usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2},
          activeMs: 1000, runningSince: agent.status === 'running' ? Date.now() : null,
          pauseRequested: false, createdAt: index + 1, updatedAt: index + 1,
        }));
        const tools = initial.map(agent => ({id: 'spawn-' + agent.id, name: 'spawn_agent', status: 'done',
          activity: {agentId: agent.id, agentPath: agent.path, agent: agent.kind, body: agent.task}}));
        function Fixture({display}) {
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
          const Body = infoCardDefinitions.agents.Body;
          return <AppLocaleProvider locale="zh-CN">
            <AgentWorkspaceProvider agents={agents} activeAgentId={activeId} openAgent={setActiveId} closeAgent={noop}>
              <section id="tools" data-tool-display={display} className="main-chat-view">
                {tools.map(tool => <ToolCard key={tool.id} tool={tool} compact={display === 'compact'} />)}
              </section>
              <section id="info"><Body ctx={{agents, onOpenAgent: setActiveId}} /></section>
              <section id="pane" style={{height: 300, display: 'flex'}}><WorkbenchPanel
                tabs={tabs} activeTabId={activeId} contextOpen={false} leftOpen={false}
                resize={{widths: {left: 220, right: 260, workbench: 640}, workbenchDocked: false, startResize: noop, reset: noop, nudge: noop}}
                project={{}} busy={false} execution={null} onRevise={noop} onExecutePlan={noop}
                initialDiffPath={null} initialDiffPathRequestKey={0} onShowDiff={noop}
                agents={agents} getAgentMessages={() => []} conversationId="avatar-fixture"
                ensureAgentMessages={noop} onControlAgent={onControl} onOpenAgent={setActiveId}
                onNewTab={noop} onStartAction={noop} gitAvailable={false}
                onActivateTab={tab => setActiveId(tab.id)} onCloseTab={noop} /></section>
            </AgentWorkspaceProvider>
          </AppLocaleProvider>;
        }
        let revision = 0;
        window.renderCase = (scheme, display) => {
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
      throw new Error(`超时 (${currentCase}): ${code}`);
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
            await until(`document.querySelector('#pane .agent-state.is-${status}') && document.querySelector('#info .info-card-chip.is-${status}')`);
            const updated = await snapshot();
            assert.equal(updated.pane[0].src, sources[1], `${currentCase}/${status}: 状态更新不改变头像`);
            assert.deepEqual(updated.tabs.map(img => img.src), sources, `${currentCase}/${status}: 标签头像不跟随状态变化`);
            const marker = status === "running" ? ".tool-activity-loader" : `.agent-status-dot.is-${status}`;
            assert.ok(await evaluate(`Boolean(document.querySelector('#pane .agent-pane-title ${marker}'))`), `${currentCase}/${status}: 状态标记仍可见`);
            assert.ok(await evaluate(`Boolean(document.querySelectorAll('.workbench-tab')[1].querySelector(${JSON.stringify(marker)}))`), `${currentCase}/${status}: 标签状态标记仍可见`);
          }
          await until(imagesReady);
        }
      }
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
