# Headless Runner

不启动 Electron 就能跑一次 Vela 任务：给脚本、CI 和其他 Node 宿主用的单次执行入口。任务结束即退出，每次运行的会话、子代理历史、trace 和结果都写进自己的目录，不碰桌面的会话与设置。

本文只描述已实现的能力。

## 范围

已提供：

- 命令行 `vela-runner run`：一次任务，文本或 JSONL 输出，退出码区分结果。
- Node API `runHeadless`（`@vela/runner`）：同一套执行流程，供测试和其他宿主调用。
- Agent、Plan 两种模式；`ask` / `smart` / `full` 三档权限。
- 无人值守的审批、提问、超时、中断与后台任务收尾。

不在范围内：常驻服务、HTTP / RPC、定时调度、任务配方、Resident Agent、与桌面会话的同步、历史恢复、交互式终端、Browser Panel。

## 用法

```bash
pnpm runner run \
  --cwd /path/to/repo \
  --config-dir ~/.vela \
  --provider openai-codex \
  --model <model-id> \
  --sandbox full \
  --format jsonl \
  "修复测试并验证"
```

`pnpm runner` 先构建 `apps/runner/out/cli.mjs` 再运行；也可以单独构建后直接执行：

```bash
pnpm build:runner
node apps/runner/out/cli.mjs run --help
```

产物是单个 Node ESM 文件，打包了 `@vela/*` 源码，Pi SDK、`typebox` 等运行依赖保持外部，需要在能解析到仓库 `node_modules` 的位置运行。构建与运行都不依赖 Electron。

### 选项

| 选项 | 说明 |
| --- | --- |
| `<任务>` / `--prompt-file <路径\|->` | 任务内容。两者互斥；`-` 读取 stdin。文本上限 100000 字符（与桌面输入框一致），空内容直接失败。 |
| `--cwd` | 工作目录，默认当前目录。经 `pnpm runner` 启动时进程 cwd 是仓库根，因此改用 pnpm 记录的发起目录 `INIT_CWD`。 |
| `--data-dir` | 运行数据根目录，默认 `~/.vela-runner`。 |
| `--config-dir` | 模型配置目录，默认 `<data-dir>/config`。**不会自动探测桌面账号**；要复用桌面登录，显式传桌面资料目录（安装版 `~/.vela`，开发版 `~/.vela-dev`）。 |
| `--provider` / `--model` | 必须同时提供。省略时按配置目录里的默认选择；显式模型不可用时失败，不替换成别的模型。 |
| `--thinking` | 思考强度。所选模型不支持时报错，不静默收敛。 |
| `--mode agent\|plan` | 默认 `agent`。`plan` 只产出计划，不批准也不执行。 |
| `--sandbox ask\|smart\|full` | 默认 `ask`；不读取桌面的权限设置，也不会自动提升为 `full`。 |
| `--format text\|jsonl` | 默认 `text`。 |
| `--timeout <秒>` | 整体超时，默认 1800（30 分钟），初始化、模型执行和后台等待都计入。 |
| `--locale` | 模型默认写作语言，取 `zh-CN`、`zh-TW`、`en`、`ja`、`ko`，默认 `en`。 |

CLI 不接受明文密钥参数：使用配置目录里已有的模型配置，或 Pi 支持的环境变量。它不会打开浏览器、执行登录流程或修改 `PATH`。

### 退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 正常结束（`completed`）。只表示执行正常结束，**不代表代码验证通过**。 |
| 1 | 执行失败：运行时错误、未处理的子代理失败、用量耗尽、持久化失败；或输出管道被关闭。 |
| 2 | 参数或配置错误：用法错误、工作目录无效、模型不可用、思考强度不被支持。 |
| 3 | 需要人工交互：审批或提问（`blocked`）。 |
| 124 | 超时。 |
| 130 / 143 | 收到 SIGINT / SIGTERM。第一次信号开始取消与清理，再次收到则立即退出。 |

