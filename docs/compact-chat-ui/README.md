# 紧凑对话流：样式与交互参考

本文把 Vela 渲染层里「工具调用紧凑模式」（`toolDisplay = "compact"`）及整条对话流的视觉与交互规格提取出来，用于在别处（例如 DeepSeek Harness 插件）复刻同一套界面。

配套产物：

| 文件 | 说明 |
| --- | --- |
| [compact-chat-ui.html](./compact-chat-ui.html) | 单文件、无依赖、可离线打开的参考页。CSS 直接取自 `apps/desktop/src/renderer/styles.css` 的真实规则；渲染逻辑用原生 JS 重写，函数名沿用 React 组件原名。 |
| [src/](./src/) | 生成脚本与源码：`shell.html`（页面外壳与演示用 CSS）、`app.js`（渲染与演示数据）、`build.mjs`（拼接真实 CSS）。`styles.css` 变动后运行 `node docs/src/build.mjs` 重新生成。 |

> 样式的唯一事实来源是 `apps/desktop/src/renderer/styles.css`。HTML 里的 `<style id="vela-extracted">` 是生成物，不要手改。

## 1. 怎么看这份参考页

用浏览器直接打开 HTML。顶部控制条：

| 控件 | 作用 |
| --- | --- |
| 折叠方式 | `toolFold = message`（每条助理消息各自折叠）、`position`（整轮拍平后按位置合并相邻工具）或 `none`（不折叠，每个工具单独一行）。 |
| 步数 / 耗时 | 对应 `toolProcessDetails`：摘要行显示「N 步 · 耗时」，每行右侧显示耗时。默认关闭。 |
| 工具图标配色 | 对应 `toolIconColor`：切换 `<html data-tool-icon-color>`。默认开启，关闭后所有紧凑图标回到统一灰色（见 5.11）。 |
| 窄屏 | 把对话区收窄到 520px，触发 `@container chat (max-width: 720px)` 的 16px 边距。 |
| 标注 class | 悬停任意元素，显示它的 class 链、字号、字重、颜色、背景、gap 与 padding。 |
| 语言 | 中文 / English，只覆盖紧凑对话流用到的文案。 |
| 全部展开 / 收起 | 批量写入折叠记忆。 |
| 重播流式输出 | 回放第二轮：思考 → 读取（运行中点阵）→ 编辑 → 命令 → 最终回复，结束后自动变成「用时」折叠块。 |

首屏第一轮已经完成并展开过程，可以直接看到：混合摘要（读取 + 命令）、文件创建/编辑摘要（带统计）、展开的 diff 卡片、失败命令的终端输出、执行清单卡片、子代理行。

## 2. 提取范围

`build.mjs` 按选择器或注释锚点（不依赖行号）从 `styles.css` 取下列片段，原样放进 HTML：

| 片段 | 内容 |
| --- | --- |
| 令牌与主题 | `:root` 的半径、字体、动效；`[data-scheme="light"]`（晴空）基底；由基础色派生的 `color-mix` 层。深色基底与其余主题不提取。 |
| 重置 | `*` 重置、`button` / `textarea` 继承字体、`:focus-visible` 焦点环、细滚动条。 |
| 对话区骨架 | `.main-chat-view`、`.main-chat-header`、`.chat-title-*`、`.chat-conversation-pane`、`.chat-message-surface`、`.chat-jump-latest`。 |
| 对话流主体 | `.chat-scroll-area` → `.user-*` → `.md-content` → `.assistant-block` → `.reply-action*` → `.time-spent-*` → `.thinking-*` → 卡片模式的 `.tool-card*` / `.tool-run*`（卡片模式不在 HTML 里演示，但 CSS 保留）。 |
| 紧凑模式 | `.tool-card-list.is-compact`、`.tool-compact-*`、`.compact-diff-card*`、`.tool-sheet-compact-diff`、执行清单 `.plan-checklist*`、子代理 `.agent-compact*`、`.agent-summary*`、图标配色（`--tool-icon-*` 与 `:root[data-tool-icon-color]` 规则、`.thinking-icon`，见 5.11）。 |
| 终端与代码表 | `.tool-terminal*`、`.tool-sheet`、`.tool-code-line`、`.tool-diff-line`、`.tool-diff-gap`、`tool-spin` / `tool-pulse` 关键帧。 |
| 回合收尾 | `.turn-changes*`（本轮文件统计卡）、`.md-content .code-file-ref`。 |
| 输入框 | `.chat-dock-wrapper`（含顶部渐进模糊）、`.floating-input-card`、`.composer-stats-row`、`.input-textarea`、`.dock-controls-*`、`.model-choice-pill`、`.mode-pill`、`.send-action-blue-btn`、`.composer-action-slot`。 |
| 动效 | `.message-enter`、`prefers-reduced-motion`、`.md-block`、`.content-swap*`、`.tool-status-swap*`、`tool-card-in`。 |

**没有提取、HTML 里也没有的部分**（需要时回到源码）：

- 会话标签条 `ConversationViewTabs`（对话 / 轨迹 / 用量 / 预算 / 版本控制）。
- 提问卡片 `QuestionCard`、审批条 `ApprovalSlot`、计划预览卡 `PlanPreviewList`、验收卡 `AcceptanceCard`。
- 思考总结（`thinking-summary-*`，需要总结模型；HTML 只实现默认的「思考」折叠标题）。
- 内容边缘的 SVG 渐进模糊滤镜 `ThinkingEdgeBlur`：HTML 只保留上下渐隐渐变，没有 `--scroll-edge-filter` 模糊。
- 文件类型图标（真实应用用 devicon / material-icon-theme；HTML 用按扩展名着色的 14px 徽标代替）。
- 点阵加载动画的真实实现（canvas 回放 `dot-motion-loader.json`；HTML 用纯 CSS 近似，见 5.7）。
- 玻璃侧栏、悬浮环境卡片、对话车道让位（`--chat-lane-shift` / `--chat-lane-shrink`，默认值为 0，不让位）。

## 3. 设计令牌

### 3.1 主题

参考页只保留默认的浅色主题「晴空 Daylight」：`<html data-scheme="light">`，变量来自 `styles.css` 的 `:root, [data-scheme="light"]` 块，其后是由基础色推导的 `color-mix` 层（见下）。深色基底和其余 9 个主题（宣纸、青瓷、丁香、海棠、夜航、石墨、余烬、森林、潮汐）没有提取，需要时看 `styles.css` 的 `[data-scheme="dark"]` 与 `[data-theme="…"]` 块以及 `themes.ts`。

