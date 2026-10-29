# Vela 1.2.7

Vela 1.2.7 warns you when two conversations edit the same file, adds a category-based navigation layout, and lets you switch the Changes view between uncommitted, staged, committed and branch diffs.

## New

- **Cross-conversation edit warnings**: when several conversations edit the same file, Vela shows a reminder and lists which conversations overlap. You can move one of them into its own worktree (a new branch created from the current HEAD, with a new conversation opened inside it) so the changes stop overwriting each other. Uncommitted changes in the original directory are not moved. The new **Recent edits across chats…** item in the chat actions menu shows the files each conversation edited in the last six hours.
- **Categories navigation layout**: choose **Categories** under Settings → Interface → Navigation layout to add an icon rail at the far left for Home, Scheduled Tasks, Task Recipes, Agent Inbox and Settings. The sidebar then shows only the conversation list and collapses while you are on another category. **Classic** keeps the single sidebar.
- **Filtering the Changes view**: switch between the last turn, uncommitted, unstaged, staged and committed changes, or compare against a branch or a single commit. Diffs that are too large show a partial preview.

## Improved

- **Quieter scrollbars**: scrollbars in the Agent Inbox, Task Recipes, Scheduled Tasks, Pull Requests and Settings pages now appear only while you scroll.
- **Overlap accuracy**: only files changed through the `edit` and `write` tools count. Changes made through the shell or by other programs cannot be attributed to a conversation, and files with the same name in different worktrees are not treated as overlapping.
- **Consistent pages**: pages in the Categories layout share the same top bar and spacing.
- **Localization**: the new interface text is available in Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Known issues

Two real-Electron smoke checks still fail with the same symptoms documented in 1.2.6: Task Recipes reports `Missing button 编辑`, and PR Inbox reports `Loaded PRs did not refresh while working outside the inbox`. Those features were not changed in this release.

Five UI suites also fail: `mcp-settings-ui`, `workbench-chat-ui`, `side-chat-ui`, `intelligent-ui-ui` and `agent-inbox-ui`. These are the same five suites listed as failing in 1.2.6.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. The navigation layout defaults to the existing layout; switch to Categories in Settings if you want it.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.7-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.7-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.7`. macOS bundle and download version: `1.2.7`.

## Validation

- Type checks passed for all packages. Unit tests passed in agent (761 passed, one skipped), workspace (208 passed) and desktop (1,107 passed), including the five-language in-app release-notes check (`pnpm test`).
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Thirteen real-Electron smoke suites passed, including browser annotations, browser authentication and automation, MCP, scheduled tasks, handoff, PR review response, notification sounds, settings and thinking display (`pnpm test:smoke`; see Known issues for the other two suites).
- Ten UI suites passed: plugins, memory settings, web tools, web-tool cards, acceptance, races, handoff packs, updates, navigation rail and chat actions (`pnpm test:ui`; the chat actions suite was updated for the new menu item and re-run on its own; see Known issues for the five failing suites).
- macOS arm64 packaging completed (`pnpm package:mac`). The application bundle and extracted ZIP report version and build `1.2.7` with identifier `com.vela.desktop`; the ZIP extracts to a single `Vela.app`, and the DMG checksum verifies and mounts successfully.
- The packaged `app.asar` contains `release-notes.json` and the application icon.
- Signed checksums were generated (`pnpm sign:release`). Both package hashes match, and the Ed25519 signature passes the application's `verifySignature` check with `updatePublicKeys`.
