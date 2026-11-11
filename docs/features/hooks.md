# Lifecycle Hooks

Status: implemented on the development branch. Hooks currently support **command handlers**, not prompt/LLM, HTTP, or detached asynchronous handlers. They are separate from Git's own hooks and Pi extensions.

## Configure and authorize

Open **Settings → Hooks** in an open workspace. Select Global or Project, add a disabled event example or paste JSON, edit the command, enable the rule, and save. Review the saved commands and explicitly authorize native execution. Saving does not authorize execution. Changes to either configuration file invalidate that file's authorization, including external edits and whitespace changes.

| Scope | File | Authorization |
| --- | --- | --- |
| Global | `<agentDir>/hooks.json` (normally `~/.vela/hooks.json`, or `~/.vela-dev/hooks.json` in development) | Explicit approval of its exact SHA-256 digest |
| Project | `<cwd>/.vela/hooks.json` | Explicit approval of its exact digest and canonical workspace path |

Approvals live in `<agentDir>/hooks-trust.json`, not in the repository. Project approvals do not transfer to another workspace or worktree. Global rules run before project rules; file order is preserved within a scope. All matching enabled rules compose; a blocking denial stops that chain. Neither scope overrides the other by ID.

Configuration is reread for every event and approval is rechecked before every command. Reload detects external changes. Saves use the revision originally loaded, so a stale editor cannot silently overwrite another writer. Drafts survive scope changes and settings navigation for the lifetime of the renderer, but are not persisted to disk or local storage. Discarding a dirty draft requires confirmation. Removing a rule or toggling its checkbox edits the draft and requires saving and reauthorization.

```json
{
  "version": 1,
  "hooks": [
    {
      "id": "format-after-edit",
      "event": "PostToolUse",
      "matcher": "edit",
      "command": "node scripts/format-hook.mjs",
      "timeoutMs": 10000,
      "enabled": true
    },
    {
      "id": "check-before-commit",
      "event": "PreCommit",
      "command": "node scripts/check-commit-hook.mjs",
      "timeoutMs": 60000,
      "enabled": true
    }
  ]
}
```

`id` must be unique within its file, use letters/digits/underscore/hyphen, and contain 1–64 characters. `event` and `command` are required. Unknown fields are rejected. Optional `enabled` defaults to true. `matcher` is an anchored tool-name glob using `*` and `?`, not a regex or shell expression; it is supported only for tool and commit events. Omit it to match every tool. For MCP, use the actual runtime tool name, such as `mcp__server__*`.

## Event semantics

| Event | When | Result |
| --- | --- | --- |
| `SessionStart` | Before the first agent run of a created, resumed or reloaded runtime session; deferred while the session is read-only | Can stop startup. A denied startup can be retried after repairing its configuration. Additional context is inserted as an untrusted custom message. |
| `PreToolUse` | Before native or MCP tool execution, after the runtime mode/budget guards | Can block execution. Denial becomes a tool result so the agent can choose an allowed alternative. Execution failures terminate the tool batch and report an error. |
| `PostToolUse` | After a tool result, awaited before the next provider request | Observational. Failure or denial is appended as a diagnostic, never changes the original tool's success or undoes its side effects. |
| `Stop` | At a successfully completed agent settlement boundary, after queued continuations have settled | A denial requests another model turn with its reason. At most two repair continuations are allowed per run; a third denial or an execution failure reports an error. Does not run on user abort or failed model activity. Receives final assistant text as `response`, excluding thinking. |
| `PreCommit` | In the desktop Git service after requested staging and before `git commit`; also before recognizable agent `bash` calls containing `git … commit` | Can refuse the commit. Existing Git hooks and signing remain active. UI commit denial leaves staged changes and the commit draft intact. |

Hooks are installed for root sessions and general subagents, including background, scheduled and recipe runs that share the runtime. They never execute native commands in Plan, explore/read-only subagents, resident coordinators, read-only recipe stages, or after budget exhaustion. Skipped tool/settlement hooks can still produce metadata records. Side chats and independent model-assistance requests do not run lifecycle hooks.

**PreCommit is not a universal Git firewall.** The desktop Git service has an exact boundary, but arbitrary shell scripts, aliases, `eval`, absolute Git executable paths, Browser REPL, or remote tools cannot be reliably classified from their text. The agent-shell detector is only a convenience. Use `PreToolUse` for a broader tool policy and actual Git hooks/server-side protection for repository-wide enforcement. Calls made inside a hook command do not recursively trigger Vela hooks.

## Command protocol

Commands run as `/bin/sh -c <command>`, with the canonical workspace as cwd and the inherited application environment. `VELA_HOOK_EVENT` contains the event name. There is no shell interpolation of tool input: input is delivered as one JSON document on stdin.

```json
{
  "version": 1,
  "event": "PreToolUse",
  "cwd": "/path/to/workspace",
  "conversationId": "conversation-id",
  "agentId": "optional-child-id",
  "toolName": "write",
  "toolCallId": "call-id",
  "toolInput": { "path": "src/example.ts", "content": "..." }
}
```

`PostToolUse` also receives `toolResult` (`content` and `details`) and `isError`. `Stop` receives `response`. Desktop `PreCommit` receives `toolName: "git.commit"` and `commit` (title, body, amend and stagePaths). Agent-shell `PreCommit` receives the original bash input instead.

