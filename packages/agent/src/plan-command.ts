/**
 * Plan 模式与查阅子代理的 bash 只读守卫。
 *
 * 不再用正则猜命令文本，而是按 shell 规则分词：遇到命令替换、变量展开、子 shell、
 * 后台执行或写文件的重定向就直接拒绝；拆出每条简单命令的 argv 后，命令名必须在允许名单里，
 * 参数再按该命令的规则检查（例如 find 不能带 -delete/-exec，sort 不能带 -o）。
 * 拿不准的写法一律拒绝：误拒只会让模型换个写法，误放会改动用户的文件。
 */

interface Word {
  value: string;
  /** 含未加引号的 * ? [，执行时可能被 shell 展开成别的参数。 */
  glob: boolean;
}

type Token = { kind: "word"; word: Word } | { kind: "separator" } | { kind: "redirect"; op: string };

/** Plan 模式下只放行查阅命令。按 ; && || | 和换行拆开后，每一条命令都要通过检查。 */
export function isPlanSafeCommand(command: string): boolean {
  const tokens = tokenize(command);
  if (!tokens) return false;
  const commands = splitCommands(tokens);
  if (!commands || commands.length === 0) return false;
  return commands.every((words) => isSafeSimpleCommand(words));
}

// ---------------------------------------------------------------------------
// 分词

const expansionStart = /[A-Za-z0-9_@*#?$!{(\['"-]/;

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let value = "";
  let inWord = false;
  let quoted = false;
  let glob = false;
  let brace = false;

  const endWord = (): boolean => {
    if (!inWord) return true;
    // 花括号展开（{a,b}、{1..3}）会生成新参数，例如 -{delete,}。
    if (brace && (value.includes(",") || value.includes(".."))) return false;
    tokens.push({ kind: "word", word: { value, glob } });
    value = "";
    inWord = false;
    quoted = false;
    glob = false;
    brace = false;
    return true;
  };

  let i = 0;
  while (i < input.length) {
    const char = input[i]!;
    const next = input[i + 1];

    if (char === " " || char === "\t") {
      if (!endWord()) return null;
      i += 1;
      continue;
    }
    if (char === "\n") {
      if (!endWord()) return null;
      tokens.push({ kind: "separator" });
      i += 1;
      continue;
    }
    if (char === "\\") {
      if (next === undefined) return null;
      if (next !== "\n") {
        value += next;
        inWord = true;
        quoted = true;
      }
      i += 2;
      continue;
    }
    if (char === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) return null;
      value += input.slice(i + 1, end);
      inWord = true;
      quoted = true;
      i = end + 1;
      continue;
    }
    if (char === '"') {
      i += 1;
      let closed = false;
      while (i < input.length) {
        const inner = input[i]!;
        if (inner === '"') {
          closed = true;
          i += 1;
          break;
        }
        if (inner === "`") return null;
        if (inner === "$" && i + 1 < input.length && expansionStart.test(input[i + 1]!) && input[i + 1] !== '"') return null;
        if (inner === "\\" && i + 1 < input.length) {
          const escaped = input[i + 1]!;
          if (escaped === "\n") {
            i += 2;
            continue;
          }
          value += "$`\"\\".includes(escaped) ? escaped : `\\${escaped}`;
          i += 2;
          continue;
        }
        value += inner;
        i += 1;
      }
      if (!closed) return null;
      inWord = true;
      quoted = true;
      continue;
    }
    if (char === "`") return null;
    if (char === "$") {
      // $VAR、${...}、$(...)、$((...))、$'...'、$"..." 都拒绝；单独的 $（如正则里的行尾）按字面保留。
      if (next !== undefined && expansionStart.test(next)) return null;
      value += char;
      inWord = true;
      i += 1;
      continue;
    }
    if (char === "#" && !inWord) {
      while (i < input.length && input[i] !== "\n") i += 1;
      continue;
    }
    if (char === ";") {
      if (!endWord()) return null;
      tokens.push({ kind: "separator" });
      i += 1;
      continue;
    }
    if (char === "|") {
      if (!endWord()) return null;
      tokens.push({ kind: "separator" });
      i += next === "|" || next === "&" ? 2 : 1;
      continue;
    }
    if (char === "&") {
      if (next === "&") {
        if (!endWord()) return null;
        tokens.push({ kind: "separator" });
        i += 2;
        continue;
      }
      if (next === ">") {
        if (!endWord()) return null;
        const append = input[i + 2] === ">";
        tokens.push({ kind: "redirect", op: append ? "&>>" : "&>" });
        i += append ? 3 : 2;
        continue;
      }
      // 单个 & 是后台执行。
      return null;
    }
    if (char === ">") {
      // 紧贴在前面的纯数字是文件描述符，例如 2>&1。
      const fd = inWord && !quoted && /^\d+$/.test(value) ? value : "";
      if (fd) {
        value = "";
        inWord = false;
      } else if (!endWord()) {
        return null;
      }
      let op = ">";
      if (next === ">") op = ">>";
      else if (next === "&") op = ">&";
      else if (next === "|") op = ">|";
      tokens.push({ kind: "redirect", op: `${fd}${op}` });
      i += op.length;
      continue;
    }
    // 输入重定向、here-doc、进程替换、子 shell 与命令组都不放行。
    if (char === "<" || char === "(" || char === ")") return null;
    if (char === "{" || char === "}") brace = true;
    if (char === "*" || char === "?" || char === "[") glob = true;
    value += char;
    inWord = true;
    i += 1;
  }
  if (!endWord()) return null;
  return tokens;
}

