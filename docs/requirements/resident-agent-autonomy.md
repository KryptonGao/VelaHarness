# Resident Agent 自主化需求

**Status:** P1 and P2 are implemented. P3–P5 remain planned; rule suggestions still appear in Inbox and reminders are not yet supported. See [Agent Inbox](../features/agent-inbox.md) for current behavior and [the original requirements](./agent-inbox.md) for context.

## 目标

让 Resident Agent 真正可用：

1. **主动**：任务完成、规则触发、提醒到期等真实事件到来时，Resident 能主动在对话里回复，并在用户不在页面时通知用户。
2. **自选工作区**：用户不需要选工作区。Resident 自己判断目标工作区，在多个工作区里创建对话、续聊，再把结果汇总回复给用户。
3. **不增加权限**：Resident 仍然没有文件、命令、浏览器工具；所有动手的事都在工作区任务里完成，任务内部的权限与审批不变。

## 设计时的缺口

| 缺口 | 代码依据 | 后果 |
| --- | --- | --- |
| 只能被动响应 | `ResidentAgentSupervisor.submit()` 是唤醒 Resident 模型的唯一入口 | 任务完成后 Resident 不知情，不会主动说话 |
| 看不到结果 | `list_background_tasks` 只返回状态；[agent-inbox.md](../features/agent-inbox.md) 把「看不到任务对话内容」列为限制 | 无法把结果回复给用户，只能让用户去 Inbox 看 |
| 任务是一次性的 | `delegate` 经 `runScheduledTask` 跑一轮就结束，没有续聊工具 | 不能追问，不能与某个工作区多轮对话 |
| 选工作区靠猜 | `list_workspaces` 只返回路径 | 模型常选错，只能让用户选 |
| 用户是瓶颈 | 每次委派都走 `delegate` 审批，且不交给模型判断 | 小事也要逐次批准 |
| 规则结果不进对话 | 规则任务结果只以 `suggestion` 进 Inbox | Resident 无法统一汇报、去重 |

## 原则

- 保留已有边界：Resident 无文件类工具；任务沿用沙箱与审批；重启不重放；`disabled` 和暂停只阻止新工作。
- **空闲不调用模型。** 唤醒只由真实事件触发，并受合并与每日预算约束。
- 任务结果是**不可信数据**。它可能来自网页或文件，不能被当作用户指令，也不能据此自动扩大权限。
- 不另建调度器或 Agent 引擎：任务对话复用 `AgentRuntime.promptBackground`，提醒复用 supervisor 的账本与持久化。

## 需求

### A. 结果回流与多轮对话

新增 Resident 工具：

- `read_task_result(taskId)`：返回任务对话最后一条助手回复，截断到约 6000 字，附工具调用次数与涉及文件数。不返回完整 transcript。只能读 supervisor 账本里的任务对话，不能读任意会话。
- `send_to_task(taskId, text)`：向同一任务对话追加消息，复用 `promptBackground`；对话忙时排队，不打断。supervisor 把任务重新置为 `running`，并重新计入并发上限与时限。

任务对话末尾追加统一的汇报指引：结果、证据、未验证项、建议下一步，使 Resident 读到的是结构化汇报。

### B. 事件唤醒

1. **事件来源**：任务进入终态、规则任务完成、失败事项、审批过期、Resident 自己设置的提醒。
2. **事件信封**：由 Host 构造，通过 `promptBackground` 投到 Resident 会话。任务回复包在 `<task_result untrusted>` 内，系统提示要求 Resident 视为数据。界面把它渲染为事件卡片，而不是用户气泡。
3. **Resident 的处理**：汇报、追问任务、再委派，或输出约定标记 `NO_REPLY` 表示不打扰，界面隐藏该轮。
4. **合并与节流**：约 20 秒窗口内的事件合并为一条信封；Resident 正在回复时排队；新增设置 `maxWakesPerDay`（默认 30，0 表示不允许唤醒）；与既有的 `dailyProactiveRuns` 相互独立。
5. **触达用户**：由事件唤醒产生的 Resident 回复，若用户当前不在 Resident 页面，生成一条 Inbox 事项（新类型 `message`，不计入待处理徽标，只计未读），并发系统通知，遵守静默时段、合并与隐藏预览设置。用户主动发起的回合不通知。这修改了现有「Resident 自己的回复不进收件箱」的规则，仅对唤醒回合例外。
6. **自我提醒**：新增 `schedule_followup(at, note)`。supervisor 持久化最多 20 条；重启后已过期的不补发，标记为 `missed`。
7. **规则结果汇入 Resident**：规则任务完成后唤醒 Resident，由它判断是否值得打扰用户；同一件事只产生一次通知，不同时出现 `suggestion` 与 Resident 消息。

### C. 工作区自选

