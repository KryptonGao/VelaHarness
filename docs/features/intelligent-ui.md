# Intelligent UI

Agent 回答里可以嵌入原生交互界面：计算器、对比表、分步演示。界面是声明式数据，由 Vela 自己的组件渲染；模型输出的任何 HTML、脚本、JSX 都不会被执行。

需求与分期见 [requirements/intelligent-ui.md](../requirements/intelligent-ui.md)。本文描述已经实现的 P0、P1（图表与图解、可信数据源、导出与继续提问、本地指标与检查器）和 P2（沙盒微应用、更丰富的视图、工作流协作）。

## 使用

- **设置**：设置 → 对话显示 →「交互式界面」，三个选项：
  - **自动**（默认）：只在界面明显比文字好用时生成。
  - **仅文字**：不再告诉模型可以生成界面。
  - **偏向可视化**：比较、计算、参数探索类问题优先用界面；简单问答、命令和代码仍然用文字。
- 偏好保存在当前 Profile 的 `intelligent-ui-settings.json`，只存模式，不存任何交互数据。
- 只有 **Agent 模式**会收到界面语法说明；Plan 与 Goal 不注入，保持纯 Markdown，`<proposed_plan>` 等现有流程不受影响。
- 界面里的筛选、排序、页签、滑块、勾选都只在本地即时生效，不会打扰 Agent。只有点击带 `submit_to_agent` 动作的按钮，并在界面内确认文字后，才会把当前参数作为一条新消息发给 Agent。
- 每个界面都有「查看原始文本」，可看到围栏里的 NDJSON；界面出错或未完成时会降级显示，正文仍可读。

## 协议

在回答里用 `vela-ui` 围栏，每行一个 JSON 对象（NDJSON）：

| op | 作用 |
| --- | --- |
| `begin` | 必须是第一行：`id`、`version`（当前为 1）、可选 `title`。第一行不是合法 `begin` 的围栏按普通代码块显示。 |
| `state` | 声明本地状态：`number`（`min`/`max`/`step`）、`string`（`maxLength`/`options`）、`boolean`。 |
| `derive` | 派生值，表达式可引用状态或其他派生值；`commit` 时拓扑排序，循环依赖被拒绝。 |
| `node` | 组件节点：`id`、`parent`、`type`、`props`。第一个节点是根，之后父节点必须已出现。 |
| `commit` | 最后一行。缺少 `commit` 的界面标为「未完成」。 |

组件白名单（`uiComponentTypes`）：`text` `heading` `caption` `code`；`column` `row` `grid` `divider` `card`；`table` `stat` `progress` `list`；`tabs` `segmented` `select` `radio`；`input` `number_input` `slider` `checkbox`；`button` `collapsible`；`loading` `empty` `error`；P1 增加 `bar_chart` `line_chart` `pie_chart` `svg_diagram` `media`；P2 增加 `timeline` `itinerary` `diff_view`。所有节点可带 `show` 表达式控制显示。属性经严格规范化，未知字段被丢弃；未知组件或非法属性只让该节点变成占位，结构性违规（超限、父节点不存在等）让整块无效。

表达式是纯数据 AST：`add` `subtract` `multiply` `divide` `round` `floor` `ceil` `abs` `min` `max` `compare` `if`（惰性）`and` `or` `not` `format` `concat`，以及 `{"ref":名字}`。求值错误（除零、非有限数、类型不符）作为值返回并在界面显示，不会抛异常。表达式不能读取时间、文件、网络或剪贴板。

动作（`parseAction`）：`set_state`、`toggle`、`copy`、`open_external`、`submit_to_agent`、`refresh_source`、`request_tool`。`open_external`、`submit_to_agent`、`refresh_source`、`request_tool` 都需要在界面内确认，并显示将要发送的文字或打开的地址；外链只允许 `http`、`https`、`mailto`。`refresh_source` 与 `request_tool` 只是**请 Agent 去做**：确认后生成一条普通消息发给 Agent（`composeRefreshRequest`、`composeToolRequest`），由 Agent Runtime 按原有权限与审批决定能不能运行。界面自己不能调用工具、改文件或执行命令，也不会伪造工具运行记录。

