import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { appLocales, isAppLocale, thinkingLevels, type AppLocale, type SandboxMode, type ThinkingLevel } from "@vela/shared";

export type OutputFormat = "text" | "jsonl";

export interface RunOptions {
  cwd: string;
  /** 位置参数里的提示词；与 promptFile 互斥。 */
  prompt: string | null;
  /** 文件路径，或 "-" 表示 stdin。 */
  promptFile: string | null;
  dataDir: string;
  configDir: string;
  model: { provider: string; id: string } | null;
  thinkingLevel: ThinkingLevel | null;
  mode: "agent" | "plan";
  sandboxMode: SandboxMode;
  format: OutputFormat;
  timeoutMs: number | null;
  locale: AppLocale | null;
}

export type ParsedCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "run"; options: RunOptions };

/** 参数或配置层面的错误：退出码 2。 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const defaultDataDirName = ".vela-runner";

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) throw new UsageError(`--${name} 必须是 ${allowed.join(" | ")} 之一，收到 "${value}"`);
  return value as T;
}

export interface ParseEnvironment {
  cwd: string;
  home?: string;
  /** pnpm 记录的发起目录；`pnpm runner run` 时进程 cwd 是仓库根，不是用户所在目录。 */
  initCwd?: string;
}

export function parseCommand(argv: readonly string[], env: ParseEnvironment): ParsedCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        cwd: { type: "string" },
        "prompt-file": { type: "string" },
        "data-dir": { type: "string" },
        "config-dir": { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        thinking: { type: "string" },
        mode: { type: "string" },
        sandbox: { type: "string" },
        format: { type: "string" },
        timeout: { type: "string" },
        locale: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const [command, ...rest] = positionals;
  if (command === undefined) throw new UsageError("缺少子命令。用法：vela-runner run [选项] <任务>，或 --help");
  if (command === "help") return { kind: "help" };
  if (command !== "run") throw new UsageError(`未知子命令 "${command}"。目前只支持 run`);
  if (rest.length > 1) throw new UsageError("任务内容请作为一个参数传入（带引号），或使用 --prompt-file");
  const prompt = rest[0] ?? null;
  const promptFile = values["prompt-file"] ?? null;
  if (prompt !== null && promptFile !== null) throw new UsageError("位置参数里的任务与 --prompt-file 互斥");
  if (prompt === null && promptFile === null) throw new UsageError("缺少任务内容：传入一个任务参数，或使用 --prompt-file <路径|->");

  if ((values.provider === undefined) !== (values.model === undefined)) throw new UsageError("--provider 与 --model 必须同时提供");
  const home = env.home ?? homedir();
  const dataDir = resolve(expandHome(values["data-dir"] ?? join(home, defaultDataDirName), home));
  const configDir = resolve(expandHome(values["config-dir"] ?? join(dataDir, "config"), home));
  const baseCwd = env.initCwd ?? env.cwd;
  const cwd = resolve(baseCwd, expandHome(values.cwd ?? ".", home));

  let timeoutMs: number | null = null;
  if (values.timeout !== undefined) {
    const seconds = Number(values.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > 2 ** 31 - 1) throw new UsageError("--timeout 必须是正的秒数");
    timeoutMs = Math.round(seconds * 1000);
  }
  let locale: AppLocale | null = null;
  if (values.locale !== undefined) {
    if (!isAppLocale(values.locale)) throw new UsageError(`--locale 必须是 ${appLocales.join(" | ")} 之一`);
    locale = values.locale;
  }

  return {
    kind: "run",
    options: {
      cwd,
      prompt,
      promptFile: promptFile === null || promptFile === "-" ? promptFile : resolve(baseCwd, expandHome(promptFile, home)),
      dataDir,
      configDir,
      model: values.provider !== undefined && values.model !== undefined ? { provider: values.provider, id: values.model } : null,
      thinkingLevel: values.thinking === undefined ? null : oneOf("thinking", values.thinking, thinkingLevels),
      mode: values.mode === undefined ? "agent" : oneOf("mode", values.mode, ["agent", "plan"] as const),
      sandboxMode: values.sandbox === undefined ? "ask" : oneOf("sandbox", values.sandbox, ["ask", "smart", "full"] as const),
      format: values.format === undefined ? "text" : oneOf("format", values.format, ["text", "jsonl"] as const),
      timeoutMs,
      locale,
    },
  };
}

export const helpText = `vela-runner — 无界面的单次 Vela 任务（脚本 / CI 用）

用法
  vela-runner run [选项] <任务>
  vela-runner run [选项] --prompt-file <路径|->

选项
  --cwd <目录>             工作目录（默认当前目录；通过 pnpm runner 启动时为发起目录）
  --prompt-file <路径|->   从文件或 stdin（-）读取任务；与位置参数互斥
  --data-dir <目录>        运行数据根目录，每次运行在 runs/<runId> 下（默认 ~/.vela-runner）
  --config-dir <目录>      模型配置目录（默认 <data-dir>/config）；不会自动探测桌面账号，
                           要复用桌面登录请显式传入桌面资料目录，例如 ~/.vela
  --provider <id>          模型提供方；必须与 --model 同时提供
  --model <id>             模型 id；省略时按配置目录里的默认选择
  --thinking <级别>        ${thinkingLevels.join(" | ")}；所选模型不支持时报错，不静默收敛
  --mode <agent|plan>      agent（默认）或 plan（输出计划，不执行）
  --sandbox <ask|smart|full>
                           ask（默认）：需要批准的操作立即阻塞退出；smart：先由模型判断，
                           拿不准同样阻塞；full：不再询问。注意这不是操作系统级沙箱
  --format <text|jsonl>    text（默认）：stdout 只输出最终回复；jsonl：每行一个事件
  --timeout <秒>           整体超时（默认 1800）
  --locale <语言>          ${appLocales.join(" | ")}；模型默认写作语言（默认 en）
  -h, --help               显示帮助
  -v, --version            显示版本

退出码
  0 正常结束   1 执行失败   2 参数或配置错误   3 需要人工交互（审批 / 提问）
  124 超时     130 SIGINT   143 SIGTERM
`;
