# Vela 1.1.11

Vela 1.1.11 lets you place Skills anywhere in a message, adds three composer layouts, and refreshes the file preview and file tree.

## New

- **Skills anywhere in your message**: Type `/` to insert a Skill chip at the cursor, including in the middle of a sentence. Chips keep their position in the sent message and when a conversation is reopened. Pasting into the composer now keeps plain text only.
- **Composer layouts**: Choose Classic, Calm or Capsule in Settings → Interface. Calm keeps the existing structure and moves the stats into a footer band; Capsule shrinks the input into one pill, with mode, permissions and stats in a tray below. The reasoning-level control shows a small signal or dial in Calm and Capsule.
- **Refreshed file preview**: File paths appear as breadcrumbs with file-type icons, the toolbar uses new icons and dividers, and the file tree gains folder icons, indent guides and a search icon in its filter field.

## Improved

- Tool rows mark only running and failed calls; completed calls no longer show a checkmark.
- The file tree toggle moves to the right end of the preview toolbar.
- New composer layout options are translated into Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

Known validation limits: the full Electron smoke run passed 12 of 14 suites. Task Recipes and PR Inbox failed with the same symptoms already recorded for earlier releases; these failures remain unresolved.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.11-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.11-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.11`. macOS bundle and download version: `1.1.11`.

## Validation

- Type checks and unit tests passed (`pnpm test`): 188 workspace, 628 agent and 907 desktop tests passed; one agent test was skipped. One workspace `gh-run` test failed on the first run under parallel load, passed on its own, and the full run was green on rerun.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases.
- The real-Electron workbench chat UI check passed.
- macOS arm64 packaging, signed checksum generation and release asset checks are completed before publishing (`pnpm package:mac`, `pnpm sign:release`).