真实应用的主题机制：`data-scheme="light|dark"` 决定明暗基底，`data-theme="<id>"` 在基底上覆盖配色；每个主题块把颜色变量写全，不依赖外层继承。派生层写在主题块**之前**，所以主题只需改基础色，`--accent-tint`、`--diff-add-bg` 等会自动跟随。

### 3.2 对话流用到的语义变量

| 变量 | 值（晴空 Daylight） | 用在哪里 |
| --- | --- | --- |
| `--bg-chat` | `#ffffff` | 对话区底；渐隐与 dock 遮罩的底色。 |
| `--bg-chat-bubble-user` | `#edf4fc` | 用户气泡。 |
| `--bg-card-surface` | `#ffffff` | diff 卡片、文件统计卡、输入框相邻的卡面。 |
| `--bg-surface-subtle` | `#f7f7f8` | diff 卡片头、卡片模式工具卡、表头。 |
| `--bg-elevated` | `#ffffff` | 输入框、「回到最新」按钮。 |
| `--bg-code` | `#f5f5f6` | 代码块、代码表。 |
| `--bg-hover` | `#f0f1f2` | 悬停底、行内 `code` 底。 |
| `--text-primary` | `#202124` | 正文、文件名、悬停态。回复正文在浅色基底固定为 `#000`。 |
| `--text-secondary` | `#484b50` | 摘要标签、命令、终端行外的次要正文。 |
| `--text-muted` | `#686d75` | 动作词、目录、图标、箭头、思考正文、操作行。 |
| `--text-dim` | `#a1a6ad` | 行号列、diff 省略带文字、统计图标。 |
| `--border-subtle` | `rgba(25,28,33,.09)` | 分隔线、卡片描边、分组左导轨。 |
| `--border-strong` | `#d9dadd` | 输入类控件描边、编辑框。 |
| `--accent-blue` | `#2563eb` | 焦点环、链接、发送按钮、点阵动画（与白混 30%）。 |
| `--success` / `--danger` / `--warning` | `#059669` / `#c8322a` / `#ea580c` | 完成、失败、警示。 |
| `--tool-bash` / `-read` / `-edit` / `-write` / `-other` | `#334155` / `#1d4ed8` / `#b45309` / `#047857` / `#64748b` | 卡片模式的工具强调色；紧凑模式的图标**不用它们**（默认 `--text-muted`，开启图标配色后用下一行的 `--tool-icon-*`），只有 `.tool-kind-*` 传下去的 `--tool-accent` 被运行中脉冲和子代理状态引用。 |
| `--tool-icon-bash` / `-read` / `-edit` / `-write` / `-group` / `-mcp` / `-agent` / `-ask` / `-other` / `-think` | 见 5.11 | 紧凑模式的图标配色（`toolIconColor` 开启时生效），明暗各一套。 |
| `--term-bg` / `--term-fg` / `--term-cmd` / `--term-prompt` / `--term-error` | `--bg-code` / `--text-primary` / `--text-primary` / 绿 72% 混主色 / `--danger` | 终端输出块。 |
| `--syntax-*`（`fg` `comment` `string` `number` `keyword` `function` `type` `attr`） | `#1e293b` `#94a3b8` `#16a34a` `#ea580c` `#e11d48` `#2563eb` `#0284c7` `#b45309` | diff 行里的语法着色。真实应用用 shiki 分词后写 inline `color`，HTML 用 8 行正则近似。 |

派生色（均为 `color-mix`，跟随主题）：

```css
--diff-add-bg: color-mix(in srgb, var(--success) var(--tint), transparent);   /* --tint: 浅 6% / 深 16% */
--diff-del-bg: color-mix(in srgb, var(--danger)  var(--tint), transparent);
--diff-add-fg: color-mix(in srgb, var(--success) 78%, var(--text-primary));
--diff-del-fg: color-mix(in srgb, var(--danger)  78%, var(--text-primary));
--diff-stat-add-fg: color-mix(in srgb, var(--success) 88%, var(--bg-chat));
--diff-stat-del-fg: color-mix(in srgb, var(--danger)  88%, var(--bg-chat));
--tool-*-tint: color-mix(in srgb, var(--tool-*) var(--tint), transparent);
```

### 3.3 尺寸、字体与动效

| 令牌 | 值 |
| --- | --- |
| 半径 | `--radius-xs 6` · `sm 8` · `md 12` · `lg 16` · `xl 20` · `pill 9999` |
| 字体 | `--font-sans: "SF Pro Text", "SF Pro Display", "SF Pro", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif`；`--font-mono: "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace` |
| 基础排版 | 正文 15px / 行高 1.55，`-webkit-font-smoothing: antialiased` |
| 缓动 | `--transition-smooth: .24s cubic-bezier(.16, 1, .3, 1)`（折叠、箭头旋转）；`--transition-enter: .18s` 同曲线；`--motion-ease-enter: cubic-bezier(.16, 1, .3, 1)`；`--motion-ease-exit: cubic-bezier(.4, 0, 1, 1)` |
| 阴影 | `--shadow-dock`（输入框）、`--shadow-btn-blue`（发送按钮） |
| 降低动效 | `prefers-reduced-motion: reduce` 时所有动画/过渡缩到 0.01ms，点阵停在中间相位 |

## 4. 对话流布局

### 4.1 DOM 骨架

```
main.main-chat-view[data-tool-display="compact"]      ← container-type: inline-size; name: chat
├─ header.main-chat-header                            ← 52px 高,padding 0 20px
└─ div.chat-conversation-pane                         ← position: relative; --chat-lane-max: 760px
   ├─ div.chat-scroll-area                            ← 唯一的滚动容器
   │  └─ div.chat-message-surface                     ← 纵向 flex,居中,gap 22px
   │     ├─ div.user-msg-container                    ← 用户消息(右对齐)
   │     ├─ article.assistant-block.assistant-turn    ← 已完成的一轮
   │     └─ div.assistant-live-turn                   ← 进行中的一轮
   ├─ button.chat-jump-latest[data-visible]
   └─ div.chat-dock-wrapper                           ← position: absolute; bottom: 0
      └─ form.floating-input-card
```

### 4.2 关键规则