/** 把 token 流拆成一条条简单命令；重定向只允许丢弃输出或合并文件描述符。 */
function splitCommands(tokens: Token[]): Word[][] | null {
  const commands: Word[][] = [];
  let current: Word[] = [];
  let pendingRedirect: string | null = null;
  for (const token of tokens) {
    if (pendingRedirect !== null) {
      if (token.kind !== "word" || !redirectTargetAllowed(pendingRedirect, token.word.value)) return null;
      pendingRedirect = null;
      continue;
    }
    if (token.kind === "redirect") {
      pendingRedirect = token.op;
      continue;
    }
    if (token.kind === "separator") {
      if (current.length > 0) commands.push(current);
      current = [];
      continue;
    }
    current.push(token.word);
  }
  if (pendingRedirect !== null) return null;
  if (current.length > 0) commands.push(current);
  return commands;
}

function redirectTargetAllowed(op: string, target: string): boolean {
  if (op.endsWith(">&")) return /^(\d+|-)$/.test(target);
  return target === "/dev/null";
}

// ---------------------------------------------------------------------------
// 参数解析

interface ArgRules {
  /** 带值的短选项；只在值紧贴或下一个参数不像选项时才算作值。 */
  valueShort?: string;
  /** 带值的长选项（--name value 形式）。 */
  valueLong?: string[];
  /** 给出时只允许这些短选项（含 valueShort）。 */
  allowShort?: string;
  /** 给出时只允许这些长选项，精确匹配。 */
  allowLong?: string[];
  /** 出现在短选项簇任意位置即拒绝。 */
  denyShort?: string;
  /** 按 GNU getopt 的缩写规则匹配，--out 也会命中 --output。 */
  denyLong?: string[];
}

interface ParsedArgs {
  options: { name: string; value?: string }[];
  positionals: string[];
}

function looksLikeOption(arg: string): boolean {
  return arg.length > 1 && arg.startsWith("-");
}

function abbreviates(name: string, full: string): boolean {
  return name.length >= 3 && full.startsWith(name);
}

function parseArgs(args: string[], rules: ArgRules): ParsedArgs | null {
  const options: ParsedArgs["options"] = [];
  const positionals: string[] = [];
  const valueShort = rules.valueShort ?? "";
  const allowShort = rules.allowShort === undefined ? null : rules.allowShort + valueShort;
  const takeValue = (index: number): string | undefined => {
    const candidate = args[index + 1];
    return candidate !== undefined && !looksLikeOption(candidate) ? candidate : undefined;
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!looksLikeOption(arg)) {
      positionals.push(arg);
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq < 0 ? arg : arg.slice(0, eq);
      if (rules.denyLong?.some((full) => abbreviates(name, full))) return null;
      if (rules.allowLong && !rules.allowLong.includes(name)) return null;
      let value = eq < 0 ? undefined : arg.slice(eq + 1);
      if (value === undefined && rules.valueLong?.includes(name)) {
        value = takeValue(i);
        if (value !== undefined) i += 1;
      }
      options.push({ name, value });
      continue;
    }
    const cluster = arg.slice(1);
    if (rules.denyShort && [...cluster].some((char) => rules.denyShort!.includes(char))) return null;
    for (let j = 0; j < cluster.length; j += 1) {
      const char = cluster[j]!;
      if (allowShort !== null && !allowShort.includes(char)) return null;
      if (valueShort.includes(char)) {
        let value: string | undefined = cluster.slice(j + 1);
        if (!value) {
          value = takeValue(i);
          if (value !== undefined) i += 1;
        }
        options.push({ name: `-${char}`, value });
        break;
      }
      options.push({ name: `-${char}` });
    }
  }
  return { options, positionals };
}

