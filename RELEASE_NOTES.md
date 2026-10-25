# Vela 1.2.4

Vela 1.2.4 is a fix-and-polish release. Packaged builds show the window and menu bar icons again, large or minified files open in the code preview without freezing the window, models with the same name from different providers can be told apart, and a subagent window reopened mid-run keeps its earlier messages.

## Improved

- **Large files in the code preview**: opening a minified bundle or a very large file no longer freezes the window. Text over 120,000 characters is shown as plain text without syntax highlighting, lines that are too long to tokenize are left uncolored, and each highlighted line has a time limit. A single line is drawn up to 3,000 characters and ends with a "line truncated" note. Rows are no longer redrawn when you select a line.
- **Same model name, different providers**: when two providers both offer an available model with the same name, the model picker label, the side chat and the task status now show the provider as well (for example `Provider · Model`), so you can tell which one is in use.
- **Subagent history**: if a subagent is still running when you reopen its window, its earlier messages are now loaded in front of the live ones instead of being skipped, and they are loaded only once.
- **Tool lines**: in the compact tool lines, a long directory path now shrinks first and the file name is cut only after the path is gone, so the file name stays readable.

## Fixed

- **Missing icons in packaged builds**: the window icon and the menu bar icon are now bundled with the app and loaded from the same place in development and in the installed app. Earlier packaged builds could not find them.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.4-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.4-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.4`. macOS bundle and download version: `1.2.4`.

## Validation

- Type checks passed for all packages, and unit tests passed in the agent (751 tests, 750 passed and one skipped), workspace (200) and desktop (1036) packages (`pnpm test`).
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of the fourteen real-Electron smoke suites passed (`pnpm test:smoke`). Task Recipes failed with `Missing button 编辑` and PR Inbox with `Loaded PRs did not refresh while working outside the inbox`; both are the same symptoms already documented in earlier releases and neither touches code changed here. The other twelve suites passed.
- macOS arm64 packaging completed (`pnpm package:mac`); the application bundle reports version `1.2.4` and identifier `com.vela.desktop`, the ZIP contains a single `Vela.app`, the DMG checksum verifies, and the packaged `app.asar` contains `icon.png` and `tray-template.png` under `out/main`.
- The signed checksum file was generated for the DMG and ZIP with the bundled-public-key check (`pnpm sign:release`).
