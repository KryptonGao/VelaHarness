import { boundToolJson, parseToolPresentation, type JsonValue, type ToolPresentation } from "@vela/shared";

type RecordValue = Record<string, unknown>;
const resources = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);
const schedules = new Set(["create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task"]);
function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function textOf(value: unknown): string {
  const content = record(value)?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map(part => record(part)?.type === "text" ? string(record(part)?.text) ?? "" : "").filter(Boolean).join("\n") : "";
}
function jsonText(text: string): unknown {
  if (text.length > 80_000) return undefined;
  const source = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  try { return JSON.parse(source); } catch { return undefined; }
}
function build(kind: string, source: "result" | "legacy" | "request", fields: RecordValue): ToolPresentation | undefined {
  return parseToolPresentation({ version: 1, kind, source, ...fields });
}
function valueOf(value: unknown): JsonValue | undefined { return boundToolJson(value)?.value; }

/** Only expose selected call fields, never arbitrary arguments or credentials. */
export function presentationFromCall(name: string, input: unknown): ToolPresentation | undefined {
  const args = record(input) ?? {};
  if (name === "bash_output" || name === "bash_kill") {
    return typeof args.shell_id === "string" ? build("shell", "request", {
      operation: name === "bash_output" ? "read" : "kill", shell: { id: args.shell_id },
    }) : undefined;
  }
  if (name === "memory_read" || name === "memory_update") return build("memory", "request", {
    operation: name === "memory_read" ? "read" : "update",
    entries: [{ scope: string(args.scope) ?? "all" }],
  });
  if (name === "tool_search") return build("discovery", "request", { query: args.query, limit: args.limit, tools: [] });
  if (resources.has(name)) return build("resource", "request", {
    operation: resourceOperation(name), server: args.server, uri: args.uri, value: null,
  });
  if (schedules.has(name)) return build("schedule", "request", {
    operation: scheduleOperation(name),
    tasks: name === "create_scheduled_task" || name === "update_scheduled_task" ? [{ id: args.id, title: args.title, schedule: args.schedule }] : [],
    runs: [], ...(name === "delete_scheduled_task" ? { deletedId: args.id } : {}),
  });
  if (name === "update_goal" || name === "record_goal_validation") return build("goal", "request", {
    requested: valueOf(name === "update_goal" ? { status: args.status, note: args.note ?? null } : {
      risk: args.risk, checks: args.checks, skipped: args.skipped, knownIssues: args.knownIssues,
    }),
  });
  return undefined;
}
function resourceOperation(name: string): string { return name === "read_mcp_resource" ? "read" : name === "list_mcp_resource_templates" ? "templates" : "list"; }
function scheduleOperation(name: string): string { return name.split("_")[0] ?? "list"; }

