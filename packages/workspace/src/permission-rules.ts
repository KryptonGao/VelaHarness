import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { SandboxApprovalKind, SandboxMcpContext } from "@vela/shared";

/**
 * What "Always allow" and "Always deny" remember: `Tool(specifier)` strings grouped into allow / deny.
 *
 * - `Bash(git status *)`: shell command; `*` is a wildcard, a trailing ` *` also matches the bare command.
 * - `Edit(.env*)` / `Write(...)`: file writes made by the edit / write tools; gitignore-style path globs.
 * - `Web(domain:example.com)`: web fetch by host (subdomains included) or URL glob.
 * - `Mcp(server/tool)` or `mcp__server__tool`: MCP tool call.
 * - `Browser`: Browser REPL. A bare tool name (no parentheses) matches every call of that tool.
 *
 * A deny rule beats an allow rule.
 */
export type PermissionRuleAction = "allow" | "deny";

type RuleTool = "bash" | "file" | "web" | "mcp" | "browser";

interface ParsedRule {
  /** Normalized rule text, as shown back to the user and the model. */
  source: string;
  tool: RuleTool;
  /** null matches every call of the tool. */
  specifier: string | null;
}

export interface PermissionRuleSet {
  allow: ParsedRule[];
  deny: ParsedRule[];
}

export interface RuleTarget {
  kind: SandboxApprovalKind;
  command?: string | null;
  path?: string | null;
  workspace?: string | null;
  mcp?: SandboxMcpContext;
}

export interface RuleDecision {
  action: PermissionRuleAction;
  rule: string;
}

const toolAliases: Record<string, RuleTool> = {
  bash: "bash",
  shell: "bash",
  edit: "file",
  write: "file",
  file: "file",
  web: "web",
  webfetch: "web",
  mcp: "mcp",
  browser: "browser",
  browserrepl: "browser",
  browser_repl: "browser",
};

export function emptyRuleSet(): PermissionRuleSet {
  return { allow: [], deny: [] };
}

export function parsePermissionRule(text: string): ParsedRule | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("mcp__")) {
    const [server, ...rest] = trimmed.slice(5).split("__");
    if (!server || /[()]/.test(trimmed)) return null;
    const tool = rest.join("__") || "*";
    return { source: trimmed, tool: "mcp", specifier: `${server}/${tool}` };
  }
  const match = /^([A-Za-z_]+)(?:\(([\s\S]*)\))?$/.exec(trimmed);
  if (!match) return null;
  const tool = toolAliases[match[1]!.toLowerCase()];
  if (!tool) return null;
  // The tool name stays as the user typed it, so messages quote the rule they wrote.
  const label = match[1]!;
  if (match[2] === undefined) return { source: label, tool, specifier: null };
  const specifier = match[2].trim();
  if (!specifier) return null;
  if (specifier === "*") return { source: label, tool, specifier: null };
  return { source: `${label}(${specifier})`, tool, specifier };
}

/** Compiles `{ allow, deny }` from a stored record; entries that cannot be parsed are dropped. */
export function compilePermissionRules(config: unknown): PermissionRuleSet {
  const rules = emptyRuleSet();
  if (!config || typeof config !== "object") return rules;
  for (const action of ["allow", "deny"] as const) {
    const list = (config as Record<string, unknown>)[action];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const parsed = typeof entry === "string" ? parsePermissionRule(entry) : null;
      if (parsed) rules[action].push(parsed);
    }
  }
  return rules;
}

function ruleToolFor(kind: SandboxApprovalKind): RuleTool | null {
  switch (kind) {
    case "bash": return "bash";
    case "edit":
    case "write":
    case "mkdir": return "file";
    case "web": return "web";
    case "mcp": return "mcp";
    case "browser_repl": return "browser";
    default: return null;
  }
}