function hasOption(parsed: ParsedArgs, ...names: string[]): boolean {
  return parsed.options.some((option) => names.includes(option.name));
}

function optionValues(parsed: ParsedArgs, ...names: string[]): (string | undefined)[] {
  return parsed.options.filter((option) => names.includes(option.name)).map((option) => option.value);
}

// ---------------------------------------------------------------------------
// 各命令的规则

type CommandCheck = (args: string[]) => boolean;

/** 没有写文件或执行外部命令能力的命令，参数随意。 */
const anyArgs = new Set([
  "cat", "head", "tail", "grep", "ls", "pwd", "echo", "printf", "wc", "diff", "stat", "du", "df",
  "which", "whereis", "type", "printenv", "uname", "whoami", "id", "date", "cal", "uptime", "ps",
  "top", "free", "jq", "eza", "true", "false",
]);

function withRules(rules: ArgRules, extra?: (parsed: ParsedArgs) => boolean): CommandCheck {
  return (args) => {
    const parsed = parseArgs(args, rules);
    return parsed !== null && (extra ? extra(parsed) : true);
  };
}

const findDenied = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);

const httpUrl = /^https?:\/\//i;

const checks: Record<string, CommandCheck> = {
  find: (args) => !args.some((arg) => findDenied.has(arg)),
  sort: withRules({
    valueShort: "kStTo",
    denyShort: "oT",
    denyLong: ["--output", "--compress-program", "--temporary-directory"],
  }),
  uniq: withRules({ valueShort: "fsw" }, (parsed) => parsed.positionals.length <= 1),
  file: withRules({ denyShort: "C", denyLong: ["--compile"] }),
  tree: withRules({ denyShort: "oR", denyLong: ["--output"] }),
  rg: withRules({ denyLong: ["--pre", "--hostname-bin"] }),
  fd: withRules({ denyShort: "xX", denyLong: ["--exec", "--exec-batch"] }),
  bat: withRules(
    { denyLong: ["--pager", "--generate-config-file"] },
    (parsed) => parsed.positionals[0] !== "cache",
  ),
  env: (args) => args.length === 0,
  node: versionOnly,
  python: versionOnly,
  python3: versionOnly,
  sed: checkSed,
  awk: checkAwk,
  curl: withRules(
    {
      allowShort: "sSLIifvq",
      valueShort: "HAmXeor",
      allowLong: [
        "--silent", "--show-error", "--location", "--head", "--include", "--fail", "--fail-with-body",
        "--verbose", "--compressed", "--globoff", "--http1.1", "--http2", "--header", "--user-agent",
        "--max-time", "--connect-timeout", "--max-redirs", "--request", "--referer", "--range", "--retry",
      ],
      valueLong: [
        "--header", "--user-agent", "--max-time", "--connect-timeout", "--max-redirs", "--request",
        "--referer", "--range", "--retry",
      ],
    },
    (parsed) =>
      optionValues(parsed, "-o").every((value) => value === "-") &&
      optionValues(parsed, "-X", "--request").every((value) => /^(GET|HEAD|OPTIONS)$/i.test(value ?? "")) &&
      parsed.positionals.length > 0 &&
      parsed.positionals.every((url) => httpUrl.test(url)),
  ),
  wget: withRules(
    {
      allowShort: "qSv",
      valueShort: "OT",
      allowLong: ["--quiet", "--server-response", "--header", "--user-agent", "--timeout", "--output-document", "--max-redirect"],
      valueLong: ["--header", "--user-agent", "--timeout", "--output-document", "--max-redirect"],
    },
    (parsed) =>
      optionValues(parsed, "-O", "--output-document").length > 0 &&
      optionValues(parsed, "-O", "--output-document").every((value) => value === "-") &&
      parsed.positionals.length > 0 &&
      parsed.positionals.every((url) => httpUrl.test(url)),
  ),
  git: checkGit,
  npm: subcommandIn(["list", "ls", "view", "info", "search", "outdated", "audit"], (sub, rest) => sub !== "audit" || !rest.includes("fix")),
  yarn: subcommandIn(["list", "info", "why", "audit"]),
  pnpm: subcommandIn(["list", "ls", "view", "why"]),
};

