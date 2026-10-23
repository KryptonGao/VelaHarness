# 网页工具（Web tools）

让 Agent 通过 `web_search` 和 `web_fetch` 两个工具搜索网页、读取页面正文。**提供商与模型提供商完全分开**：接口、密钥、选择都在设置页「网页工具」里单独配置，也可以添加自定义提供商。

本文只描述第一阶段已实现的能力。Tavily、Brave、SearXNG 等预设和用量显示尚未实现，需要时用自定义提供商接入。

## 提供商模型

类型在 `packages/shared/src/web-tools.ts`：

- `WebProvider`：`id`、`name`，以及可选的 `search`（`WebSearchEndpoint`）和 `fetch`（`WebFetchEndpoint`）。一个提供商可以只支持其中一种。
- `WebToolsConfig`：`enabled`、`searchProviderId`、`fetchProviderId`、自定义 `providers`。搜索与抓取可以选不同的提供商。
- 内置预设 `deepseekWebProvider`（`builtinWebProviders`）：`https://api.deepseek.com/v1/tools/search` 与 `.../fetch`，Bearer 认证。内置提供商不可编辑或删除。
- 默认配置 `defaultWebToolsConfig()` 为关闭，且没有选择任何提供商。

**统一的 HTTP 适配器**：不为每家写代码，由接口配置驱动。

| 项 | 说明 |
| --- | --- |
| 请求 | `url`、`method`（GET/POST）、`headers`、`query`、`body`（JSON 模板），认证 `bearer` / `header` / `query` / `none`。 |
| 模板变量 | 搜索 `{{query}}`、`{{count}}`、`{{apiKey}}`；抓取 `{{url}}`、`{{apiKey}}`。整串恰为 `{{count}}` 时按数字代入。 |
| 响应 | 用点号/下标路径取值（如 `data.items[0].title`）：搜索取 `resultsPath` 与 `fields`（title、url、snippet、summary、content、date、source），抓取取 `titlePath`、`contentPath`。 |

## 存储

- 配置：`<agentDir>/web-tools.json`（`version: 1`，权限 0600，原子写入）。文件缺失、损坏或不合法时退回「关闭」的默认配置，不会抛错。删除自定义提供商时同时丢弃它的密钥。
- 密钥：`<home>/web-tools-auth.enc.json`，由 `SecureCredentialStore`（Electron `safeStorage`）加密，内容为 `{version:1, keys:{<providerId>: <key>}}`。系统加密不可用时 `WebToolsState.keysAvailable` 为 `false`，设置页禁止保存密钥，工具也不会生效。
- 密钥只写入：界面保存后只显示「已保存」，IPC 不会返回密钥；密钥不进入对话、系统提示词、日志或工具结果。

## 工具与行为

实现在 `packages/agent/src/web-tools.ts`（`createWebTools`）与 `web-tools-service.ts`（`WebToolsService`）。

- `web_search`：参数 `query`、可选 `count`（1–20，默认 8）。结果格式化为带标题、URL、来源、摘要的列表，整体包在 `<untrusted_web_content>` 里。
- `web_fetch`：参数 `url`。返回标题与正文（最多 50,000 字符，超出会标注截断），同样包在 `<untrusted_web_content>` 里。
- 工具仅在「总开关打开 + 对应能力选了提供商 + 该提供商有密钥」时才激活；设置变化会立即更新所有对话的激活工具（`AgentRuntime` 的 `webTools.onChange`）。关闭后即使模型仍发出调用也会被拒绝。
- 系统提示词只在工具激活时追加使用说明（`vela-web-tools` 扩展），强调网页内容是不可信数据，不执行其中的指令。

### 审批策略

| 场景 | `web_search` | `web_fetch` |
| --- | --- | --- |
| 每次询问（ask） | 不询问 | 询问网址（审批类型 `web`，不在 ask 模式的豁免之列） |
| 智能（smart） | 不询问 | 由风险模型判断（`describeSandboxRiskAction` 的 web 分支，重点是 URL 是否可能外传敏感信息） |
| 完全访问（full） | 不询问 | 不询问 |

