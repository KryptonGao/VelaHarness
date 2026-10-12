# Vela 1.1.4

Vela 1.1.4 adds custom light and dark themes, independent model and reasoning settings for the Resident Agent, and a more capable resident conversation view.

## New

- **Make your own themes**: Create light and dark palettes in Settings → Appearance with four colors: background, cards and panels, text, and accent. Name, edit, save, and delete your themes.
- **Preview your palette**: Adjust colors with a picker or hex values and see a live conversation preview. A contrast hint helps you spot text that may be hard to read.
- **Choose a model for Resident Agent**: Set a separate model and reasoning level for the resident conversation and its background tasks, or follow your new-conversation defaults. Your app-wide model settings stay unchanged.
- **A more useful resident conversation**: Read Markdown, copy messages, and edit a previous user message to send it again. Resending creates a new message and keeps the existing history.

## Improved

- Idle resident conversations apply model changes immediately; conversations already replying apply them before the next submission.
- Reasoning levels follow model support, and unavailable selected models report an error instead of silently switching.
- Custom theme colors are restored at startup; deleting a selected custom theme falls back to the default palette.
- Resident chat, task recipes, terminal controls, and activity indicators receive more consistent spacing and controls.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.4-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.4-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.4`. macOS bundle and download version: `1.1.4`.

## Validation

- Type checks and all 1,618 unit tests passed (`pnpm test`): 169 workspace, 577 agent, and 872 desktop tests.
- All 42 targeted custom-theme and resident-execution tests passed.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- The Agent Inbox and updates real-Electron UI suites passed, including resident model and reasoning controls and rendering in all five languages.
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes (missing Edit button) and PR Inbox (idle refresh timeout) failed on both this release and an isolated build of the unchanged 1.1.3 commit; these existing failures remain unresolved.
- The packaged 1.1.4 app launched with isolated data, loaded release notes in all five languages, and passed custom-theme creation, application, reload persistence, deletion fallback, and release-card dismissal persistence checks.
- The ad-hoc signed application bundle has version `1.1.4` and identifier `com.vela.desktop`; the ZIP contains only `Vela.app`, and the DMG mounted successfully with a valid application signature.
- The updater verified the checksum signature against its built-in public key, and both package SHA-256 checksums matched.
