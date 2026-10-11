/**
 * 从 bash 命令和输出里识别「验证」：测试、构建、类型检查、lint。
 * 交接包和成果验收面板共用；只看命令文本，不猜测脚本里做了什么。
 */
import type { HandoffVerificationCategory } from "./handoff";

const packageManagers = new Set(["pnpm", "npm", "yarn", "bun"]);
const valueFlags = new Set(["--filter", "-F", "--dir", "-C", "--prefix", "-w", "--workspace", "--cwd"]);

/** `pnpm --filter x run test:ui` 这类调用实际执行的脚本名；不是包管理器脚本调用时返回 null。 */
function packageScript(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/);
  if (!packageManagers.has(tokens[0] ?? "")) return null;
  let index = 1;
  while (index < tokens.length && tokens[index]!.startsWith("-")) index += valueFlags.has(tokens[index]!) ? 2 : 1;
  if (tokens[index] === "run" || tokens[index] === "run-script") index += 1;
  while (index < tokens.length && tokens[index]!.startsWith("-")) index += 1;
  return tokens[index] ?? null;
}

/** 命令是否是测试、构建、类型检查或 lint；不是时返回 null。 */
export function classifyVerification(command: string): HandoffVerificationCategory | null {
  const text = command.toLowerCase();
  for (const segment of text.split(/&&|\|\||;|\n|\|/)) {
    const script = packageScript(segment);
    if (!script) continue;
    const name = /^(?:[\w.-]+:)?(test|typecheck|lint|build|package)(?::[\w.:-]*)?$/.exec(script)?.[1];
    if (name === "test") return "test";
    if (name === "typecheck") return "typecheck";
    if (name === "lint") return "lint";
    if (name === "build" || name === "package") return "build";
  }
  if (/\b(?:vitest|jest|mocha|pytest|rspec|phpunit)\b|\bnode\b[^\n]*--test\b|\b(?:go|cargo|dotnet|swift|mvn|gradle)\s+test\b|\bplaywright\s+test\b|\bctest\b/.test(text)) return "test";
  if (/\btsc\b|\bmypy\b|\bpyright\b|\bcargo\s+check\b|\bgo\s+vet\b/.test(text)) return "typecheck";
  if (/\beslint\b|\bbiome\s+(?:check|lint)\b|\bruff\b|\bclippy\b|\bswiftlint\b/.test(text)) return "lint";
  if (/\b(?:cargo|go|dotnet|swift|mvn|gradle|make)\s+build\b|\bvite\s+build\b|\bwebpack\b|\bxcodebuild\b|\belectron-builder\b/.test(text)) return "build";
  return null;
}

/** Pi 的 bash 工具把退出码写在输出末尾；超时和中止没有退出码。 */
export function parseExitCode(body: string): number | undefined {
  const match = /Command exited with code (-?\d+)\s*$/.exec(body.trimEnd());
  return match ? Number(match[1]) : undefined;
}