- **车道宽度**：消息与输入框共用 `width: calc(min(100%, var(--chat-lane-max, 760px)) - var(--chat-lane-shrink, 0px))`，并带 `margin-right: calc(var(--chat-lane-shift, 0px) * 2)`。`shift` / `shrink` 默认 0，只在悬浮环境卡片遮挡时由 JS 写入；复刻时可以先去掉这两项。
- **消息间距**：`.chat-scroll-area` 与 `.chat-message-surface` 都是 `gap: 22px`；一轮之内的 `.assistant-block` 是 `gap: 10px`；`.assistant-live-turn` 是 `gap: 12px`。
- **滚动区留白**：`padding: 20px 24px var(--composer-clearance)`。`--composer-clearance` 由 JS 用 `ResizeObserver` 量输入框高度后写入（`高度 + 36px`，初值 220px），正文因此可以滑到输入框下方、由顶部渐进模糊接管。
- **窄屏**：`@container chat (max-width: 720px)` 下滚动区与 dock 的左右边距从 24px 降到 16px。
- **滚动条**：5px 宽；平时颜色是 `transparent`，滚动时加 `.is-scrolling` 变成 `--scrollbar-thumb`，800ms 后淡出。颜色用 `@property --chat-scrollbar-color`（`<color>`、可继承）做过渡，滚动条宽度和拖动命中区始终保留。
- **dock 渐进模糊**：`.chat-dock-wrapper` 自身不透明（`background: var(--bg-chat)`），`::before` / `::after` 在其上方 52px 叠两层 `backdrop-filter`（3px 与 16px，用 `mask-image` 做渐进），最后一段渐变融进 `--bg-chat`。
- **回到最新**：`.chat-jump-latest` 定位在 `bottom: calc(var(--composer-clearance) - 24px)`；水平位置跟输入框同一条车道，`left: calc(50% - var(--chat-lane-shift, 0px) - var(--chat-scrollbar-width, 0px) / 2)`，悬浮信息卡片让列左移时圆球跟着左移，始终停在输入框正上方的中央。出现/消失用 `opacity` + 6px 位移 + `visibility`，`data-visible="true"` 控制。

### 4.3 各块规格

| 块 | 类名 | 规格 |
| --- | --- | --- |
| 用户气泡 | `.user-msg-container` > `.user-bubble` | 容器纵向 flex、`align-items: flex-end`、`gap: 8px`；气泡 `background: --bg-chat-bubble-user`、`border-radius: 16px`、`padding: 12px 18px`、`max-width: 85%`、`line-height: 1.65`。 |
| 用户操作行 | `.user-message-actions` | 右对齐、`gap: 4px`、`min-height: 24px`、12px、`--text-muted`、时间用 `tabular-nums` 且 `margin-right: 4px`；两个 28×28 的 `.reply-action.user-message-action`（复制、编辑）。 |
| 回复正文 | `.agent-reply-prose` | 15px / 行高 1.75；浅色基底下颜色固定 `#000`（深色基底用 `--text-primary`）。内部是 `.md-content`。 |
| Markdown | `.md-content` | 段落/列表间距 `.55em`；标题 `1.33em / 1.18em / 1.07em / 1em`，`letter-spacing: -.02em`，字重 600；行内 `code` 14px mono，`--bg-hover` 底、`4px` 圆角；代码块 `--bg-code`、`10px` 圆角、`padding: 12px 14px`、14px mono / 行高 1.55；表格 15px，`--border-subtle` 单线、表头 `--bg-surface-subtle`；引用左 2px `--border-strong`。 |
| 用时触发器 | `.time-spent-trigger.assistant-turn-trigger` | 15px / 500 / `--text-muted`；`width: 100%`、`padding-bottom: 8px`、底部 1px `--border-subtle`；箭头 12px，展开转 90°。 |
| 思考 | `.thinking-block` | 标题行同上（`思考` + 箭头）；展开体最高 280px，内部 13px / 行高 1.62、`--text-muted`；上下 66px 渐隐，强度随距边缘 24px 内平滑变化（smoothstep）。 |
| 回复操作行 | `.reply-actions` | `gap: 4px`、`min-height: 22px`；`.reply-action` 12px、`--text-muted`、`padding: 3px 7px`、`6px` 圆角，悬停 `--text-primary` + `--bg-hover`；时间靠右（`margin-left: auto`）。 |
| 文件统计卡 | `.turn-changes` | `margin-top: 10px`、`12px` 圆角、1px `--border-subtle`、`--bg-card-surface`；头部 `min-height: 68px`、`padding: 10px 12px`；图标块 40×40、`11px` 圆角；默认显示 3 个文件，多余的折叠成「再显示 N 个文件」。 |
| 输入框 | `.floating-input-card` | `--bg-elevated`、1px `--border-subtle`、`20px` 圆角、`--shadow-dock`、`padding: 14px 16px 8px`、`gap: 6px`；textarea 44–140px、15px / 1.5；发送按钮 32px 圆形、`--accent-blue`；流式时发送与停止在同一格里交叉淡入（opacity + scale .86）。 |

## 5. 紧凑工具行（核心）

### 5.1 数据模型

渲染只依赖 `ToolTrace`（`packages/shared/src/index.ts`）：

```ts
interface ToolTrace {
  id: string;
  name: string;                       // 决定种类,见 5.2
  status: "running" | "done" | "error";
  activity: {
    command?: string;                 // bash
    path?: string;                    // read / edit / write
    body?: string;                    // bash 输出 / read 正文 / 失败原因 / edit 说明
    diff?: string;                    // edit / write 的展示 diff,见下
    plan?: { text: string; status: "pending" | "in_progress" | "completed" }[];
    agent?: "explore" | "general";    // 子代理(task)
    agentId?: string; agentPath?: string;
    mcp?: { server: string; tool: string };
  };
}
```

耗时不在 `ToolTrace` 上：`ToolProcessProvider` 用 `useTrace` 读轨迹节点，按 `toolCallId` 关联出 `durationMs` / `startedAt` / `completedAt`（`indexToolDurations`）。只有 `toolProcessDetails` 开启时才读取；未完成或缺时间的调用不显示耗时，也不会推算。

**展示 diff 格式**（`parseDisplayDiff`）：每行是「符号 + 行号 + 空格 + 内容」，符号为 `+` / `-` / 空格；一行 `...` 或 `…` 表示省略的上下文。

```
  12 import { Session } from "./session";
+ 13 import { defaultPolicy } from "./retry-policy";
...
- 87     return retryOnce(() => this.start(), 3);
+ 87     return withRetry(() => this.start(), defaultPolicy);
```

### 5.2 种类与分组规则

