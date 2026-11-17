# 工作区总览

点击侧边栏里工作区名称左侧的文件夹图标，主区域会换成这个工作区的总览页（点名称仍是折叠或展开该工作区的对话列表）。总览属于主页：侧边栏保持可见，用「上一页 / 下一页」可以在对话和总览之间来回。设计稿见 [design/workspace-overview.html](../design/workspace-overview.html)。

## 内容

| 区块 | 内容 | 何时显示 |
| --- | --- | --- |
| 头部 | 工作区名称、主要文件夹路径、附加文件夹数（点击打开工作区设置）、当前分支、与远程的同步状态，以及「新对话」和「工作区设置」 | 始终 |
| 需要你处理 | 等待回答和出错的对话，以及进行中的 merge / rebase / cherry-pick / revert；等待回答排在前面 | 有事项时 |
| 概况 | 对话数（进行中、等待、出错）、未提交变更（文件数、增删行数、其他 worktree 数）、本周新对话、这个工作区启用的定时任务数与下次执行时间 | 有对话时；不是 Git 仓库时没有变更一项 |
| 仓库 | 整行宽度。分支与领先落后；左列是变更构成（修改、新增、删除、其他）和改动最多的 3 个文件（只显示文件图标和文件名，图标跟随文件图标主题，灰色、悬停变黑，点击在 Finder 中显示；已删除的文件显示最近的上级目录），右列是其他 worktree 和最近 3 次提交 | 有对话时；不是仓库时显示提示 |
| 近 14 天 | 每天新建的对话数，悬停或聚焦柱子查看当天数量 | 有对话时 |
| 项目记忆 | 项目 `MEMORY.md` 的条目数、大小和前 3 条 | 有对话时 |
| 工具与扩展 | 已启用的 MCP 服务器及连接状态、已启用的 Hooks 数和是否待授权 | 有对话时 |
| 定时任务 | 这个工作区里启用的定时任务和下次执行时间，「管理」打开定时任务页 | 有对话时 |

工作区还没有对话时只显示头部和一张「新对话」引导卡。

对话的归属与侧边栏一致：只统计已发送过消息、未归档的对话；在受管 worktree 里的对话归到它的仓库名下。

## 数据来源

- 对话数与等待状态取自渲染层已有状态；对话列表本身不在总览里重复，侧边栏已有。
- 仓库信息由主进程按路径只读收集：`packages/workspace/src/workspace-overview.ts` 的 `collectWorkspaceOverview`，经 `workspace-overview:get` 返回。它不依赖「当前工作区」，所以可以查看任意工作区。主进程只接受已登记的工作区路径（当前工作区、最近使用、已有会话的目录），其他路径会被拒绝。
- 项目记忆、MCP、Hooks、定时任务沿用各自已有的接口；每一块独立读取，某一块失败时只是那一块不显示。
- 点击文件走 `workspace-overview:reveal`：主进程只接受已登记工作区，路径按仓库根解析，必须落在仓库内（符号链接解析后也要在内），由 `resolveRevealPath` 校验。
- 窗口重新获得焦点和 Git 状态变化时刷新，Git 事件做了 400ms 合并。

## 限制

- 「近 14 天」统计的是新建对话数，不含花费或 Token：用量需要读取每个对话的轨迹，这一版没有做。
- 不显示 Pull Request：现有 PR 接口只针对当前工作区。
- worktree 数不含主工作区本身和已丢失（prunable）的目录。

## 实现位置

- `packages/shared/src/workspace-overview.ts`：类型与 IPC 通道。
- `apps/desktop/src/main/workspace-overview-host.ts`：IPC 与工作区登记校验。
- `apps/desktop/src/renderer/components/WorkspaceOverviewPage.tsx`、`workspace-overview-model.ts`、`hooks/useWorkspaceOverview.ts`、`workspace-overview.css`：页面、纯函数模型、数据读取与样式。
- `apps/desktop/src/renderer/components/Sidebar.tsx`：文件夹图标入口；`App.tsx` 的 `overviewWorkspace` 控制显示，并计入前进 / 后退历史。
- 文案的繁体、日文、韩文翻译在 `packages/shared/src/i18n-messages/workspace-overview.ts`。

## 验证

```bash
pnpm --filter @vela/workspace test          # 含 workspace-overview.test.ts（真实 git 仓库）
pnpm --filter @vela/desktop test            # 含 workspace-overview-model.test.ts
node apps/desktop/test/run-electron-suite.mjs ui workspace-overview
```

`workspace-overview-ui.mjs` 在真实 Electron 里挂载页面和侧边栏，检查各区块内容、交互、Git 事件刷新、空状态和五种语言；加 `VELA_OVERVIEW_SHOT=/path/shot.png` 会额外输出浅色与深色截图。
