export const customCommandOrigins = ["project", "user"] as const;

export type CustomCommandOrigin = (typeof customCommandOrigins)[number];

export interface CustomCommand {
  /** 命令名称（不含前导 `/`），来自 `.md` 文件名。 */
  name: string;
  /** 菜单里的简短说明：优先取 frontmatter `description`，否则取正文首行。 */
  description: string;
  /** 可选参数提示（来自 frontmatter `argument-hint`）。 */
  argumentHint?: string;
  /** 去掉 frontmatter 后的 Markdown 正文模板。 */
  content: string;
  /** `.md` 文件的绝对路径。 */
  location: string;
  origin: CustomCommandOrigin;
  /** 正文是否包含 `$ARGUMENTS` 或 `${ARGUMENTS:-...}` 占位符。 */
  acceptsArguments: boolean;
}

export interface CustomCommandDiagnostic {
  type: "warning" | "error";
  message: string;
  path: string | null;
}

export interface CustomCommandCatalog {
  /** 用户级自定义命令目录，即 `<agentDir>/commands`。 */
  commandsDir: string;
  commands: CustomCommand[];
  diagnostics: CustomCommandDiagnostic[];
}

const argumentsTokenPattern = /\$\{ARGUMENTS:-([^}]*)\}|\$ARGUMENTS(?![A-Za-z0-9_])/g;
const argumentsDetectPattern = /\$\{ARGUMENTS:-[^}]*\}|\$ARGUMENTS(?![A-Za-z0-9_])/;

/** 模板正文中是否声明了 `$ARGUMENTS` 占位符。 */
export function hasCommandArgumentsPlaceholder(template: string): boolean {
  return argumentsDetectPattern.test(template);
}

/**
 * 展开 `.vela/commands/*.md` 模板：
 * - 有 `$ARGUMENTS` / `${ARGUMENTS:-default}` 时原地替换（传入函数避免 `$` 转义和递归展开）。
 * - 没有占位符但用户附带了参数时，把参数追加在正文之后。
 */
export function expandCustomCommand(template: string, rawArgs: string): string {
  const args = rawArgs.trim();
  const body = template.trim();
  if (!body) return args;
  if (!hasCommandArgumentsPlaceholder(body)) {
    return args ? `${body}\n\n${args}` : body;
  }
  return body
    .replace(argumentsTokenPattern, (_match, defaultValue?: string) => {
      if (defaultValue !== undefined) return args || defaultValue;
      return args;
    })
    .trim();
}

/** 解析以 `/name` 开头的输入；不是斜线命令形式时返回 null。 */
export function parseSlashInvocation(text: string): { name: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match?.[1]) return null;
  return { name: match[1], args: (match[2] ?? "").trim() };
}