### 输出

`text`：stdout 只有最终主代理回复（Plan 模式是计划正文），仅在正常结束时输出；日志、进度和诊断写 stderr。

`jsonl`：stdout 每行一个 JSON 对象，不混入任何日志；失败说明写 stderr。信封固定为：

```json
{"version":1,"runId":"…","sequence":1,"timestamp":"…","type":"run_started","payload":{}}
```

| `type` | 含义 |
| --- | --- |
| `run_started` | 运行目录、工作目录、模式、权限和请求的模型。始终是第一条。 |
| `runtime` | Runtime 事件的精简视图（文本增量、工具开始 / 结束、子代理状态、计划、错误等）。不含思考内容、trace 和流式工具输出，过长字段会被截断。 |
| `approval` | 一个审批请求被拒绝（`outcome: "denied"`）。 |
| `question` | 一个提问被取消（`outcome: "cancelled"`）。 |
| `run_result` | 终态结果。**最后一条，且只有一条**。 |

`sequence` 从 1 连续递增。所有事件在输出前会经过现有的脱敏（`redactSensitive`）并额外抹掉环境变量里看起来像凭据的值；原始鉴权事件和 HTTP 请求头不会输出。输出关闭或遇到 EPIPE 时取消任务并清理，进程以 1 退出；慢速 stdout 会被等待（背压），排队期间相邻的文本增量合并。

## 结果与终态

`run_result`（也是 `runHeadless` 的返回值）包含：`runId`、`conversationId`、`runDir`、起止时间、实际使用的模型与思考强度、`status`、结构化 `error`、最后一次主代理回复 `finalText`、Plan 模式的最新计划 `plan`、根会话与各子代理的 token 用量、子代理失败摘要、`blocked` 说明和 `warnings`。

| `status` | 含义 |
| --- | --- |
| `completed` | 主代理及后台活动正常结束。 |
| `failed` | 配置、模型、运行或持久化失败。`error.code` 见下。 |
| `blocked` | 必须由人回答或审批。 |
| `cancelled` | 调用方取消或收到退出信号。 |
| `timed_out` | 达到整体超时。 |

终态由一次性仲裁决定：先到先得，之后的取消、超时或重复完成都被忽略。`error.code` 取 `invalid_request`、`config_error`、`model_unavailable`、`thinking_unsupported`、`start_failed`、`runtime_error`、`subagent_failed`、`budget_exhausted`、`plan_missing`、`persistence_failed`、`approval_required`、`question_required`、`cancelled`、`timed_out`、`internal_error`。

判定规则：

- 中间可恢复的工具错误不算失败。
- 没有恢复的 Runtime 错误、结束时仍处于失败状态的子代理、任务用量耗尽，不会被一段普通的最终文本掩盖。
- Plan 模式正常结束必须取得有效的 Proposed Plan，否则 `plan_missing`。
- 释放资源前会严格落盘（会话索引与 trace）；写盘失败不会报告成功。`run.json` 写不进去同理。

## 无人值守的交互

第一版不会从终端询问任何人：

- 需要人工批准的请求（`ask` 下的 `bash`、工作区外的写入、MCP、网页抓取等）立即被拒绝，运行以 `blocked` / `approval_required` 结束。
- `ask_user_question` 立即取消，运行以 `blocked` / `question_required` 结束；不会冒充用户作答。
- `smart` 的风险判断复用桌面的实现；判断为不安全或判断不出来时同样阻塞退出。
- `full` 只有显式指定才启用。
- 拒绝时先记录终止原因，再异步中断会话，避免在事件回调里重入 Runtime；后续的取消错误不会覆盖最初的原因。

**这套权限沿用交互式审批的语义，不是操作系统级沙箱。** `full` 下模型可以执行任意命令，请在可丢弃的环境里使用。

## 后台任务收尾

