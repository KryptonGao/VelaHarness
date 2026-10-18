# 系统提示词优化方案

> **实现状态：部分实现。** 阶段 0（基线导出）、阶段 1 的开关、阶段 2–3（v2 提示词、Intelligent UI 范围限定、视觉自检措辞）已落地，见第 12 节；**默认已改为 `v2`**（2026-10-18 按用户决定，先于阶段 4 评测），可用 `VELA_SYSTEM_PROMPT=v1` 切回。阶段 1 的评测任务集与指标采集、阶段 4 的模型评测都还没有做，第 7 节没有结论，不得把 v2 的效果当作事实。第 1–10 节里的 `legacy` 即现在的 `v1` 档，「现状」一节描述的是它的行为。

## 1. 背景

同一道题（鹈鹕骑自行车，单文件 HTML 动画）在 Vela 与 DeepSeek Harness（下称 DSH，仓库 `deepseek-ai/deepseek-harness`，对照版本为 2026-10-17 的 `687f282e`）上产出差距明显：

- DSH 的页面带视差层、海面与灯塔、车铃音效，并提供 `?t=` 冻结帧与 `?ui=0` 隐藏界面参数，说明它的执行过程里做过「渲染、截图、检查」。
- Vela 的页面结构更简单，且有一个渲染一次就能发现的缺陷：速度线是 `<line>`，却被设置 `y` 属性，8 条线全部停在画面顶端。

两边用的大概率是同一个模型（DeepSeek V4.1 Flash）。源码核对的结果：

| 假设 | 结论 | 依据 |
| --- | --- | --- |
| 思考强度偏低 | 排除 | Vela 默认 `medium`，但 deepseek-flash 的 `thinkingLevelMap` 里 `medium` 为 `null`；`@earendil-works/pi-ai` 的 `clampThinkingLevel` 会向上取最近的可用级别，即 `high`，与 DSH 默认一致。 |
| reasoning 没有回传 | 排除 | 该模型 compat 设置了 `requiresReasoningContentOnAssistantMessages`，DSH 同样原样回传。 |
| 提示词与工具规范 | **待验证，本方案的对象** | 见第 3、4 节。 |

注意：以上是读源码得出的，没有做对照实跑。本方案的第一步就是把它变成数据。

## 2. 目标与非目标

目标：

1. 让模型「完成前自检」成为默认行为，尤其是产出可视成品（HTML、SVG、图表、界面）时。
2. 去掉与 Vela 产品无关或相互冲突的提示词内容，把身份与规则换成 Vela 自己的。
3. 降低常驻提示词的 token 占用，不为此牺牲 Plan、Goal、子代理等现有模式的行为。
4. 所有改动可 A/B 对比、可回退。

非目标：

- 不重写 Intelligent UI 协议、记忆、Plan、Goal 本身的语义，只调整它们进入提示词的方式与措辞。
- 不改动一次性辅助调用的提示词（会话标题、操作风险评审 `sandbox-risk`、配方生成、文本辅助、输入预测等）。
- 不切换底层框架，也不改 API 调用路径（仍走 pi-ai）。
- 不在本方案内决定 `browser_repl` 的权限模型，见第 9 节待决策。

## 3. 现状：Vela 实际送给模型的提示词

主会话在 agent 模式下，提示词由 `@earendil-works/pi-coding-agent` 的 `buildSystemPromptSections` 生成基础段，再由 Vela 的扩展与 `appendSystemPromptOverride` 追加。

| 顺序 | 段 | 来源 | 内容概要 |
| --- | --- | --- | --- |
| 1 | `preamble` | pi | `You are an expert coding assistant operating inside pi, a coding agent harness...` |
| 2 | `tools` | pi | 每个工具一行摘要，如 `Read file contents`、`Execute bash commands (ls, grep, find, etc.)` |
| 3 | `rules` | pi | 无 grep/find/ls 时「用 bash 做文件操作」、各工具 guideline、`Be concise in your responses`、`Show file paths clearly when working with files` |
| 4 | `docs` | pi | pi 文档、示例的路径与「读 pi 文档」的指示 |
| 5 | `addendum` | Vela | 对话自定义指令、定时任务说明（启用时）、`browserUseInstructions`（启用 `browserRepl` 时）、`modeSystemPrompt`（含 `outcomePrompt`、`agentTreePrompt` 等）、Intelligent UI（`intelligentUiInstructions`）、附加文件夹（`workspaceFoldersInstructions`）、记忆说明与记忆块、任务时间 |
| 6 | `project_context` | pi | 工作区 `AGENTS.md` 等 |
| 7 | `skills` | pi | 已启用的技能列表 |
| 8 | `cwd` | pi | 工作目录 |