| 工具名 | 种类 | 紧凑行里的表现 |
| --- | --- | --- |
| `bash` | `bash` | 终端图标 + 「已运行」+ 命令（mono）；整行是按钮，点击展开命令与输出。 |
| `read` | `read` | 眼睛图标 + 「已读取」+ 文件图标 + 文件名 + 目录；点文件名在右侧预览。 |
| `edit` | `edit` | 铅笔图标 + 「已编辑」+ 文件名 + 目录 + `+N −M`；可展开 diff 卡片。 |
| `write` | `write` | 加号文件图标 + 「已创建」+ …同上。 |
| `browser_repl` | `browser` | 不参与紧凑摘要。 |
| 其他（`update_plan`、`task` 子代理、MCP、`ask_user_question` …） | `other` | 不折叠，仍是单个卡片（被 `.is-compact` 压成一行）。 |

**`toolFold = "message"`（默认）**——`ToolList` 对一条助理消息的 `tools`：

1. `splitToolRuns`：连续的非 `other` 工具成一段；每个 `other` 工具自成一段并打断。
2. `shouldFoldRun(length, "compact")`：段内 **超过 1 个** 就折成 `CompactToolGroup`；刚好 1 个就是单独的 `CompactToolLine`（卡片模式则要 ≥ 3 个）。
3. `other` 段逐个渲染 `ToolCard`。

**`toolFold = "position"`**——`ToolSequence` 先 `buildTurnItems` 把整轮每条消息拍平成 `思考 → 工具… → 正文` 序列，再 `groupProcessItems`：思考、可见正文、`other` 工具都会打断分组，相邻可折叠工具跨消息合并。参考页顶部可切换对比。

**`toolFold = "none"`（不折叠）**——渲染路径同 `message`，但 `shouldFoldRun(length, display, "none")` 恒为 `false`：段内每个工具各自渲染 `CompactToolLine`（卡片模式则逐张 `ToolCard`），不生成 `CompactToolGroup` / `ToolRunGroup`。回合级的「用时 X」整体折叠不受影响。

### 5.3 摘要行 `CompactToolGroup`

```
div.tool-compact-group.tool-kind-<uniform|other>[.open][.is-running]
├─ button.tool-compact-summary[aria-expanded]
│  ├─ span.tool-compact-icon          ← 种类唯一时用该种类图标,混合时用 Stack 图标
│  ├─ span.tool-compact-label         ← "已读取 3 个文件 · 已运行 1 条命令"
│  ├─ span.tool-compact-sample        ← 文件名样例 / 首条命令(见下)
│  ├─ span.tool-compact-failed        ← "1 失败"
│  ├─ span.tool-compact-stat          ← +N −M
│  ├─ svg.tool-compact-chevron
│  ├─ span.tool-compact-steps         ← 仅 toolProcessDetails: "N 步 · 耗时"
│  └─ canvas.tool-activity-loader     ← 仅运行中
└─ div.tool-collapse > div.tool-collapse-inner
   └─ div.tool-compact-lines          ← 展开后的逐行明细
      └─ CompactToolLine × N          ← 种类唯一时 hideIcon + hideAction
```

标签规则（`compactSummaryParts` + `compactPartLabel`）：

- 按种类**首次出现的顺序**聚合；同一路径的同类操作只计一次（读两次同一文件算 1 个），`bash` 每条都计。
- 文案：`已编辑 N 个文件` / `已创建 N 个文件` / `已读取 N 个文件` / `已运行 N 条命令`；英文 `Edited N file(s)` / `Created …` / `Read …` / `Ran N command(s)`；多种类用 ` · ` 连接。
- **样例（`tool-compact-sample`）**：仅当种类唯一时出现。`bash` 取第一条命令（空白压成单空格）；文件类取去重后前 2 个文件名，多出的追加 ` +N`（如 `session-host.ts, runtime.ts +1`）。混合摘要没有样例。
- **统计（`tool-compact-stat`）**：对所有 `diff` 汇总 `+N −M`，`diffStat` 数「+」「−」开头的行（`+++`、`---` 不计）。
- **展开后的文件类分组**（种类唯一且是 `edit` / `write`）：摘要行里的样例与统计隐藏，信息由下面各行的统计承担。
- 展开箭头与图标：箭头默认 `opacity: 0` 但**保留占位**，避免悬停时文字跳动，规则见 5.9。

### 5.4 单行 `CompactToolLine`

**文件类（read / edit / write）**

```
div.tool-compact-item.tool-kind-<kind>[.open]
├─ div.tool-compact-line
│  ├─ span.tool-compact-icon          ← 分组内(hideIcon)省略
│  ├─ [button.tool-compact-text-toggle.tool-compact-action-toggle] span.tool-compact-action   ← 「已编辑」;分组内(hideAction)省略
│  ├─ img.file-type-icon (14×14)
│  ├─ button.tool-compact-name | span.tool-compact-name.is-static   ← 文件名,500 字重 --text-primary;有预览能力时是按钮,悬停下划线(offset 2px)
│  ├─ button.tool-compact-text-toggle.tool-compact-path-toggle > span.tool-compact-dir   ← 目录,--text-muted,可省略号
│  ├─ button.tool-compact-detail-toggle (20×20) > svg.tool-compact-chevron                ← 仅 edit/write
│  ├─ span.tool-compact-stat          ← 展开 diff 预览时隐藏
│  ├─ span.tool-duration              ← 仅 toolProcessDetails
│  └─ span.tool-status-swap.compact   ← 见 5.7
└─ div.tool-collapse (仅 edit/write)
   └─ div.tool-compact-file-detail[.has-diff-preview]
      └─ section.compact-diff-card    ← 有 diff 且未失败;否则显示 ScrollFade 里的错误/说明文本
```

只有 edit / write 有展开；`read` 是只读的一行。edit / write 的动作词、目录、箭头三处都能开合，文件名点击是「预览」，不是开合。

**bash**

整行是一个 `button.tool-compact-line`（`aria-expanded`），点击开合。展开体是 `div.tool-compact-out`（`margin: 0 8px 4px`）里套 `ScrollFade` 和 `BashView`：

```
div.tool-terminal[.failed]
├─ div.tool-terminal-cmd   ← "$"(--term-prompt,失败时 --term-error) + 命令
└─ pre.tool-terminal-out   ← 输出;无输出时是 .tool-terminal-wait "运行中/无输出"
```