`prompt()` 返回不等于任务结束：子代理、后台命令和合并通知都可能再次唤醒主代理。Runner 用 `AgentRuntime.waitForIdle` 等待以下条件**同时**成立，且在下一轮事件循环及活动版本复核后仍然成立：

- 主会话没有运行、流式请求或待投递指令；
- 没有运行中或暂停中的子代理；
- 没有该会话待合并的 root 通知，也没有进行中的 root 投递；
- 没有运行中的后台命令。

Headless 启用后台命令，并等待它们结束以及随后的主代理回复。**长期运行的服务器会一直占用任务**，直到模型终止它或达到超时。成功、失败、取消和超时都会终止后台命令并等它们退出（上限 5 秒；超过则在 `warnings` 里报告）。

## 数据隔离

每次运行一个独占目录：

```text
<dataDir>/runs/<runId>/
  run.json          # version 1：请求元数据、状态、结果和错误，不含凭据
  agent/            # 与桌面同格式的会话数据：conversations.json、sessions/、subagents/、traces/ …
  cache/            # 模型目录缓存（models-store.json）
  sandbox.json      # 权限管理器占位文件，不会被写入
```

- 运行目录用 UUID 独占创建，权限 `0700`；`run.json` 权限 `0600`，原子替换写入。运行目录不能与配置目录相同，也不会复用已有目录。不同调用可以并行，不共写任何目录。
- `run.json` 只记录提示词的长度与 SHA-256，不重复保存正文；但 `agent/` 下的会话和 trace 含有完整的提示、工具输出和工作区内容。**CI 不应默认公开上传整个运行目录。**
- 崩溃留下的非终态 `run.json`（`starting` / `running`）仅供诊断，不会自动重放；第一版不提供恢复执行。
- 沿用现有的会话、trace、检查点格式，不迁移桌面历史，运行不写桌面的会话索引。

### 模型配置：共享但只读

`AgentRuntimeOptions.modelDirectory` 把「配置」和「运行数据」分开：

- `auth.json`、`models.json`、`selection.json` 从 `configDir` 读取。
- 模型目录缓存写进独立的 `cacheDir`；源目录里已有的 `models-store.json` 会复制一份过去，离线也能用。
- `readOnlyConfig` 禁止修改模型定义、默认选择以及手动登录 / 登出，`rememberLastUsed` 不落盘。Runner 不改变桌面的默认模型。
- 自动 OAuth 刷新仍走 Pi 原有的带锁凭据存储，可以更新 `configDir/auth.json`。refresh token 不会被复制，避免产生失效的凭据副本。
- Headless 关闭启动时的远程模型目录刷新。
- 配置目录不存在时 Pi 会补一个空的 `auth.json`（`{}`）；`models.json`、`selection.json` 不会被创建。

### 不继承的内容

CLI 只复用模型配置，不隐式继承桌面的权限设置、MCP、插件密钥、网页工具密钥、全局记忆、自定义指令（`selection.json` 里的 `instructions`）或桌面专用 Skill。这些都读自每次运行独立的 `agent/` 目录，因此默认是空的。项目里的资源与通用 Skill 仍按现有规则加载：工作目录的 `AGENTS.md` / `CLAUDE.md`、项目 Skill、`~/.agents/skills`。

另外，Headless 会话使用准确的宿主身份提示（没有桌面窗口，也没人回答问题），关闭 Intelligent UI、微应用、运行视图待办与推荐操作，并且只给长期记忆的读权限。这通过通用的「后台执行」标记（`backgroundExecution`）实现，不冒充定时任务或赛马赛道。

## 在 Node 里调用

```ts
import { runHeadless } from "@vela/runner";

const result = await runHeadless(
  { cwd, prompt: "修复测试并验证", dataDir, configDir, sandboxMode: "full", timeoutMs: 10 * 60_000 },
  { signal, onEvent: (event) => { /* 与 JSONL 相同的事件；返回 Promise 可施加背压 */ } },
);
```

