# Vela 1.2.34

Vela 1.2.34 lets a chat run in its own Git worktree and hand its changes back, adds a user-defined model pool for subagents with direct messaging and usage accounting, and makes the Run View todo list optional. It also renames the Midnight theme to a plain neutral Dark theme and fixes several settings and usage issues.

## New

- **Worktree chats with hand-off**: a chat can run in a session-level Git worktree, so its edits stay separate from your main checkout until you hand them off. The environment chip in the composer creates the worktree and hands the changes over, and clear messages explain when a worktree can't be created (not a Git repository, or no commits yet) or when the agent is still running.
- **Subagent model pool**: a new Subagent models settings page holds an available pool and an allowed pool. `spawn_agent` takes an optional model from the allowed pool, which is listed in the system prompt and saved with your selection. The chosen model appears in the Agent pane, the roster menu, and the spawn card.
- **Message subagents directly**: send a message straight to a subagent from its pane. It is queued until the subagent's current turn ends, and the main agent is told silently so it doesn't mistake the reply for work it dispatched.
- **Subagent requests in usage statistics**: every subagent model request is recorded under its own model, so the Usage page, cost totals, and latest-task cost include subagents.

## Improved

- **Optional todo list**: the Run View todo list no longer blocks `bash`, `edit`, and `write` until it exists. The model can explore with read-only commands first, submit a 2–7 item list for multi-step tasks, and skip it for simple ones.
- **Dark theme**: the Midnight theme is now a plain neutral dark theme named Dark.
- **Accurate subagent model labels**: each subagent shows the model it actually runs on (the parent's model when none was chosen) by its display name, and history restores it from the subagent's own session file.
- **Subagent model pool saving**: saving from the Subagent models page now keeps your changes instead of echoing back the old pool.
- **Settings and Usage layout**: the provider model list in model settings scrolls, the usage statistics title lines up with its content, and provider labels no longer wrap.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.34-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.34-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.34`. macOS bundle and download version: `1.2.34`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.34`; all five in-app release-note languages contain four highlights and five improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version checks; the bundle identifier is `com.vela.desktop`. The packaged app contains the final in-app release notes (`1.2.34`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.

The automated test suites were not run for this release, as requested.