终端块：`border-radius: 8px`、`--term-bg`、mono 14px / 行高 1.55；命令与输出之间 1px `--border-subtle`。

### 5.5 diff 卡片 `CompactDiffCard`

```
section.compact-diff-card                    ← 1px --border-subtle,10px 圆角,--bg-card-surface
├─ header.compact-diff-card-head             ← min-height 28,padding 2px 6px 2px 10px,底线,--bg-surface-subtle
│  ├─ span.compact-diff-card-name            ← 12px / 550
│  ├─ span.compact-diff-card-stat            ← 12px mono 600,+N 绿 / -M 红
│  └─ button.compact-diff-card-copy          ← 20×20,靠右;复制后 1.4s 内换成对勾
├─ div.compact-diff-card-note                ← 可选:edit 的说明文字(12px,--text-muted)
└─ ScrollFade > div.tool-sheet.tool-sheet-compact-diff
```

`.tool-sheet-compact-diff`：12px / 行高 1.65；每行 `min-height: 22px`、`padding-right: 8px`；行号列 `min-width: 4.5em`、右对齐、`margin-right: 9px`、右侧 1px 分隔线，**不显示 `+/−` 符号**；新增/删除行用整行淡色底（`--diff-add-bg` / `--diff-del-bg`）加**左侧 3px 色条**（`--success` / `--danger`，由 `::before` 画）；文字与行号同色（`--diff-add-fg` / `--diff-del-fg`）。

**上下文折叠**（`collapseDiffContext`）：连续的未改行超过 3 行，且前后都有改动时，只保留首尾各一行，中间换成一条 7px 高、顶部 1px `--border-subtle` 的分隔带（`.tool-diff-gap.is-compact`）。开头与结尾的上下文不折叠。

`.tool-compact-file-detail.has-diff-preview` 去掉 220px 最大高度（卡片自己有 `ScrollFade` 限高），外边距 `3px 0 7px`；没有 diff 预览时是 `margin: 3px 8px 7px 22px; max-height: 220px; overflow: auto`。

### 5.6 子代理行与 other 卡片

**子代理（`isAgentToolName`，紧凑形态）**

```
div.tool-compact-item.tool-kind-other.agent-compact[.open]
├─ div.tool-compact-line.agent-compact-line          ← 点击除名称外的任何地方开合概况
│  ├─ button.agent-compact-toggle.is-lead            ← 子代理图标 + 种类词(查阅 / 执行 / 子代理),flex: none
│  ├─ button.agent-compact-name                      ← 路径,mono 14px --text-primary;点击在右侧 Pane 打开;无目标时 disabled
│  ├─ button.agent-compact-toggle.is-tail            ← flex: 1;箭头紧跟名称,剩余空间仍属开合区域
│  │   └─ svg.tool-compact-chevron + 状态标记        ← 运行中点阵 / .agent-status-dot.is-<status>(8px 圆点)
│  └─ span.tool-duration
└─ div.tool-collapse > div.tool-compact-out.agent-compact-out > ScrollFade.agent-summary-scroll
   ├─ div.agent-summary-task
   └─ div.agent-summary-report | .agent-summary-error   ← 上方 10px 间距 + 1px 顶线
```

悬停任一 `.agent-compact-toggle` 时，整行的图标、动作词、箭头一起变 `--text-primary`。

**other 卡片（`update_plan` 等）**

仍是 `article.tool-card`，在 `.tool-card-list.is-compact` 下被压平：透明背景、无圆角、`overflow: visible`；头部 `gap: 6px; padding: 2px 0`；图标 16×16 无底色 `--text-muted`；`.tool-kind-label` 自适应宽度、14px / 500 / `--text-muted`；名称 14px / 500；目录 13px。状态位在**右侧最末**，完成画一个 12px 对勾（`StatusMark compact`），与文件行「完成不占位」不同。展开体是 `.plan-checklist`：竖向 1px 引导线贯穿各项图标，图标用卡面色压在线上形成节点；已完成项文字 `--text-muted`、进行中项 600 `--text-primary`、待办 `--text-secondary`，图标分别是 `--success` 对勾 / `--accent-blue` 箭头 / `--text-muted` 空心圆。

### 5.7 状态位与点阵动画

`CompactStatus` 只标异常：

| 状态 | 表现 |
| --- | --- |
| `running` | 16×16 点阵加载动画，`margin-left: auto` 靠右。 |
| `error` | 11px 红叉（`--danger`），描边 2.5。 |
| `done` | 宽度过渡到 0（`.tool-status-swap.compact.is-done { width: 0 }`），不占位。 |

状态切换用 `ContentSwap`：新内容 140ms 淡入，旧内容绝对定位叠在上面 140ms 淡出；宽度用 `140ms var(--motion-ease-enter)`。

**点阵动画规格**（真实实现 `ActivityIndicator`：canvas 逐帧回放 `dot-motion-loader.json`，颜色取 `getComputedStyle(canvas).color`）：

- 画布 388×388 逻辑单位，6×6 个圆角方块，边长 53、步距 59、边距 20、圆角 11.66（≈ 22%）。
- 每格两层：底层固定 12% 不透明度；顶层不透明度随时间 `0.5 − 0.5·sin(2π·t)` 在 0–1 之间摆动（`.5 → 0 → .5 → 1 → .5`），周期 2s（`duration × 2`）。
- 相位沿对角线错开：格 `(行, 列)` 的相位延迟是 `(行 + 列) × 0.14` 个周期。
- 颜色 `color-mix(in srgb, var(--accent-blue) 70%, white)`，尺寸 16×16，`margin-left: auto`。
- 减少动效时停在 `phase = 0.5`。

HTML 里用 36 个 `<i>` + CSS 关键帧近似（`.dot-loader`，每个 `i` 的 `--d` 是负的动画延迟）。复刻时可以直接用这个 CSS 版本，也可以用 canvas。

### 5.8 排版数值速查（紧凑模式）