限制（`uiLimits`）：原始协议 256 KiB、单行 48 KiB、节点 200、深度 12、状态 50、派生值 50、选项总数 500、表格 200 行 × 12 列、列表 100 项、单节点子节点 100。超限的块标为无效并降级。P1/P2 的额外上限：图表每序列 100 个点、最多 6 个序列、饼图 24 个扇区；`svg_diagram` 150 个图元、40 个热区、坐标范围 ±10000、path 4000 字符；时间轴 100 项；行程 14 天 × 60 站；`diff_view` 2000 行 / 40000 字符；数据源 8 个，解析后保留 500 行 × 24 列、单元格 500 字符；`vela-app` 的 HTML 64 KiB。

## P1：图表、图解与数据

- **图表**：`bar_chart`、`line_chart`、`pie_chart` 的数据可以是字面量，也可以通过 `from` 引用数据源。每个图表同时有「图表 / 数据表」两种呈现：数据表是无障碍备选，也可复制为 TSV。空值与非有限数显示为缺失，不画成 0。颜色只取主题变量，不依赖颜色传达信息（图例、数据标签、数据表同时存在）。
- **`svg_diagram`**：只允许 `rect`、`circle`、`ellipse`、`line`、`polyline`、`polygon`、`path`、`text` 这些基础图元和文字标签。没有 `foreignObject`、事件属性、脚本和外链资源；颜色是主题 token，不接受任意 CSS。热区是可聚焦的按钮，点击只切换模型**已经提供**的说明文字，不推断图里没有的事实。
- **`media`**：只是带说明文字的占位。图片、地图属于独立 Provider，没有连接图片或地图服务时，只显示说明文字和「没有连接图片/地图服务」的提示，不显示虚构内容。
- **数据源**：`{"op":"source","name","tool","match","call","format","path"}` 指名会话里**真实发生过**的一次工具调用，由 Vela 从工具结果里解析出值（`json` / `csv` / `lines` / `text`）。模型不能在界面里直接写数据冒充工具结果；没有找到对应调用时显示「会话里没有找到对应的工具结果」。每份数据带 `sourceId`、`fetchedAt`、`status`：`ok`、`loading`（回复仍在生成，结果还没来）、`stale`（超过 10 分钟）、`error`（调用失败或结果被截断）、`empty`。非 `ok` 状态不会显示成「已更新」。
- **刷新**：按钮的 `refresh_source` 动作确认后，把「请重新运行某次工具调用」作为消息发给 Agent。组件自己从不 `fetch`。收件箱与 Resident 没有会话工具调用，数据源显示找不到工具结果。
- **导出**：每个界面下方有「复制文字」（复制与对话导出相同的纯文字等价物，含表格与来源）、「继续」类按钮和「查看原始文本」。图表可以复制为表格、保存为 PNG：渲染层把已计算的主题样式内联进 SVG 再用 canvas 光栅化，文件里保留标题、单位和来源。有可交互状态的界面还有「用当前设置继续」，确认后把当前参数作为一条消息发出（`composeContinueRequest`）。用户模板（保存常用界面）**没有实现**。

## P1：本地指标与检查器

- 指标只统计次数和耗时：含界面的回复占比、首个合法节点耗时中位数、commit 成功率、降级原因、渲染错误、平均节点数与状态数、微应用运行与停止原因。**不含界面内容和用户输入的值，不上传。** 汇总计数存在渲染层 `uiStorage`；事件时间线只在内存里。
- 只有本次运行里**流式生成**的界面计入「结局」统计（成功率、耗时）；历史恢复的界面只记事件，不夸大成功率。
- 设置 → 对话显示 →「交互式界面」下可以查看汇总、重置，以及打开「检查器」。检查器在开发版默认开启，正式版需手动打开。每个界面下方的检查器显示已验证的 AST、事件时间线、当前状态、数据源与拒绝原因，不包含模型的思考内容。

## P2：沙盒微应用

声明式界面做不到的场景（小游戏、画布、复杂模拟）可以用 `vela-app` 围栏：第一行是 JSON 头 `{"op":"app","id","version":1,"title","height"}`，其余是一段单文件 HTML（可含内联样式和脚本，≤ 64 KiB）。这是与 `vela-ui` 完全隔离的另一条通道，**P0/P1 的声明式界面仍然不执行任何脚本**。

