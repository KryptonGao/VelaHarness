# Vela 1.2.18

Vela 1.2.18 redesigns the models and accounts settings, adds storage usage cleanup and a background tasks card, and polishes the built-in browser, onboarding and appearance options.

## New

- **Redesigned models and accounts settings**: connected built-in providers and custom providers are listed on the left, with the account, endpoint and model list of the selected provider on the right. Adding a provider has its own view, provider icons are bundled, and model vision support is shown.
- **Storage usage and cleanup**: the storage settings page shows disk capacity immediately and Vela’s usage by category (conversations, run traces, subagents, checkpoints, skills, worktrees, logs, updates, cache). Traces, logs, update packages and app cache can be cleaned, and a single conversation’s trace can be deleted. Traces in use are always kept.
- **Background tasks card**: a new info card and right-panel tab list the background shell commands started by a conversation.
- **Built-in browser**: failed pages show a full error page with retry, a loading bar shows progress, tabs display site favicons, and the blank page offers favorites shortcuts. The address bar has a subtler focus state and a larger font.
- **Independent SubAgents switch**: SubAgents can be enabled or disabled globally and per conversation. Disabling blocks new subagents without stopping running ones, and count and nesting preferences are preserved.
- **Style setting for thinking titles**: choose the weight and color of chain-of-thought summary titles.
- **Trace timeline selection**: drag across the trace timeline to select a span and jump to it in the event list.
- **Random theme generator**: generates themes under readability rules and picks the better accent text color.

## Improved

- **Onboarding**: now nine steps, with thinking summary and input prediction switches, info card layout, composer layout diagrams and the interactive UI preference. **Settings → About & updates** can redo onboarding.
- **Compact tool calls**: compact tool-call text stays gray until a clickable segment is hovered, status colors stay gray until row hover, and monospace is used for command text only.
- **Thinking indicators**: compact thinking bulbs now appear in standalone subagent panes, bulbs are aligned, thought-title colors are softer, and command animation dots are inset without changing the click target.
- **Cleaner messages**: image scaling notes added by the SDK no longer appear in the displayed text of your messages.
- New interface text is available in all five interface languages.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.18-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.18-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.18`. macOS bundle and download version: `1.2.18`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.18`; all five in-app release-note languages contain four highlights and six improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`); bundled in-app release notes match the source file.
- The application bundle reports version `1.2.18` and identifier `com.vela.desktop`. The ZIP was extracted and contains a single `Vela.app` at version `1.2.18`; the DMG checksum verified.
- Signed SHA-256 checksums were generated (`pnpm sign:release`). The signature was verified using the application’s `verifySignature` function and built-in `updatePublicKeys`, and both package hashes were recomputed and match.
- The automated test suites were not run for this release.