| 类 | 字号 / 字重 | 颜色 | 其他 |
| --- | --- | --- | --- |
| `.tool-card-list.is-compact` | — | — | `gap: 1px` |
| `.tool-compact-summary` | 14 / 行高 1.55 | 继承（悬停 `--text-primary`） | `gap: 6px; padding: 2px 0; border-radius: 4px` |
| `.tool-compact-icon` | — | `--text-muted`（`toolIconColor` 开启时按种类着色，见 5.11） | 16×16，`flex: none` |
| `.tool-compact-label` | 14 | `--text-secondary`（摘要悬停 → `--text-primary`） | 省略号，`flex: 0 1 auto` |
| `.tool-compact-sample` | 13 | `--text-muted` | 省略号 |
| `.tool-compact-failed` | 14 / 600 | `--diff-del-fg` | `flex: none` |
| `.tool-compact-stat` / `.tool-stat-*` | 继承 / 600，mono，`tabular-nums` | `--diff-stat-add-fg` / `--diff-stat-del-fg` | `gap: 6px` |
| `.tool-compact-steps`、`.tool-duration` | 12，mono，`tabular-nums` | `--text-secondary` | `margin-left: auto`；`.tool-duration` 固定 `width: 7ch` 右对齐 |
| `.tool-compact-chevron` | — | `--text-muted` | 12×12，`transition: transform var(--transition-smooth)`，展开 `rotate(90deg)` |
| `.tool-compact-lines` | — | — | `margin: 2px 0 6px 16px; padding: 1px 0 1px 10px; border-left: 1px solid var(--border-subtle); gap: 1px` |
| `.tool-compact-line` | 14 / 行高 1.5 | `--text-secondary`（按钮行悬停 → `--text-primary`） | `gap: 6px; padding: 2px 0; border-radius: 4px` |
| `.tool-compact-action` | 14 | `--text-muted` | `flex: none` |
| `.tool-compact-name` | 14 / 500 | `--text-primary` | 悬停下划线 `text-underline-offset: 2px` |
| `.tool-compact-dir` | 14 | `--text-muted` | 省略号 |
| `.tool-compact-cmd` | 14，mono | `--text-secondary` | 省略号 |
| `.file-type-icon` | — | — | 14×14 |
| `.tool-compact-out` | — | — | `margin: 0 8px 4px` |
| 行高度合计 | | | 单行实际高度 ≈ 14 × 1.5 + 4 = 25px |

### 5.9 交互细节

**箭头显隐**（紧凑模式下的箭头默认透明、保留占位）：

- 下列选择器默认 `opacity: 0`：`.tool-compact-chevron`、`.tool-card-list.is-compact .tool-chevron`，以及紧凑模式下 `.thinking-block` 里的 `.time-spent-trigger-arrow` 和 `.thinking-prose-toggle svg`。
- 出现条件（`opacity: 1`）：**鼠标悬停在该行的文字部分**（摘要的 `.tool-compact-label` / `.tool-compact-sample`；行内的 `.tool-compact-action` / `-name` / `-dir` / `-cmd`、`.agent-compact-name`）、**键盘聚焦在该行任一按钮**、鼠标悬停在箭头自己上，以及悬停/聚焦 `.tool-compact-detail-toggle`。写法依赖 `:has()`。
- 展开状态下箭头旋转 90° 但仍保持透明，直到悬停——展开本身由下方的内容和左导轨表达。

**悬停与聚焦**

- 行没有悬停背景；只有文字颜色从次要色升到 `--text-primary`。
- 键盘聚焦：`outline: 2px solid var(--accent-blue)`，行与摘要用 `outline-offset: -2px`（向内收，避免被滚动容器裁掉），文字类小按钮用 `1px` 并带 `3px` 圆角。

**点击区域**

| 位置 | 行为 |
| --- | --- |
| 摘要行任意处 | 开合分组 |
| bash 行任意处 | 开合命令与输出 |
| edit / write 的动作词、目录、箭头 | 开合 diff |
| 文件名 | 在侧栏预览（不开合） |
| 子代理名称 | 在右侧 Pane 打开 |
| 子代理名称以外 | 开合概况 |
| diff 卡片右上角 | 复制 diff |

**折叠动画**：`.tool-collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .24s }`，父级加 `.open` 后变 `1fr`；`.tool-collapse-inner { min-height: 0; overflow: hidden }`；关闭时内层加 `inert`，键盘与读屏不可达。展开体用 `LazyMount`：首次展开时才创建内容，之后保留，所以关闭也有平滑的高度过渡。

**折叠记忆**（`tool-fold-state.ts`）：键为 `rows:<toolId>`（单行）与 `sequences:<序列 id>`（分组；回合的整体折叠用 `sequences:turn:<首条消息 id>`），值是布尔。按会话存在 `vela.toolFold.v1:<sessionId>`，200ms 防抖写入，最多保留 500 项（按最近触碰淘汰，淘汰的值仍留在内存里，避免可见行突然折叠）；页面卸载时同步写入；数据损坏时丢弃并用默认值。**只有开启 `toolProcessDetails` 时才启用**；关闭时每行回退到组件本地状态（重新挂载后回到默认折叠）。

### 5.10 入场动画

- 工具节点（`.tool-card`、`.tool-run`、`.tool-compact-item`、`.tool-compact-group`）创建时 `tool-card-in`：180ms，从 `opacity: 0; translateY(4px)` 到位。React 里只对新挂载的节点触发；自己重建 DOM 时要给已存在的节点跳过（参考页用 `.no-enter`）。
- 新消息整体 `message-enter`：`.24s`，`translateY(6px)` + 淡入。
- 流式 Markdown 的新尾块 `markdown-tail-in`：120ms 淡入，只作用于最新的 `.md-block`。

### 5.11 图标配色（`toolIconColor`）

紧凑模式下每行最左侧的图标默认是统一的 `--text-muted` 灰色。偏好 `toolIconColor` 开启（**默认开启**）时按种类着色；关闭时回到灰色。开关只是 `<html>` 上的一个属性，所有规则都挂在它下面，没有任何组件逻辑：

```html
<html data-scheme="light" data-tool-icon-color="true">   <!-- "true" 着色,"false" 全灰 -->
```

**配色表**（变量定义在 `:root, [data-scheme="light"]` 与 `[data-scheme="dark"]` 里，明暗各一套；暗色是同色系提亮）：