子代理由 `createChildSession` 构造，同样用 `DefaultResourceLoader`，追加内容为对话指令、`agentKindPrompt`、附加文件夹，以及仅 `general` 类型才有的浏览器说明。

`packages/agent/src/context-usage.ts` 的 `splitSystemPrompt` 已按顶层标签拆段统计 token，其中 `rules`、`project_context`、`addendum` 归入规则类。本方案的度量可直接复用它。

## 4. 问题清单

每项标注依据与置信度。「置信度」指「该问题确实存在于当前提示词」，不是「它确实造成了输出差距」；后者要靠第 7 节的评测证实。

| 编号 | 问题 | 依据 | 置信度 |
| --- | --- | --- | --- |
| P1 | 模型被告知自己是「pi 里的 expert coding assistant」，不是 Vela | `buildSystemPromptSections` 的 `preamble` | 高 |
| P2 | 每次请求都带一段与用户任务无关的 pi 文档导览 | `docs` 段 | 高 |
| P3 | 规则里有无条件的 `Be concise in your responses`。默认 agent 模式没有「完成前自检」要求：`outcomePrompt` 只要求如实申报本轮的验证，并明确允许 `verificationIds` 为空。Goal 模式的 `goalPrompt` 强制验证（diff、定向测试、构建、类型检查，须 `record_goal_validation`），但针对的是 bash 检查，不覆盖视觉成品 | pi 的 `buildRules`；`interaction.ts` 的 `outcomePrompt`、`goalPrompt` | 高 |
| P3b | 验证证据只认 bash：`submit_outcome` 的 `verificationIds` 与 `record_goal_validation` 只能引用已完成的 bash 工具调用 id；而 `browserUseInstructions` 还写明 `browser_repl` 调用会使 Goal 验证失效、需要重新验证。视觉检查因此没有合法的证据位置，也有「检查了反而要重验」的负担 | `interaction.ts` 的 `outcomePrompt`；`browser-use.ts` 的 `browserUseInstructions` | 高 |
| P4 | 视觉成品没有「渲染后查看」的要求；`browser_repl` 仅在启用 `browserRepl`、非 Plan/explore 模式、且逐次通过权限时可用，提示词也只写「编辑后检查同一页面」 | `browser-use.ts` 的 `browserUseInstructions`、`createBrowserTools` | 高 |
| P5 | Intelligent UI 说明在 agent 模式下一定注入（`text_only` 时注入简短说明），其中含 `do not output HTML, JavaScript, JSX, CSS, or any script`，本意只针对 `vela-ui` 围栏，但与「写一个 HTML 文件」的任务出现在同一份提示词里 | `intelligent-ui-prompt.ts` 的 `intelligentUiInstructions` | 措辞存在：高；是否影响输出：低，需实测 |
| P6 | 没有「检查工具结果、失败先排查」「删除前确认绝对路径」「被权限或沙盒拒绝后不要换方式重试」之类具体行为规则 | 对照 DSH 的 `tool:bash` 段与 bash 工具描述 | 高 |
| P7 | `edit` 的参数形状是 `edits[]` + `oldText`，并附带「不得重叠、对原文件匹配」的约束；较小模型可能更容易出错 | pi 的 `edit` 工具 guideline | 低，需看 trace 中的 edit 失败率 |
| P8 | 工具列表段与 API 的工具声明重复 | pi 的 `tools` 段 | 中，影响的是 token，不是行为 |

对照 DSH 的做法（均来自其仓库源码，不是推测）：