Exit 0 with empty stdout means allow. Otherwise stdout must be exactly one JSON object:

```json
{
  "decision": "allow",
  "reason": "Optional reason",
  "additionalContext": "Optional data to give the agent"
}
```

`decision` defaults to `allow`; use `deny` to refuse. `reason` is at most 4,000 characters and `additionalContext` at most 16,000. Output is untrusted data, not instructions or a grant of permissions. Pre-tool context is delivered before the next model turn; post-tool context is appended to the result. For an allowed Stop, extra context is not consumed because no next model turn is requested. Desktop PreCommit only uses the allow/deny decision and reason.

Nonzero exit, invalid JSON/protocol, timeout, cancellation, excessive output, or inability to spawn fail closed at blocking boundaries. stderr is drained and bounded but is not interpreted or copied to the model/history. Put human-readable diagnostics in `reason`; send build logs to stderr rather than stdout.

Example `scripts/check-commit-hook.mjs`:

```js
import { spawnSync } from "node:child_process";
const check = spawnSync("pnpm", ["typecheck"], { stdio: ["ignore", "ignore", "inherit"] });
console.log(JSON.stringify({
  decision: check.status === 0 ? "allow" : "deny",
  reason: check.status === 0 ? "Typecheck passed." : "Typecheck failed. Fix it before committing."
}));
```

A Stop handler that repeatedly returns `deny` will exhaust the repair limit. A script that exits nonzero reports an execution error rather than asking the model to repair a check; return exit 0 with `decision: "deny"` for a repairable check failure.

## Safety and resource limits

Authorizing a hook authorizes **native code execution without per-invocation approval**, independently of the tool's ordinary approval prompt. Hooks can modify files, access the network, inherit environment credentials, and receive secrets present in tool arguments/results. They are not an OS sandbox. Only approve code you trust. Approval hashes the configuration, not the contents of scripts or binaries it references; changing a referenced script does not change the configuration digest.

- Up to 64 definitions per scope; 128 KB configuration; 8,192 characters per command.
- Default 10-second timeout; configurable 100–120,000 ms; total event chain limited to 120 seconds.
- At most 16 concurrently running commands; 1 MB stdin; 64 KB combined stdout/stderr.
- Timeout, cancellation, saving a scope or revoking its trust kills active commands in that scope. User stop and runtime shutdown cancel active runs. The process group is killed so ordinary descendants do not linger. This does not provide containment against malicious code that daemonizes or escapes its process group.
- Symbolic-link configuration files/directories are rejected. Malformed or unapproved documents never execute commands; settings and skipped records expose their state. A configuration that changes during a trusted multi-rule chain stops the chain.
- Hooks may mutate files and therefore conservatively invalidate unfinished Goal validation when they start. Ordinary file checkpoints still apply, but are not a rollback of external hook effects.

## Test and observe

**Test run** requires current approval and a matching enabled rule. A second confirmation explains that commands really execute. It uses synthetic `toolInput`/`toolResult` marked `hookTest: true`; it does not invoke the simulated tool or create a commit. It can still modify files through the configured commands. No-match tests fail rather than reporting a false success. While a test runs, **Revoke authorization and stop test** cancels the scope's running commands and revokes its approval. Revocation remains possible even if the configuration changed externally; another test requires reviewing and authorizing the current configuration again.

Settings show the latest 200 run records during the current app process: event, scope, rule, tool, conversation/agent association, status, reason code and duration. Conversation traces persist metadata nodes with running/final status and timing. Hook metadata excludes command text, stdin, raw stdout and stderr. Returned context and denial reasons that are sent to the agent are still persisted as ordinary conversation/model context; do not return secrets there.

Test results expose the returned `reason` and `additionalContext` in an escaped, collapsible preview. This preview is volatile and is not included in the metadata history.

Reason codes include `untrusted`, `restricted`, `invalid-config`, `changed`, `timeout`, `cancelled`, `output-limit`, `input-limit`, `invalid-output`, `exit`, `spawn`, and `busy`. Review the command and protocol in Settings when a run fails.

## Implementation and checks

- Shared schema/API: `packages/shared/src/hooks.ts`.
- Configuration, approval, process supervision, history: `packages/agent/src/hooks-service.ts`.
- Awaited lifecycle boundaries and bounded Stop continuation: `packages/agent/src/hooks-extension.ts` and `runtime.ts`.
- Desktop Git boundary: `packages/workspace/src/git-service.ts` and `apps/desktop/src/main/index.ts`.
- Validated main-frame IPC and management UI: `apps/desktop/src/main/hooks-host.ts`, preload API, `HooksSettingsSection.tsx`.
- Focused checks: `pnpm test:hooks`; real Electron renderer: `pnpm test:hooks:ui`.
- Built-app end-to-end check: `pnpm build && pnpm --filter @vela/desktop test:settings:electron`. It saves and approves a rule through the actual renderer/preload/main chain, executes a native test command in a temporary workspace, verifies its file effect and live history, and revokes authorization.

The focused suite covers schema validation, exact trust and invalidation, canonical workspaces, revision conflicts, symlinks, matching/order, protocol errors, cancellation/descendants, size bounds, metadata privacy, native runtime lifecycle boundaries, bounded Stop repair, read-only restrictions, IPC origin checks, and the real Git commit guard. The renderer suite covers editing, enable/remove/save, approval review, test confirmation, draft retention/conflicts, live history, five locales and narrow layout.