/** Returns the winning rule for an operation, or null when no rule applies (the caller falls back to its mode). */
export function evaluatePermissionRules(rules: PermissionRuleSet, target: RuleTarget): RuleDecision | null {
  const tool = ruleToolFor(target.kind);
  if (!tool) return null;
  const scoped: PermissionRuleSet = {
    deny: rules.deny.filter(rule => rule.tool === tool),
    allow: rules.allow.filter(rule => rule.tool === tool),
  };
  if (!scoped.deny.length && !scoped.allow.length) return null;
  if (tool === "bash") return evaluateBash(scoped, target.command ?? "");
  for (const action of ["deny", "allow"] as const) {
    const hit = scoped[action].find(rule => matchesTarget(rule, target));
    if (hit) return { action, rule: hit.source };
  }
  return null;
}

function matchesTarget(rule: ParsedRule, target: RuleTarget): boolean {
  if (rule.specifier === null) return true;
  switch (rule.tool) {
    case "file": return target.path ? pathMatches(rule.specifier, target.path, target.workspace) : false;
    case "web": return target.command ? webMatches(rule.specifier, target.command) : false;
    case "mcp": return target.mcp ? mcpMatches(rule.specifier, target.mcp) : false;
    case "browser": return starMatches(rule.specifier, target.command ?? "");
    default: return false;
  }
}

// ---------- bash ----------

function evaluateBash(rules: PermissionRuleSet, command: string): RuleDecision | null {
  const segments = splitShellCommand(command);
  // Deny looks at every sub-command, the commands nested in substitutions, the command behind
  // common wrappers (sudo, env, time ...), and the whole line (so a rule can describe a pipeline).
  const candidates = [...segments.flatMap(segment => matchForms(segment.text)), command.replace(/\s+/g, " ").trim()];
  for (const rule of rules.deny) {
    if (rule.specifier === null || candidates.some(candidate => bashPatternMatches(rule.specifier!, candidate))) return { action: "deny", rule: rule.source };
  }
  const everything = rules.allow.find(rule => rule.specifier === null);
  if (everything) return { action: "allow", rule: everything.source };
  if (!segments.length) return null;
  // Allow is strict: every sub-command must match literally, and nothing may hide behind substitutions or redirections.
  let first: ParsedRule | undefined;
  for (const segment of segments) {
    if (segment.unsafeForAllow) return null;
    const hit = rules.allow.find(rule => bashPatternMatches(rule.specifier!, segment.text));
    if (!hit) return null;
    first ??= hit;
  }
  return first ? { action: "allow", rule: first.source } : null;
}

const wrapperWords = new Set(["sudo", "env", "time", "nohup", "nice", "command", "exec", "builtin", "do", "then", "else", "elif", "if", "while", "until", "!", "{", "}"]);

function stripLeading(text: string): string {
  let rest = text;
  for (;;) {
    const match = /^(\S+)(?: |$)/.exec(rest);
    if (!match) return rest;
    const word = match[1]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || wrapperWords.has(word)) rest = rest.slice(match[0].length);
    else return rest;
  }
}

function matchForms(text: string): string[] {
  const forms = new Set([text, stripLeading(text)]);
  for (const form of [...forms]) {
    const first = /^\S+/.exec(form)?.[0];
    if (first && first.includes("/")) forms.add(basename(first) + form.slice(first.length));
  }
  return [...forms];
}

const regexCache = new Map<string, RegExp>();

