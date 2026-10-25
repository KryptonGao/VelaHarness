# 后台命令

主代理运行长时间命令（开发服务器、watch、耗时的构建或测试）时不必干等：给 `bash` 传 `run_in_background: true`，命令在后台继续跑，主代理立刻拿到一个 shell id 往下做别的事。子代理的行为见 `AgentControl` 的 `spawn_agent`，两者共用同一条「结果回到主代理」的唤醒路径。

## 工具

| 工具 | 作用 |
| --- | --- |
| `bash`（`run_in_background: true`） | 过与前台相同的权限门后启动命令，立刻返回 `bg-N`。可同时带 `timeout`（秒），到点终止，状态为 `timed_out`。 |
| `bash_output` | 读取自上次读取以来的新输出和当前状态。`wait`（秒，最多 600）会等命令结束或超时再读；读到结束状态后不再重复通知。 |
| `bash_kill` | 终止命令及其子进程。 |

不传 `run_in_background` 时 `bash` 与以前完全一致，仍是同步阻塞。

## 行为

- 命令自然结束、失败或超时时，运行时把结果（状态、退出码、耗时、尚未读过的输出末尾）作为不可见的自定义消息 `vela_background_shell` 送进主会话，处理方式与子代理结论相同：主代理空闲就自动唤醒，运行中追加为 follow-up，用户已停止则只进上下文不唤醒。
- 主动 `bash_kill`、会话被移除、应用退出都不会唤醒主代理。会话被移除和应用退出时命令会被终止；用户在回合里点停止不会终止后台命令。
- 输出保存在内存里，每个命令最多保留约 1 MB，超出丢弃最早的部分；单次读取最多返回 30,000 个字符的末尾，并标注已截断。
- 每个会话同时最多运行 8 个后台命令，已结束的记录最多保留 20 条。
- 只有主代理有后台模式：子代理的 `bash` 始终同步，Plan 模式和只读配方阶段拒绝 `run_in_background`，也不提供 `bash_output` / `bash_kill`。

## 实现位置

- `packages/workspace/src/background-shells.ts` 的 `BackgroundShellManager`：进程表、输出游标、结束事件。命令通过 Pi 的 `createLocalBashOperations` 执行，终止时杀整个进程树。
- `packages/workspace/src/background-shell-tools.ts`：`withBackgroundOption`（给 `bash` 加参数）与 `bash_output` / `bash_kill`；`packages/workspace/src/sandbox-tools.ts` 的 `createSandboxedToolDefinitions` 在传入 `background` 时装配它们。
- `packages/agent/src/runtime.ts`：`backgroundShells` 选项、`handleBackgroundShellExit` 与 `deliverRootMessage`；`packages/agent/src/runtime-tools.ts` 的 `ToolLoadout` 决定哪些模式激活这两个工具。
- `apps/desktop/src/main/index.ts` 创建 `BackgroundShellManager` 并只给根会话的工具工厂开启 `background`。

## 验证

- `packages/workspace/test/background-shells.test.ts`：管理器的启动、增量读取、等待、终止、超时、会话隔离、数量上限与输出截断。
- `packages/agent/test/background-shell-tools.test.ts`：工具装配、权限拒绝时不启动命令。
- `packages/agent/test/background-shell-runtime.test.ts`：回合在命令结束前完成、结束后唤醒主代理、主动终止不唤醒，以及 Plan 模式与子代理的限制。

## 已知限制

- 后台命令只活在应用进程内，应用重启后不会恢复；界面上没有后台命令列表，只能在 `bash_output` / `bash_kill` 的工具卡片里看到。
- 命令用默认环境运行，不带前台 `bash` 注入的 `PI_*` 会话变量。
