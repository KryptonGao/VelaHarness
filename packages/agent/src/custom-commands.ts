import {
  hasCommandArgumentsPlaceholder,
  type CustomCommand,
  type CustomCommandCatalog,
  type CustomCommandDiagnostic,
  type CustomCommandOrigin,
} from "@vela/shared";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const maxCommandFileBytes = 512 * 1024;
const maxDescriptionLength = 100;
const frontmatterLinePattern = /^(?:[A-Za-z0-9_-]+\s*:|[ \t]+|#)/;

export interface ParsedCommandMarkdown {
  description: string;
  argumentHint?: string;
  content: string;
}

export interface LoadCustomCommandsOptions {
  cwd: string;
  agentDir: string;
  hasWorkspace?: boolean;
}

function unquoteYamlValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === "\"" || quote === "'") && trimmed[trimmed.length - 1] === quote) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function fallbackDescription(content: string): string {
  for (const rawLine of content.split("\n")) {
    const cleaned = rawLine.trim().replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    return cleaned.length > maxDescriptionLength
      ? `${cleaned.slice(0, maxDescriptionLength - 1)}…`
      : cleaned;
  }
  return "";
}

/**
 * 解析 `.vela/commands/*.md`：
 * - 支持可选 YAML frontmatter（`description`、`argument-hint`）
 * - 只有头部 block 每行都符合 YAML `key: value` 形状时才按 frontmatter 剥离，避免误伤正文的 Markdown 分隔线 `---`。
 */
export function parseCommandMarkdown(raw: string): ParsedCommandMarkdown {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let body = normalized;
  let description = "";
  let argumentHint = "";

  if (normalized.startsWith("---\n")) {
    const closeIndex = normalized.indexOf("\n---", 4);
    if (closeIndex !== -1) {
      const afterClose = normalized.slice(closeIndex + 4);
      if (afterClose === "" || afterClose.startsWith("\n")) {
        const block = normalized.slice(4, closeIndex);
        const lines = block.split("\n");
        const looksLikeFrontmatter = lines.every((line) => !line.trim() || frontmatterLinePattern.test(line));
        if (looksLikeFrontmatter) {
          for (const line of lines) {
            const colonIndex = line.indexOf(":");
            if (colonIndex <= 0) continue;
            const key = line.slice(0, colonIndex).trim().toLowerCase();
            const value = unquoteYamlValue(line.slice(colonIndex + 1));
            if (key === "description" && value) description = value;
            if ((key === "argument-hint" || key === "argumenthint") && value) argumentHint = value;
          }
          body = afterClose.replace(/^\n+/, "");
        }
      }
    }
  }

  const content = body.trim();
  return {
    description: description || fallbackDescription(content),
    ...(argumentHint ? { argumentHint } : {}),
    content,
  };
}

function isValidCommandName(name: string): boolean {
  if (!name) return false;
  if (name.startsWith("skill:")) return false;
  return !/[\s/\\]/.test(name);
}

function scanCommandDirectory(
  directory: string,
  origin: CustomCommandOrigin,
  commands: Map<string, CustomCommand>,
  diagnostics: CustomCommandDiagnostic[],
): void {
  if (!existsSync(directory)) return;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    diagnostics.push({
      type: "warning",
      message: error instanceof Error ? error.message : String(error),
      path: directory,
    });
    return;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    const fullPath = join(directory, entry.name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch (error) {
      diagnostics.push({
        type: "warning",
        message: error instanceof Error ? error.message : String(error),
        path: fullPath,
      });
      continue;
    }
    if (!stats.isFile()) continue;
    if (stats.size > maxCommandFileBytes) {
      diagnostics.push({
        type: "warning",
        message: `Command file exceeds ${maxCommandFileBytes} bytes`,
        path: fullPath,
      });
      continue;
    }

    const name = entry.name.slice(0, -3);
    if (!isValidCommandName(name)) {
      diagnostics.push({
        type: "warning",
        message: `Invalid command filename: ${entry.name}`,
        path: fullPath,
      });
      continue;
    }

    let raw;
    try {
      raw = readFileSync(fullPath, "utf8");
    } catch (error) {
      diagnostics.push({
        type: "warning",
        message: error instanceof Error ? error.message : String(error),
        path: fullPath,
      });
      continue;
    }

    const parsed = parseCommandMarkdown(raw);
    if (!parsed.content) {
      diagnostics.push({
        type: "warning",
        message: `Command file is empty: ${entry.name}`,
        path: fullPath,
      });
      continue;
    }

    commands.set(name, {
      name,
      description: parsed.description || `/${name}`,
      ...(parsed.argumentHint ? { argumentHint: parsed.argumentHint } : {}),
      content: parsed.content,
      location: fullPath,
      origin,
      acceptsArguments: hasCommandArgumentsPlaceholder(parsed.content),
    });
  }
}

/**
 * 扫描 `<agentDir>/commands/*.md`（user）与 `<cwd>/.vela/commands/*.md`（project）。
 * 同名命令由 project 覆盖 user；未选定工作区（`hasWorkspace === false`）时只加载 user 目录。
 */
export function loadCustomCommands(options: LoadCustomCommandsOptions): CustomCommandCatalog {
  const userDir = join(options.agentDir, "commands");
  const diagnostics: CustomCommandDiagnostic[] = [];
  const byName = new Map<string, CustomCommand>();

  scanCommandDirectory(userDir, "user", byName, diagnostics);
  if (options.hasWorkspace !== false) {
    scanCommandDirectory(join(options.cwd, ".vela", "commands"), "project", byName, diagnostics);
  }

  const commands = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  return {
    commandsDir: userDir,
    commands,
    diagnostics,
  };
}