function cachedRegExp(source: string, flags: string): RegExp {
  const key = `${flags}\0${source}`;
  let regex = regexCache.get(key);
  if (!regex) {
    if (regexCache.size > 500) regexCache.clear();
    regex = new RegExp(source, flags);
    regexCache.set(key, regex);
  }
  return regex;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const anyChars = "[\\s\\S]*";

function starSource(pattern: string): string {
  return pattern.split("*").map(escapeRegExp).join(anyChars);
}

function starMatches(pattern: string, value: string): boolean {
  return cachedRegExp(`^${starSource(pattern)}$`, "").test(value);
}

function bashPatternMatches(specifier: string, command: string): boolean {
  // `npm:*` is the legacy prefix form of `npm *`.
  let pattern = specifier.replace(/\s+/g, " ").replace(/:\*$/, " *");
  const trailing = pattern.endsWith(" *");
  if (trailing) pattern = pattern.slice(0, -2);
  return cachedRegExp(`^${starSource(pattern)}${trailing ? `(?: ${anyChars})?` : ""}$`, "").test(command);
}

export interface CommandSegment {
  text: string;
  /** Contains a command/process substitution, a heredoc, an unterminated quote or a file-writing redirection. */
  unsafeForAllow: boolean;
}

/**
 * Splits a shell line at unquoted `&&`, `||`, `;`, `|`, `&`, newlines and parentheses. Commands nested in
 * `$(...)`, backticks and `<(...)` come out as segments of their own. Unquoted whitespace is collapsed.
 * This is a classifier for rules, not a shell parser: whatever it cannot reason about is marked unsafe for allow.
 */
export function splitShellCommand(command: string): CommandSegment[] {
  const out: CommandSegment[] = [];
  parseInto(command, out);
  return out;
}

function parseInto(src: string, out: CommandSegment[]): void {
  let text = "";
  let pendingSpace = false;
  let unsafe = false;
  let quote: "'" | '"' | null = null;
  let i = 0;
  const append = (chunk: string): void => {
    if (pendingSpace && text) text += " ";
    pendingSpace = false;
    text += chunk;
  };
  const flush = (): void => {
    if (text) out.push({ text, unsafeForAllow: unsafe });
    text = "";
    pendingSpace = false;
    unsafe = false;
  };
  const nested = (inner: string, open: string, close: string, end: number): void => {
    parseInto(inner, out);
    unsafe = true;
    append(`${open}${inner}${close}`);
    i = end;
  };
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (quote === "'") {
      append(c);
      if (c === "'") quote = null;
      i++;
      continue;
    }
    if (c === "\\") {
      if (next === "\n") pendingSpace = true;
      else append(next === undefined ? c : c + next);
      i += 2;
      continue;
    }
    if (c === "$" && next === "(") {
      const close = findClosingParen(src, i + 1);
      nested(src.slice(i + 2, close), "$(", close < src.length ? ")" : "", close + 1);
      continue;
    }
    if (c === "`") {
      const close = findBacktick(src, i + 1);
      nested(src.slice(i + 1, close), "`", close < src.length ? "`" : "", close + 1);
      continue;
    }
    if (quote === '"') {
      append(c);
      if (c === '"') quote = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      append(c);
      i++;
      continue;
    }
    if ((c === "<" || c === ">") && next === "(") {
      const close = findClosingParen(src, i + 1);
      nested(src.slice(i + 2, close), `${c}(`, close < src.length ? ")" : "", close + 1);
      continue;
    }
    if (c === "\n" || c === ";" || c === "(" || c === ")") {
      flush();
      i++;
    } else if (c === "&" && next === "&") {
      flush();
      i += 2;
    } else if (c === "&" && next !== ">") {
      flush();
      i++;
    } else if (c === "|") {
      flush();
      i += next === "|" || next === "&" ? 2 : 1;
    } else if (c === ">" || c === "&") {
      // `>`, `>>`, `>|`, `&>`: allowed only for fd duplication (`2>&1`) and /dev/null.
      let j = i + 1;
      if (c === "&") j++;
      if (src[j] === ">") j++;
      if (src[j] === "&") {
        j++;
        if (!/[0-9-]/.test(src[j] ?? "")) unsafe = true;
      } else {
        if (src[j] === "|") j++;
        let k = j;
        while (src[k] === " " || src[k] === "\t") k++;
        if (!/^\/dev\/null(?![\w./-])/.test(src.slice(k))) unsafe = true;
      }
      append(src.slice(i, j));
      i = j;
    } else if (c === "<" && next === "<") {
      unsafe = true;
      append("<<");
      i += 2;
    } else if (c === " " || c === "\t" || c === "\r") {
      pendingSpace = true;
      i++;
    } else {
      append(c);
      i++;
    }
  }
  if (quote) unsafe = true;
  flush();
}