| 图标 | 变量 | 浅色 | 深色 | 命中的元素 |
| --- | --- | --- | --- | --- |
| 命令（终端） | `--tool-icon-bash` | `#7c5cd6` 紫 | `#b9a4f5` | `.tool-kind-bash .tool-compact-icon` |
| 读取（眼睛） | `--tool-icon-read` | `#0f8a8a` 青绿 | `#5fd0cc` | `.tool-kind-read .tool-compact-icon` |
| 编辑（铅笔） | `--tool-icon-edit` | `#c2710c` 琥珀 | `#fbbf6a` | `.tool-kind-edit .tool-compact-icon` |
| 写入（加号文件） | `--tool-icon-write` | `#1f9d55` 绿 | `#6ee7a0` | `.tool-kind-write .tool-compact-icon` |
| 混合摘要（层叠） | `--tool-icon-group` | `#5b6fd6` 靛蓝 | `#a5b0f5` | `.tool-compact-group.tool-kind-other > .tool-compact-summary .tool-compact-icon` |
| MCP | `--tool-icon-mcp` | `#d6457a` 玫红 | `#f59ab9` | `.tool-card.is-mcp .tool-card-icon` |
| 子代理 | `--tool-icon-agent` | `#b43fc7` 洋红 | `#e19af0` | `.tool-card.is-task .tool-card-icon`、`.agent-compact .tool-compact-icon` |
| 提问 | `--tool-icon-ask` | `#0284c7` 天蓝 | `#7dd3fc` | `.question-compact-icon` |
| 其他通用工具（计划等） | `--tool-icon-other` | `#e0603c` 珊瑚 | `#fb9b7e` | 兜底：`.tool-compact-icon`、`.is-compact .tool-card-icon` |
| 思考（灯泡） | `--tool-icon-think` | `#84a10d` 黄绿 | `#c3e35c` | `.thinking-icon` |

实现要点：

- **兜底在前，种类在后**。先用一条规则给所有 `.tool-compact-icon` 和 `.is-compact .tool-card-icon` 上 `--tool-icon-other`，再用更具体的 `.tool-kind-*` 规则覆盖。
- **混合摘要的图标必须用子代选择器 `>`**。摘要的外层是 `.tool-compact-group.tool-kind-other`，它里面展开的逐行明细各有自己的 `.tool-kind-read` 等；写成后代选择器会让整组明细的图标全部被染成摘要的靛蓝（特异性更高）。
- **MCP 要有标记**：MCP 卡片的种类仍是 `other`，需要在 `article.tool-card` 上额外加 `is-mcp` 类才能和普通工具区分。
- **不加背景**：紧凑模式的图标始终是 16×16 无底色，配色只改 `color`。
- **思考图标**：`Thinking` 的「思考」标题前多一个 `span.thinking-icon`（16×16，灯泡），**只在紧凑模式显示**——`.thinking-icon { display: none }`，`.main-chat-view[data-tool-display="compact"] .thinking-icon { display: grid }`。总结以标题样式展示时，图标也出现在标题前；正文样式（`prose`）不加。关闭配色时它与工具图标一样回到 `--text-muted`。
- **Browser REPL**（参考页未提取）：紧凑模式下图标没有底色、16×16，配色开启时是 `--accent-blue`，关闭时回到 `--text-muted`（失败状态靠右侧的红叉标出，图标不变红）；卡片模式不受开关影响，保留 20×20 的蓝色底。
- 失败/运行中状态不改图标颜色，仍由状态位表达（5.7）。

图标路径：思考用 `ThinkingIcon`（`icons.tsx`，灯泡：`M9 18h6M10 21.5h4` + 灯泡外廓，24×24 视口，1.6 描边，与其他图标同一 `base()`）。参考页对应 `ICON.thinking`。

## 6. 回合与过程折叠

### 6.1 已完成 / 进行中

每个用户消息开始一个 turn。轮内助理消息的渲染分两种：

- **已完成**（`canCollapse`）：存在带正文的最终回复，且（不是最后一轮，或会话 `ready` 并且 `turnCompletedAt` 已写入）。渲染 `CompletedAssistantTurn`：顶部是「用时 38秒 ›」触发器，点开显示过程（每条消息的思考、工具、中间正文），**最终回复正文始终显示在下面**；再下面是回复操作行，最后是文件统计卡。
- **进行中**：`.assistant-live-turn`。顶部是不可点的「已处理 12秒」（每秒刷新，起点是该轮首个 `turnStartedAt`）；每条助理消息一个 `article.assistant-block`，思考与工具直接展开显示，不折叠。

完成瞬间「已处理」被「用时」接管，位置与分隔线不变。

「用时」文案：`<1 sec` / `38秒` / `2分05秒` / `1小时2分3秒`（`formatElapsedTime`）。开启 `toolProcessDetails` 后优先用轨迹里记录的整轮时长，缺失时退回各工具耗时之和，再缺失才用 `turnCompletedAt − turnStartedAt`。工具耗时格式：`<1s` 用 `NNNms`，`<60s` 用 `N.Ns`，其余 `NmNs`。

### 6.2 思考块

- 进行中（该消息是当前活动消息、还没有正文也没有工具）默认展开，并在「思考」旁显示点阵；一旦出现工具或正文，自动折叠。任意时刻都可手动开合。
- 展开后内容在 `.thinking-scroll-viewport` 里，最高 280px；**只在用户停在底部时才跟随新内容**，向上滚（wheel 向上、触摸下拉、scrollTop 回退超过 4px）立即解除跟随；跟随阈值是离底部 ≤ 16px。
- 紧凑模式下「思考」后的箭头默认透明（见 5.9）。
- 紧凑模式下「思考」前有一个灯泡图标（`.thinking-icon`），随 `toolIconColor` 着色（见 5.11）。

### 6.3 对话滚动跟随

`ChatView` 用同一套规则（`chat-scroll.ts`）：

- 初始贴底；切换对话或出现新的用户消息时重新贴底；流式更新同一条回复时保持当前跟随状态。
- 用户向上滚立即取消跟随；只有自己滚回底部（距底 ≤ 16px 且在向下滚）才恢复。
- 离开跟随且距底部超过 64px 才显示「回到最新」。
- 展开思考或 diff 会改变高度：用 `ResizeObserver` 观察滚动区的直接子元素，贴底时自动继续跟到底。

## 7. 偏好

| 偏好 | `localStorage` 键 | 取值 | 默认 | 作用 |
| --- | --- | --- | --- | --- |
| `toolDisplay` | `vela.toolDisplay` | `"card"` / `"compact"` | `compact` | 决定 `.main-chat-view[data-tool-display]` 与整个紧凑渲染。 |
| `toolFold` | `vela.toolFold` | `"message"` / `"position"` / `"none"` | `message` | 分组方式，见 5.2。 |
| `toolProcessDetails` | `vela.toolProcessDetails` | `"true"` / `"false"` | `false` | 步数、耗时、折叠记忆。 |
| `toolIconColor` | `vela.toolIconColor` | `"true"` / `"false"` | `true` | 紧凑图标按种类着色；写到 `document.documentElement.dataset.toolIconColor`，CSS 只认这个属性。设置位置：设置 → 对话显示 → 工具图标配色。 |