- **默认关闭**：设置 → 对话显示 →「微应用（高级）」里要明确打开，并有风险提示。关闭时微应用只显示说明和原文。
- **每次运行需要点击「运行」**；同时最多运行 2 个，滚出视野、切换会话、关闭设置都会停止并收回令牌。
- **隔离**：渲染在 `<iframe sandbox="allow-scripts" srcdoc=…>` 里，没有 `allow-same-origin`，origin 是不透明的，访问不到 Electron、Node、父页面的 DOM、`localStorage`、cookie。文档自带严格 CSP（`default-src 'none'`，`connect-src 'none'`，不允许框架、对象、worker、表单提交），并在应用代码运行前移除 WebRTC 构造函数。Main 的 `will-frame-navigate` 守卫（`ui-sandbox-guard.ts`）只放行 `about:srcdoc` 子框架，任何导航请求都被拒绝。
- **消息桥与 capability**：应用只有 `window.vela.submit(text)` 和 `window.vela.copy(text)` 两个能力，通过 `postMessage` 向父页面申请。Main 发放**一次性、限定应用/能力/文本大小、60 秒过期、可撤销**的令牌，每个应用最多 3 个未用令牌、每分钟 6 次申请；令牌只在 Main 与渲染层之间流转，iframe 拿不到。**每次申请都要用户在界面里确认**（显示将发送或复制的文字）；确认后才兑换令牌，再走 Agent 的普通发送路径，所以仍受原有权限与审批约束。
- **资源限制**：5 秒内必须报告 ready；之后心跳静默超过 5 秒、累计错误超过 5 次、运行超过 10 分钟都会被停止并说明原因。
- **导出**：微应用不会被导出，导出里只有「沙盒微应用不会被导出」占位。

## P2：更丰富的视图与工作流协作

- `timeline`（时间轴）、`itinerary`（行程；只有模型明确给出坐标的站点才有可选的「位置示意图」，并标注「坐标由模型给出」，不会把只有名称的地点当成真实坐标，也不是地图）、`diff_view`（文件差异，逐行显示增删、行号和折叠，文本一律按文本渲染）。图表可以声明 `draggable`：数据点直接引用 number 状态时，可以用鼠标或键盘拖动，只改本地状态并立刻重算派生值，不会启动工具；不引用状态的点不可拖。
- `request_tool`：界面可以**建议**一个工具调用（工具名、摘要、参数），确认后以消息形式交给 Agent。工具名只接受标识符形式的字符串，是否可用、是否需要审批仍由 Agent Runtime 与 ToolPolicy 决定；界面不会显示成已执行。`submit_to_agent` 与「用当前设置继续」同样只发送消息。

## 流式解析