- 身份只有一句：`You are an AI agent powered by DeepSeek Harness.`
- 规则绑定到具体工具，例如 bash 段：检查每次结果的 `[exit code: N]`，失败先排查再继续。
- bash 描述里写明：删除或移动前确认解析后的绝对路径；被沙盒拒绝时不要换方式重试。
- 工具 schema 里标注参数顺序，如 `Provide description before command`。
- `edit` 是扁平的 `file_path / old_string / new_string / replace_all`；另有独立的 `read_image`，以及 read-before-write 闸门。

结论：DSH 的提示词并不更长，优势在「规则具体、与工具绑定」。因此优化方向是**换成具体规则**，不是把提示词写长。

## 5. 方案

### 5.1 机制

`DefaultResourceLoader` 支持 `systemPromptOverride`，返回值会作为 `customPrompt` 传给 `buildSystemPromptSections`。设置后 pi 只输出这段作为 `preamble`，**不再生成 `tools`、`rules`、`docs` 三段**；`addendum`、`project_context`、`skills`、`cwd` 照常生成。Vela 目前只用了 `appendSystemPromptOverride`，没有用 `systemPromptOverride`。

因此：

1. 新增 `packages/agent/src/system-prompt.ts`，导出 `velaPreamble` 与 `velaRules(kind, capabilities)`。
2. 主会话与子代理两处 `DefaultResourceLoader` 都加 `systemPromptOverride: () => velaPreamble`。
3. 把 `velaRules(...)` 放进两处 `appendSystemPromptOverride` 数组的**第一项**。`context-usage.ts` 把 `addendum` 归入规则类，统计口径不变。
4. 去掉 `tools` 段后，模型仍通过 API 的工具声明获知工具；pi 各工具 `promptGuidelines` 也随之消失，其中有价值的几条（见 5.3）由 `velaRules` 显式保留。**这一点必须在阶段 0 用 trace 验证**，不能默认成立。

选这条路径而不是在扩展里改 `systemPromptOptions.sections`，原因是 `preamble` 无法通过 `sections` 覆盖，且 `sections` 里空内容会被 pi 忽略，不能用来删除 `docs`。

### 5.2 提示词 v2 草案

以下为待评审草案，措辞在评测中迭代。保持英文，与现有提示词一致。

`velaPreamble`：

```
You are Vela, an agent that works inside the user's workspace on a desktop app. You carry a task through to a finished, checked result using the tools provided.
```

`velaRules`（agent、goal、子代理 `general` 使用完整版）：

```
Working rules:
- Finish what was asked. Do not stop at a plan or a partial result unless the user asked for a plan or the mode instructions below say otherwise.
- Read every tool result before moving on. A non-zero exit code, an error, or an unexpectedly empty output is something to investigate, not to skip.
- Verify before you report done. After changing code, run the narrowest check that covers the change (test, typecheck or build). After producing something visual (an HTML page, SVG, chart or UI), render it and look at the result at least once, fix what is visibly wrong, then report. If you could not verify something, say exactly what you did not verify.
- Read a file before you edit it. Keep edits small and exact; use write only for new files or complete rewrites.
- Before deleting or moving anything, confirm the resolved absolute target path.
- If an operation is denied by a permission or sandbox policy, do not retry it another way; report it and continue with what is allowed.
- Keep chat replies short and plain. Do not shorten the work or the deliverable to be brief.
- Show file paths clearly when working with files.
```

按场景裁剪：

| 场景 | 规则 |
| --- | --- |
| agent、子代理 `general` | 完整版。与 `outcomePrompt` 衔接：做过的验证照实申报，没做的明说，不要为凑数而虚构 |
| goal | 去掉「运行检查」一条（由 `goalPrompt` 与 `record_goal_validation` 负责，避免两处要求叠加或冲突），保留「渲染后查看」及其余各条 |
| plan、子代理 `explore`（只读） | 去掉「运行检查」「渲染」「删除或移动」「edit/write」相关条，保留「读取结果」「简洁」「路径」 |
| 模型不支持图片输入 | 「渲染后查看」改为「用可执行的结构化检查代替（脚本检查、控制台报错、DOM 断言），并说明没有目视检查」 |
| 未启用浏览器工具 | 不写具体工具名；允许用 bash 的无头渲染产出图片，再用 `read` 读图 |

