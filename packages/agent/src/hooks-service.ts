import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { emptyHooksConfig, hookMatches, parseHooksConfig, type HookDefinition, type HookRunCode, type HookRunRecord, type HooksCatalog, type HooksDocument, type HooksRunInput, type HooksRunResult, type HooksSaveInput, type HooksTrustInput, type HookScope, type HooksTestInput } from "../../shared/src/hooks";

const maxBytes = 128_000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const digestValid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const pass = (): HooksRunResult => ({ allowed: true, failed: false, reason: "", additionalContext: "" });

export { hookMatches } from "../../shared/src/hooks";

/** Best-effort convenience only; PreToolUse is the guard for arbitrary shell commands. */
export function isGitCommitCommand(input: unknown): boolean {
  return record(input) && typeof input.command === "string" && /\bgit\b[^\n;&|]*\bcommit\b/.test(input.command);
}

interface CommandResult { code: HookRunCode; reason: string; additionalContext: string }

export class HooksService {
  private readonly listeners = new Set<(record: HookRunRecord) => void>();
  private readonly active = new Map<string, { cwd: string; scope: HookScope; conversationId?: string; agentId?: string; controller: AbortController }>();
  private readonly history: HookRunRecord[] = [];
  private readonly agentDir: string;
  constructor(options: { agentDir: string }) {
    mkdirSync(options.agentDir, { recursive: true });
    this.agentDir = realpathSync(options.agentDir);
  }
  subscribe(listener: (record: HookRunRecord) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  cancel(conversationId?: string, agentId?: string): void {
    for (const run of this.active.values()) if ((!conversationId || run.conversationId === conversationId) && (!agentId || run.agentId === agentId)) run.controller.abort();
  }
  private cwd(cwd: string): string { return realpathSync(resolve(cwd)); }
  private path(cwd: string, scope: HookScope): string {
    if (scope !== "global" && scope !== "project") throw new Error("Invalid hooks scope.");
    return scope === "global" ? join(this.agentDir, "hooks.json") : join(cwd, ".vela", "hooks.json");
  }
  private safePath(path: string): void {
    // Never follow a project-controlled symlink to overwrite configuration elsewhere.
    for (const target of [dirname(path), path]) if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("Hooks configuration cannot be a symbolic link.");
  }
  private policy(): Record<string, string> {
    const path = join(this.agentDir, "hooks-trust.json");
    try {
      this.safePath(path);
      if (statSync(path).size > maxBytes) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!record(value) || Object.values(value).some(v => !digestValid(v))) return {};
      return value as Record<string, string>;
    } catch { return {}; }
  }
  private key(cwd: string, scope: HookScope): string { return scope === "global" ? "global" : `project:${cwd}`; }
  private document(cwd: string, scope: HookScope): HooksDocument {
    const path = this.path(cwd, scope);
    let text = "";
    let digest = hash("");
    try {
      this.safePath(path);
      if (existsSync(path)) {
        const info = statSync(path);
        digest = hash(`${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`);
        if (info.size > maxBytes) throw new Error("Hooks configuration is too large.");
        text = readFileSync(path, "utf8");
        digest = hash(text);
      }
      const config = text ? parseHooksConfig(JSON.parse(text)) : emptyHooksConfig();
      return { scope, path, config, digest, trusted: this.policy()[this.key(cwd, scope)] === digest };
    } catch {
      return { scope, path, config: emptyHooksConfig(), digest, trusted: false, error: "Cannot read hooks configuration. Check its schema, size and file path." };
    }
  }
  getCatalog(rawCwd: string): HooksCatalog {
    const cwd = this.cwd(rawCwd);
    return { cwd, documents: [this.document(cwd, "global"), this.document(cwd, "project")], history: this.history.filter(r => r.cwd === cwd).map(r => ({ ...r })) };
  }
  private atomic(path: string, text: string): void {
    this.safePath(path);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
    writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  }
  save(input: HooksSaveInput): HooksCatalog {
    const cwd = this.cwd(input.cwd);
    const current = this.document(cwd, input.scope);
    if (!digestValid(input.expectedDigest) || current.digest !== input.expectedDigest) throw new Error("Hooks configuration changed. Reload before saving; your draft has not been saved.");
    const config = parseHooksConfig(input.config);
    this.atomic(current.path, `${JSON.stringify(config, null, 2)}\n`);
    this.cancelScope(cwd, input.scope);
    return this.getCatalog(cwd);
  }
  setTrust(input: HooksTrustInput): HooksCatalog {
    const cwd = this.cwd(input.cwd);
    const current = this.document(cwd, input.scope);
    if (typeof input.trusted !== "boolean" || !digestValid(input.digest) || input.trusted && (input.digest !== current.digest || current.error)) throw new Error("Hooks configuration changed or is invalid. Review it again before approving.");
    const policy = this.policy();
    const key = this.key(cwd, input.scope);
    if (input.trusted) policy[key] = input.digest; else delete policy[key];
    const policyText = `${JSON.stringify(policy, null, 2)}\n`;
    if (Buffer.byteLength(policyText) > maxBytes) throw new Error("Hooks trust store is full. Revoke unused workspace approvals first.");
    this.atomic(join(this.agentDir, "hooks-trust.json"), policyText);
    if (!input.trusted) this.cancelScope(cwd, input.scope);
    return this.getCatalog(cwd);
  }
  async test(input: HooksTestInput): Promise<HooksRunResult> {
    const cwd = this.cwd(input.cwd);
    const document = this.document(cwd, input.scope);
    if (document.error || !document.trusted || document.digest !== input.digest) throw new Error("Review and approve the current hooks configuration before testing.");
    if (!document.config.hooks.some(h => h.enabled !== false && h.event === input.event && hookMatches(h.matcher, input.toolName))) throw new Error("No enabled hook matches this test event and tool name.");
    return this.run({ cwd, event: input.event, toolName: input.toolName, toolInput: { hookTest: true }, toolResult: { hookTest: true },
      ...(input.event === "PreCommit" ? { commit: { title: "Hook test", body: "Synthetic test; no Git commit will be created." } } : {}) }, { scope: input.scope });
  }
  private cancelScope(cwd: string, scope: HookScope): void {
    for (const run of this.active.values()) if (run.scope === scope && (scope === "global" || run.cwd === cwd)) run.controller.abort();
  }
  private publish(entry: HookRunRecord): void {
    const index = this.history.findIndex(r => r.id === entry.id);
    if (index < 0) this.history.push({ ...entry }); else this.history[index] = { ...entry };
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
    for (const listener of this.listeners) { try { listener({ ...entry }); } catch { /* Observers cannot authorize or interrupt execution. */ } }
  }
  async run(input: HooksRunInput, options: { signal?: AbortSignal; allowed?: boolean; scope?: HookScope } = {}): Promise<HooksRunResult> {
    const cwd = this.cwd(input.cwd);
    const result = pass();
    const deadline = Date.now() + 120_000;
    for (const document of this.getCatalog(cwd).documents) {
      if (options.scope && document.scope !== options.scope) continue;
      if (document.error) {
        this.publish({ id: randomUUID(), cwd, scope: document.scope, hookId: "configuration", event: input.event, conversationId: input.conversationId, startedAt: Date.now(), durationMs: 0, status: "skipped", code: "invalid-config" });
      }
      for (const hook of document.config.hooks) {
        if (hook.enabled === false || hook.event !== input.event || !hookMatches(hook.matcher, input.toolName)) continue;
        const entry: HookRunRecord = { id: randomUUID(), cwd, scope: document.scope, hookId: hook.id, event: hook.event,
          conversationId: input.conversationId, agentId: input.agentId, toolName: input.toolName, toolCallId: input.toolCallId,
          startedAt: Date.now(), durationMs: 0, status: "running", code: "ok" };
        if (!document.trusted || options.allowed === false) {
          this.publish({ ...entry, status: "skipped", code: options.allowed === false ? "restricted" : "untrusted" });
          continue;
        }
        const fresh = this.document(cwd, document.scope);
        if (!fresh.trusted || fresh.digest !== document.digest) {
          this.publish({ ...entry, status: "error", code: "changed" });
          return { allowed: false, failed: true, reason: "Hooks configuration changed during execution.", additionalContext: "" };
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        if (this.active.size >= 16) {
          options.signal?.removeEventListener("abort", abort);
          this.publish({ ...entry, status: "error", code: "busy" });
          return { allowed: false, failed: true, reason: "Too many hooks are running.", additionalContext: "" };
        }
        this.active.set(entry.id, { cwd, scope: document.scope, conversationId: input.conversationId, agentId: input.agentId, controller });
        this.publish(entry);
        let output: CommandResult;
        try { output = await this.execute(hook, { ...input, cwd }, controller.signal, Math.max(1, deadline - Date.now())); }
        catch { output = { code: "spawn", reason: `Hook ${hook.id}: spawn.`, additionalContext: "" }; }
        finally { this.active.delete(entry.id); options.signal?.removeEventListener("abort", abort); }
        const allowed = output.code === "ok";
        const failed = !allowed && output.code !== "denied";
        this.publish({ ...entry, durationMs: Date.now() - entry.startedAt, status: failed ? "error" : allowed ? "allowed" : "denied", code: output.code });
        if (output.additionalContext) result.additionalContext = `${result.additionalContext}\n${output.additionalContext}`.trim().slice(0, 16_000);
        if (!allowed) return { allowed: false, failed, reason: output.reason, additionalContext: result.additionalContext };
      }
    }
    return result;
  }
  private execute(hook: HookDefinition, input: HooksRunInput, signal: AbortSignal, remainingMs: number): Promise<CommandResult> {
    const failure = (code: HookRunCode): CommandResult => ({ code, reason: `Hook ${hook.id}: ${code}.`, additionalContext: "" });
    if (signal.aborted) return Promise.resolve(failure("cancelled"));
    let payload: string;
    try { payload = `${JSON.stringify({ ...input, version: 1 })}\n`; } catch { return Promise.resolve(failure("input-limit")); }
    if (Buffer.byteLength(payload) > 1_000_000) return Promise.resolve(failure("input-limit"));
    return new Promise(resolve => {
      const child = spawn("/bin/sh", ["-c", hook.command], { cwd: input.cwd, detached: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, VELA_HOOK_EVENT: input.event } });
      let settled = false;
      let output = "";
      let bytes = 0;
      let forced: HookRunCode | null = null;
      const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ } };
      const force = (code: HookRunCode) => { if (!forced) forced = code; kill(); };
      const abort = () => force("cancelled");
      const timer = setTimeout(() => force("timeout"), Math.min(hook.timeoutMs ?? 10_000, remainingMs));
      const finish = (result: CommandResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        // Also kill descendants left behind by a shell that exited early.
        kill();
        resolve(result);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { bytes += Buffer.byteLength(chunk); if (bytes > 65_536) force("output-limit"); else output += chunk; });
      child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65_536) force("output-limit"); });
      child.stdin.on("error", () => { /* EPIPE after an early command exit is handled by close. */ });
      child.on("error", () => finish(failure("spawn")));
      child.on("close", code => {
        if (forced) return finish(failure(forced));
        if (code !== 0) return finish(failure("exit"));
        if (!output.trim()) return finish({ code: "ok", reason: "", additionalContext: "" });
        try {
          const value: unknown = JSON.parse(output);
          if (!record(value) || Object.keys(value).some(k => !["decision", "reason", "additionalContext"].includes(k))
            || value.decision !== undefined && value.decision !== "allow" && value.decision !== "deny"
            || value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 4000)
            || value.additionalContext !== undefined && (typeof value.additionalContext !== "string" || value.additionalContext.length > 16_000)) return finish(failure("invalid-output"));
          finish({ code: value.decision === "deny" ? "denied" : "ok", reason: typeof value.reason === "string" ? value.reason : `Hook ${hook.id} denied this event.`, additionalContext: typeof value.additionalContext === "string" ? value.additionalContext : "" });
        } catch { finish(failure("invalid-output")); }
      });
      child.stdin.end(payload);
    });
  }
}
