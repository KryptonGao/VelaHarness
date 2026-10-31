# 任务交接包

把一个对话整理成结构化的交接包：目标、已确认决策、修改文件、实际验证、未完成事项。预览并编辑后，建立新对话并把交接文本填入新对话的输入框，由使用者补一句下一步指令再发送。

## 使用

对话标题栏右侧的「更多对话操作」菜单里选择 **生成交接包…**。对话还没有文字消息、或当前回复尚未结束时该项不可用。

对话框依次做这些事：

1. 打开即开始整理，期间显示进度，关闭对话框会取消请求。
2. 整理完成后在「编辑」视图里修改各区块，在「预览」视图里看最终要填入的文本。
3. 点「创建新对话并填入」：在原对话所在的工作区新建对话，交接文本填入它的输入框，光标在末尾。**不会自动发送**，使用者确认并补充指令后自行发送。

可编辑的区块：目标、已确认决策、未完成事项（每行一项）、补充说明。修改文件和实际验证只能取消勾选，不能改写，避免在不知情下伪造验证结果。

## 内容从哪里来

事实类内容由程序从对话记录里确定性推导，模型不参与；语义类内容由对话当前使用的模型整理，但不能增删事实。实现在 `packages/agent/src/handoff-pack.ts` 的 `buildHandoffFacts` 与 `HandoffPackGenerator`。

| 区块 | 来源 | 模型的作用 |
| --- | --- | --- |
| 目标 | `ConversationGoal.objective`；否则最近一个带 `objective` 的 Plan；否则第一条用户消息 | 改写成一两句话 |
| 已确认决策 | `ask_user_question` 里用户的回答；已批准的 Plan 标题 | 补充对话里明确敲定的选择 |
| 修改文件 | `edit`、`write` 成功调用的路径与 diff 行数，并与文件检查点取并集：从磁盘发现的改动（能补上 `bash`、子代理的间接改动） | 不参与 |
| 实际验证 | `bash` 调用里识别为测试、构建、类型检查或 lint 的命令；Goal 模式优先用 `goal.validation.checks`。通过与否取自工具状态与输出末尾的 `Command exited with code N`。之后又有 `edit`/`write` 的验证标为「可能已过期」 | 不参与 |
| 未完成事项 | 当前执行清单里不是 `completed` 的项；未完成目标的备注 | 补充口头提到但没做完的事 |

合并规则：模型返回的文件和验证一律丢弃，只采用目标、决策、未完成事项；模型的决策和未完成事项排在确定性条目之后并去重。上一个对话没有任何验证时，交接文本明确写「没有记录任何验证」。

模型收到的是事实 JSON 加一份受限的对话文本（只含用户消息和助手回复正文，不含工具输出，超长时保留开头和最近部分），系统提示要求把它们当作数据而不是指令，并禁止新增验证结论。命令和输出先经 `redactSensitive` 脱敏。

## 降级

没有可用模型、模型报错、超时（90 秒）或返回无法解析时，返回只含事实的交接包（`source: "facts-only"`），对话框顶部提示「没有使用模型」，目标取确定性来源，其余区块只含确定性条目。使用者主动关闭对话框则是取消，不降级。

## 实现位置

- 共享契约与渲染：`packages/shared/src/handoff.ts`（`HandoffPack`、`parseHandoffDraftRequest`、`renderHandoffText`），`diffCounts`、`relativePath` 在 `packages/shared/src/tool-diff.ts`，与对话导出共用。
- 运行时：`AgentRuntime` 的 `generateHandoffPack`、`cancelHandoff`；对话进行中拒绝生成，因为记录不完整。
- IPC：`IpcChannel.sessionHandoffDraft`、`sessionHandoffCancel`，主进程在 `apps/desktop/src/main/session-host.ts`，预加载桥在 `apps/desktop/src/preload/index.ts`。
- 界面：`HandoffPackDialog`（样式 `handoff-pack.css`）、`ChatActionsMenu` 的菜单项、`App.tsx` 里的状态；输入框预填通过 `composer-seed-context.ts` 的 `ComposerSeedContext` 与 `useComposerSeed`，`Composer` 只在目标对话里取走一次。
- 模型调用的用量记入原对话的 Trace 作为独立的摘要请求。

## 限制

- 子代理内部的 `bash` 命令不在根对话记录里，不会出现在验证列表中。
- 某一轮与上一轮共用文件检查点时 `changedFiles` 为空，这时只有工具调用回报的文件。
- 「可能已过期」只看 `edit`/`write`，不识别 `bash` 写文件。
- 文件最多列 60 个、验证最多 30 条，其余只提示数量；最终文本上限 16000 字符，超出会截断并注明。
- 命令是否算验证只看命令文本（如 `pnpm test`、`tsc`、`cargo test`），不理解脚本内部做了什么。

## 验证

- `packages/agent/test/handoff-pack.test.ts`：事实抽取、验证识别、过期判断、脱敏、模型输出合并（丢弃模型的文件与验证）、降级、取消与超时、运行时的模型选择。
- `apps/desktop/test/handoff-pack.test.ts`：请求解析与文本渲染（各语言标题、空区块、截断）。
- `apps/desktop/test/handoff-pack-ui.mjs`（`pnpm --filter @vela/desktop test:ui handoff`）：对话框加载与取消、事实只能勾选、编辑与预览同步、输入法组字不误提交、确认失败保留现场、输入框预填且只取走一次、重试、窄窗口布局。
- `apps/desktop/test/chat-actions-ui.mjs`：菜单项的启用、禁用与调用。