/** Shared by live events and transcript reconstruction. No mutable services or snapshots are read here. */
export function presentationFromExecution(name: string, input: unknown, result: unknown, isError: boolean): ToolPresentation | undefined {
  const args = record(input) ?? {};
  const raw = record(result) ?? {};
  const details = record(raw.details) ?? {};
  const text = textOf(result);
  const supplied = parseToolPresentation(details.toolPresentation);
  if (!isError && supplied) return supplied;
  if (isError) return presentationFromCall(name, input);

  if (name === "bash" || name === "bash_output" || name === "bash_kill") {
    const shell = record(details.backgroundShell);
    if (shell) {
      const legacy = parseLegacyShell(text);
      if (name === "bash_output" && typeof details.output !== "string" && !legacy) return undefined;
      return build("shell", "result", {
        operation: name === "bash" ? "start" : name === "bash_output" ? "read" : "kill",
        shell,
        output: typeof details.output === "string" ? details.output : name === "bash_output" ? legacy?.output : undefined,
        truncated: details.truncated === true || legacy?.truncated === true,
        killed: typeof details.killed === "boolean" ? details.killed : undefined,
      });
    }
    if (name !== "bash") {
      const legacy = parseLegacyShell(text);
      if (legacy) return build("shell", "legacy", { operation: "read", ...legacy });
      const kill = /^(Stopped background shell (.+)\.|Background shell (.+) had already exited\.)$/.exec(text.trim());
      if (kill) return build("shell", "legacy", { operation: "kill", shell: { id: kill[2] ?? kill[3] }, killed: Boolean(kill[2]) });
    }
    return undefined;
  }
  if (schedules.has(name)) {
    const hasData = Object.hasOwn(details, "data");
    const data = hasData ? details.data : jsonText(text);
    const operation = scheduleOperation(name);
    const listing = record(data);
    if (operation === "list" && (!Array.isArray(listing?.tasks) || !Array.isArray(listing?.runs))) return undefined;
    if ((operation === "create" || operation === "update") && typeof listing?.id !== "string") return undefined;
    if (operation === "delete" && typeof listing?.deleted !== "string") return undefined;
    return build("schedule", hasData ? "result" : "legacy", {
      operation, tasks: operation === "list" ? listing?.tasks : operation === "delete" ? [] : [data],
      runs: operation === "list" ? listing?.runs : [], deletedId: listing?.deleted,
    });
  }
  if (name === "memory_read") {
    const entries = Array.isArray(details.entries) ? details.entries.map(item => {
      const entry = record(item) ?? {};
      const error = record(entry.error);
      return { scope: entry.scope, path: string(entry.path), revision: string(entry.revision),
        bytes: entry.bytes, exists: entry.exists, content: string(entry.content), status: string(entry.status),
        error: string(entry.error) ?? (error ? [string(error.code), string(error.message)].filter(Boolean).join(": ") : undefined) };
    }) : parseLegacyMemory(text);
    return entries?.length ? build("memory", Array.isArray(details.entries) ? "result" : "legacy", { operation: "read", entries }) : undefined;
  }
  if (name === "memory_update") {
    if (typeof details.scope === "string" && typeof details.path === "string") return build("memory", "result", {
      operation: details.operation ?? (details.changed === false ? "unchanged" : "saved"), entries: [details],
    });
    const match = /^(已保存|已清空|无需更新) (global|project) 记忆[：:]([^\n]*)\n(?:path: ([^\n]*)\n)?revision: ([^\n]*)(?:\nbytes: (\d+))?$/.exec(text.trim());
    if (match) return build("memory", "legacy", { operation: match[1] === "无需更新" ? "unchanged" : match[1] === "已清空" ? "cleared" : "saved", entries: [{ scope: match[2], path: match[4] ?? match[3], revision: match[5], ...(match[6] ? { bytes: Number(match[6]) } : {}) }] });
    return undefined;
  }
  if (name === "tool_search") {
    const lines = text.split("\n");
    const descriptions = new Map<string, string>();
    for (const line of lines) { const match = /^- ([^:]+): (.*)$/.exec(line); if (match) descriptions.set(match[1]!, match[2]!); }
    const loaded = Array.isArray(details.loaded) ? details.loaded.filter((item): item is string => typeof item === "string") : [...descriptions.keys()];
    if (!Array.isArray(details.loaded) && !/^Loaded \d+ tools?\.|^No matching tools found\.$/.test(text.trim())) return undefined;
    return build("discovery", Array.isArray(details.loaded) ? "result" : "legacy", {
      query: args.query, limit: args.limit, tools: loaded.map(name => ({ name, description: descriptions.get(name) })),
    });
  }
  if (resources.has(name)) {
    const payload = raw.structuredContent !== undefined ? raw.structuredContent : jsonText(text);
    // A read result can contain plain text/images instead of JSON; its URI remains in the call.
    const value = payload ?? (name === "read_mcp_resource" ? { contents: text ? [{ text }] : [] } : undefined);
    if (value === undefined) return undefined;
    const images = Array.isArray(raw.content) ? raw.content.filter(part => record(part)?.type === "image").map(part => ({ mimeType: record(part)?.mimeType, data: record(part)?.data })) : [];
    const sanitized = stripBinary(value);
    return build("resource", raw.structuredContent !== undefined || name === "read_mcp_resource" ? "result" : "legacy", {
      operation: resourceOperation(name), server: args.server ?? details.server, uri: args.uri,
      value: sanitized.value, truncated: sanitized.truncated, images, fullOutputPath: details.fullOutputPath,
    });
  }
  if (name === "update_goal" || name === "record_goal_validation") {
    if (details.goal || details.validation) return build("goal", "result", { goal: details.goal, validation: details.validation });
    return presentationFromCall(name, args);
  }
  if (name === "browser_repl_reset") return build("notice", "result", { code: "browser-reset" });
  // Arbitrary terminal/file text is intentionally never promoted to JSON.
  if (name.startsWith("mcp__") || name === "browser_repl") {
    const value = raw.structuredContent !== undefined ? raw.structuredContent : jsonText(text);
    if (value !== undefined) return build("json", raw.structuredContent !== undefined ? "result" : "legacy", { value });
  }
  return undefined;
}

