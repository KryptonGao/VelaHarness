/** bash 命令的语义归类:模型常用 ls / cat / grep 获取信息,界面上显示成「列出目录」「读取文件」「搜索」。 */
export type BashIntentKind = "list" | "read" | "search" | "find" | "script";

export interface BashIntent {
  kind: BashIntentKind;
  /** 目录或文件;读取多个文件时是全部文件,列目录/搜索/查找没写路径时为空(即当前目录)。 */
  targets: string[];
  /** 搜索词或文件名模式;list / read 没有。 */
  query?: string;
  /** script:解释器名称,如 Python。脚本文件在 targets 里,内联脚本的首行有效代码在 query 里。 */
  language?: string;
}

/** 一条命令里串了多段(`;`、`&&`)时,归类取第一段有意义的命令,more 是其余同样可归类的段数。 */
export interface BashIntent {
  more?: number;
}

const listCommands = new Set(["ls", "ll", "la", "dir", "tree", "eza", "exa", "lsd"]);
const readCommands = new Set(["cat", "head", "tail", "less", "more", "bat", "nl", "tac"]);
const searchCommands = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"]);

/** 管道后面只做截断/排序/计数的命令:不改变前一条命令的含义。 */
const passThroughCommands = new Set(["head", "tail", "sort", "uniq", "wc", "cut", "tr", "nl", "less", "more", "column"]);

/** 带独立取值的选项:取值不是路径也不是搜索词。 */
const valueOptions: Record<string, Set<string>> = {
  ls: new Set(["-I", "--ignore", "-w", "--width", "--color", "--sort", "--time", "--format"]),
  tree: new Set(["-L", "-P", "-I", "--charset", "--filelimit"]),
  head: new Set(["-n", "-c", "--lines", "--bytes"]),
  tail: new Set(["-n", "-c", "--lines", "--bytes"]),
  grep: new Set(["-A", "-B", "-C", "-m", "-d", "--include", "--exclude", "--exclude-dir", "--max-count", "--color", "--label"]),
  rg: new Set(["-A", "-B", "-C", "-m", "-g", "--glob", "-t", "-T", "--type", "--type-not", "--max-count", "--max-depth", "-j", "--threads", "--color", "--sort", "--iglob"]),
  bat: new Set(["-r", "--line-range", "-l", "--language", "--theme", "--style", "--color"]),
};
valueOptions.egrep = valueOptions.grep!;
valueOptions.fgrep = valueOptions.grep!;
valueOptions.ag = valueOptions.rg!;
valueOptions.ack = valueOptions.rg!;
valueOptions.eza = valueOptions.ls!;
valueOptions.exa = valueOptions.ls!;
valueOptions.lsd = valueOptions.ls!;

/** 明确给出搜索词的选项(此时第一个位置参数是路径,不是搜索词)。 */
const patternOptions = new Set(["-e", "--regexp", "-f", "--file"]);

const findQueryOptions = new Set(["-name", "-iname", "-path", "-ipath", "-regex", "-iregex", "-wholename"]);
/** find 带这些参数就不是纯查找,保持原样显示。 */
const findMutating = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprintf", "-fls"]);

/** 只打印、不读也不改文件系统的命令:出现在 `;` / `&&` 串联里时直接忽略,如 `ls; echo ---`。 */
const harmlessCommands = new Set(["echo", "printf", "pwd", "true"]);

/**
 * 把一条 bash 命令归类为列目录、读文件、搜索或查找文件。
 * 只认只读命令:可带 head/sort 之类的管道尾巴,可用 `;`、`&&` 串联(echo、cd 之类不影响含义);
 * 含重定向、`||`、子 shell 或任何无法确定含义的命令一律返回 null,界面照常显示原命令。
 */
export function describeBashCommand(command: string | undefined): BashIntent | null {
  // 合并 stderr 不改变含义,先去掉,免得被当作后台运行符 &。
  const stripped = command?.replace(/\s2>&1(?=\s|\||$)/g, "").trim();
  if (!stripped) return null;
  const extracted = extractHeredoc(stripped);
  if (!extracted) return null;
  const { text, body } = extracted;
  const segments = splitSequence(text);
  if (!segments) return null;
  const intents: BashIntent[] = [];
  let cwd: string | undefined;
  for (const segment of segments) {
    const stages = splitPipeline(segment);
    if (!stages) return null;
    const head = tokenize(stages[0]!);
    if (!head || head.length === 0) return null;
    const name = basename(head[0]!);
    if (stages.length === 1 && name === "cd" && head.length === 2) {
      cwd = head[1];
      continue;
    }
    if (stages.length === 1 && harmlessCommands.has(name)) continue;
    for (const stage of stages.slice(1)) {
      const tokens = tokenize(stage);
      if (!tokens?.length || !passThroughCommands.has(basename(tokens[0]!))) return null;
    }
    const intent = classify(head, body);
    if (!intent) return null;
    intents.push(cwd && intent.kind !== "script" && intent.targets.length === 0 ? { ...intent, targets: [cwd] } : intent);
  }
  const [first, ...rest] = intents;
  if (!first) return null;
  return rest.length > 0 ? { ...first, more: rest.length } : first;
}

