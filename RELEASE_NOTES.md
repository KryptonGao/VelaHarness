# Vela 1.2.0

Vela 1.2.0 adds a Run View that keeps a live todo list and step status in the conversation, an Info Cards layout for the side panel, new font controls, and a new animated "jump to latest" orb.

## New

- **Run View**: Turn it on under Settings → Conversation Display (off by default). While a task runs, a todo list and a status line (animation plus the current step, such as Thinking, Running Command or Reading Files, with elapsed time) appear at the end of the turn and scroll with the conversation. In Agent and Goal modes the model is asked to submit a todo list through the new `update_todos` tool before it runs commands or edits files; reading tools are not restricted.
- **Info Cards layout**: A third option for the information panel (Settings → Interface → Info layout). A column of cards floats over the conversation: Environment, Goal, Plan, Context, Outputs, Changes, Sub-agents and Tools. Drag the handle (or use Space and the arrow keys) to reorder, click a title to collapse, hide cards and bring them back from the tray, or restore the default layout. Your layout is saved and survives upgrades.
- **Font settings**: Choose Latin and CJK fonts separately for the interface and for model replies, each as sans-serif or serif. Replies can follow the interface font. Serif Latin uses the same serif as the Claude app and falls back to Georgia when it is not installed.
- **Animated orb**: The "jump to latest" button and the inline activity indicator now use a canvas-drawn orb with several styles for thinking and for running commands, rotating smoothly instead of cutting between them.

## Improved

- Spacing between CJK text and Latin letters or digits in replies is now controlled by Vela instead of the browser's fixed 1/8 em; copied text stays identical to the original.
- Refinements to the thinking block, plan panel, review view, composer mode and sandbox chips, and the browser view host.
- Japanese, Korean and Traditional Chinese translations for the new settings and cards are included.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.0-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.0-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.0`. macOS bundle and download version: `1.2.0`.

## Validation

- Type checks passed, and unit tests passed in the workspace (191) and agent (703, one skipped) packages. In the desktop package 951 of 952 tests passed; the one failure, `script UI check timeout cleans up its own child processes`, fails with `kill EPERM` in the full run on this machine but passes when run on its own.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases; these failures remain unresolved.
- macOS arm64 packaging completed (`pnpm package:mac`); the application bundle reports version `1.2.0` and identifier `com.vela.desktop`, the ZIP contains a single `Vela.app`, and the DMG checksum verifies.
- The signed checksum file was generated for the DMG and ZIP with the bundled-public-key check (`pnpm sign:release`).
