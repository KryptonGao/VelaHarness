# Vela 1.1.2

Vela 1.1.2 adds task handoff packs and an outcome acceptance panel, making it easier to continue work in a new conversation and review what changed, what was verified, and what still needs attention.

## New

- **Task handoff packs**: choose **Generate handoff pack…** from the conversation actions menu after a reply finishes. Review the goal, confirmed decisions, changed files, recorded checks, and unfinished work; edit the summary and create a new conversation in the same workspace with the handoff text ready in its composer. You decide when to send it.
- **Evidence-based handoffs**: changed files and verification results come from conversation tool records and file checkpoints. The conversation's model summarizes only the goal, decisions, and unfinished work; model-invented files and checks are discarded. If the model is unavailable or fails, Vela offers a pack built from recorded facts. Commands and output excerpts are redacted for sensitive values.
- **Outcome acceptance panel**: a completed work reply can open an Acceptance tab in the workbench. Review each requirement alongside its changes, recorded verification evidence, and items that need confirmation. File links open the corresponding turn diff, and checks show their recorded command and output, with failures expanded by default.
- **Validated outcome references**: agents can associate requirements with completed file edits and bash calls from the current user turn. Invalid references are rejected. The panel keeps failed, potentially stale, missing, and unassigned evidence visible; an agent's completion claim alone does not count as a passed requirement. Conversations without an explicit submission can show a conservative summary derived from recorded edits and checks.

## Improved

- A **Jump to latest** button helps return to the newest messages after scrolling away from a streaming reply.
- Internal prompts for agent interactions, memory, scheduled tasks, text assistance, summaries, and operation risk review now use English, with response-language guidance retained where applicable.
- Conversation export and turn review share file-diff helpers, and acceptance links can locate individual edits within a turn.
- New handoff and acceptance interface text is available in Simplified Chinese, English, Traditional Chinese, Japanese, and Korean.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.2-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.2-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.2`. macOS bundle and download version: `1.1.2`.

## Validation

- Type checks and all 1,593 unit tests passed (`pnpm test`): 169 workspace, 573 agent, and 851 desktop tests.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- All four targeted real-Electron UI suites passed: chat actions, outcome acceptance, handoff packs, and updates.
- Eleven real-Electron smoke suites passed, including the new end-to-end handoff flow, Pi SDK compatibility, profile isolation, browser workflows, MCP, scheduled tasks, PR review responses, notification sounds, and settings.
- The signed, packaged Vela 1.1.2 application launched and initialized its runtime using isolated test data.
- Both distribution packages contain a valid ad-hoc signed application bundle with version `1.1.2` and identifier `com.vela.desktop`; the zip contains only `Vela.app`, and the DMG mounted successfully.
- The application's updater verified the release checksum signature against its built-in public key, and both package SHA-256 checksums matched.
