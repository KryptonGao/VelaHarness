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

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [development.md](./development.md) | 开发者 | 开发版与安装版的资料目录、同步正式版资料、开发工具，以及界面设置与会话记录的保存位置。 |
| [updates.md](./updates.md) | 使用者与维护者 | 应用内更新：仅依赖 GitHub Release 的检查、自动下载、Ed25519 验签、退出时替换应用，以及发版签名步骤与限制。 |
| [checkpoints.md](./checkpoints.md) | 使用者与开发者 | 文件检查点的存储：共享 blob 池与硬链接、stat 缓存、保留策略与总量上限、设置页的清理，以及已知限制。 |
| [conversation-export.md](./conversation-export.md) | 使用者与开发者 | 对话导出为 Markdown / HTML：包含的内容（工具调用、文件 diff、轨迹、检查点改动）、脱敏规则、实现位置与已知限制。 |
| [handoff-pack.md](./handoff-pack.md) | 使用者与开发者 | 任务交接包：把对话整理成目标、决策、修改文件、实际验证与未完成事项，预览编辑后填入新对话；事实与模型整理的分工、降级、实现位置与限制。 |
| [outcome-acceptance.md](./outcome-acceptance.md) | 使用者與開發者 | 成果驗收：逐項需求、修改、驗證證據與待確認，agent 歸屬、確定性事實推導、fallback 與限制。 |
| [race.md](./race.md) | 使用者与开发者 | 赛马：同一任务在 2–4 个独立 worktree 里用不同模型/思考强度/提示并行尝试，按耗时、token、改动、统一验证并排比较，一键 squash 采用其一；存储、恢复、限制与验证。 |
| [pi-1.0-migration.md](./pi-1.0-migration.md) | 开发者 | Pi 1.0 精确版本迁移、接口适配、依赖与打包检查、验证结果和未验证项。 |
| [mcp.md](./mcp.md) | 使用者与开发者 | MCP 服务器的配置、项目信任、工具曝光、只读授权、会话生命周期与定向验收。 |
| [model-catalog.md](./model-catalog.md) | 使用者与开发者 | 模型列表的自动与手动刷新、Pi 的 4 小时检查间隔、按 Pi 版本过滤模型目录，以及升级 Pi 后的验收步骤。 |
| [memory.md](./memory.md) | 使用者与开发者 | 项目记忆与全局记忆的目录、作用域、加载与刷新时机、写入权限、设置页管理、worktree 行为与验证。 |
| [web-tools.md](./web-tools.md) | 使用者与开发者 | 网页搜索与抓取：与模型提供商分开的可自定义提供商（内置 DeepSeek 预设 + 通用 HTTP 适配器）、加密密钥存储、`web_search`/`web_fetch` 工具、审批策略、不可信内容与安全边界、设置页与验证。 |
| [side-chat.md](./side-chat.md) | 使用者与开发者 | 侧边聊天：工作面板里不带工具的轻量对话，带入全局与项目记忆，可单独选择模型与推理强度；模型与记忆的选择、历史与停止、实现位置与验证。 |
| [compact-chat-ui/](./compact-chat-ui/README.md) | 开发者 | 紧凑工具调用模式与整条对话流的样式（仅晴空浅色主题）、令牌、DOM 结构、折叠与滚动规则，配套可离线打开的参考页 [compact-chat-ui/compact-chat-ui.html](./compact-chat-ui/compact-chat-ui.html)，用于在其他 Harness 里复刻界面。 |
| [built-in-mcp-plugins.md](./built-in-mcp-plugins.md) | 使用者与开发者 | Notion 内置插件、通用 OAuth、安全凭证、插件扩展与验证边界。 |
| [scheduled-tasks.md](./scheduled-tasks.md) | 使用者与开发者 | 定时任务的时间格式、执行与权限、错过与并发策略、存储与恢复、实现与验证。 |
| [requirements/version-control.md](./requirements/version-control.md) | 产品与开发者 | 版本控制需求：Git/GH CLI 分工、Commit 与同步、提交关系图、PR、AI 文案辅助及验收标准；P0–P2 已实现，P3 尚未实现。 |
| [requirements/pull-requests.md](./requirements/pull-requests.md) | 产品与开发者 | Pull Request 中心方案：仅经 GH CLI 访问 GitHub，跨仓库关联查询、分页去重、概览与 diff、同步及验收；第一期读取闭环已实现，AI 与远程写入留待后续。 |
| [pr-inbox.md](./pr-inbox.md) | 使用者与开发者 | Pull Request 中心的已实现能力、gh/IPC/缓存结构、针对性验证和第一期边界，以及让 Agent 回应审阅意见（工作树修改、确认后推送并回复）。 |
| [task-recipes.md](./task-recipes.md) | 使用者与开发者 | 任务配方 P0/P1/P2 的使用、结构化阶段、分支审批与重试、团队共享、效果比较，以及验证和边界。 |
| [requirements/task-recipes.md](./requirements/task-recipes.md) | 产品与开发者 | 任务配方需求基线：参数化模板、预览、新对话启动、版本快照与使用记录；P0/P1/P2 已实现。 |
| [intelligent-ui.md](./intelligent-ui.md) | 使用者与开发者 | Intelligent UI 的已实现能力：`vela-ui` 协议、组件与表达式、流式解析、本地状态与生命周期、图表与图解、可信数据源、本地指标与检查器、沙盒微应用、安全限制、导出、实现位置与验证（P0–P2）。 |
| [requirements/intelligent-ui.md](./requirements/intelligent-ui.md) | 产品与开发者 | Intelligent UI 需求：自适应回答、原生声明式组件、流式编译、安全交互、持久化及 P0–P2 验收；P0–P2 已实现，用户模板除外。 |
| [requirements/system-prompt-optimization.md](./requirements/system-prompt-optimization.md) | 产品与开发者 | 系统提示词优化方案（部分实现）：现状分段与问题清单、对照 DeepSeek Harness 的结论、`systemPromptOverride` 接入机制、v2 提示词、`VELA_SYSTEM_PROMPT` 开关与基线数据、分阶段计划、评测与验收、待决策事项；默认 v2，可用 `VELA_SYSTEM_PROMPT=v1` 切回，模型评测未做。 |
| [agent-inbox.md](./agent-inbox.md) | 使用者与开发者 | Agent Inbox 的已实现能力：事项类型与状态、Host 权威决策与并发保护、重启作废、先落盘后通知、Resident Agent 与委派审批、Intelligent UI 嵌入、后台运行与通知、主动规则、限制、实现位置与验证。 |
| [requirements/agent-inbox.md](./requirements/agent-inbox.md) | 产品与开发者 | Agent Inbox 与常驻 Agent 需求：定位、阶段状态、关键约束、后续设计决定与验收；第一至第七阶段均已实现。 |
| [plan-mode.md](./plan-mode.md) | 使用者 | Plan 模式的工作方式：规划流程、Plan Document、revision、批准与执行、只读限制和常见问题。 |
| [plan-mode-architecture.md](./plan-mode-architecture.md) | 开发者 | Plan 模式的实现：数据模型、流式解析、运行时编排、持久化与迁移、界面状态和测试。 |
| [logging.md](./logging.md) | 使用者与开发者 | 日志位置与格式、级别、轮转与脱敏、未捕获错误记录，以及诊断包导出的内容与隐私边界。 |
| [motion-audit.md](./motion-audit.md) | 开发者 | 桌面端动效盘点：现有基建、各区域缺口、总优先级表、统一动效规范与落地批次。 |
| [motion-audit.md](./motion-audit.md) | 开发者 | 界面动效现状盘点与补全建议：已有基建、按区域缺口清单、统一参数规范与落地批次。 |

## 新增文档

新建专题文档时沿用上面的写作约定，并在索引表补一行。