请求无效（空任务、目录不存在、超时非法等）时抛出 `HeadlessRequestError`，此时没有运行目录，也没有 `run_result`；其余情形都以结果返回，且恰好发出一条 `run_result`。

## 与桌面共用的运行环境

`createRuntimeHost`（`packages/runner/src/runtime-host.ts`）把原来只能由桌面启动代码使用的组装逻辑抽了出来：沙箱化的 `bash` / `edit` / `write`、后台命令管理器、MCP / 浏览器 / 记忆 / 网页的权限适配、`runtime.evaluateSandboxRisk` 风险判断，以及幂等的释放逻辑（先关闭 Runtime，再有界地等后台命令退出）。浏览器、加密凭据、工作区目录、定时任务和 Resident 工具仍由桌面显式注入。

依赖方向：

```text
桌面 Electron 宿主 ─┐
                   ├─ @vela/runner ─ @vela/agent ─ Pi SDK
Node CLI ──────────┘              └─ @vela/workspace
```

`packages/runner` 不导入 `apps/desktop`、Electron 或渲染层代码（测试里有断言）。桌面的 `SessionHost.dispose()` 只释放自己的订阅、节流和事件传输；Runtime 归 `RuntimeHost` 所有，退出时先停业务入口与订阅，再关闭 `RuntimeHost`，最后等调度服务收尾。

工具调用计数现在由 Runtime 在工具真正开始执行时记录（根会话口径），不再由 `SessionHost` 统计，因此没有桌面也不会漏计。

## 实现位置

- `packages/runner/src/headless-runner.ts` 的 `runHeadless`：请求校验、运行目录、终态仲裁、事件投递、收尾。
- `packages/runner/src/runtime-host.ts` 的 `createRuntimeHost`。
- `packages/runner/src/run-record.ts`：运行目录与 `run.json`；`event-view.ts`：事件视图与脱敏。
- `packages/agent/src/runtime.ts` 的 `createRunConversation`、`waitForIdle`、`getRunReport`、`persistStrict`，以及幂等的 `dispose`。
- `packages/agent/src/model-directory.ts` 的 `ModelDirectoryOptions`。
- `packages/workspace/src/background-shells.ts` 的 `BackgroundShellManager.drain`。
- `apps/runner/src/`：`args.ts`（参数）、`main.ts`（流程与退出码）、`output.ts`（背压写入）、`cli.ts`（入口与信号）；`apps/runner/build.mjs`（esbuild）。

## 验证

- `packages/agent/test/runtime-idle.test.ts`：后台会话入口、`waitForIdle`（后台命令、通知排队与投递空窗、取消）、计数、`dispose` 幂等、初始化中关闭、严格落盘。
- `packages/agent/test/model-directory-isolation.test.ts`：配置只读、缓存隔离、OAuth 刷新写回源 `auth.json`。
- `packages/runner/test/runtime-host.test.ts`：权限接线、计数、幂等关闭、包边界。
- `packages/runner/test/headless-runner.test.ts`：本地假模型 HTTP 服务上的端到端：正常、Plan、失败、审批、提问、子代理与后台命令、超时、取消、并行。
- `apps/runner/test/cli.test.ts`：参数、stdin、JSONL、背压、退出码、信号、EPIPE，以及对构建产物的进程级检查。

```bash
pnpm test:runner
```

测试使用本地假模型与临时目录，不调用真实模型，也不依赖桌面登录。

## 已知限制

- 单次执行：没有恢复、重试或会话续接。
- `smart` 的风险判断会向所选模型多发请求。
- 工具调用计数和用量按根会话统计，子代理的 token 在结果里单独列出。
- 构建产物依赖仓库的 `node_modules`（Pi SDK 等不被打包）。
- 未用真实的模型提供商验证；上面的测试都走本地假模型。
