# Vela 1.2.8

Vela 1.2.8 groups the thinking of OpenAI reasoning models under a title together with its tool calls, adds a third tool icon color option, and only warns about overlapping edits between conversations that are still running.

## New

- **Thinking groups**: thinking from OpenAI reasoning models now folds into a group titled by its first line, with the tool calls that follow (including later rounds that have no thinking of their own) nested underneath. A collapsed group notes how many of its tools failed. Thinking from other providers is shown as before.
- **Adjustable group height**: **Settings → Conversation display → Thinking group height** caps the height of an expanded group and of the command output and edit diffs inside it. Longer content scrolls with softly blurred top and bottom edges. An optional setting shrinks the details in proportion when a group is shorter than its limit.
- **Theme-colored tool icons**: **Tool icon colors** now has three choices: **Colorful** tints icons by tool type, **Theme** uses the current theme's accent color for all of them, and **Gray** keeps them uniformly gray.

## Improved

- **Fewer false overlap warnings**: the cross-conversation edit warning now appears only while the conversations involved are still running. Finished conversations stay in **Recent edits across chats…** but no longer trigger a reminder, and the warning clears when a run ends.
- **Ultra highlight**: opening the model menu with Ultra already selected no longer replays the Ultra highlight; it plays only when you switch to Ultra.
- **Categories layout**: the chat area keeps square corners on its left edge when the sidebar collapses or expands.
- **Localization**: the new interface text is available in Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Known issues

Two real-Electron smoke checks still fail with the same symptoms documented in 1.2.6 and 1.2.7: Task Recipes reports `Missing button 编辑`, and PR Inbox reports `Loaded PRs did not refresh while working outside the inbox`. Those features were not changed in this release.

Four UI suites also fail: `mcp-settings-ui`, `side-chat-ui`, `intelligent-ui-ui` and `agent-inbox-ui`. These are four of the five suites listed as failing in 1.2.7; `workbench-chat-ui` now passes.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing tool icon color settings keep their meaning: **On** becomes **Colorful** and **Off** becomes **Gray**.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.8-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.8-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.8`. macOS bundle and download version: `1.2.8`.

## Validation

- Type checks passed for all packages. Unit tests passed in agent (761 passed, one skipped), workspace (208 passed) and desktop (1,120 passed), including the five-language in-app release-notes check (`pnpm test`). One workspace timing test (`gh executor`) failed on the first run under load and passed on re-run, both alone and in the full suite.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Thirteen real-Electron smoke suites passed, including browser annotations, browser authentication and automation, MCP, scheduled tasks, handoff, PR review response, notification sounds, settings and thinking display (`pnpm test:smoke`; see Known issues for the other two suites).
- Ten UI suites passed: plugins, memory settings, web tools, web-tool cards, chat actions, workbench chat, acceptance, races, handoff packs, updates and navigation rail (`pnpm test:ui`; see Known issues for the four failing suites).
- macOS arm64 packaging completed (`pnpm package:mac`). The application bundle and extracted ZIP report version and build `1.2.8` with identifier `com.vela.desktop`; the ZIP extracts to a single `Vela.app`, and the DMG checksum verifies and mounts successfully.
- The packaged `app.asar` contains `release-notes.json` and the application icon.
- Signed checksums were generated (`pnpm sign:release`). Both package hashes match, and the Ed25519 signature passes the application's `verifySignature` check with `updatePublicKeys`.