/** 按 `;`、`&&`、换行切成顺序执行的几段;引号内不切。`||` 和单个 `&` 留给后面的检查拒绝。 */
function splitSequence(text: string): string[] | null {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"') current += text[++index] ?? "";
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
    } else if (char === "\\") {
      current += char + (text[++index] ?? "");
    } else if (char === ";" || char === "\n") {
      segments.push(current);
      current = "";
    } else if (char === "&" && text[index + 1] === "&") {
      segments.push(current);
      current = "";
      index++;
    } else {
      current += char;
    }
  }
  if (quote) return null;
  segments.push(current);
  const kept = segments.map((segment) => segment.trim()).filter(Boolean);
  return kept.length > 0 ? kept : null;
}

function classify(tokens: string[], heredoc?: string): BashIntent | null {
  const name = basename(tokens[0]!);
  const args = tokens.slice(1);
  if (listCommands.has(name)) return { kind: "list", targets: positionals(name, args).slice(0, 1) };
  if (readCommands.has(name)) {
    const files = positionals(name, args);
    // head/tail 没有文件参数时读的是标准输入,含义不明。
    return files.length > 0 ? { kind: "read", targets: files } : null;
  }
  if (name === "sed") return classifySed(args);
  if (searchCommands.has(name)) return classifySearch(name, args);
  if (name === "find") return classifyFind(args);
  const language = scriptLanguage(name);
  if (language) return classifyScript(language, args, heredoc);
  if (name === "fd" || name === "fdfind") {
    const [query, ...paths] = positionals(name, args);
    return { kind: "find", targets: paths.slice(0, 1), ...(query ? { query } : {}) };
  }
  return null;
}

/** 解释器 → 显示名;python3.12 之类带版本号的也算。 */
function scriptLanguage(name: string): string | null {
  if (/^python[\d.]*$/.test(name)) return "Python";
  if (name === "node" || name === "nodejs") return "Node";
  if (name === "ruby") return "Ruby";
  if (name === "perl") return "Perl";
  if (name === "bash" || name === "sh" || name === "zsh") return "Shell";
  return null;
}

/** 内联代码的 flag:python -c、node -e/-p、ruby/perl -e。 */
const inlineCodeFlags = new Set(["-c", "-e", "-p"]);

/**
 * 解释器跑脚本:heredoc(`python3 - <<'EOF'`)、`-c/-e` 内联代码或脚本文件。
 * `python -m pytest`、不带脚本的交互解释器等无法说明在做什么,返回 null。
 */
function classifyScript(language: string, args: string[], heredoc: string | undefined): BashIntent | null {
  const shell = language === "Shell";
  let file: string | undefined;
  let inline: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "-m" || arg === "--version" || arg === "-V") return null;
    if (inlineCodeFlags.has(arg) && !(shell && arg !== "-c")) {
      // bash -c 里是整条命令,不是脚本,保持原样。
      if (shell) return null;
      inline = args[index + 1];
      break;
    }
    if (arg === "-") continue;
    if (arg.startsWith("-")) continue;
    file = arg;
    break;
  }
  if (file) return { kind: "script", language, targets: [file] };
  const code = inline ?? heredoc;
  if (code === undefined) return null;
  const snippet = firstCodeLine(code);
  return { kind: "script", language, targets: [], ...(snippet ? { query: snippet } : {}) };
}

/** 脚本里第一行有实际内容的代码:跳过空行、注释和 import。 */
function firstCodeLine(code: string): string {
  for (const raw of code.split("\n")) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line || /^(#|\/\/)/.test(line) || /^(import|from)\s/.test(line)) continue;
    return line.length > 160 ? `${line.slice(0, 160)}…` : line;
  }
  return "";
}

/**
 * 摘掉第一个 heredoc(`<<'EOF' … EOF`),返回剩下的命令和 heredoc 正文。
 * 没有 heredoc 时原样返回;写了 heredoc 却没有结束行,说明命令不完整,返回 null。
 */
