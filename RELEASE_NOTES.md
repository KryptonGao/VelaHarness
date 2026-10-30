# Vela 1.2.9

Vela 1.2.9 adds a Coherent grouping mode that gathers all thinking and tool calls between two replies into one group, can grow a group when you expand command or edit details, gives reading and editing files their own icons, and fixes a notch that could appear in the chat area while the sidebar moved.

## New

- **Coherent grouping**: **Settings → Conversation display → Thinking grouping** now has two modes. **One group per thought** keeps the 1.2.8 behavior, where each reasoning summary from an OpenAI reasoning model forms its own group titled by its first line. **Coherent** treats formal reply text as the only boundary: every thought and tool call between two replies forms one group, each returned summary is shown inside it in order, and the collapsed title sums up the edits, reads and commands. Groups with only a few tool calls are shown flat instead of folded.
- **Grow groups when details expand**: an optional setting under **Thinking group height** grows a group when you expand command or edit details. The gap between the group and the detail limits is kept, and the group never exceeds its limit. When enabled it takes priority over proportional shrinking; it is off by default.
- **File-style tool icons**: reading and editing files now use their own file icons, so they are easier to tell apart from other tools.

## Improved

- **Steadier running groups**: a thinking group stays live while any of its tools is still running, even after reply text appears. Later tool rounds stay under the thought they belong to instead of being cut off by reply text.
- **Categories layout**: fixed a missing corner on the chat area while the sidebar opened or closed.
- **Localization**: the new interface text is available in Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Known issues

Two real-Electron smoke checks still fail with the same symptoms documented in 1.2.6 through 1.2.8: Task Recipes reports `Missing button 编辑`, and PR Inbox reports `Loaded PRs did not refresh while working outside the inbox`. Those features were not changed in this release.

Four UI suites also fail, the same four as in 1.2.8: `mcp-settings-ui`, `side-chat-ui`, `intelligent-ui-ui` and `agent-inbox-ui`.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Thinking grouping defaults to **One group per thought**, so existing conversations look the same until you switch modes.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.9-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.9-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.9`. macOS bundle and download version: `1.2.9`.

## Validation

- Type checks passed for all packages. Unit tests passed in agent (761 passed, one skipped), workspace (208 passed) and desktop (1,141 passed), including the five-language in-app release-notes check (`pnpm test`).
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Thirteen of fifteen real-Electron smoke suites passed, including settings and thinking blur (`pnpm test:smoke`; see Known issues for the other two suites).
- Eleven of fifteen UI suites passed: plugins, memory settings, web tools, web-tool cards, chat actions, workbench chat, acceptance, races, handoff packs, updates and navigation rail (`pnpm test:ui`; see Known issues for the four failing suites).
- macOS arm64 packaging completed (`pnpm package:mac`). The application bundle and extracted ZIP report version and build `1.2.9` with identifier `com.vela.desktop`; the ZIP extracts to a single `Vela.app`, and the DMG checksum verifies and mounts successfully.
- The packaged `app.asar` contains `release-notes.json` and the application icon.
- Signed checksums were generated (`pnpm sign:release`). Both package hashes match, and the Ed25519 signature passes the application's `verifySignature` check with `updatePublicKeys`.