function versionOnly(args: string[]): boolean {
  return args.length === 1 && ["--version", "-v", "-V"].includes(args[0]!);
}

function subcommandIn(allowed: string[], extra?: (sub: string, rest: string[]) => boolean): CommandCheck {
  return (args) => {
    const sub = args[0];
    if (sub === undefined || !allowed.includes(sub)) return false;
    return extra ? extra(sub, args.slice(1)) : true;
  };
}

function isSafeSimpleCommand(words: Word[]): boolean {
  const name = words[0]!.value;
  const args = words.slice(1);
  if (anyArgs.has(name)) return true;
  const check = checks[name];
  if (!check) return false;
  // 通配符可能展开成以 - 开头的文件名，变成选项；带参数规则的命令不接受未加引号的通配符。
  if (args.some((word) => word.glob)) return false;
  return check(args.map((word) => word.value));
}

// ---------------------------------------------------------------------------
// git

const gitDenyOutput: ArgRules = { denyLong: ["--output"] };

const gitSubcommands: Record<string, CommandCheck> = {
  status: () => true,
  "rev-parse": () => true,
  "ls-files": () => true,
  "ls-tree": () => true,
  "ls-remote": withRules({ denyShort: "u", denyLong: ["--upload-pack"] }),
  log: withRules(gitDenyOutput),
  diff: withRules(gitDenyOutput),
  show: withRules(gitDenyOutput),
  branch: withRules(
    {
      allowShort: "arvli",
      allowLong: [
        "--list", "--all", "--remotes", "--verbose", "--show-current", "--ignore-case", "--color", "--no-color",
        "--column", "--no-column", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at",
        "--sort", "--format", "--abbrev", "--no-abbrev",
      ],
      valueLong: ["--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--sort", "--format"],
    },
    // 不带这些选项时，git branch <name> 会新建分支。
    (parsed) =>
      parsed.positionals.length === 0 ||
      hasOption(parsed, "--list", "-l", "-v", "--verbose", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"),
  ),
  remote: withRules(
    { allowShort: "vn", allowLong: ["--verbose", "--push", "--all"] },
    (parsed) => parsed.positionals.length === 0 || ["show", "get-url"].includes(parsed.positionals[0]!),
  ),
  config: withRules(
    {
      allowShort: "lz",
      allowLong: [
        "--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "--global", "--local", "--system",
        "--worktree", "--show-origin", "--show-scope", "--name-only", "--null", "--type", "--bool", "--int", "--path",
      ],
    },
    (parsed) =>
      hasOption(parsed, "--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "-l") &&
      parsed.positionals.length <= 2,
  ),
};

function checkGit(args: string[]): boolean {
  let i = 0;
  // 全局选项只放行 -C 和关闭分页；-c、--exec-path、--git-dir 等可以让 git 执行任意命令。
  while (i < args.length && args[i]!.startsWith("-")) {
    const arg = args[i]!;
    if (arg === "-C") {
      const dir = args[i + 1];
      if (dir === undefined || looksLikeOption(dir)) return false;
      i += 2;
      continue;
    }
    if (arg === "--no-pager" || arg === "-P" || arg === "--no-optional-locks") {
      i += 1;
      continue;
    }
    return false;
  }
  const sub = args[i];
  const check = sub === undefined ? undefined : gitSubcommands[sub];
  return check ? check(args.slice(i + 1)) : false;
}

// ---------------------------------------------------------------------------
// sed：只放行打印、删除、替换这类不碰文件的脚本

function checkSed(args: string[]): boolean {
  const parsed = parseArgs(args, {
    allowShort: "nErsuz",
    valueShort: "e",
    allowLong: ["--quiet", "--silent", "--regexp-extended", "--expression", "--separate", "--unbuffered", "--null-data", "--posix", "--debug"],
    valueLong: ["--expression"],
  });
  if (!parsed) return false;
  const expressions = optionValues(parsed, "-e", "--expression");
  const scripts = expressions.length > 0 ? expressions : parsed.positionals.slice(0, 1);
  if (scripts.length === 0) return false;
  return scripts.every((script) => script !== undefined && isReadOnlySedScript(script));
}

const sedSimpleCommands = "pdDnNPqQ=lgGhHx{}";

/** 解析 sed 脚本，命令只能是打印、删除、保持空间操作、s 和 y；w/W/r/R/e 等一律拒绝。 */
function isReadOnlySedScript(script: string): boolean {
  let i = 0;
  const n = script.length;
  const skipBlank = () => {
    while (i < n && (script[i] === " " || script[i] === "\t")) i += 1;
  };
  const parseAddress = (): boolean => {
    const char = script[i];
    if (char === undefined) return true;
    if (/\d/.test(char)) {
      while (i < n && /[\d~]/.test(script[i]!)) i += 1;
      return true;
    }
    if (char === "$") {
      i += 1;
      return true;
    }
    if (char === "/" || char === "\\") {
      let delimiter = "/";
      if (char === "\\") {
        delimiter = script[i + 1] ?? "";
        if (!delimiter || delimiter === "\n" || delimiter === "\\") return false;
        i += 1;
      }
      const end = scanDelimited(script, i + 1, delimiter, true);
      if (end < 0) return false;
      i = end + 1;
      while (i < n && (script[i] === "I" || script[i] === "M")) i += 1;
      return true;
    }
    return true;
  };

  while (i < n) {
    while (i < n && " \t\n;".includes(script[i]!)) i += 1;
    if (i >= n) break;
    if (!parseAddress()) return false;
    if (script[i] === ",") {
      i += 1;
      skipBlank();
      if (script[i] === "+" || script[i] === "~") {
        i += 1;
        if (!/\d/.test(script[i] ?? "")) return false;
      }
      if (!parseAddress()) return false;
    }
    skipBlank();
    if (script[i] === "!") {
      i += 1;
      skipBlank();
    }
    const command = script[i];
    if (command === undefined) return false;
    i += 1;
    if (command === "s" || command === "y") {
      const delimiter = script[i];
      if (!delimiter || delimiter === "\n" || delimiter === "\\") return false;
      const patternEnd = scanDelimited(script, i + 1, delimiter, true);
      if (patternEnd < 0) return false;
      const replacementEnd = scanDelimited(script, patternEnd + 1, delimiter, false);
      if (replacementEnd < 0) return false;
      i = replacementEnd + 1;
      if (command === "s") {
        while (i < n && /[gpiImM\d]/.test(script[i]!)) i += 1;
      }
    } else if (command === "{") {
      continue;
    } else if (sedSimpleCommands.includes(command)) {
      if (command === "q" || command === "Q" || command === "l") {
        skipBlank();
        while (i < n && /\d/.test(script[i]!)) i += 1;
      }
    } else {
      return false;
    }
    skipBlank();
    if (i < n && !";\n}".includes(script[i]!)) return false;
  }
  return true;
}

/**
 * 从 start 开始找到未转义的分隔符，返回它的位置；找不到返回 -1。
 * 正则里的方括号在 GNU 与 BSD sed 中处理不同，方括号内出现分隔符或反斜杠就拒绝，避免两边解读不一致。
 */
function scanDelimited(text: string, start: number, delimiter: string, regex: boolean): number {
  let i = start;
  while (i < text.length) {
    const char = text[i]!;
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === delimiter) return i;
    if (regex && char === "[") {
      let j = i + 1;
      if (text[j] === "^") j += 1;
      if (text[j] === "]") j += 1;
      while (j < text.length && text[j] !== "]") {
        if (text[j] === delimiter || text[j] === "\\") return -1;
        if (text[j] === "[" && (text[j + 1] === ":" || text[j + 1] === "." || text[j + 1] === "=")) {
          const close = text.indexOf(`${text[j + 1]}]`, j + 2);
          if (close < 0) return -1;
          if (text.slice(j, close).includes(delimiter)) return -1;
          j = close + 2;
          continue;
        }
        j += 1;
      }
      if (j >= text.length) return -1;
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// awk：只放行不调用外部命令、不写文件的程序

function checkAwk(args: string[]): boolean {
  const parsed = parseArgs(args, { allowShort: "", valueShort: "Fv", allowLong: [] });
  if (!parsed) return false;
  const program = parsed.positionals[0];
  if (program === undefined) return false;
  if (/\bsystem\b|@/.test(program)) return false;
  // print > file、print | "cmd"、"cmd" | getline 都靠 > 和 |；>= 与 || 是比较和逻辑运算，放行。
  if (/>(?!=)/.test(program)) return false;
  if (/(^|[^|])\|(?!\|)/.test(program)) return false;
  return true;
}
