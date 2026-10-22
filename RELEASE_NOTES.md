# Vela 1.1.10

Vela 1.1.10 adds lightweight side chats with memory, clearer tool and browser activity, live previews for conversation display settings, and manual model catalog refresh with Pi 1.3.0.

## New

- **Side chats with memory**: Open Side chat from a new workbench tab to ask a quick question beside your main conversation. Choose its model and reasoning level independently; when memory is enabled, global and current-project memory are included. Replies stream with stop, retry and clear controls. Side chats have no tools or access to the main conversation, and their history lasts only for the open tab.
- **Live display previews**: Hover or focus options in Settings → Conversation display to preview tool layout, grouping, timing, thinking summaries and input prediction before choosing. Tool grouping can now be turned off, and tool icons can use color.
- **Browser activity cards**: Browser calls show action summaries, script and text output, plus screenshots that can be enlarged directly in the conversation.
- **Manual model refresh**: Get the latest model list from Settings → Models & accounts without waiting for the automatic refresh interval. Pi 1.3.0 updates the model catalog and MCP integration.

## Improved

- Side chats remember their own model selection and keep that choice when you switch the main conversation or workspace. Memory is reloaded for each request.
- Compact tool rows, diff colors and failure timing are easier to read.
- A failed provider refresh preserves its cached models and reports the error; offline mode does not make network requests.
- MCP compatibility and OAuth cancellation are maintained with the Pi 1.3.0 patch.
- New controls and side chat messages are translated into Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Upgrade


Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

Known validation limits: the full Electron smoke run passed 10 of 14 suites. Browser tab closing and Settings scrollbar checks failed on the initial run and recheck; Task Recipes and PR Inbox also failed with the symptoms recorded for 1.1.9. The targeted MCP settings UI check reached its Chinese-language assertion and failed there. These failures remain unresolved.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.10-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.10-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.10`. macOS bundle and download version: `1.1.10`.

## Validation

- Type checks and unit tests passed (`pnpm test`): 188 workspace, 628 agent and 906 desktop tests passed; one agent test was skipped.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- Targeted side chat, manual model refresh and MCP agent tests passed (12, 2 and 72 tests respectively).
- The production build passed (`pnpm build`).
- The real-Electron side chat UI check passed, including independent model selection, streaming, memory status, stop, retry, tab lifecycle, narrow layout and five languages.
- Chat actions and workbench chat UI checks passed.
- Ten real-Electron smoke suites passed: Pi SDK, profile isolation, browser authentication, browser use, MCP, scheduled tasks, handoff, PR review response, notification sounds and thinking blur.
- macOS arm64 packaging completed (`pnpm package:mac`); the application bundle reports version `1.1.10` and identifier `com.vela.desktop`.
- The signed checksum file was generated for the DMG and ZIP with the bundled-public-key check (`pnpm sign:release`).
