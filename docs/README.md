# Vela 文档

本目录存放 Vela 的专题文档。文档以当前开发分支的源码与测试为准，可能描述尚未随版本发布的能力；已发布版本的产品行为以根目录 [README](../README.md) 和 [RELEASE_NOTES](../RELEASE_NOTES.md) 为准。

## 写作约定

- 正文用简体中文；文件名、类型名、函数名、工具名和命令保持英文原文。
- 行为描述必须能在源码或测试中定位。引用统一写成 `` `路径` 的 `符号名` ``，不写行号，避免代码变动后引用失效。
- 只描述已经实现的能力，不把计划中的功能写成现状。
- 文档之间、文档与根 README 之间使用相对链接。
- 与根 README 重复的内容只保留概览，细节放在本目录。

需求文档存放于 `requirements/`，必须明确标注实现状态，并将当前实现与目标行为分开；未实现的级别不作为已实现功能的使用说明。

## 文档索引

### 开发与运维

开发版与安装版、应用内更新、日志与模型目录。

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [guides/development.md](./guides/development.md) | 开发者 | 开发版与安装版的资料目录、同步正式版资料、开发工具，以及界面设置与会话记录的保存位置。 |
| [guides/updates.md](./guides/updates.md) | 使用者与维护者 | 应用内更新：仅依赖 GitHub Release 的检查、自动下载、Ed25519 验签、退出时替换应用，以及发版签名步骤与限制。 |
| [guides/model-catalog.md](./guides/model-catalog.md) | 使用者与开发者 | 模型列表的自动与手动刷新、Pi 的 4 小时检查间隔、按 Pi 版本过滤模型目录，以及升级 Pi 后的验收步骤。 |
| [guides/logging.md](./guides/logging.md) | 使用者与开发者 | 日志位置与格式、级别、轮转与脱敏、未捕获错误记录，以及诊断包导出的内容与隐私边界。 |

### 功能说明

已实现能力的使用方式、实现位置、验证与已知限制。

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [features/checkpoints.md](./features/checkpoints.md) | 使用者与开发者 | 文件检查点的存储：共享 blob 池与硬链接、stat 缓存、保留策略与总量上限、设置页的清理，以及已知限制。 |
| [features/conversation-export.md](./features/conversation-export.md) | 使用者与开发者 | 对话导出为 Markdown / HTML：包含的内容（工具调用、文件 diff、轨迹、检查点改动）、脱敏规则、实现位置与已知限制。 |
| [features/handoff-pack.md](./features/handoff-pack.md) | 使用者与开发者 | 任务交接包：把对话整理成目标、决策、修改文件、实际验证与未完成事项，预览编辑后填入新对话；事实与模型整理的分工、降级、实现位置与限制。 |
| [features/outcome-acceptance.md](./features/outcome-acceptance.md) | 使用者与开发者 | 成果验收：逐项需求、修改、验证证据与待确认，agent 归属、确定性事实推导、fallback 与限制。 |
| [features/race.md](./features/race.md) | 使用者与开发者 | 赛马：同一任务在 2–4 个独立 worktree 里用不同模型/思考强度/提示并行尝试，按耗时、token、改动、统一验证并排比较，一键 squash 采用其一；存储、恢复、限制与验证。 |
| [features/mcp.md](./features/mcp.md) | 使用者与开发者 | MCP 服务器的配置、项目信任、工具曝光、只读授权、会话生命周期与定向验收。 |
| [features/memory.md](./features/memory.md) | 使用者与开发者 | 项目记忆与全局记忆的目录、作用域、加载与刷新时机、写入权限、设置页管理、worktree 行为与验证。 |
| [features/web-tools.md](./features/web-tools.md) | 使用者与开发者 | 网页搜索与抓取：与模型提供商分开的可自定义提供商（内置 DeepSeek 预设 + 通用 HTTP 适配器）、加密密钥存储、`web_search`/`web_fetch` 工具、审批策略、不可信内容与安全边界、设置页与验证。 |
| [features/background-shells.md](./features/background-shells.md) | 使用者与开发者 | 后台命令：`bash` 的 `run_in_background`、`bash_output` / `bash_kill`、结束后唤醒主代理、权限与 Plan/子代理限制、输出保留与已知限制。 |
| [features/side-chat.md](./features/side-chat.md) | 使用者与开发者 | 侧边聊天：工作面板里不带工具的轻量对话，带入全局与项目记忆，可单独选择模型与推理强度；模型与记忆的选择、历史与停止、实现位置与验证。 |
| [features/built-in-mcp-plugins.md](./features/built-in-mcp-plugins.md) | 使用者与开发者 | Notion 内置插件、通用 OAuth、安全凭证、插件扩展与验证边界。 |
| [features/scheduled-tasks.md](./features/scheduled-tasks.md) | 使用者与开发者 | 定时任务的时间格式、执行与权限、错过与并发策略、存储与恢复、实现与验证。 |
| [features/pr-inbox.md](./features/pr-inbox.md) | 使用者与开发者 | Pull Request 中心的已实现能力、gh/IPC/缓存结构、针对性验证和第一期边界，以及让 Agent 回应审阅意见（工作树修改、确认后推送并回复）。 |
| [features/task-cost-guard.md](./features/task-cost-guard.md) | 使用者与开发者 | 任务费用护栏：按人民币/美元设置任务费用上限、币种与未登记价格的处理、逼近上限时的收件箱提醒、按同类历史任务的开跑前预估、价格同步、实现位置与限制。 |
| [features/task-recipes.md](./features/task-recipes.md) | 使用者与开发者 | 任务配方 P0/P1/P2 的使用、结构化阶段、分支审批与重试、团队共享、效果比较，以及验证和边界。 |
| [features/intelligent-ui.md](./features/intelligent-ui.md) | 使用者与开发者 | Intelligent UI 的已实现能力：`vela-ui` 协议、组件与表达式、流式解析、本地状态与生命周期、图表与图解、可信数据源、本地指标与检查器、沙盒微应用、安全限制、导出、实现位置与验证（P0–P2）。 |
| [features/agent-inbox.md](./features/agent-inbox.md) | 使用者与开发者 | Agent Inbox 的已实现能力：事项类型与状态、Host 权威决策与并发保护、重启作废、先落盘后通知、Resident Agent 与委派审批、Intelligent UI 嵌入、后台运行与通知、主动规则、限制、实现位置与验证。 |
| [features/run-view.md](./features/run-view.md) | 使用者与开发者 | 运行视图：运行中在过程末尾显示待办清单与当前步骤状态条，并要求模型先提交待办清单（`update_todos`、闸门、偏好同步）。 |
| [features/info-cards.md](./features/info-cards.md) | 使用者与开发者 | 信息卡片布局：右侧浮在对话上的可排序卡片、各卡片内容与显示条件、拖动与键盘排序、隐藏与找回、布局存储和实现位置。 |
| [features/plan-mode.md](./features/plan-mode.md) | 使用者 | Plan 模式的工作方式：规划流程、Plan Document、revision、批准与执行、只读限制和常见问题。 |
| [features/plan-mode-architecture.md](./features/plan-mode-architecture.md) | 开发者 | Plan 模式的实现：数据模型、流式解析、运行时编排、持久化与迁移、界面状态和测试。 |
| [features/browser.md](./features/browser.md) | 使用者与开发者 | 内置浏览器面板与 Browser Use：Browser Host 对标签页、会话归属、窗口路由与 CDP 生命周期的管理，面板只做投影；各会话标签页独立但共享 cookie 与站点存储，切换会话、打开设置或收起面板时页面保持存活；元素批注见需求文档。 |