function extractHeredoc(text: string): { text: string; body?: string } | null {
  const marker = /<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(text);
  if (!marker) return { text };
  const lineEnd = text.indexOf("\n", marker.index + marker[0].length);
  if (lineEnd < 0) return null;
  const indent = marker[1] === "-";
  const delimiter = marker[3]!;
  let cursor = lineEnd + 1;
  const bodyLines: string[] = [];
  while (cursor <= text.length) {
    const next = text.indexOf("\n", cursor);
    const end = next < 0 ? text.length : next;
    const line = text.slice(cursor, end);
    if ((indent ? line.trim() : line) === delimiter) {
      const rest = text.slice(0, marker.index) + text.slice(marker.index + marker[0].length, lineEnd) + text.slice(end);
      return { text: rest.trim(), body: bodyLines.join("\n") };
    }
    bodyLines.push(line);
    if (next < 0) break;
    cursor = next + 1;
  }
  return null;
}

/** 只认 `sed -n 'A,Bp' file`:纯粹按行号读取。 */
function classifySed(args: string[]): BashIntent | null {
  if (!args.includes("-n") || args.some((arg) => arg === "-i" || arg.startsWith("-i") || arg === "--in-place")) return null;
  const rest = args.filter((arg) => arg !== "-n");
  const [script, ...files] = rest;
  if (!script || !/^\d*(,\d+|,\$)?p$/.test(script) || files.length === 0) return null;
  return { kind: "read", targets: files };
}

function classifySearch(name: string, args: string[]): BashIntent | null {
  const withValues = valueOptions[name] ?? new Set<string>();
  const positional: string[] = [];
  const patterns: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (patternOptions.has(arg)) {
      const value = args[++index];
      if (value && arg !== "-f" && arg !== "--file") patterns.push(value);
      continue;
    }
    if (arg.startsWith("--regexp=")) {
      patterns.push(arg.slice("--regexp=".length));
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      if (withValues.has(arg)) index++;
      continue;
    }
    positional.push(arg);
  }
  // `grep -e foo a b`:搜索词已给,位置参数全是路径;否则第一个位置参数是搜索词。
  const query = patterns.length > 0 ? patterns.join(" | ") : positional.shift();
  if (!query) return null;
  return { kind: "search", targets: positional, query };
}

function classifyFind(args: string[]): BashIntent | null {
  if (args.some((arg) => findMutating.has(arg))) return null;
  const targets: string[] = [];
  let index = 0;
  // 路径在表达式之前:到第一个以 - ( ! 开头的参数为止。
  while (index < args.length && !/^[-(!]/.test(args[index]!)) targets.push(args[index++]!);
  let query: string | undefined;
  for (; index < args.length; index++) {
    if (findQueryOptions.has(args[index]!) && args[index + 1]) {
      query = args[index + 1];
      break;
    }
  }
  return { kind: "find", targets: targets.slice(0, 1), ...(query ? { query } : {}) };
}

/** 去掉选项后的位置参数;head/tail 等带取值的选项会连同取值一起跳过。head -20 这种数字选项当作普通选项。 */
function positionals(name: string, args: string[]): string[] {
  const withValues = valueOptions[name] ?? new Set<string>();
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      result.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      if (withValues.has(arg)) index++;
      continue;
    }
    result.push(arg);
  }
  return result;
}

function basename(command: string): string {
  const index = command.lastIndexOf("/");
  return index >= 0 ? command.slice(index + 1) : command;
}

/** 按 `|` 切管道。引号内的 `|` 不切;出现重定向、`;`、`&`、反引号、`$(` 等写法返回 null(`2>/dev/null` 例外)。 */
function splitPipeline(text: string): string[] | null {
  const stages: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"') {
        current += text[++index] ?? "";
      } else if (char === quote) {
        quote = null;
      } else if (quote === '"' && (char === "`" || (char === "$" && text[index + 1] === "("))) {
        return null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "\\") {
      current += char + (text[++index] ?? "");
      continue;
    }
    if (char === "|") {
      if (text[index + 1] === "|") return null;
      stages.push(current);
      current = "";
      continue;
    }
    if (char === ";" || char === "&" || char === "`" || char === "\n" || char === "<") return null;
    if (char === "$" && text[index + 1] === "(") return null;
    if (char === ">") {
      const rest = text.slice(index);
      const discard = /^>\s*\/dev\/null/.exec(rest);
      // 允许丢弃 stderr(2>/dev/null、2>&1);其余重定向会写文件。
      if (discard && /2$/.test(current.trimEnd())) {
        current = current.trimEnd().slice(0, -1);
        index += discard[0].length - 1;
        continue;
      }
      return null;
    }
    current += char;
  }
  if (quote) return null;
  stages.push(current);
  return stages.every((stage) => stage.trim()) ? stages : null;
}

/** 简化的 shell 分词:支持单双引号和反斜杠转义,不展开变量。 */
function tokenize(text: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < text.length) current += text[++index];
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === "\\" && index + 1 < text.length) {
      current += text[++index];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) tokens.push(current);
  return tokens;
}