`UiStreamParser` 按行增量解析，任意拆包结果一致（包含中文和 JSON 转义）。尾部不完整的围栏行会被暂扣，避免 ```` ```vela-u ```` 先以代码块闪现。嵌套围栏、只是提到 `vela-ui` 的代码示例都不会被当作界面。同一条消息可以是 `Markdown → UI → Markdown` 的任意组合。

产物状态：`receiving` → `ready`；流意外结束为 `incomplete`；校验失败为 `invalid`；消息被删除或回退后为 `disposed`。`commit` 之前已验证的节点就会显示。

## 本地状态与生命周期

- 只保存**用户改动过的值**，叠加在界面定义的初始值之上，所以流式过程中 `commit` 到来不会重置已输入的内容。
- 快照写入渲染层的 `uiStorage`（与其他界面偏好同一存储），带节流，单个快照上限 16 KiB，每个会话最多 400 个。
- 键为 `vela.ui.state.<会话>.<u{n}>.<artifactId>`。`u{n}` 是「会话里第 n 条可能含界面的助手回复」：聊天里的消息 id 在实时和历史恢复时不同，这个序号两者一致。快照里带内容指纹（FNV-1a），同一位置的界面被改写（编辑重发）后，旧快照因指纹不符被丢弃。
- 重启、切换会话、历史恢复：读回最后一份合法快照；格式损坏或版本不符时退回初始值，不影响聊天打开。
- Branch：复制快照，两个会话互不共享。Rewind/编辑重发：清除已不存在位置的快照。删除会话：清除其全部快照。
- 一个界面的状态不影响另一个界面。

## 导出

对话导出（Markdown/HTML，见 [conversation-export.md](./conversation-export.md)）把每个 `vela-ui` 块写成纯文字等价物：标题、控件的当前值、统计、表格、列表，以及图表的数据表、图解说明、时间轴、行程、差异和数据源的来源与状态，不含原始 JSON、脚本或可点击动作。数据源从会话的真实工具调用里解析，找不到时写明状态。`vela-app` 微应用只写占位说明。读取的是用户最后保存的输入（指纹匹配时），否则用初始值；界面无法导出时写占位说明而不是泄露源码。

## 可访问性与安全

- 全部控件是原生元素，具备名称、状态和错误提示，仅用键盘即可填写、切换页签、排序、提交。
- 文本一律按文本渲染，没有 `dangerouslySetInnerHTML`；Markdown 内联仅支持有限的 `**粗体**`、`*斜体*`、`` `代码` ``；链接只在 `safeExternalUrl` 通过时可点。
- 每个界面外有错误边界，渲染异常只让该块显示降级信息。
- 状态名拒绝原型污染键（如 `__proto__`）。

## 实现位置

| 位置 | 职责 |
| --- | --- |
| `packages/shared/src/intelligent-ui*.ts` | 协议类型与限制、表达式、组件规范化、流式解析器、状态与快照格式。纯 TypeScript，不依赖 React/Electron，Main 与 Renderer 共用。 |
| `packages/agent/src/intelligent-ui-prompt.ts` 的 `intelligentUiInstructions` | 按偏好和模式生成系统提示附加说明。 |
| `packages/agent/src/intelligent-ui-settings.ts` 的 `IntelligentUiSettings` | 偏好持久化；损坏或未知值回到「自动」。 |
| `packages/agent/src/runtime.ts` | 隐藏的 Pi 扩展在 `before_agent_start` 注入说明；`session-host.ts` 与 preload 暴露偏好读写。 |
| `apps/desktop/src/renderer/components/intelligent-ui/` | `AssistantMarkdown`（替换助手正文的 Markdown）、`UiRuntime`（状态与动作）、`components`（各组件）、`ui-state-store`（快照存储）、`IntelligentUiSetting`（设置项）。 |
| `apps/desktop/src/main/intelligent-ui-export.ts` | 导出时把界面块转成文字。 |
| `packages/shared/src/intelligent-ui-{source,data,sandbox,metrics}.ts` | 数据源解析与状态、图表数据与表格、沙盒文档/消息桥/capability broker、本地指标。 |
| `apps/desktop/src/renderer/components/intelligent-ui/` 新增 | `charts`、`diagrams`、`rich-views`（图表、SVG 图解、时间轴/行程/差异）、`image-export`、`MicroApp`、`running-apps`、`UiInspector`、`ui-metrics-instance`、`ui-settings-store`、`shared-views`。 |
| `apps/desktop/src/main/ui-sandbox-host.ts`、`ui-sandbox-guard.ts` | 微应用 capability 的发放/兑换/撤销 IPC，以及子框架导航守卫。 |

## 验证

```bash
pnpm --filter @vela/desktop test:intelligent-ui   # 解析、表达式、状态、提示、渲染模型、导出、沙盒导航守卫
pnpm --filter @vela/desktop test:ui               # 含 intelligent-ui-ui：真实 Electron 的流式、计算器、持久化、表格、XSS、窄屏、图表与图解、数据源、检查器、沙盒隔离
```

## 已知限制与未实现

- **保存用户模板**（`IUI-12` 中「可选」的一项）没有实现；也没有跨会话复用的界面库。
- 沙盒隔离已在真实 Electron 中验证：iframe 运行在独立进程，死循环不会卡住聊天页，且无网络、存储、cookie 和父页面访问。但它仍是模型写的代码：可能占用 CPU 直到被看门狗停止，也可能显示误导性内容，所以默认关闭并带风险提示。上线前建议再做一次独立的安全审查。
- 图片、地图等外部媒体没有 Provider，`media` 只显示占位；行程视图没有地图，只有模型给坐标时才有一个示意图。
- 数据源只能引用当前会话的工具调用，且按回复位置截取；收件箱和 Resident 里没有工具记录，数据源显示找不到工具结果。
- 子代理面板里的回复仍按普通 Markdown 显示，不渲染界面。
- 没有按模型能力自动关闭：能否写出合法界面取决于模型，写不出时降级为原始文字。
- 导出是静态文字，没有交互；按位置序号匹配状态，因此回退并重新生成后不会误用旧输入（指纹不符即丢弃）。