### 5.3 从 pi 内置规则保留什么

去掉 `rules` 段会丢失下列有用的约束，`velaRules` 需保留其意：

- 优先用 `read` 读文件，不用 `cat`、`sed`。
- `write` 只用于新文件或整体重写。
- 同一文件多处不相交修改，合并为一次 `edit` 调用；`oldText` 取最小且唯一。

「无 grep/find/ls 工具时用 bash 做文件操作」按实际工具集条件生成。

### 5.4 Intelligent UI 说明

1. 在说明开头加一句范围限定：本节只约束聊天回复中的 `vela-ui`、`vela-app` 围栏；写入工作区的 HTML、JS、CSS、SVG 文件不受限制。
2. 保留现有协议语义，不改 `docs/intelligent-ui.md` 描述的行为。
3. 阶段 0 量出这一段的 token 占比；若偏大，再评估改为按需加载（例如仅在对话涉及对比、计算、图解时注入），该方案属 P2，需单独评审。

### 5.5 视觉成品的自检路径

提示词只能「要求」自检，能不能做到取决于工具是否可用：

- 启用 `browser_repl` 时：沿用 `browserUseInstructions`，并在其中明确「产出 HTML 后用 `tab.screenshot()` 查看」。
- 未启用时：允许用 bash 调无头浏览器截图，再用 `read` 读取图片。`read` 对图片会作为附件发送，前提是当前模型的 `input` 含 `image`（deepseek-flash 含，deepseek-v4-pro 不含）。
- `browser_repl` 的逐次权限是否放宽属于安全与产品决策，不在本方案内擅自改动，见第 9 节。

### 5.6 工具形状（有条件）

`edit` 是否改成扁平的 `old_string / new_string`，**只在阶段 1 的 trace 显示 edit 失败率明显偏高时才做**。改动涉及自定义工具封装与权限、检查点联动，成本较高，不预先承诺。

## 6. 分阶段计划

| 阶段 | 内容 | 交付物 | 验收 |
| --- | --- | --- | --- |
| 0 基线 | 用 `splitSystemPrompt` 导出 agent、plan、goal、子代理 `general`/`explore` 五种场景的完整提示词与分段 token；验证去掉 `tools` 段后工具仍被正常调用 | 基线记录（段、token、完整文本）；一个能复现的导出脚本或测试夹具 | 五种场景都有数据；工具调用 trace 无异常 |
| 1 评测集与开关 | 建评测任务与指标采集；加开发期开关在 `legacy` 与 `v2` 间切换（具体形式参照 `docs/development.md` 的开发约定） | 评测任务清单、采集脚本、开关 | 同一任务可在两种配置下各跑 N 次，指标能从 trace 导出 |
| 2 v2 提示词 | 实现 5.1–5.3：新增 `system-prompt.ts`，主会话与子代理接入 | 代码与单元测试 | 第 8 节的测试全部通过；`pnpm test` 通过 |
| 3 Intelligent UI 与视觉自检 | 实现 5.4、5.5 | 代码与测试 | 同上 |
| 4 评测与决策 | 跑完评测，给出结论；决定是否默认启用 `v2`、是否做 5.6 | 评测报告（回写本文第 7 节结果） | 达到第 8 节指标，或明确放弃并记录原因 |
| 5 收尾 | 默认启用后删除开关与 `legacy` 路径；更新文档索引与相关文档 | 清理提交 | 不再有死代码 |

阶段 2 与 3 在评测前可以合并成一个 `v2`，但评测时要能拆开单独比较（`v2` 仅换身份与规则，对比 `v2` 加 UI 措辞与视觉自检），否则无法归因。

## 7. 评测方案

### 7.1 任务集（建议 8 个）

