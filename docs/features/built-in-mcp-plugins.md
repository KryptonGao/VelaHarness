# Built-in MCP Plugin System

设置 → Integrations（集成）显示内置应用（Notion、Linear、DeepWiki、Cloudflare、Supabase、PostHog）。每张卡片提供 Connect、连接中 Cancel、连接后 Disconnect，以及可重试的错误状态。用户无需填写 URL、Token 或 JSON。连接为当前 Vela 配置目录中的全局个人连接；所有工作区、现有与未来的 Agent 会话使用同一账号。

## 架构与文件

内置插件是预配置的 MCP Server，没有专用 Tool Adapter。现有 `createMcpExtension` 继续负责 Streamable HTTP、initialize、tools/list、工具注册、资源和执行管线。

| 文件 | 职责 |
| --- | --- |
| `packages/shared/src/plugin.ts` | 不含凭证的插件配置、状态与 IPC 类型。 |
| `packages/agent/src/mcp/plugin-registry.ts` | `PluginRegistry`、Notion 声明、启用状态、与用户 MCP Server 的合并。 |
| `packages/agent/src/mcp/manager.ts` | `PluginMCPManager`：连接、取消、断开、重复点击合并与状态。 |
| `packages/agent/src/mcp/oauth.ts` | `OAuthMCPManager`：复用 Pi OAuth discovery / PKCE / DCR / localhost callback，统一登录与 refresh 锁。 |
| `packages/agent/src/mcp/credentials.ts` | `CredentialStore` abstraction、非桌面内存存储、共享凭证路由、刷新串行化与撤销保护。 |
| `packages/agent/src/mcp-config.ts` | 合并虚拟内置服务器，生成配置摘要及授权 digest，预留并保护 `builtin_` 命名空间。 |
| `packages/agent/src/mcp-session.ts` | 为现有 MCP 扩展注入共享凭证存储；安全脱敏仍由现有桥接层完成。 |
| `packages/agent/src/runtime.ts` | 通用插件生命周期入口与现有 MCP 会话 reload / suspend 的衔接。 |
| `packages/agent/src/index.ts`、`packages/shared/src/index.ts`、`packages/shared/src/mcp.ts` | 导出接口，MCP 服务器摘要附加 `pluginId`。 |
| `apps/desktop/src/main/plugin-credentials.ts` | Electron `safeStorage` 加密与带锁文件存储。 |
| `apps/desktop/src/main/index.ts`、`mcp-host.ts`、`apps/desktop/src/preload/index.ts` | 主进程注入安全存储、校验 IPC、桥接无凭证的方法和事件。 |
| `apps/desktop/src/renderer/components/IntegrationsSection.tsx` | 通用插件卡片及 disconnected / connecting / connected / error 状态。 |
| `SettingsView.tsx`、`settings-copy.ts`、`McpSettingsSection.tsx`、`apps/desktop/src/renderer/styles.css` | 集成导航、中英文界面与现有设置样式；用户 MCP 页面只显示用户条目。 |
| `packages/agent/test/plugin-system.test.ts` | OAuth/MCP 端到端与生命周期、权限、并发刷新测试。 |
| `apps/desktop/test/plugin-credentials.test.ts`、`mcp-host.test.ts`、`plugins-ui.mjs` | 安全存储、IPC、真实 Electron 交互与系统加密验证。 |
| 根目录、Agent 和桌面 `package.json` | 新增 `test:plugins`，桌面新增 `test:plugins:ui`。 |

## 数据结构

`BuiltInPlugin` 包含 `id`、`name`、`description`、`icon`、`mcpUrl`、`transport`、`authType`。可选 `oauth` 提供公开 client ID、scope、metadata URL、localhost callback 配置；不允许 client secret 出现在插件公开配置中。`toolPolicy` 预留审批策略与访问类别扩展结构，当前继续使用现有 MCP policy；该字段不会自动授予工具权限。