/** Index of the `)` matching the `(` at `open`, or src.length when unbalanced. */
function findClosingParen(src: string, open: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "\\" && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return src.length;
}

function findBacktick(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "`") return i;
  }
  return src.length;
}

// ---------- paths, urls, mcp ----------

function pathSource(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += escapeRegExp(c);
  }
  return out;
}

/**
 * Gitignore-style matching. A pattern without `/` matches any path component (`.env*`, `node_modules`);
 * a pattern with `/` is relative to the workspace; `/x` and `~/x` are absolute. A match on a directory covers its contents.
 * Matching ignores case because the default macOS volume does.
 */
function pathMatches(specifier: string, filePath: string, workspace: string | null | undefined): boolean {
  const absolute = resolve(workspace ?? "/", filePath);
  let pattern = specifier;
  if (pattern === "~") pattern = homedir();
  else if (pattern.startsWith("~/")) pattern = homedir() + pattern.slice(1);
  if (isAbsolute(pattern)) return cachedRegExp(`^${pathSource(pattern.replace(/\/+$/, ""))}(?:/.*)?$`, "i").test(absolute);
  if (pattern.startsWith("./")) pattern = pattern.slice(2);
  pattern = pattern.replace(/\/+$/, "");
  let rel: string | null = null;
  if (workspace) {
    const candidate = relative(resolve(workspace), absolute);
    if (candidate && candidate !== ".." && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate)) rel = candidate.split(sep).join("/");
  }
  if (!pattern.includes("/")) {
    const regex = cachedRegExp(`^${pathSource(pattern)}$`, "i");
    return (rel ?? absolute).split("/").some(part => part !== "" && regex.test(part));
  }
  return rel !== null && cachedRegExp(`^${pathSource(pattern)}(?:/.*)?$`, "i").test(rel);
}

function webMatches(specifier: string, url: string): boolean {
  if (/^domain:/i.test(specifier)) {
    const domain = specifier.slice(7).trim().toLowerCase().replace(/^\*\./, "");
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return !!domain && (host === domain || host.endsWith(`.${domain}`));
  }
  return starMatches(specifier, url);
}

function mcpMatches(specifier: string, mcp: SandboxMcpContext): boolean {
  const slash = specifier.indexOf("/");
  const server = slash < 0 ? specifier : specifier.slice(0, slash);
  const tool = slash < 0 ? "*" : specifier.slice(slash + 1);
  return starMatches(server, mcp.server) && starMatches(tool, mcp.tool);
}

// ---------- rules offered by "Always allow" / "Always deny" ----------

/** Programs that are safe to allow for any arguments: they read, print or inspect. */
const suggestablePrograms = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "echo", "grep", "rg", "tree", "which", "whoami", "date", "stat", "file", "diff",
  "sort", "uniq", "du", "df", "basename", "dirname", "realpath", "cd", "true", "false", "tsc",
]);
const suggestableGitSubcommands = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "ls-files", "blame", "describe", "add", "commit"]);
const packageManagers = new Set(["pnpm", "npm", "yarn", "bun"]);
const suggestableScripts = /^(test|build|lint|typecheck|check|format)(:[\w:-]+)?$/;
const suggestableCargoGoSubcommands: Record<string, Set<string>> = {
  cargo: new Set(["build", "check", "test", "clippy", "fmt"]),
  go: new Set(["build", "test", "vet"]),
};

/** `rg --pre CMD` runs CMD for every file; a rule for `rg *` must not be offered for such a command. */
const executingFlags = /(^| )--(pre|pre-glob|hostname-bin)(=| |$)/;