| 类别 | 任务 | 目的 |
| --- | --- | --- |
| 视觉成品 | 鹈鹕骑自行车（本方案起因） | 复现原问题 |
| 视觉成品 | 单文件落地页 | 视觉自检是否泛化 |
| 代码 | 修复一个失败的单元测试 | 验证「跑检查」 |
| 代码 | 小范围重构并保持测试通过 | 验证 edit 稳定性 |
| 代码 | 写一个带边界条件的命令行脚本 | 验证自检 |
| 非视觉对照 | 阅读几个文件后写总结 | 确认没有因新规则变啰嗦或变慢 |
| 回归 | Plan 模式任务 | 确认 `<proposed_plan>` 流程不受影响 |
| 回归 | Goal 模式任务 | 确认验证报告流程不受影响 |

### 7.2 配置矩阵

- 提示词：`legacy`、`v2`、`v2` 加视觉自检。
- 模型：deepseek-flash（`high`）为主；再加一个当前默认的其他模型，防止对它们回归。
- 浏览器工具：视觉任务各跑开与关。
- 每格重复 3 次。
- 上限参照：视觉任务另用 DSH 跑同题，只作为上限对照，不作为通过条件。

### 7.3 指标

| 指标 | 来源 |
| --- | --- |
| 完成前是否执行过渲染或检查（验证行为率） | trace 中工具调用序列 |
| 工具错误数与重试数，其中 edit 失败单列 | `tool-activity.ts`、`trace.ts` 的记录，阶段 0 先确认可导出 |
| 总 token、耗时 | 现有用量统计 |
| 常驻提示词 token | `splitSystemPrompt` |
| 成品质量 | 盲评 1–5 分，至少两人，打分前隐去配置 |

> 这里引用的 trace 能力是否足够导出上述指标，需要阶段 0 确认；不足时先补采集，再谈评测。

## 8. 验收标准（建议值，评测后可调整）

功能与测试：

1. 主会话与子代理的提示词都不再出现 pi 的身份句与文档段（单元测试断言文本不含 `operating inside pi` 与 `Pi documentation`）。
2. plan 与 `explore` 场景不含「运行检查」「渲染」类规则；agent 与 goal 场景含「完成前验证」规则（单元测试断言）。
3. `modeSystemPrompt`、记忆块、附加文件夹等原有追加内容仍按原顺序出现（扩展已有的提示词测试，参照 `runtime-instructions.test.ts`、`intelligent-ui-prompt.test.ts`、`memory-context.test.ts`）。
4. `splitSystemPrompt` 对新提示词的分段统计不出现新的未识别段。

效果：

5. 视觉任务的验证行为率：`v2` 在开启浏览器工具的配置下不低于 80%，且显著高于 `legacy`。
6. 非视觉任务：工具错误率不高于 `legacy`；总 token 增幅不超过 5%；Plan 与 Goal 回归任务全部通过。
7. 常驻提示词 token 低于基线（预期来自去掉 `docs` 与 `tools` 段）。
8. 盲评中，`v2` 在视觉任务上均分高于 `legacy`。

## 9. 待决策事项

| 编号 | 问题 | 说明 |
| --- | --- | --- |
| D1 | `browser_repl` 是否对本地预览放宽逐次权限 | 涉及执行任意 JS，属于安全决策，需要产品与安全一起拍板；不放宽时视觉自检主要靠 5.5 的 bash 加读图路径 |
| D2 | Intelligent UI 说明是否改为按需注入 | 能省 token，但会增加「该用时没用上」的风险，建议等基线数据再定 |
| D3 | 是否按模型做提示词档位（例如不支持图片的模型） | 5.2 已写了降级条款；是否独立成档位视评测结果而定 |
| D4 | 是否封装扁平的 `edit` 工具 | 见 5.6，等 trace 数据 |
| D5 | 是否把评测任务沉淀为仓库内的回归夹具 | 好处是后续改提示词有基线；代价是维护成本与模型调用开销 |
| D6 | 视觉检查能否作为验证证据 | 目前 `submit_outcome` 与 `record_goal_validation` 只认 bash 调用 id（见 P3b）。若要让「截图自检」进入成果验收，需要扩展证据类型并同步 [outcome-acceptance.md](../outcome-acceptance.md) 的说明；不扩展时，视觉自检只作为行为要求，不进入验收记录 |