### 需求文档

需求基线与实现状态，必须区分当前实现与目标行为。

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [requirements/version-control.md](./requirements/version-control.md) | 产品与开发者 | 版本控制需求：Git/GH CLI 分工、Commit 与同步、提交关系图、PR、AI 文案辅助及验收标准；P0–P2 已实现，P3 尚未实现。 |
| [requirements/pull-requests.md](./requirements/pull-requests.md) | 产品与开发者 | Pull Request 中心方案：仅经 GH CLI 访问 GitHub，跨仓库关联查询、分页去重、概览与 diff、同步及验收；第一期读取闭环已实现，AI 与远程写入留待后续。 |
| [requirements/task-recipes.md](./requirements/task-recipes.md) | 产品与开发者 | 任务配方需求基线：参数化模板、预览、新对话启动、版本快照与使用记录；P0/P1/P2 已实现。 |
| [requirements/intelligent-ui.md](./requirements/intelligent-ui.md) | 产品与开发者 | Intelligent UI 需求：自适应回答、原生声明式组件、流式编译、安全交互、持久化及 P0–P2 验收；P0–P2 已实现，用户模板除外。 |
| [requirements/agent-inbox.md](./requirements/agent-inbox.md) | 产品与开发者 | Agent Inbox 与常驻 Agent 需求：定位、阶段状态、关键约束、后续设计决定与验收；第一至第七阶段均已实现。 |
| [requirements/browser-annotations.md](./requirements/browser-annotations.md) | 产品与开发者 | 浏览器元素批注需求：在内置浏览器点选元素写批注，与“选中文字回复”共用卡片，随下一轮消息发送；P0–P2 分期、安全限制与验收；P0 已实现。 |
| [requirements/competitive-gap-analysis.md](./requirements/competitive-gap-analysis.md) | 产品与开发者 | 竞品差距与新功能构想：对比 Codex、Claude Code、ZCode 缺失的能力，并按优先级列出构想；仅为构想稿，均未实现。 |

### 界面与设计参考

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [compact-chat-ui/README.md](./compact-chat-ui/README.md) | 开发者 | 紧凑工具调用模式与整条对话流的样式（仅晴空浅色主题）、令牌、DOM 结构、折叠与滚动规则，配套可离线打开的参考页 [compact-chat-ui/compact-chat-ui.html](./compact-chat-ui/compact-chat-ui.html)，用于在其他 Harness 里复刻界面。 |
| [design/task-recipes-ui.md](./design/task-recipes-ui.md) | 开发者 | 任务配方编辑器的界面设计说明：布局、层级与交互。 |

### 验证记录

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [internal/browser-use-validation.md](./internal/browser-use-validation.md) | 开发者 | 内置 Browser Use 的验证记录（2026-10-03）：定向测试、受影响系统回归与真实 Electron 检查的结果。 |

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `guides/` | 开发、更新、日志、模型目录等开发与运维文档。 |
| `features/` | 各功能的专题说明。 |
| `requirements/` | 需求文档。 |
| `design/` | 设计稿与界面说明（HTML 草稿不入库，只有 `task-recipes-ui.md` 随仓库）。 |
| `compact-chat-ui/` | 紧凑对话界面的参考页与复刻资料。 |
| `internal/` | 验证记录、迁移记录等内部文档；其中部分文件仅保留在本地、不入库。 |

## 新增文档

新建专题文档时沿用上面的写作约定，放进对应目录，并在索引表补一行。