function allowPrefix(text: string): string | null {
  if (executingFlags.test(text)) return null;
  const tokens = text.split(" ");
  const program = tokens[0]!;
  if (suggestablePrograms.has(program)) return program;
  const sub = tokens[1];
  if (!sub) return null;
  if (program === "git") return suggestableGitSubcommands.has(sub) ? `git ${sub}` : null;
  const cargoGo = suggestableCargoGoSubcommands[program];
  if (cargoGo) return cargoGo.has(sub) ? `${program} ${sub}` : null;
  if (packageManagers.has(program)) {
    if (suggestableScripts.test(sub)) return `${program} ${sub}`;
    const script = tokens[2];
    if ((sub === "run" || sub === "run-script") && script && /^[a-z][\w:.-]*$/i.test(script)) return `${program} ${sub} ${script}`;
  }
  return null;
}

/** Tools whose first argument is the verb: denying `git push` must not deny every `git`. */
const verbPrograms = new Set(["git", "pnpm", "npm", "yarn", "bun", "cargo", "go", "docker", "kubectl", "gh", "brew", "pip", "uv"]);

function denyPrefix(text: string): string | null {
  const tokens = stripLeading(text).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const program = tokens[0]!.includes("/") ? basename(tokens[0]!) : tokens[0]!;
  if (!/^[A-Za-z0-9._+-]+$/.test(program)) return null;
  if (!verbPrograms.has(program)) return program;
  const verb = tokens[1];
  return verb && /^[a-z][a-z0-9:_-]*$/.test(verb) ? `${program} ${verb}` : null;
}

export interface RuleSuggestion {
  allow: string[];
  deny: string[];
}

/**
 * The rules "Always allow" and "Always deny" would remember for a pending request, derived from the request itself.
 *
 * Allow is a short allowlist of commands that read, inspect or build: interpreters, shells, `rm`, `curl`, `sudo`, `find`,
 * package installs, `git push` and anything with a substitution or file redirection get no allow suggestion.
 * Deny is broader: a command is denied by its program, or program and verb for `git`, `pnpm` and the like. In a compound
 * command only the sub-commands that are not on the allow list are denied, so `pwd && rm x` denies `rm`, not `pwd`.
 * An empty list means the card does not offer that button.
 */
export function suggestRules(target: { kind: SandboxApprovalKind; command?: string | null; path?: string | null; workspace?: string | null; mcp?: SandboxMcpContext }): RuleSuggestion {
  const none: RuleSuggestion = { allow: [], deny: [] };
  if (target.kind === "bash") {
    const segments = splitShellCommand(target.command ?? "");
    if (!segments.length) return none;
    const result: RuleSuggestion = { allow: [], deny: [] };
    const prefixes = segments.map(segment => allowPrefix(segment.text));
    if (prefixes.every(prefix => prefix !== null) && !segments.some(segment => segment.unsafeForAllow)) result.allow = [...new Set(prefixes.map(prefix => `Bash(${prefix} *)`))];
    const risky = segments.filter((_, index) => prefixes[index] === null);
    const denied = (risky.length ? risky : segments).map(segment => denyPrefix(segment.text));
    if (denied.every(prefix => prefix !== null)) result.deny = [...new Set(denied.map(prefix => `Bash(${prefix} *)`))];
    return result;
  }
  if (target.kind === "web") {
    let host: string;
    try {
      host = new URL(target.command ?? "").hostname.toLowerCase();
    } catch {
      return none;
    }
    if (!/^[a-z0-9.-]+$/.test(host)) return none;
    const named = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/^\d+(\.\d+){3}$/.test(host);
    return { allow: named ? [`Web(domain:${host})`] : [], deny: [`Web(domain:${host})`] };
  }
  if (target.kind === "mcp" && target.mcp) {
    const { server, tool } = target.mcp;
    const rule = /^[\w.:-]+$/.test(server) && /^[\w.:-]+$/.test(tool) ? [`Mcp(${server}/${tool})`] : [];
    return { allow: rule, deny: rule };
  }
  if ((target.kind === "edit" || target.kind === "write" || target.kind === "mkdir") && target.path) {
    const path = resolve(target.workspace ?? "/", target.path);
    return { allow: [], deny: /[*?()]/.test(path) ? [] : [`Edit(${path})`] };
  }
  return none;
}