## 10. 风险与回退

| 风险 | 缓解 |
| --- | --- |
| 去掉 `tools` 段后模型对工具的使用变差 | 阶段 0 先验证；`v2` 期间保留开关，随时回到 `legacy` |
| 「验证」规则让简单任务变慢、变啰嗦 | 规则只要求「最窄的检查」；非视觉对照任务和 token 指标用来拦截 |
| 模型不支持图片，视觉自检落空 | 5.2 的降级条款：改用结构化检查并明说没有目视检查 |
| 新规则与 Plan、Goal 的提示词冲突 | 规则按场景裁剪；回归任务覆盖；开头写明「以模式说明为准」 |
| 提示词变更改变已有用户的行为 | 默认启用前经过评测；发版说明里写明；保留回退开关到下一个版本 |
| 评测样本小，结论不稳 | 每格 3 次、盲评两人以上；结论写明样本量，不过度外推 |

## 11. 实现位置索引

| 位置 | 与本方案的关系 |
| --- | --- |
| `packages/agent/src/runtime.ts` 的 `startInternalOnce`、`createChildSession` | 两处 `DefaultResourceLoader` 构造，接入 `systemPromptOverride` 与规则 |
| `packages/agent/src/interaction.ts` 的 `modeSystemPrompt`、`createModeExtension` | 模式提示，保持不变，需回归 |
| `packages/agent/src/intelligent-ui-prompt.ts` 的 `intelligentUiInstructions` | 5.4 的措辞调整 |
| `packages/agent/src/browser-use.ts` 的 `browserUseInstructions` | 5.5 的措辞调整 |
| `packages/agent/src/context-usage.ts` 的 `splitSystemPrompt` | 度量工具 |
| `packages/agent/src/memory-context.ts`、`workspaceFoldersInstructions` | 追加内容，需回归 |
| `@earendil-works/pi-coding-agent` 的 `buildSystemPromptSections`、`DefaultResourceLoader` | 提示词基础段与覆盖入口 |
| `@earendil-works/pi-ai` 的 `clampThinkingLevel` 与 deepseek 模型表 | 思考强度结论的依据 |

相关文档：[intelligent-ui.md](../intelligent-ui.md)、[plan-mode.md](../plan-mode.md)、[memory.md](../memory.md)、[browser.md](../browser.md)、[browser-use-validation.md](../browser-use-validation.md)、[outcome-acceptance.md](../outcome-acceptance.md)。

## 12. 实现记录

### 12.1 开关

`AgentRuntime` 新增选项 `systemPromptProfile`，桌面端从环境变量 `VELA_SYSTEM_PROMPT` 读取（`apps/desktop/src/main/index.ts`），未设置或取值未知时为 `v2`；`legacy` 作为 `v1` 的旧名仍可识别：

| 档位 | 内容 | 用途 |
| --- | --- | --- |
| `v1` | Pi 原有 `preamble`、`tools`、`rules`、`docs`，其余不变 | 对照与回退 |
| `v2` | `velaPreamble` 替换基础段，`velaRules` 放在 `addendum` 第一项 | 只换身份与规则，**默认** |
| `v2-visual` | `v2` 加视觉成品自检条款、Intelligent UI 范围限定、`browserUseInstructions` 后补一句截图检查 | 归因视觉自检的效果 |

```bash
VELA_SYSTEM_PROMPT=v1 pnpm dev          # 切回 Pi 原有提示词
VELA_SYSTEM_PROMPT=v2-visual pnpm dev   # 加视觉自检
```

安装版从访达启动时不带自定义环境变量，始终是 `v2`；要切换需从终端带变量启动，例如 `VELA_SYSTEM_PROMPT=v1 /Applications/Vela.app/Contents/MacOS/Vela`。

### 12.2 与第 5 节方案的差异

