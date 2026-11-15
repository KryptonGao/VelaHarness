# Approval Choices

Status: implemented in `@vela/workspace` (`permission-rules.ts`, `SandboxPermissionManager`) and the approval card in the composer.

The sandbox mode (`ask` / `smart` / `full`) is the default. The approval card adds four choices, and two of them are remembered for the current project:

| Choice | Effect |
| --- | --- |
| Allow once | Allows this request. Nothing is remembered. |
| Always allow | Allows this request and the same kind of request in this project from now on, without a prompt or a model check in `ask` and `smart`. |
| Deny | Refuses this request. Nothing is remembered. |
| Always deny | Refuses this request and the same kind of request in this project from now on, in every mode including `full`, without asking. |

Esc on the card is Deny. The card is a separate card above the input box, not part of it.

## What gets remembered

A remembered choice is a rule such as `Bash(git status *)`. The card lists the exact rules under the command ("Always allowed in this project: ..." and "Always denied in this project: ..."), and a button's tooltip shows the same list. A button is hidden when there is nothing safe or meaningful to remember:

- **Always allow** is offered only for a short allowlist: read-only and inspection commands (`ls`, `cat`, `grep`, `rg`, `git status|diff|log|show|branch|add|commit` ...), build and test scripts (`pnpm test`, `npm run build`, `cargo test` ...), a named web host (`Web(domain:host)`), and one exact MCP tool (`Mcp(server/tool)`). A compound command gets one rule per sub-command and none if any part is off the list. Shells, interpreters, `rm`, `curl`, `sudo`, `find`, package installs, `git push`, substitutions, file redirections, file writes and Browser REPL never get it. `rg --pre` and `--hostname-bin` are excluded.
- **Always deny** is broader. A command is denied by its program (`Bash(rm *)`), or by program and verb for `git`, `pnpm`, `npm`, `cargo` and similar (`Bash(git push *)`). In a compound command only the parts that are not on the allow list are denied, so `pwd && rm x` denies `rm`, not `pwd`. A file write is denied by its exact path (`Edit(/abs/path)`). Browser REPL and background tasks are not offered.
- Neither button appears when the request has no project, or when the agent is rewriting the record file itself.

The rules are derived by the main process from the pending request. The UI only says "remember this choice"; it never sends rule text.

## Where it is stored

`project-permissions.json` next to `vela-settings.json` (`~/.vela`, or `~/.vela-dev` in development), grouped by the project's real path:

```json
{
  "version": 1,
  "projects": {
    "/Users/me/code/app": { "allow": ["Bash(git status *)", "Bash(pnpm test *)"], "deny": ["Bash(rm *)"] }
  }
}
```

It is deliberately outside the repository, so a cloned project cannot ship pre-approved commands. There is no settings page yet; to undo a choice, delete its line from this file, which is reread on the next request. An unparsable file or entry is ignored, which also means a remembered deny stops applying until the file is fixed. Writes to this file by the agent always prompt unless in `full` mode.

A remembered deny wins over a remembered allow. The Agent Inbox approval view has only Allow and Deny.

## Rule syntax

`Tool(specifier)`, case-insensitive tool name. A bare tool name matches every call of that tool.

| Rule | Applies to | Specifier |
| --- | --- | --- |
| `Bash(...)` | `bash` tool, including background commands | Command pattern, `*` matches anything |
| `Edit(...)`, `Write(...)` | `edit`, `write`, `mkdir` (aliases) | Path pattern |
| `Web(...)` | Web fetch | `domain:example.com` (the host and its subdomains) or a URL pattern with `*` |
| `Mcp(server/tool)`, `mcp__server__tool` | MCP tool calls | `server` or `server/tool`, `*` allowed |

- `Bash(git status *)` matches `git status` and `git status --short`, not `git statusx`.
- The command is split at unquoted `&&`, `||`, `;`, `|`, `&`, newlines and parentheses, and commands inside `$(...)`, backticks and `<(...)` are extracted.
- **Allow is strict.** Every sub-command must match, and a command with a substitution, heredoc, unterminated quote or file-writing redirection (anything but `2>&1` and `/dev/null`) is never auto-allowed. Wrappers do not widen an allow: `sudo git status` does not match `Bash(git status *)`.
- **Deny is broad.** It matches any sub-command, any nested command, the whole line, and the command behind `sudo`, `env`, `time`, `nohup`, leading `VAR=value`, shell keywords such as `do` and `then`, and an absolute path to the binary. It is a matcher, not a shell: `sudo -u root rm` can slip past `Bash(rm *)`.
- Path patterns are gitignore-style: no `/` matches any path component (`.env*`), a `/` makes it workspace-relative (`src/**`), `/abs` and `~/x` are absolute. Matching ignores case and resolves `..` first. `Edit` rules cover the file tools only, not `cat` or `>` in a shell.

Rules are matched against the text the agent sends, so they cannot see what a script does internally.
