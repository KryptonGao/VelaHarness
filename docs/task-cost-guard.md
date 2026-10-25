# 任务费用护栏

任务用量上限原本只按时间和 Token 计。现在可以直接按金额（人民币或美元）设上限，费用逼近上限时在收件箱提醒，并在开跑前根据同类历史任务给出费用预估。相关设置在 设置 › 默认与权限 的「任务用量上限」，单个对话可以在「用量限制」标签页里单独覆盖。

## 费用怎么算

- 价格沿用设置里登记的模型价格（每 100 万 Token，分输入、输出、缓存写入、缓存读取四项），Vela 不内置价目表。
- 一个任务从用户发出消息开始，到根代理与所有子代理都空闲为止；费用按整棵 agent 树累计。账本只记每个模型的 Token 用量，金额在评估时按**当前**登记的价格换算，所以改价格会立刻作用于进行中的任务。
- 人民币与美元**不换算**。费用上限选定一种币种，只有登记为这个币种的模型才计入。
- 没登记价格、或登记为另一种币种的模型**不计入**（沿用「没登记价格不计入」的规则）。聊天里的提示和「用量限制」标签页会显示「有 N 个模型没有计入，实际花费可能更高」，避免把「没超」误读成「花得少」。
- 费用只在每次模型请求结束时增加，所以一次很长的回复可能越过上限一点；到达上限后立即停止整棵 agent 树，行为与时间、Token 上限一致。

## 上限与提醒

- `TaskBudgetSettings.maxCost`（`packages/shared/src/task-budget.ts`）为 `{ currency, amount }` 或 `null`（不限）。金额范围 0.01 – 1,000,000，取整到分。旧的设置文件没有这个字段，读取时视为不限。
- 启用时，时间、Token、费用三项至少要设置一项；多项同时设置时，先到上限的触发。
- 达到 80% 时聊天里出现接近上限的提示，达到 100% 时停止并提供「整理交接」。
- 同一任务里，费用的 80% 和 100% 各向收件箱发一条提醒（类型「提醒」，来源是对话）。判断只看费用自己的比例，不受时间或 Token 更接近上限的影响；一次直接越过 100% 时不会再补发「接近上限」。提醒的摘要只有金额（例如 `¥1.62 / ¥2.00`），说明文字由界面按语言显示。时间、Token 上限的行为没有变化，不进收件箱。

## 开跑前预估

- 每个任务结束时，运行时记一条用量记录（`task-cost-history.json`，各模型的 Token 用量、类别、耗时），最多保留 200 条。不论是否启用上限都会记，否则永远攒不出样本。
- 「同类」按类别划分：普通对话和任务配方分开估。优先只用同一个模型的记录；同模型样本不足时退回同类别的全部记录，并在界面标明「含其他模型，按现价换算」。
- 至少要有 3 条同类记录才给预估，最多参考最近 30 条；样本不足、或没有可用价格时什么都不显示，不给没有依据的数。
- 预估用现在的价格重新换算，显示中位数和中间一半任务所在的区间（第 25 到第 75 百分位）。币种优先取费用上限的币种，没设上限就取当前模型登记的币种。
- 预估只在输入框上方、对话空闲时显示；中位数已达到本对话的费用上限时会加一行警示。

## 价格同步

费用上限和预估都在主进程里计算，但价格由渲染层的设置页维护（浏览器存储）。因此：

- 保存价格时同时通过 `setModelPrices` 交给主进程，写入资料目录的 `model-prices.json`。
- 启动时 `syncModelPrices` 对齐一次：以本地为准推给主进程；只有本地为空而主进程有价格时才反向恢复。同步失败不影响本地保存，下次启动会补同步。
- 主进程从未收到过价格时，所有模型都视为未登记，费用上限不会触发，但「未计入」提示会出现。

## 实现位置

| 内容 | 位置 |
| --- | --- |
| 上限设置、评估与状态 | `packages/shared/src/task-budget.ts` 的 `TaskBudgetSettings`、`evaluateTaskBudget`、`TaskBudgetState` |
| 账本、币种过滤、预估与历史解析 | `packages/shared/src/task-cost.ts` 的 `cappedCost`、`estimateTaskCost`、`parseTaskCostHistory` |
| 任务账本与状态 | `packages/agent/src/task-budget.ts` 的 `TaskBudgetTask` |
| 价格副本、历史存储 | `packages/agent/src/model-price-store.ts`、`packages/agent/src/task-cost-history.ts` |
| 请求计费、提醒、预估入口 | `packages/agent/src/runtime.ts` 的 `recordTaskUsage`、`alertTaskCost`、`estimateTaskCost` |
| 收件箱提醒 | `apps/desktop/src/main/agent-inbox-adapter.ts` 的 `onTaskBudget` |
| 界面 | `TaskBudgetFields`、`TaskBudgetBanner`、`TaskBudgetTab`、`TaskCostForecastHint`（`apps/desktop/src/renderer/components/`） |

## 验证

```bash
pnpm --filter @vela/agent test        # task-budget.test.ts、task-budget-runtime.test.ts
pnpm --filter @vela/desktop test      # task-cost.test.ts、agent-inbox-adapter.test.ts
pnpm --filter @vela/desktop test:ui   # 渲染层检查
```

界面夹具：`node apps/desktop/test/trace-preview-server.mjs` 后打开 `test/task-budget-cost-preview.html`（`?phase=warning|exhausted`、`?over=1`、`?mixed=1`、`?tab=1`、`?en=1`、`?theme=dark`）。

## 已知限制

- 费用按每次请求结束时的用量结算，不估算流式输出中的费用。
- 任务类别只分对话与配方两类，不按配方区分；不同配方的开销差别大时，预估区间会偏宽。
- 预估只看历史用量，不读取这次的提示词，也不预测子代理数量。
- 历史记录和预估是本机数据，不跨设备同步。