- **主会话的规则每轮生成**：主会话切换 agent / plan / goal 时不会重新加载资源，`appendSystemPromptOverride` 只在创建时执行一次，所以规则改由隐藏扩展 `vela-rules` 在 `before_agent_start` 里按当前模式、实际可用工具（`systemPromptOptions.selectedTools`）和当前模型的图片输入能力生成，并前置到 `addendum`。子代理类型固定，仍写在 `appendSystemPromptOverride` 第一项。
- **规则按工具生成**：edit、write、bash、删除或移动、「无 grep/find/ls 时用 bash」各条只在对应工具可用时出现；常驻协调会话（resident）没有文件工具，只剩通用条目。
- **「被拒绝后不要换方式重试」在 plan 与 explore 也保留**：这两种场景同样会被模式守卫或沙盒拒绝，这条不涉及修改，与只读约束不冲突。
- **`SYSTEM.md` 仍优先**：`systemPromptOverride` 收到 Pi 发现的 `SYSTEM.md` 时原样使用，没有时才用 `velaPreamble`，与 `v1` 档的覆盖行为一致。
- **截图要显式发出**：`browser_repl` 的截图要经 `nodeRepl.emitImage(await tab.screenshot())` 才会作为图片回到模型，规则和浏览器补充句都按这个写法。
- 工具形状（5.6）、`browser_repl` 权限（D1）、视觉证据类型（D6）均未改动。

### 12.3 基线（阶段 0）

由 `packages/agent/test/system-prompt.test.ts` 用真实 `AgentRuntime`、沙盒工具和脚本化模型生成，取每个场景第一次请求的系统提示。token 按 `context-usage.ts` 的口径（字符数 ÷ 4）估算；测试夹具的模型不支持图片，没有附加文件夹、记忆内容和工作区 `AGENTS.md`，Intelligent UI 为默认 `auto`，未启用浏览器工具与定时任务。

```bash
cd packages/agent
VELA_PROMPT_BASELINE_DIR=/path/to/out node --import ./test/register-ts.mjs --experimental-transform-types \
  --experimental-test-module-mocks --test --test-name-pattern=exports test/system-prompt.test.ts
```

输出每个档位与场景的完整提示（`<profile>.<scenario>.txt`，档位为 `v1`、`v2`、`v2-visual`）和分段统计 `summary.json`。2026-10-18 的结果（估算 token，总量 / 其中 `addendum`）：

| 场景 | v1 | v2 | v2-visual |
| --- | --- | --- | --- |
| agent | 4895 / 3393 | 4407 / 3744 | 4521 / 3857 |
| plan | 1808 / 621 | 1442 / 779 | 1442 / 779 |
| goal | 3191 / 1676 | 2666 / 2002 | 2736 / 2072 |
| 子代理 `general` | 964 / 225 | 641 / 575 | 711 / 645 |
| 子代理 `explore` | 804 / 239 | 462 / 397 | 462 / 397 |

- `v1` 的 `docs` 段在每个场景都约 355 token，`tools` 段 71–270 token；去掉两者后，`v2` 的常驻提示词在各场景下降约 10%–43%，`v2-visual` 下降约 8%–43%（agent 场景最少），满足第 8 节第 7 条。
- agent 场景的大头是 Intelligent UI 说明（`addendum` 的大部分），D2 是否按需注入仍等评测数据。
- 「去掉 `tools` 段后工具仍被正常调用」只验证了工具声明随请求发送、脚本化调用可执行；真实模型的工具使用质量要靠阶段 4 评测。

### 12.4 测试

`packages/agent/test/system-prompt.test.ts` 覆盖第 8 节第 1–4 条：五种场景都不含 `operating inside pi` 与 `Pi documentation`；plan 与 explore 不含「完成前验证」「渲染」类规则，agent、goal、general 含；goal 不含「运行检查」；规则位于 `addendum` 开头，`outcomePrompt`、`agentTreePrompt`、Intelligent UI 按原顺序在其后；`splitSystemPrompt` 不出现未识别段；`v1` 档与改动前一致；未传档位时使用 `v2` 且不含视觉自检条款。

### 12.5 尚未完成

- 阶段 1 的评测任务集与指标采集脚本（第 7 节）。
- 阶段 4 的评测：`v2` 已先行默认启用，评测结果用来确认是否保留，以及是否把默认升级为 `v2-visual`；阶段 5 的清理（删除 `v1` 路径）要等评测后再定。
