# 移植提示词（给 DeepSeek Harness 里的 Agent）

用法：先把本目录整个复制到 DSH 仓库（建议 `docs/reference/compact-chat-ui/`），在 DSH 仓库根目录启动 Agent，把下面围栏里的内容整段贴给它。`<...>` 是需要你按实际情况替换的地方。

````text
任务：把 Vela Harness 的「紧凑工具调用模式」对话界面复刻到本仓库（DeepSeek Harness）的对话界面里。视觉和交互要与参考页一致，数据来自本仓库自己的工具事件。

## 参考资料（只读，不要修改）

位于 <docs/reference/compact-chat-ui/>：

- README.md：完整规格。先读第 5 节（紧凑工具行，核心）、第 6 节（回合与过程折叠）、第 8 节（移植指南与易踩的坑），其余按需查。
- compact-chat-ui.html：可直接在浏览器打开的参考页。CSS 是 Vela 的真实规则，是视觉验收的基准。
- src/app.js：参考页的渲染逻辑（原生 JS）。纯函数可以直接搬：splitToolRuns、groupProcessItems、buildTurnItems、compactSummaryParts、parseDisplayDiff、collapseDiffContext、diffStat、totalDiffStat、subjectOf、splitPath、formatDuration、formatElapsed。组件函数（CompactToolGroup、CompactToolLine、CompactDiffCard、AgentToolCard、CompletedAssistantTurn、Thinking 等）给出 DOM 结构和类名，按本仓库的前端技术栈改写，不要照抄成原生 JS。
- src/build.mjs 和 src/shell.html 是参考页的生成脚本，不用移植。

## 目标范围

要做：

1. 紧凑工具行：同一条助理消息里连续的 bash/read/edit/write 折叠成一行摘要（「已读取 3 个文件 · 已运行 1 条命令」），可展开成逐行明细；edit/write 能展开 diff 卡片，bash 能展开终端输出；失败、运行中状态位；子代理行；执行清单卡片。
2. 对话流外壳：用户气泡、助理回复正文、思考块（进行中自动展开，开始出现工具或正文后自动收起）、回复操作行、回合完成后「用时 X」折叠、进行中「已处理 X」、本轮文件统计卡、输入框 dock、「回到最新」按钮、贴底跟随。
3. 折叠方式：先实现默认的 toolFold = message。toolFold = position 和 toolProcessDetails（步数/耗时/折叠记忆）等基础版本跑通后再做，不要一开始就铺开。

不做：深色主题和多主题切换（只做晴空浅色）、卡片模式（toolDisplay = card）、会话标签条、提问卡、审批条、计划预览、思考总结、车道让位。参考页里 SVG 渐进模糊、devicon 文件图标、canvas 点阵动画都有简化版，按 README 第 9 节「与真实应用的差异」的参考页做法即可。

## 工作方式

1. 先只读，不改代码。弄清楚：
   - 本仓库前端用什么框架、样式怎么组织（全局 CSS、CSS Modules、Tailwind……）；
   - 对话消息和工具调用事件的数据结构：工具名有哪些、每个事件有哪些字段（命令、路径、输出、diff、状态、起止时间）、流式过程里怎么更新；
   - 现在的对话界面在哪几个文件里渲染，哪些交互（复制、重试、停止、预览文件）已经有实现。
2. 写一份简短的移植方案给我确认，再动手。方案包括：
   - 本仓库工具名 → Vela 种类（bash / read / edit / write / other）的映射表，对应不上的归 other；
   - 本仓库数据 → ToolTrace（README 5.1）的适配层放在哪、做什么；缺失字段怎么处理（没有 diff 就不显示卡片和统计，没有耗时就不显示耗时，不要编造）；
   - 样式放在哪、类名是否保持与参考页一致（建议一致，便于后续对照）；
   - 分几步提交。
3. 样式尽量原样复用：把参考页 <style id="vela-extracted"> 里用到的规则搬进本仓库样式体系，保留类名和 CSS 变量名；只改与本仓库冲突的部分（例如全局重置、字体变量），并在方案里列出冲突。
4. 分步实现，每步可独立运行：
   - 第 1 步：令牌 + 静态渲染（用固定的演示数据，对照参考页看视觉）；
   - 第 2 步：接入真实数据，非流式的历史会话先通；
   - 第 3 步：流式更新（运行中状态、思考自动展开/收起、贴底跟随、完成后变成「用时」折叠）；
   - 第 4 步：可选项（position 折叠、步数/耗时、折叠记忆）。
5. 每一步完成后用浏览器打开应用实际看一眼，并与参考页并排对照：同样的内容在两边的字号、间距、颜色、展开动画是否一致。无法在浏览器里验证的部分，如实说明没有验证。

## 必须遵守的细节

这些在 README 第 5.9 与 8.2 里有原因，容易做错：

- 紧凑模式下展开箭头默认 opacity: 0 但要保留占位，不能 display: none（否则悬停时文字会跳）；悬停文字部分或键盘聚焦时才显示。
- 耗时/步数用 margin-left: auto 靠右，展开箭头必须排在它们前面。
- 文件行与 bash 行完成后状态位宽度为 0，只有运行中显示点阵、失败显示红叉；other 卡片完成后才显示对勾。
- 折叠动画用 grid-template-rows: 0fr → 1fr，内层 min-height: 0; overflow: hidden，关闭时加 inert；展开体首次展开时才挂载，之后保留。
- 嵌套折叠（「用时」过程里套思考块）的展开态选择器只作用于直接子级。
- 需要较新的浏览器内核：:has()、color-mix()、容器查询。先确认本仓库的运行环境支持；不支持就停下来问我，不要悄悄改成别的写法。
- 一次性入场动画只在新挂载的节点上触发；重渲染已存在的节点不要重放。
- 尊重 prefers-reduced-motion。

## 边界

- 不要修改参考资料目录里的任何文件。
- 不要改动与对话界面无关的功能和数据流；需要改动现有数据结构时，先在方案里说明并等我确认。
- 不要提交、不要推送。完成后给我一份改动清单、验证过什么、没验证什么，以及和参考页仍有差异的地方。
````