`PluginSnapshot` 追加 `serverName`、`status`、`toolCount` 和固定安全错误文字。`PluginCatalog` 包含当前工作区、插件摘要与 `pendingApply`。`PluginTarget` 只接收工作区、可选对话 ID 和插件 ID；Renderer 无权改变内置 endpoint 或传入凭证。`PluginStatusEvent` 只广播插件 ID、状态与安全错误文字。

`CredentialStore` 采用 Pi 的同步/异步带锁读改写契约。它与 Electron 无关，可替换为其他主进程存储实现。`PluginCredentialStore` 根据插件服务器身份路由到安全存储，所有会话共享同一实例。

## OAuth 与连接流程

1. 点击 Connect，IPC 校验调用方为桌面窗口主 frame，并校验工作区、对话归属和插件 ID；注册表只允许已声明插件。
2. 将插件 ID 写入 `integrations.json`，合并为 `builtin_<id>` MCP Server。用户 `mcp.json` 不被改写。闲置会话 reload；忙碌会话等待本轮结束。管理会话单独负责授权，因此连接操作无需等待模型生成。
3. 使用现有 Streamable HTTP transport 尝试 initialize。若服务要求授权，Pi 从 `WWW-Authenticate` 的 protected resource metadata 开始 discovery，再读取 authorization server metadata。
4. 有预配置公开 client ID 时复用；否则服务公布 registration endpoint 时执行 Dynamic Client Registration。OAuth 使用 authorization code、PKCE S256、随机 state 和 issuer 检查，回调监听 localhost loopback 地址。用户只在系统浏览器中登录及确认授权。
5. code exchange、client registration、access / refresh token 与 PKCE 状态仅在主进程存储。登录等待上限为五分钟，取消会中断请求并关闭回调监听。
6. 授权完成，现有 MCP connection 自动 reconnect，执行 initialize / tools/list，将工具注册为 `mcp__builtin_<id>__<tool>`。默认 `deferred` 曝光，Agent 使用现有 `tool_search` 找到并调用工具。
7. access token 临近过期或 HTTP 401 时，现有 OAuth provider 自动 refresh。连接内部合并 refresh；共享存储再提供跨会话队列及跨进程文件锁。读取旧 token、refresh 与写入轮换 token 在同一锁内，后续请求看到新 token 后不重复 refresh。显式登录可能使用 refresh grant，因此也共享该锁。
8. Disconnect 先取消正在进行的登录，将插件禁用以立即收回工具权限，再关闭所有会话连接、等待 refresh 结束并删除凭证。旧 store handle 无法在撤销后重新写回 token。

## 凭证与权限

桌面内置插件凭证写入 `<Vela home>/integrations-auth.enc.json`，文件只包含版本及加密 envelope。Electron `safeStorage` 使用系统安全存储支持的密钥；文件沿用 Pi 的原子写入与权限管理。系统加密不可用、Linux 退化为 `basic_text`、文件损坏或无法解密时失败，不退回明文。`integrations.json` 只保存启用的插件 ID。

手动配置 MCP Server 的现有凭证路径与格式保持兼容，不自动迁移其 `mcp-auth.json`。非桌面宿主不注入安全存储时，内置插件只在主进程内存保存凭证，进程退出后需要重新授权。

所有工具仍走 `McpSessionBridge` 的现有工具调用链、MCP 审批和 Plan/explore 只读过滤。服务端 `readOnlyHint` 仅是提示；只有与工作区、服务器 config digest 和原始工具 digest 绑定的明确授权才被当作只读。Notion 的名称和工具名不参与 Runtime 特殊分支。服务端回显的凭证也会在进入 Renderer 前脱敏。

## Notion、Linear、DeepWiki、Cloudflare、Supabase、PostHog 注册与新增插件

`packages/agent/src/mcp/plugin-registry.ts` 的 `builtInPlugins` 声明 Notion：

```ts
{
  id: "notion",
  name: "Notion",
  description: "Search, read and edit your Notion workspace",
  icon: "notion",
  mcpUrl: "https://mcp.notion.com/mcp",
  transport: "streamable-http",
  authType: "oauth2",
  toolPolicy: { approval: "existing-mcp-policy", access: "read-write" },
}
```

