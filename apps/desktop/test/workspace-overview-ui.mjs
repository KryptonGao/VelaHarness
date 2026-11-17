/** Workspace overview page and sidebar entry in real Electron: node apps/desktop/test/workspace-overview-ui.mjs */
import { readStyles } from "./read-styles.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-workspace-overview-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: { contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Sidebar } from './apps/desktop/src/renderer/components/Sidebar';
        import { WorkspaceOverviewPage } from './apps/desktop/src/renderer/components/WorkspaceOverviewPage';
        import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';
        import './apps/desktop/src/renderer/nav-rail.css';

        localStorage.setItem('vela.sidebarView', JSON.stringify('workspaces'));
        const WS = '/projects/VelaHarness';
        const now = Date.now();
        const day = 86400000;
        const chat = (id, title, extra = {}) => ({ id, title, cwd: WS, createdAt: now - day, updatedAt: now - 60000, archivedAt: null, status: 'ready', messageCount: 3, ...extra });
        const conversations = [
          chat('run', '迁移图标到统一 Icon', { status: 'streaming', createdAt: now }),
          chat('wait', '设计工作区总览页', { createdAt: now - 2 * day }),
          chat('err', '升级 Pi 后验收', { status: 'error', createdAt: now - 3 * day }),
          chat('wt', '赛马：Sidebar 虚拟滚动', { status: 'streaming', worktree: { repository: WS }, cwd: '/home/.vela/worktrees/x' }),
          chat('old', '整理发布说明', { createdAt: now - 30 * day, updatedAt: now - 5 * day }),
          { ...chat('other', '别的工作区'), cwd: '/projects/Notes' },
        ];
        const git = {
          repoRoot: WS, repoName: 'VelaHarness', subdir: null, branch: 'main', detached: false, upstream: 'origin/main', ahead: 0, behind: 0, operation: null,
          fileCount: 12, addedLines: 418, deletedLines: 96, counts: { modified: 8, added: 1, untracked: 2, deleted: 1, renamed: 0, conflicted: 0 },
          topFiles: [{ path: 'apps/desktop/src/renderer/components/some/very/deeply/nested/directory/structure/WorkspaceOverviewPageWithAVeryLongName.tsx', status: 'added', addedLines: 212, deletedLines: 0 }, { path: 'shared/src/index.ts', status: 'modified', addedLines: 24, deletedLines: 6 }],
          commits: [{ sha: 'a'.repeat(40), shortSha: 'ebe837a', subject: 'feat: migrate all interface icons to the unified Icon component, add opt-in Unified icons setting (off by default) and a very long tail', at: now - day }],
          worktrees: [{ path: '/home/.vela/worktrees/race-a', branch: 'race/icons-a', changeCount: 3, managed: true }], worktreeCount: 1,
        };
        window.snapshot = { workspace: WS, git, generatedAt: now };
        window.revealed = []; window.opened = []; window.newChats = []; window.edited = []; window.schedules = 0; window.overviewOpened = []; window.gitListener = null;
        window.vela = {
          platform: 'darwin',
          workspaceOverview: { get: async workspace => { window.lastGet = workspace; return window.snapshot; }, reveal: async (workspace, path) => { window.revealed.push([workspace, path]); } },
          memory: {
            list: async () => ({ ok: true, value: { projects: [{ workspace: WS, exists: true, bytes: 2048 }] } }),
            read: async () => ({ ok: true, value: { content: '# 记忆\\n- **CSS** 加载顺序要对\\n- 拖拽区域陷阱\\n' + Array.from({ length: 28 }, (_, index) => '- 第' + (index + 3) + '条\\n').join('') } }),
          },
          getMcpCatalog: async () => ({ servers: [
            { name: 'Linear', scope: 'global', enabled: true, connectionStatus: 'connected', authStatus: 'authenticated' },
            { name: 'Notion', scope: 'global', enabled: true, connectionStatus: 'disconnected', authStatus: 'required' },
            { name: 'Off', scope: 'global', enabled: false, connectionStatus: 'disconnected', authStatus: 'none' },
          ] }),
          getHooksCatalog: async () => ({ documents: [{ scope: 'project', trusted: false, config: { version: 1, hooks: [{ id: 'a', event: 'x', command: 'y' }, { id: 'b', event: 'x', command: 'y', enabled: false }] } }] }),
          scheduledTasks: {
            list: async () => ({ tasks: [
              { id: 't1', title: '依赖安全检查', workspace: WS, status: 'active', nextRunAt: now + day },
              { id: 't2', title: '已暂停', workspace: WS, status: 'paused', nextRunAt: now + day },
              { id: 't3', title: '别处的任务', workspace: '/projects/Notes', status: 'active', nextRunAt: now + day },
            ], runs: [] }),
            subscribe: () => () => {},
          },
          onGitEvent: listener => { window.gitListener = listener; return () => {}; },
        };

        const root = createRoot(document.getElementById('root'));
        function Fixture({ locale, items, workspace, overview }) {
          return <AppLocaleProvider locale={locale}><div className="vela-window platform-darwin right-collapsed" style={{ height: '100vh', display: 'flex' }}>
            <div style={{ width: 260, flex: 'none', position: 'relative' }}>
              <Sidebar collapsed={false} platform="darwin" resize={{ widths: { left: 248, right: 300, workbench: 500 }, startResize() {}, nudge() {}, reset() {} }}
                conversations={items} activeConversationId={null} settingsOpen={false} settingsLabel="设置"
                workspaces={[{ path: WS, name: 'VelaHarness', lastUsedAt: now, folders: ['/projects/shared-lib', '/projects/docs'] }]}
                overviewWorkspace={overview} onOpenWorkspaceOverview={cwd => { window.overviewOpened.push(cwd); }}
                onToggle={() => {}} onOpenSettings={() => {}} onNewChat={() => {}} onSwitchConversation={() => {}} onArchiveConversation={() => {}}
                onOpenPrInbox={() => {}} prInboxOpen={false} onOpenAgentInbox={() => {}} agentInboxOpen={false} agentInboxBadge={0}
                onOpenRecipes={() => {}} recipesOpen={false} onOpenScheduledTasks={() => {}} scheduledTasksOpen={false} />
            </div>
            <div className="main-stage"><div className="main-stage-pane scheduled-tasks-stage">
              <WorkspaceOverviewPage workspace={workspace} conversations={items}
                workspaces={[{ path: WS, name: 'VelaHarness', lastUsedAt: now, folders: ['/projects/shared-lib', '/projects/docs'] }]}
                waitingConversationIds={['wait']} sidebarCollapsed={false} onToggleSidebar={() => {}}
                onOpenConversation={id => window.opened.push(id)} onNewChat={cwd => window.newChats.push(cwd)}
                onEditWorkspace={cwd => window.edited.push(cwd)} onOpenScheduledTasks={() => { window.schedules += 1; }} />
            </div></div>
          </div></AppLocaleProvider>;
        }
        window.renderFixture = (props = {}) => { const locale = props.locale ?? 'zh-CN'; setActiveLocale(locale); root.render(<Fixture locale={locale} items={props.items ?? conversations} workspace={props.workspace ?? WS} overview={props.overview ?? null} />); };
        window.renderFixture();
      `, resolveDir: resolve(here, "../../.."), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      outfile: join(temporary, "ui.js"), loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
    });
    writeFileSync(join(temporary, "index.html"), '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><style>' +
      readStyles(join(here, "../src/renderer/styles.css")) +
      '</style><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
    const env = { ...process.env, VELA_OVERVIEW_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, "Workspace overview checks failed");
    } finally { clearTimeout(timer); }
  } finally { if (process.env.VELA_OVERVIEW_KEEP) console.log(`kept ${temporary}`); else rmSync(temporary, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const { writeFileSync: save } = await import("node:fs");
  app.setPath("userData", join(process.env.VELA_OVERVIEW_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: Boolean(process.env.VELA_OVERVIEW_SHOT), width: 1240, height: 1300, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    try {
      await win.loadFile(join(process.env.VELA_OVERVIEW_TEMP, "index.html"));
      const evaluate = code => win.webContents.executeJavaScript(code);
      const until = async code => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (await evaluate(code)) return;
          await new Promise(done => setTimeout(done, 20));
        }
        throw new Error(`Timed out: ${code}`);
      };
      const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
      const count = selector => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

      await until("document.querySelector('.wo-head h1')");
      assert.equal(await text(".wo-head h1"), "VelaHarness");
      assert.equal(await evaluate("window.lastGet"), "/projects/VelaHarness", "Overview reads the git snapshot of its own workspace");
      await until("document.querySelector('.wo-repo')");

      if (process.env.VELA_OVERVIEW_SHOT) {
        const base = process.env.VELA_OVERVIEW_SHOT.replace(/\.png$/, "");
        const settle = () => new Promise(done => setTimeout(done, 500));
        const capture = async name => save(`${base}-${name}.png`, (await win.webContents.capturePage()).toPNG());
        await settle();
        await capture("light-top");
        await evaluate("document.querySelector('.scheduled-tasks-page-scroll').scrollTop = 560");
        await settle();
        await capture("light-bottom");
        await evaluate("document.documentElement.dataset.scheme = 'dark'; document.querySelector('.scheduled-tasks-page-scroll').scrollTop = 0");
        await settle();
        await capture("dark-top");
        await evaluate("document.querySelector('.scheduled-tasks-page-scroll').scrollTop = 560");
        await settle();
        await capture("dark-bottom");
        await evaluate("document.documentElement.dataset.scheme = 'light'; document.querySelector('.scheduled-tasks-page-scroll').scrollTop = 0");
      }

      // Attention: waiting first, then the failed chat; clicking answers the right chat.
      const attention = "document.querySelectorAll('.wo-attention-row')";
      assert.equal(await evaluate(`${attention}.length`), 2);
      assert.match(await evaluate(`${attention}[0].textContent`), /设计工作区总览页.*等待回答/);
      assert.match(await evaluate(`${attention}[1].textContent`), /升级 Pi 后验收.*发生错误/);
      await evaluate(`${attention}[0].querySelector('button').click()`);
      assert.deepEqual(await evaluate("window.opened"), ["wait"]);

      // Summary: other workspaces' chats are not counted; worktree chats fold into the repository.
      const stats = await evaluate("[...document.querySelectorAll('.wo-stat')].map(node => node.textContent)");
      assert.equal(stats.length, 4);
      assert.match(stats[0], /对话5.*2 进行中.*1 等待.*1 出错/);
      assert.match(stats[1], /12.*\+418.*−96.*1 个工作树/);
      assert.match(stats[2], /本周新对话/);
      assert.match(stats[3], /定时任务1.*下次/, "Only active tasks of this workspace count");

      assert.equal(await evaluate("(() => { const cards = [...document.querySelectorAll('.wo-card')]; const repo = cards.find(card => card.querySelector('.wo-repo')); const row = document.querySelector('.wo-stats').getBoundingClientRect(); const r = repo.getBoundingClientRect(); return Math.abs(r.width - row.width) < 1; })()"), true, "The repository card takes the whole row");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.wo-split-even')).gridTemplateColumns.split(' ').length"), 2, "Activity and memory share a row");
      // Repository, activity and config cards.
      const repo = await evaluate("document.querySelector('.wo-repo').textContent");
      assert.match(repo, /main/);
      assert.match(repo, /8 修改/);
      assert.match(repo, /3 新增/);
      assert.match(repo, /WorkspaceOverviewPageWithAVeryLongName\.tsx/);
      assert.doesNotMatch(repo, /apps\/desktop|renderer\/components/, "Changed files show only their name, not the path");
      assert.equal(await count(".wo-files .wo-file img.file-type-icon"), 2, "Every changed file has a file icon");

      assert.equal(await evaluate("(() => { const s = document.querySelector('.scheduled-tasks-page-scroll'); return s.scrollWidth - s.clientWidth; })()"), 0, "Long paths and commit subjects ellipsize instead of widening the page");
      assert.match(repo, /race\/icons-a/);
      assert.match(repo, /ebe837a/);
      assert.equal(await count(".wo-chart .wo-col"), 14);
      assert.equal(await evaluate("document.querySelectorAll('.wo-chart .wo-col')[13].classList.contains('is-today')"), true);
      await until("[...document.querySelectorAll('.wo-card')].some(card => card.textContent.includes('CSS 加载顺序要对'))");
      const cards = await evaluate("[...document.querySelectorAll('.wo-card')].map(card => card.textContent)");
      assert.ok(cards.some(card => /30.*条记忆.*2\.0.*KB/.test(card) && card.includes("第30条")), "Project memory lists every entry");
      assert.ok(cards.some(card => /Linear.*Notion/.test(card) && !card.includes("Off") && /1 条已启用.*待授权/.test(card)), "Tools card lists enabled servers and hooks needing approval");
      assert.ok(cards.some(card => card.includes("依赖安全检查") && !card.includes("已暂停") && !card.includes("别处的任务")), "Schedule card only lists active tasks of this workspace");

      // In the category layout the overview sits flush against the sidebar like a chat: square left corners, rounded right ones.
      await evaluate("document.querySelector('.vela-window').classList.add('nav-rail-layout')");
      const corners = await evaluate(`(() => { const pseudo = getComputedStyle(document.querySelector('.wo-shell'), '::after'); return [pseudo.borderTopLeftRadius, pseudo.borderBottomLeftRadius, pseudo.borderTopRightRadius, pseudo.borderBottomRightRadius]; })()`);
      assert.deepEqual(corners.slice(0, 2), ["0px", "0px"], "Left paper corners are square next to the sidebar");
      assert.notEqual(corners[3], "0px", "Right paper corners stay rounded");
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.wo-shell')).maskImage"), "none", "Left corners get the same collapse mask as the chat");
      await evaluate("document.querySelector('.vela-window').classList.remove('nav-rail-layout')");

      // Cards sharing a row stay the same height; long content scrolls inside its card.
      const rows = await evaluate(`[...document.querySelectorAll('.wo-split-even')].map(row => [...row.children].map(card => { const body = card.querySelector('.wo-scroll'); return { height: Math.round(card.getBoundingClientRect().height), scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false, overflowY: body ? getComputedStyle(body).overflowY : null }; }))`);
      for (const row of rows) assert.equal(row[0].height, row[1].height, "Cards in one row have equal height");
      const memoryCard = rows[0][1];
      assert.equal(memoryCard.scrolls, true, "A long memory list scrolls inside its card");
      assert.equal(memoryCard.overflowY, "auto");
      assert.ok(memoryCard.height <= 300, "A long list does not stretch the row");
      // Clipped content fades out on the clipped side only, and follows the scroll position.
      const fade = () => evaluate("(() => { const el = document.querySelectorAll('.wo-split-even')[0].querySelectorAll('.wo-scroll')[0]; return [el.dataset.fade, getComputedStyle(el).maskImage !== 'none']; })()");
      assert.deepEqual(await fade(), ["bottom", true], "Long content fades at the bottom first");
      await evaluate("document.querySelectorAll('.wo-split-even')[0].querySelector('.wo-scroll').scrollTop = 80");
      await until("document.querySelectorAll('.wo-split-even')[0].querySelector('.wo-scroll').dataset.fade === 'both'");
      await evaluate("(() => { const el = document.querySelectorAll('.wo-split-even')[0].querySelector('.wo-scroll'); el.scrollTop = el.scrollHeight; })()");
      await until("document.querySelectorAll('.wo-split-even')[0].querySelector('.wo-scroll').dataset.fade === 'top'");
      assert.equal(await evaluate("document.querySelectorAll('.wo-split-even')[1].querySelector('.wo-scroll').dataset.fade"), "none", "Short content has no fade");
      await evaluate("document.querySelectorAll('.wo-split-even')[0].querySelector('.wo-scroll').scrollTop = 0");
      // Text follows the font settings: UI font and size for prose, code font and size for monospace.
      await evaluate("document.documentElement.style.cssText += '--ui-scale: 1.25; --code-scale: 1.5; --font-sans: Georgia; --font-mono: \\'Courier New\\';'");
      const fonts = await evaluate(`(() => { const style = selector => getComputedStyle(document.querySelector(selector)); return { label: [style('.wo-stat-label').fontSize, style('.wo-stat-label').fontFamily], title: style('.wo-head h1').fontFamily, button: style('.wo-primary').fontFamily, hash: [style('.wo-hash').fontSize, style('.wo-hash').fontFamily], file: [style('.wo-file-name').fontSize, style('.wo-file-name').fontFamily], path: [style('.wo-path').fontSize, style('.wo-path').fontFamily] }; })()`);
      assert.equal(fonts.label[0], "15px", "Prose scales with the interface font size");
      assert.match(fonts.label[1], /Georgia/);
      assert.match(fonts.title, /Georgia/);
      assert.match(fonts.button, /Georgia/);
      assert.equal(fonts.hash[0], "16.5px", "Commit hashes scale with the code font size");
      assert.match(fonts.hash[1], /Courier New/);
      assert.equal(fonts.file[0], "18.75px", "File names match the chat's file names: 15px scaled by the interface size");
      assert.match(fonts.file[1], /Georgia/);
      assert.equal(fonts.path[0], "18px");
      await evaluate("document.documentElement.style.removeProperty('--ui-scale'); document.documentElement.style.removeProperty('--code-scale'); document.documentElement.style.removeProperty('--font-sans'); document.documentElement.style.removeProperty('--font-mono')");

      // Changed files: grey until hovered, then primary; clicking reveals the file in Finder.
      await evaluate("document.querySelector('.wo-files').scrollIntoView({ block: 'center' })");
      const probeColor = variable => evaluate(`(() => { const p = document.createElement('i'); p.style.color = 'var(${variable})'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`);
      const muted = await probeColor("--text-muted");
      const primary = await probeColor("--text-primary");
      await until(`getComputedStyle(document.querySelector('.wo-file')).color === ${JSON.stringify(muted)}`);
      const idle = muted;
      const box = await evaluate("(() => { const r = document.querySelector('.wo-file-name').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
      win.webContents.sendInputEvent({ type: "mouseMove", x: box.x, y: box.y });
      await until(`getComputedStyle(document.querySelector('.wo-file')).color === ${JSON.stringify(primary)}`);
      await evaluate("document.querySelector('.wo-file').click()");
      assert.deepEqual(await evaluate("window.revealed"), [["/projects/VelaHarness", "apps/desktop/src/renderer/components/some/very/deeply/nested/directory/structure/WorkspaceOverviewPageWithAVeryLongName.tsx"]]);
      win.webContents.sendInputEvent({ type: "mouseMove", x: 5, y: 5 });

      const fileStyle = await evaluate("(() => { const s = getComputedStyle(document.querySelector('.wo-file')); const i = document.querySelector('.wo-file .file-type-icon').getBoundingClientRect(); return [s.fontSize, s.fontWeight, s.columnGap, Math.round(i.width), Math.round(i.height)]; })()");
      assert.deepEqual(fileStyle, ["15px", "500", "6px", 14, 14], "File rows use the chat's file name size, weight, gap and 14px icon");
      // Header actions and chip.
      await evaluate("document.querySelector('.wo-primary').click()");
      await evaluate("document.querySelector('button.wo-chip').click()");
      await evaluate("document.querySelector('.wo-icon-btn').click()");
      assert.deepEqual(await evaluate("window.newChats"), ["/projects/VelaHarness"]);
      assert.deepEqual(await evaluate("window.edited"), ["/projects/VelaHarness", "/projects/VelaHarness"]);
      assert.match(await text("button.wo-chip"), /另有 2 个文件夹/);
      await evaluate("document.querySelector('.wo-stat-link').click()");
      assert.equal(await evaluate("window.schedules"), 1);

      // A git event refreshes the snapshot.
      await evaluate("window.snapshot = { ...window.snapshot, git: { ...window.snapshot.git, branch: 'release', fileCount: 0, counts: { modified: 0, added: 0, untracked: 0, deleted: 0, renamed: 0, conflicted: 0 }, topFiles: [] } }; window.gitListener({ type: 'status-changed' })");
      await until("document.querySelector('.wo-branch')?.textContent === 'release'");
      assert.match(await text(".wo-clean"), /没有未提交的变更/);

      // Sidebar: the folder icon opens the overview, the name still folds the group.
      const group = "document.querySelector('.session-group')";
      assert.equal(await count(".session-group-overview"), 2, "Every workspace group gets its own folder button");
      assert.equal(await evaluate(`${group}.querySelector('.session-group-header .session-group-folder')`), null, "The icon is not inside the fold button");
      await evaluate(`${group}.querySelector('.session-group-overview').click()`);
      assert.deepEqual(await evaluate("window.overviewOpened"), ["/projects/VelaHarness"]);
      assert.equal(await evaluate(`${group}.querySelector('.session-group-header').getAttribute('aria-expanded')`), "true", "Opening the overview does not fold the group");
      assert.match(await evaluate(`${group}.querySelector('.session-group-overview').getAttribute('aria-label')`), /工作区总览 · VelaHarness/);
      await evaluate(`${group}.querySelector('.session-group-header').click()`);
      await until(`${group}.querySelector('.session-group-header').getAttribute('aria-expanded') === 'false'`);
      assert.equal(await evaluate("window.overviewOpened.length"), 1, "Folding does not open the overview");
      await evaluate("window.renderFixture({ overview: '/projects/VelaHarness' })");
      await until("document.querySelector('.session-group-overview')?.getAttribute('aria-current') === 'page'");

      // Not a repository, and a workspace without chats.
      await evaluate("window.snapshot = { workspace: window.snapshot.workspace, git: null, generatedAt: Date.now() }; window.renderFixture({ workspace: '/projects/Plain' })");
      await until("document.querySelector('.wo-empty')");
      assert.equal(await text(".wo-empty h2"), "这个工作区还没有对话");
      assert.equal(await count(".wo-stat"), 0);
      assert.equal(await count(".wo-attention"), 0);

      // Locales.
      await evaluate("window.renderFixture({ workspace: '/projects/VelaHarness', locale: 'en' })");
      await until("document.querySelector('.wo-attention')");
      assert.equal(await text(".wo-attention h2"), "Needs your attention2");
      for (const [locale, label] of [["zh-TW", "需要你處理"], ["ja", "対応が必要"], ["ko", "처리가 필요함"]]) {
        await evaluate(`window.renderFixture({ workspace: '/projects/VelaHarness', locale: ${JSON.stringify(locale)} })`);
        await until(`document.querySelector('.wo-attention h2')?.textContent.startsWith(${JSON.stringify(label)})`);
      }
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
