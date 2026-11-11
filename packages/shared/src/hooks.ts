import { utf8ByteLength } from "./intelligent-ui";

/** Command hooks are trusted native code, not instructions or a system sandbox. */
export const hookEvents = ["SessionStart", "PreToolUse", "PostToolUse", "Stop", "PreCommit"] as const;
export type HookEvent = typeof hookEvents[number];
export type HookScope = "global" | "project";
export interface HookDefinition {
  id: string;
  event: HookEvent;
  command: string;
  /** Tool-name glob (* and ?), not a shell expression or regular expression. */
  matcher?: string;
  timeoutMs?: number;
  enabled?: boolean;
}
export interface HooksConfig { version: 1; hooks: HookDefinition[] }
export interface HooksDocument {
  scope: HookScope;
  path: string;
  config: HooksConfig;
  digest: string;
  trusted: boolean;
  error?: string;
}
export type HookRunStatus = "running" | "allowed" | "denied" | "error" | "skipped";
export type HookRunCode = "ok" | "denied" | "untrusted" | "restricted" | "invalid-config" | "timeout" | "cancelled" | "output-limit" | "invalid-output" | "exit" | "spawn" | "input-limit" | "changed" | "busy";
/** Deliberately excludes commands, arguments, stdout/stderr and arbitrary hook output. */
export interface HookRunRecord {
  id: string;
  cwd: string;
  scope: HookScope;
  hookId: string;
  event: HookEvent;
  conversationId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  startedAt: number;
  durationMs: number;
  status: HookRunStatus;
  code: HookRunCode;
}
export interface HooksCatalog { cwd: string; documents: HooksDocument[]; history: HookRunRecord[] }
export interface HooksTarget { cwd: string }
export interface HooksSaveInput extends HooksTarget {
  scope: HookScope;
  config: HooksConfig;
  expectedDigest: string;
}
export interface HooksTrustInput extends HooksTarget {
  scope: HookScope;
  trusted: boolean;
  /** Exact digest of the configuration reviewed by the user. */
  digest: string;
}
export interface HooksRunInput extends HooksTarget {
  event: HookEvent;
  conversationId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  isError?: boolean;
  /** Final assistant text for Stop, excluding thinking and tool payloads. */
  response?: string;
  commit?: { title: string; body: string; amend?: boolean; stagePaths?: string[] | null };
}
export interface HooksRunResult {
  allowed: boolean;
  /** Execution failures cannot be repaired by a model continuation. */
  failed: boolean;
  reason: string;
  additionalContext: string;
}
export interface HooksTestInput extends HooksTarget { scope: HookScope; digest: string; event: HookEvent; toolName?: string }
export interface HooksApi {
  testHooks(input: HooksTestInput): Promise<HooksRunResult>;
  getHooksCatalog(input: HooksTarget): Promise<HooksCatalog>;
  saveHooksConfig(input: HooksSaveInput): Promise<HooksCatalog>;
  setHooksTrust(input: HooksTrustInput): Promise<HooksCatalog>;
  onHooksChanged(listener: (record: HookRunRecord) => void): () => void;
}

export function hookMatches(pattern: string | undefined, tool: string | undefined): boolean {
  if (!pattern) return true;
  if (!tool) return false;
  const regex = pattern.split("").map(c => c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(`^${regex}$`).test(tool);
}

export const emptyHooksConfig = (): HooksConfig => ({ version: 1, hooks: [] });
export function parseHooksConfig(value: unknown): HooksConfig {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!record(value) || Object.keys(value).some(k => !["version", "hooks"].includes(k)) || value.version !== 1 || !Array.isArray(value.hooks) || value.hooks.length > 64) {
    throw new Error("Expected version: 1 and at most 64 hooks.");
  }
  const ids = new Set<string>();
  const hooks = value.hooks.map((raw): HookDefinition => {
    if (!record(raw) || Object.keys(raw).some(k => !["id", "event", "command", "matcher", "timeoutMs", "enabled"].includes(k))
      || typeof raw.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.id) || ids.has(raw.id)
      || !hookEvents.includes(raw.event as HookEvent) || typeof raw.command !== "string" || !raw.command.trim() || raw.command.length > 8192 || raw.command.includes("\0")
      || raw.matcher !== undefined && (typeof raw.matcher !== "string" || !/^[a-zA-Z0-9_.*?:/-]{1,256}$/.test(raw.matcher))
      || raw.timeoutMs !== undefined && (typeof raw.timeoutMs !== "number" || !Number.isInteger(raw.timeoutMs) || raw.timeoutMs < 100 || raw.timeoutMs > 120_000)
      || raw.enabled !== undefined && typeof raw.enabled !== "boolean") throw new Error("Invalid hook definition (id, event, command, matcher, timeoutMs or enabled).");
    if (raw.matcher !== undefined && !["PreToolUse", "PostToolUse", "PreCommit"].includes(raw.event as string)) throw new Error("Matchers are only supported for tool and commit events.");
    ids.add(raw.id);
    return { id: raw.id, event: raw.event as HookEvent, command: raw.command,
      ...(raw.matcher === undefined ? {} : { matcher: raw.matcher as string }),
      ...(raw.timeoutMs === undefined ? {} : { timeoutMs: raw.timeoutMs as number }),
      ...(raw.enabled === undefined ? {} : { enabled: raw.enabled as boolean }) };
  });
  const result: HooksConfig = { version: 1, hooks };
  if (utf8ByteLength(`${JSON.stringify(result, null, 2)}\n`) > 128_000) throw new Error("Hooks configuration is too large.");
  return result;
}