function stripBinary(value: unknown): { value: unknown; truncated: boolean } {
  let nodes = 0;
  let chars = 0;
  let truncated = false;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 1000 || depth > 12 || chars > 80_000) { truncated = true; return "[truncated]"; }
    if (typeof item === "string") {
      const remaining = Math.max(0, 80_000 - chars);
      chars += item.length;
      if (item.length > remaining) { truncated = true; return item.slice(0, remaining) + "[truncated]"; }
      return item;
    }
    if (Array.isArray(item)) {
      const output: unknown[] = [];
      for (const child of item) {
        if (nodes >= 999 || chars > 80_000) { output.push("[truncated]"); truncated = true; break; }
        output.push(visit(child, depth + 1));
      }
      return output;
    }
    const object = record(item);
    if (!object) return item;
    const output: RecordValue = Object.create(null);
    for (const key in object) {
      if (!Object.hasOwn(object, key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (nodes >= 999 || chars > 80_000) { output["[truncated]"] = true; truncated = true; break; }
      chars += key.length;
      const binary = key === "blob" || (key === "data" && typeof object.mimeType === "string");
      if (binary) { output[key] = "[binary attachment]"; truncated = true; }
      else output[key] = visit(object[key], depth + 1);
    }
    return output;
  };
  return { value: visit(value, 0), truncated };
}

export function parseLegacyShell(text: string): { shell: RecordValue; output: string; truncated: boolean } | undefined {
  const match = /^shell ([^\s]+) \((running|exited with code (?:-?\d+|unknown)|stopped: timed out|killed|timed_out|cancelled)\): ([^\n]*)\n\n([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  const state = match[2]!;
  const exit = /^exited with code (-?\d+)$/.exec(state);
  let output = match[4]!;
  const truncated = /^\[Output was cut; showing the last \d+ characters of what is unread\.\]\n/.test(output);
  if (truncated) output = output.replace(/^\[Output was cut; showing the last \d+ characters of what is unread\.\]\n/, "");
  return { shell: { id: match[1], command: match[3], status: state.startsWith("exited") ? "exited" : state === "stopped: timed out" ? "timed_out" : state, ...(exit ? { exitCode: Number(exit[1]) } : {}) }, output: output === "(no new output)" ? "" : output, truncated };
}

function parseLegacyMemory(text: string): RecordValue[] | undefined {
  // Delimit only a complete protocol header. A memory document may itself contain 'scope:'.
  const pattern = /(?:^|\n\n)scope: (global|project)\npath: ([^\n]*)\n(?:exists: (true|false)\nrevision: ([^\n]*)\nbytes: (\d+)\ncontent:\n---\n|status: failed\nerror: ([^\n]*)\nmessage: ([^\n]*))/g;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length || matches.length > 2 || matches[0]!.index !== 0 || new Set(matches.map(match => match[1])).size !== matches.length) return undefined;
  return matches.map((match, index) => {
    if (match[6]) return { scope: match[1], path: match[2], status: "failed", error: `${match[6]}: ${match[7]}` };
    let content = text.slice(match.index! + match[0].length, matches[index + 1]?.index ?? text.length);
    if (content === "(文件存在但内容为空)" || content === "(文件不存在；保存时 expectedRevision 使用 absent)") content = "";
    return { scope: match[1], path: match[2], exists: match[3] === "true", revision: match[4], bytes: Number(match[5]), content, status: "read" };
  });
}