Pi 内部把 Streamable HTTP 称为 `type: "http"`，注册表负责这个配置映射，未创建新的 transport。Endpoint 与 [Notion 官方连接文档](https://developers.notion.com/guides/mcp/get-started-with-mcp) 一致。

Linear 使用同一机制，声明位于 Notion 之后：

```ts
{
  id: "linear",
  name: "Linear",
  description: "Find, create and update Linear issues, projects and comments",
  icon: "linear",
  mcpUrl: "https://mcp.linear.app/mcp",
  transport: "streamable-http",
  authType: "oauth2",
  toolPolicy: { approval: "existing-mcp-policy", access: "read-write" },
}
```

Endpoint 与 [Linear MCP 官方文档](https://linear.app/docs/mcp) 一致，服务端支持 OAuth 2.1、Dynamic Client Registration 与 PKCE，因此无需预注册 client ID。工具注册为 `mcp__builtin_linear__<tool>`，默认 `deferred`。Linear 没有专用 Adapter 或 Runtime 分支；图标映射在 `IntegrationsSection.tsx`，工具结果里的 `linear.app` 链接来源显示为 “Linear”。真实 Linear OAuth 尚未用用户账号联调，仅验证了注册表、生命周期与本地 provider 测试。

DeepWiki 是无需登录的公共 MCP 服务，同样只是一条注册声明：

```ts
{
  id: "deepwiki",
  name: "DeepWiki",
  description: "Browse and ask questions about the documentation of public GitHub repositories",
  icon: "deepwiki",
  mcpUrl: "https://mcp.deepwiki.com/mcp",
  transport: "streamable-http",
  authType: "none",
  toolPolicy: { approval: "existing-mcp-policy", access: "read-only" },
}
```

Endpoint 与 [DeepWiki MCP 官方文档](https://docs.devin.ai/work-with-devin/deepwiki-mcp) 一致，只提供 `read_wiki_structure`、`read_wiki_contents`、`ask_question` 三个读取类工具，仅覆盖公开仓库。`authType: "none"` 时注册表不生成 `oauth` 配置，`activatePlugin` 在 initialize 成功后直接完成连接，不触发 discovery、DCR 或浏览器，也不写入凭证；Disconnect 仍会禁用服务器、关闭所有会话连接。`access: "read-only"` 只是声明，不会自动授予 Plan/explore 的只读授权，仍使用现有 MCP 审批与 `setMcpToolReadOnly`。工具注册为 `mcp__builtin_deepwiki__<tool>`，默认 `deferred`；图标是从 deepwiki.com 取得的官方 Logo（单色路径，随主题着色），工具结果里的 `deepwiki.com` 链接来源显示为 “DeepWiki”。真实 DeepWiki 服务尚未联调，只用本地无认证 MCP provider 验证了连接、工具列表与断开。

Cloudflare 同样只是一条 OAuth 声明，位于 DeepWiki 之后：

```ts
{
  id: "cloudflare",
  name: "Cloudflare",
  description: "Manage Cloudflare accounts, zones, Workers and other resources through the Cloudflare API",
  icon: "cloudflare",
  mcpUrl: "https://mcp.cloudflare.com/mcp",
  transport: "streamable-http",
  authType: "oauth2",
  toolPolicy: { approval: "existing-mcp-policy", access: "read-write" },
}
```

Endpoint 与 [Cloudflare MCP 官方文档](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/) 一致。只读探测确认 `https://mcp.cloudflare.com/.well-known/oauth-authorization-server` 提供 DCR（`/register`）、PKCE S256 与公开 client（`token_endpoint_auth_methods_supported` 含 `none`），未授权请求返回带 `resource_metadata` 与基线 `scope="user:read account:read"` 的 401 挑战，因此无需预注册 client ID。**权限由用户在授权时选择**：Vela 不预置 `oauth.scope`，也不在应用内维护 Cloudflare 权限清单，用户在 Cloudflare 的授权页面勾选要授予的账号与权限，Vela 仅保存最终返回的令牌。需要更多权限时，先 Disconnect 再重新 Connect 并在授权页选择。工具注册为 `mcp__builtin_cloudflare__<tool>`，默认 `deferred`，写类操作仍走现有 MCP 审批；图标取自 Simple Icons（CC0）路径并拆成两段上品牌色（橙 #F6821F、琥珀 #FBAD41），不随主题变色，工具结果里 `cloudflare.com` 及其子域链接来源显示为 “Cloudflare”。真实 Cloudflare OAuth 尚未用用户账号联调，只验证了注册表声明、生命周期与本地 provider 测试。

Supabase 同样只是一条 OAuth 声明，位于 Cloudflare 之后：

```ts
{
  id: "supabase",
  name: "Supabase",
  description: "Manage Supabase projects, databases, migrations, Edge Functions and storage",
  icon: "supabase",
  mcpUrl: "https://mcp.supabase.com/mcp",
  transport: "streamable-http",
  authType: "oauth2",
  toolPolicy: { approval: "existing-mcp-policy", access: "read-write" },
}
```

Endpoint 与 [Supabase MCP 官方文档](https://supabase.com/docs/guides/getting-started/mcp) 一致。只读探测确认：未授权请求返回带 `resource_metadata` 的 401 挑战，授权服务器为 `https://api.supabase.com`，公布 DCR（`/platform/oauth/apps/register`）、PKCE S256 与 `organizations:read`、`projects:*`、`database:*`、`edge_functions:*`、`storage:*` 等 scope。因此无需预注册 client ID，Vela 不预置 `oauth.scope`，授权的组织与权限由用户在 Supabase 授权页选择；需要更多权限时先 Disconnect 再重新 Connect。该服务的 token endpoint 只公布 `client_secret_basic` / `client_secret_post`，DCR 为每个动态注册的 client 返回其自己的 secret，仍只保存在主进程凭证存储中，不是产品预置的 secret。工具注册为 `mcp__builtin_supabase__<tool>`，默认 `deferred`；其中执行 SQL、应用迁移、部署 Edge Function 等写类工具仍走现有 MCP 审批，`access: "read-write"` 不会自动授予 Plan/explore 的只读授权。图标取自 devicon 的 Supabase 标志，渐变改为两段纯色（#3ECF8E、#249361），不随主题变色，工具结果里 `supabase.com` 及其子域、`supabase.co` 子域的链接来源显示为 “Supabase”。真实 Supabase OAuth（含 DCR 返回 secret 的 token 交换）尚未用用户账号联调，只验证了注册表声明与生命周期测试，以及上述只读 metadata 探测。

PostHog 同样只是一条 OAuth 声明，位于 Supabase 之后：

```ts
{
  id: "posthog",
  name: "PostHog",
  description: "Query product analytics, insights, feature flags, experiments and error tracking in PostHog",
  icon: "posthog",
  mcpUrl: "https://mcp.posthog.com/mcp",
  transport: "streamable-http",
  authType: "oauth2",
  toolPolicy: { approval: "existing-mcp-policy", access: "read-write" },
}
```

Endpoint 与 [PostHog MCP 官方文档](https://posthog.com/docs/model-context-protocol) 一致。只读探测确认：未授权请求返回带 `resource_metadata` 的 401 挑战，授权服务器为 `https://oauth.posthog.com`，公布 DCR（`/oauth/register/`）、PKCE S256 与公开 client（`token_endpoint_auth_methods_supported` 含 `none`），受保护资源元数据列出 `insight:read`、`feature_flag:write` 等细粒度 scope。因此无需预注册 client ID，Vela 不预置 `oauth.scope`，授权的项目与权限由用户在 PostHog 授权页选择；需要更多权限时先 Disconnect 再重新 Connect。工具注册为 `mcp__builtin_posthog__<tool>`，默认 `deferred`；创建或修改 Feature Flag、实验等写类工具仍走现有 MCP 审批，`access: "read-write"` 不会自动授予 Plan/explore 的只读授权。图标取自 Simple Icons（CC0）的 PostHog 标志，单色跟随主题，工具结果里 `posthog.com` 及其子域的链接来源显示为 “PostHog”。**区域限制**：内置端点固定为美国区 `mcp.posthog.com`；欧盟区账号使用 `mcp-eu.posthog.com`（已确认其 401 挑战存在），目前 Vela 不提供区域选择，欧盟区用户暂时无法通过内置卡片连接，如需支持应另行设计区域选项。真实 PostHog OAuth 尚未用用户账号联调，也未验证未预置 scope 时授权页的默认勾选行为，只验证了注册表声明与生命周期测试，以及上述只读 metadata 探测。

新增更多 OAuth MCP 插件时，在同一数组追加配置：

```ts
{
  id: "second_service",
  name: "Second Service",
  description: "Search and manage your workspace",
  icon: "second_service",
  mcpUrl: "https://your-provider.example/mcp",
  transport: "streamable-http",
  authType: "oauth2",
  // 如果服务不支持 DCR，需由产品预配置已注册的公开 desktop client：
  // oauth: { clientId: "public-client-id", scope: "required scopes" },
}
```

注册表、OAuth、状态页和 Tool Registry 接入均自动复用；只需按实际服务增加图标映射和提供商测试。自定义宿主可以在 `AgentRuntimeOptions.builtInPlugins` 注入注册定义，并通过 `pluginCredentialStore` 注入安全后端。`id` 使用小写字母、数字和下划线，以字母开头。

## 验证与边界

`pnpm test:plugins` 包含本地完整 OAuth/MCP provider 测试、两会话轮换 refresh、过期自动 refresh、工具审批拒绝与允许、断开后调用拒绝、取消授权、安全存储和 Renderer 交互。UI smoke 在隔离 Electron profile 中验证真实系统加密，支持 `VELA_PLUGIN_UI_CAPTURE` 导出状态截图；图像需等待实际绘制完成。

本次还验证了现有 Agent/桌面 MCP 测试、受影响的会话与权限检查、类型检查、桌面 build 和 MCP Electron smoke。Notion metadata 的只读探测确认了 OAuth endpoints、DCR 和 PKCE S256；未用用户真实 Notion 账号完成授权或读写工作区内容。连接页面按现有设置风格实现，主 Agent 检查了明暗主题、中英文及 200% 缩放；遵照任务要求未运行子代理或独立视觉评审。

当前边界：

- 每个插件、每个 Vela 配置目录只支持一个全局账号，尚无多账号或项目级插件授权。
- 内置插件页面当前只管理连接；Plan/explore 所需的明确只读授权可使用现有 `setMcpToolReadOnly` API，尚未增加插件工具权限编辑 UI。
- Disconnect 撤销本地访问并删除本地凭证，没有调用提供商 token revocation endpoint；远端授权需在提供商后台撤销。
- 依赖提供商 OAuth metadata 与桌面 loopback redirect 支持；没有 DCR 的服务需产品预注册公开 OAuth client。要求 confidential secret 的提供商还需主进程 credential provisioning 或可信后端，不能把 secret 嵌入 Renderer。
- 当前只声明 Streamable HTTP 内置插件；其他传输或自定义协议回调需要扩展声明和宿主配置。
- 启用状态文件采用原子替换，但不提供多个独立 Vela 进程并发编辑启用状态的合并；refresh 与 token 写入已有跨进程锁。
- 已在生成工具调用之前开始执行的远端写操作无法由本地 Disconnect 回滚；本地取消会关闭传输并拒绝后续调用。
- 真实 Notion OAuth 及不同提供商的兼容性仍需账号级联调；本次没有创建 Notion OAuth client、登录用户账号或修改远端数据。

协议参考：[MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)。
