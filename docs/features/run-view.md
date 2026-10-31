# 运行视图

设置 → 对话显示 → 「运行视图」，默认关闭。开启后，任务运行时在本轮过程的末尾多出两块（它们是对话流的一部分，紧跟在过程后面并随对话一起滚动，不固定在输入框上方）：

- **待办清单**：圆角卡片，待办是虚线圈，进行中转圈，完成实心并划线；右上角计数可折叠到只剩当前项。
- **状态条**：左边是运行动画，右边是当前步骤类型（思考中 / 运行命令 / 读取文件 / 编辑文件 / 搜索网页 / 运行子代理 / 更新待办 / 撰写回复）和用时。命令带冷却：跑满 `runStepCooldownMs`（600ms）才显示「运行命令」，几十毫秒就结束的命令不会让标签闪一下，冷却期间保持上一步的标签。测试见 `test/run-view.test.ts`，可交互核对 `test/run-view-preview.html`。

对话里的步骤和工具行不变；这两块只在本轮运行中出现。设计稿见 [design/agent-run-mode.html](../design/agent-run-mode.html)。

## 实现

| 部分 | 位置 |
| --- | --- |
| 偏好 `vela.runView`（渲染层本地存储），变化时经 `setRunView` IPC 同步给运行时 | `hooks/usePreferences.ts`、`IpcChannel.setRunView`、`AgentRuntime.setRunView` |
| 取清单、判断当前步骤、命令冷却状态机、选圆球样式池（纯函数） | `renderer/run-view.ts` |
| 待办卡与状态条，渲染在 `ChatView` 滚动区里最后一轮之后 | `components/RunViewDock.tsx`、`ChatView.tsx` |
| 运行动画：直接复用 `ActivityIndicator`（`jump-orb.ts` 的样式池与轮换） | `components/ActivityIndicator.tsx` |

## 要求模型提交待办清单

开启后（Agent 与 Goal 模式，不含 Plan、定时任务、配方执行和常驻 Agent）：

1. 提供 `update_todos` 工具（参数 `todos: [{ step, status }]`，最多一项 `in_progress`）。它不改任何对话状态，清单随工具调用显示在界面上，历史会话也能还原。
2. 系统提示要求动手前先提交清单，每完成一项再提交完整清单。
3. **硬闸门**：本轮提交清单之前，`bash` / `edit` / `write` / `apply_patch` 会被拦下并告诉模型先调用 `update_todos`；读取类工具不受限。每一轮用户消息都重新要求。
4. 已有批准的执行方案时不再提供 `update_todos`，由 `update_plan` 承担，闸门同样认它。

关闭开关后，下一轮起不再注入提示和闸门，已激活的会话工具列表立即重算。