## 8. 移植到 DeepSeek Harness 插件

### 8.1 最小接入清单

1. **贴 CSS**：把 HTML 里 `<style id="vela-extracted">` 整段（或你需要的片段，按第 2 节）拷进插件样式；`<html>` 上设置 `data-scheme="light"`。需要换主题色时只改第 3 节的基础色变量。
2. **映射数据**：把 DeepSeek 的工具事件整理成 5.1 的 `ToolTrace`。
   - 命令类（shell、终端）→ `name: "bash"`，`activity.command` + `activity.body`。
   - 读文件 → `name: "read"`，`activity.path`。
   - 修改文件 → `name: "edit"`，`activity.path` + 展示 diff；新建文件 → `name: "write"`。
   - 其他（计划、子代理、MCP、提问）→ 保持别的名字，走 `other`。
   - 失败置 `status: "error"`，原因放 `activity.body`；进行中置 `"running"`。
3. **复用逻辑**：`app.js` 里这些函数是纯函数/小型 DOM 构造，可直接搬：`splitToolRuns`、`shouldFoldRun`、`groupProcessItems` / `buildTurnItems`、`compactSummaryParts`、`parseDisplayDiff`、`collapseDiffContext`、`diffStat` / `totalDiffStat`、`subjectOf`、`splitPath`、`formatDuration` / `formatElapsed`，以及 `CompactToolGroup` / `CompactToolLine` / `AgentToolCard` / `CompletedAssistantTurn` / `Thinking` 的 DOM 结构。
4. **接事件**：文件名点击（预览）、子代理名称点击、diff 复制、文件统计卡的撤销/审查、回复操作行的复制/分支/检查点，都是宿主提供的回调；参考页里用 toast 代替。
5. **补行为**：折叠记忆（5.9）、贴底跟随（6.3）、流式 Markdown 增量渲染、思考块自动折叠（6.2）。

### 8.2 容易踩的点

- **箭头占位**：箭头是 `opacity: 0` 而不是 `display: none`，否则悬停时文字会跳。`:has()` 选择器需要较新的浏览器内核。
- **耗时靠右**：`.tool-duration` / `.tool-compact-steps` 用 `margin-left: auto`，所以展开箭头必须排在它们**前面**，否则会被 auto 外边距推到最右。`ToolDurationLabel` 在 DOM 里排在箭头之后。
- **完成态不占位**：文件行与 bash 行完成后状态位宽度是 0；`other` 卡片完成后是对勾。别统一成一种。
- **嵌套折叠**：思考块在「用时」过程内部，展开态选择器必须只作用于**直接子级**（`.time-spent-collapsible.expanded > .time-spent-body`），否则外层展开会撑开内层。
- **`inert` + 0fr 网格**：折叠体关闭时必须 `inert`；同时 `.time-spent-body-inner` 用 `visibility: hidden` 并在展开时 `transition-delay: 0s`，收起时延迟到动画结束再隐藏。
- **滚动条宽度**：dock 的右内边距要加上 `--chat-scrollbar-width`，输入框才与正文列对齐。
- **可选区文字**：真实应用默认 `user-select: none`，只放开用户气泡、回复正文、思考、代码、终端输出、命令；参考页没有全局禁选，需要时参照 `styles.css` 里的白名单。
- **降低透明度/动效**：`prefers-reduced-motion` 下所有动画归零；点阵要停在静态相位。
- **图标配色的选择器是 `:root[data-tool-icon-color="true"] …`**：开关属性在文档根上。复刻时若样式被限定在某个容器里（如插件根 `[data-xxx]`），必须把 `:root[data-tool-icon-color=…]` 改写成 `[data-xxx][data-tool-icon-color=…]`（属性放在容器自身），不能简单地在前面再加一层容器前缀，否则会变成 `[data-xxx] :root[…]`，永远匹配不到。`--tool-icon-*` 变量同理要定义在容器上。
- **选择器范围**：真实应用的主题选择器写成 `[data-scheme]` 而不是只写 `:root`，这样任意容器套上属性就能得到整套变量；只在页面根上用时可以简化。

## 9. 验证与已知差异

**本次验证**（在 Chromium 内打开 `compact-chat-ui.html`）：

- 脚本无语法错误，加载与交互全程控制台无报错。
- 点击分组摘要可展开并生成逐行明细；展开 diff 卡片、失败命令的终端输出可见；`toolFold` 切到 `position` 后相邻工具跨消息合并；「步数 / 耗时」开关出现 `N 步 · 耗时` 与行内耗时；中英文切换。页面只含晴空浅色主题，没有主题选择器。
- 「工具图标配色」开/关：开启时按 5.11 的表着色（逐种类读取了 `getComputedStyle` 的颜色，混合摘要里展开的逐行明细各自保持自己的种类颜色），关闭时所有图标回到 `--text-muted`；「思考」前出现灯泡图标。
- 「重播流式输出」跑完整个流程，结束后第二轮变成「用时」折叠块，发送/停止按钮交叉切换。
- CSS 片段逐个检查花括号平衡；`build.mjs` 在片段末行没收尾时自动延长到闭合。

**未覆盖**：

- 没有和运行中的 Vela 做像素级对比；截图只用来确认版式与着色。
- 没有在 Safari / Firefox 里验证 `:has()`、`color-mix`、容器查询、`@property`。
- 窄屏、键盘聚焦环、读屏行为没有逐项走查。

**与真实应用的差异**（均为参考页的简化）：

| 项目 | 真实应用 | 参考页 |
| --- | --- | --- |
| 点阵加载动画 | canvas 回放 JSON | 纯 CSS 近似 |
| 文件类型图标 | devicon / material-icon-theme | 按扩展名着色的徽标 |
| 语法着色 | shiki 分词 | 8 行正则 |
| 滚动边缘 | 渐隐 + SVG 渐进模糊 | 仅渐隐 |
| 折叠记忆 | 仅 `toolProcessDetails` 开启时持久化，按会话存储 | 始终记在内存里，不持久化 |
| 重绘 | React 协调，只更新变化的节点 | 每步整体重建，靠 `.no-enter` 避免重复入场动画 |
| Markdown | `react-markdown` 分块、流式增量、文件引用点击 | 约 40 行的极简解析 |
| 车道让位 | 悬浮环境卡片出现时左移/收窄 | 固定居中 |
