# 侧边聊天

状态：已在 1.1.10 发布。

侧边聊天是工作面板里的轻量对话：只和模型聊天，不提供任何 Agent 工具，带入长期记忆。适合在主对话运行时顺手问个概念、核对思路，而不打断或污染主对话的上下文。

## 使用

- 工作面板标签栏的 `+`（或 ⌘T）打开新标签页，选择「侧边聊天」。可以同时开多个，第二个起标签名带编号。
- Enter 发送，Shift+Enter 换行；回复中可以停止，已收到的部分保留并标记「已停止」。
- 失败时显示错误，「重试」从最后一条用户消息重新请求。
- 顶部垃圾桶清空当前侧边聊天；关闭标签会停止仍在进行的回复并丢弃历史。
- 输入框下方可以单独选择模型和推理强度，与主输入框是同一套控件；选择只作用于侧边聊天，不改动主对话。新开的侧边聊天沿用上一次的选择（保存在界面存储 `vela.sideChat.model`），没有记录时沿用打开那一刻主对话的模型与推理强度。在这里添加自定义模型只登记并在侧边聊天里选中。
- 切换主对话或工作区不会关闭侧边聊天；下一次发送按新的主对话带入记忆，模型保持侧边聊天自己的选择。

## 能力边界

- 没有工具：不能读写文件、运行命令、浏览网页，也看不到主对话。系统提示词要求模型在需要这些能力时说明并建议回到主对话，不假装执行过。
- 只读记忆：不提供 `memory_update`，要求记住的内容需在主对话或设置页「记忆」里保存。
- 不落盘：历史只保存在该标签的界面状态里，重启应用后消失；不写入任何对话记录，也不计入对话的轨迹和用量统计。

## 模型与记忆

`packages/agent/src/runtime.ts` 的 `sideChat`：

- 模型：界面总是发送侧边聊天自己选的模型；请求未指定时依次用当前主对话（`conversationId`）选定的模型和设置里的默认模型。不可用时报错（例如「这个模型还不能使用，请先登录或填写密钥」）。
- 推理强度：`SideChatService` 用 `clampThinkingLevel` 按模型支持范围调整，`off` 或不支持推理的模型不传 `reasoning`；结果里返回实际使用的强度。界面切换模型时，原强度不受支持则取不超过它的最高一档（`side-chat-model.ts` 的 `sideChatModelInfo`）。
- 记忆：「启用记忆」开启时，按当前主对话自己的工作区用 `memoryTargetsFor` 加载全局与项目记忆，与主代理同一套规则（`hasWorkspace` 为 false 只加载全局）；没有主对话时只加载全局。正文经 `memoryContextBlock` 以相同标签注入系统提示，项目记忆在前。关闭时不加载。
- 每次发送都重新读取记忆文件，外部编辑在下一条消息生效。
- 顶部显示记忆状态（已带入全局 / 项目、没有可带入的记忆、记忆已关闭），悬停可看来源路径。

## 历史与请求

- 每次发送完整历史；`packages/agent/src/side-chat.ts` 的 `sideChatHistory` 从最新往前保留约 20 万字符，最后一条用户消息始终保留，开头不留助手消息。
- 请求经 `parseSideChatRequest` 校验：请求 ID、对话 ID 格式、语言、角色、单条长度和条数，最后一条必须是非空用户消息。
- `SideChatService` 用 `ModelRuntime.streamSimple` 发起一次不带 `tools` 的流式调用，按 `requestId` 支持中途停止。

## 实现位置

| 位置 | 内容 |
| --- | --- |
| `packages/shared/src/side-chat.ts` | 请求、结果、流式事件与 `SideChatApi` 契约。 |
| `packages/agent/src/side-chat.ts` | 请求校验、系统提示词、历史裁剪、流式调用与停止。 |
| `packages/agent/src/runtime.ts` 的 `sideChat` / `cancelSideChat` | 模型选择与记忆加载。 |
| `apps/desktop/src/main/session-host.ts` | `side-chat:send` / `side-chat:cancel` IPC，增量只发回发起请求的窗口。 |
| `apps/desktop/src/renderer/components/SideChatView.tsx` | 标签内的消息列表、输入、停止、重试与清空。 |
| `apps/desktop/src/renderer/components/side-chat-model.ts` | 请求历史、重试范围、模型选择的记忆与推理强度调整、记忆状态文案的纯逻辑。 |

## 验证

```sh
pnpm --filter @vela/desktop test:side-chat      # 校验、提示词、历史裁剪、流式、推理强度、停止、错误与界面模型
pnpm --filter @vela/desktop test:side-chat:ui   # 真实 Electron：打开标签、独立选择模型与推理强度、流式显示、记忆状态、停止、重试、跟随主对话、窄宽度、关闭即停止、五种语言
```

UI 检查使用内存夹具代替模型和主进程，没有覆盖真实模型请求。