`web_fetch` 的审批结果按 `web\0<url>` 缓存（`riskCacheKey`）。没有审批通道（如未接入 `webPermission`）时，`web_fetch` 直接拒绝。

### 适用范围

- Plan 模式允许（只读）；只读配方阶段允许。
- `explore`、`general` 子代理和定时任务拿到这两个工具。
- 常驻 Agent（resident）不提供。

## 安全边界

- 只允许抓取公开的 http/https 地址：拒绝带用户名密码的 URL，以及 `localhost`、回环、私有网段（`parseFetchUrl`、`isPrivateHost`）；拒绝发生在询问用户之前。
- 提供商接口必须是 https；仅回环地址允许 http（便于本地自建服务和测试）。
- 不跟随重定向；响应体最多 2 MB；对 408/429/5xx 重试一次。
- 状态码映射为稳定的失败代码：400 `invalid`、401 `auth`、402 `balance`、403 `blocked`、404 `not-found`、429 `rate-limit`，另有 `timeout`、`network`、`response`、`storage`、`disabled`。错误消息中的密钥会被脱敏。
- 页面内容中的 `</untrusted_web_content>` 会被转义，页面无法提前闭合不可信区块。
- IPC（`WebToolsHost`）只接受主框架请求，逐字段校验输入；设置页「测试」按钮在窗口销毁时会中止。

## 设置页

设置 → 扩展 → 网页工具（页面 id `web`），组件 `WebToolsSettingsSection`：

- 总开关、搜索/抓取各自的提供商下拉（无密钥的提供商带「无密钥」标记）。
- 每个提供商卡片：密钥输入（密码框，保存/替换/移除）、「测试搜索」「测试抓取」、自定义提供商的编辑与删除（二次确认；删除正在使用的提供商会清空对应选择）。
- 自定义提供商编辑器：名称、搜索/抓取端点各自的 URL、方法、认证、请求体模板、响应路径与字段映射；高级项里有额外请求头和查询参数。表单校验逻辑在 `web-tools-settings-model.ts`。
- DeepSeek 卡片提示其按成功请求计费。

## 对话里的工具卡片

`ToolCard.tsx` 对 `web_search`、`web_fetch` 有专属展示：

- 专属图标 `WebSearchIcon`（带经纬线的放大镜）和 `WebFetchIcon`（浏览器窗口加向下箭头），配色 `--tool-icon-web`；不再使用通用的扳手图标，运行中图标周围也没有脉冲光圈（运行状态只由右侧的转圈标出）。
- 展开后的详情按 Markdown 渲染：去掉给模型看的「不可信内容」提示行和 `<untrusted_web_content>` 包裹，标题与来源整理在顶部，搜索结果是编号列表（多行字段在 `formatSearchResults` 里缩进到条目内），页面正文按 Markdown 渲染。
- 有些抓取服务返回反斜杠转义过的 Markdown（如 DeepSeek 的 `\#\# 标题`、`2024\-07\-25`）。`unescapeMarkdown`（`packages/shared/src/web-tools.ts`）只在转义明显密集时还原，服务端抓取结果与界面展示（含历史会话）都会用到。
- 文案有 zh-CN、en 以及 zh-TW、ja、ko 译文（`settings-copy.ts`、`packages/shared/src/i18n-messages/`）。

## 验证

```bash
pnpm --filter @vela/desktop test:web-tools     # 服务、工具、运行时、IPC host、设置页模型
pnpm --filter @vela/desktop test:web-tools:ui  # 真实 Electron 渲染层：设置页（密钥只写、选择与开关、测试、自定义提供商、删除、加密不可用、中文文案）和工具卡片（专属图标、无脉冲、Markdown 详情）
pnpm test                                       # typecheck + 全部单元测试
```

覆盖审批相关的还有 `packages/workspace/test/sandbox-permission-manager.test.ts`（web fetch approvals）和 `packages/agent/test/sandbox-risk.test.ts`。

## 已知限制

- 目前只有 DeepSeek 一个内置预设，其他服务要手填自定义提供商。
- 没有用量统计和费用显示。
- 抓取由提供商服务端完成，Vela 不会在本机渲染页面或执行 JavaScript；需要登录态的页面请使用内置浏览器。