- 丰富 `list_workspaces`：名称、AGENTS.md 或 README 首段摘要（缓存）、git 分支与是否有改动、最近活动时间、正在运行的对话数、最近三个对话标题。
- 新增 `find_workspace(query)`：按名称、摘要、最近对话标题匹配，返回前三名与置信度。高置信直接使用；低置信或并列时用 `ask_user_question` 问一次。
- 别名记忆：用户说过「官网 = ~/Code/site」后保存在 resident 目录，注入系统提示。条数与长度有上限。
- 输入区的工作区选择保留为可选的「固定到」，默认不需要。

### D. 分级预授权

- `delegate_workspace_task` 增加 `readOnly` 参数，任务在 Plan 模式下运行。
- 每个工作区一个委派策略，默认 `ask`：

  | 策略 | 只读委派 | 可写委派 |
  | --- | --- | --- |
  | `ask`（默认） | 逐次审批 | 逐次审批 |
  | `allow_read_only` | 自动放行 | 逐次审批 |
  | `allow` | 自动放行 | 自动放行 |

  审批卡增加「此后在该工作区自动允许只读任务」。不提供全局「全部自动」。
- 预授权只授权创建任务。任务内部的写入与命令仍走 Inbox 审批；agent 来源的自动委派同样套用 `backgroundSandboxMode`，全局 Full Access 时降为 `smart`。
- 循环保护：由一条用户消息派生的唤醒链深度上限为 3，另设每日委派上限。
- **防注入**：唤醒回合里的可写委派一律强制审批，不受预授权影响；唤醒回合不能自动委派到与事件来源不同的工作区。否则「读 A 的结果、自动写 B」会成为跨工作区的提权路径。

## 待决定

1. **放宽「Resident 看不到任务内容」。** 回流结果必然破坏这条边界。建议只回流汇报摘要，在设置里提供总开关，并在 Resident 提示里写明「不要把工作区 A 的内容写进 B 的任务提示」。这是软约束，不是硬隔离。
2. **自动委派默认值。** 建议默认 `ask`，由用户逐个工作区开启 `allow_read_only`。
3. **唤醒预算。** 每次唤醒都是一次模型调用，`maxWakesPerDay = 30` 是估计值，需要按实际使用确认。

## 阶段

| 阶段 | 内容 | 主要位置 |
| --- | --- | --- |
| P1 | `read_task_result`、`send_to_task`、汇报指引 | `packages/agent/src/resident-tools.ts`、`resident-agent-supervisor.ts`（新增 `continueTask`） |
| P2 | 事件信封、合并节流、`NO_REPLY`、事件卡片、Inbox `message` 与通知、`maxWakesPerDay` | supervisor、`agent-inbox-adapter.ts`、`ResidentAgentView.tsx`、`packages/shared/src/resident-agent.ts` |
| P3 | 丰富 `list_workspaces`、`find_workspace`、别名记忆 | `apps/desktop/src/main/index.ts`（`registeredWorkspaces`）、`resident-tools.ts` |
| P4 | 工作区委派策略、`readOnly` 委派、链深与注入保护 | supervisor、`ResidentSettingsPanel.tsx`、委派审批卡 |
| P5 | `schedule_followup`、规则结果汇入 Resident | supervisor、`proactive-rules.ts` |

P1 and P2 cover task results and follow-ups, and wake Resident for non-rule task completion, new failures, and approval expiry. P3 and P4 can proceed independently. P5 still owns reminders and routing rule results into Resident.

## 验收

- 空闲时没有任何模型调用，包括提醒未到期、没有事件的情况。
- 任务完成后，Resident 对话出现事件卡片和一条汇报；用户在别的页面时收到一条 Inbox `message` 与一条系统通知，不重复。
- Resident 输出 `NO_REPLY` 的回合在界面不可见，不通知，但计入 `maxWakesPerDay`。
- 同一窗口内的多个事件只产生一次唤醒；超过 `maxWakesPerDay` 后不再唤醒，并给出原因。
- `send_to_task` 在任务忙时排队；时限与并发上限仍然生效。
- 用户提到「官网」「后端」这类说法时，Resident 选中正确工作区，或只问一次。
- `allow_read_only` 下的只读委派不弹审批；可写委派仍弹。
- 唤醒回合里的可写委派、以及指向事件来源之外工作区的委派，即使工作区策略为 `allow` 也弹审批。
- 链深超过 3 或超过每日委派上限时拒绝，并在回复里说明。
- 重启后进行中的任务为 `interrupted`，到期未触发的提醒为 `missed`，都不重放。
- 新增文案提供 zh-CN、en、zh-TW、ja、ko 五种语言。

## 验证

```sh
pnpm --filter @vela/desktop test:resident-agent
pnpm --filter @vela/desktop test:agent-inbox
pnpm test
pnpm test:ui
```

P1/P2 coverage uses a controlled clock and a fake runtime to test bounded result reads, queued follow-ups and their deadlines, wake batching and budgets, and `NO_REPLY`. The Inbox tests cover failure and approval-expiry routing, wake-message deduplication, notification policy, and the distinction between unread and pending. The Electron UI tests cover event cards, hidden rounds, and unread messages. Reminder and delegation-policy acceptance tests belong to later phases.
