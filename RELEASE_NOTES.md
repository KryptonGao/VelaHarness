# Vela 1.2.19

Vela 1.2.19 adds custom interface and code font sizes, a new minimal logo and a Codex-style thinking group mode, and makes the composer adapt to narrow windows.

## New

- **Custom font sizes**: **Settings → Appearance** now has separate sizes for the interface (11–15px) and for code (8–24px). Font sizes across the interface scale from these two settings, monospace text (code blocks, diffs, commands and the terminal) follows the code size, and the choice is applied before the first paint.
- **New minimal logo**: the app icon is now a white tile with a black arm-and-sail V and no text. The sidebar header shows the mark with a geometric VELΛ wordmark that follows the theme color.
- **Codex-style thinking groups**: a new thinking group mode shows only the tool calls, without a guide line, for a lighter and more compact view of what the agent did.
- **Composer fits narrow windows**: the composer tray now collapses step by step on narrow widths instead of overflowing, so the model, sandbox and other controls stay reachable.

## Improved

- **Serif reply text**: slightly heavier, with a faint stroke for CJK serif fonts so that thin strokes stay readable.
- **Start page**: the capsule composer has a faint edge shadow that lifts it off the background.
- **Workbench tabs**: file type icons are larger and easier to recognize.
- **Conversation titles**: title requests no longer send an unsupported `temperature` parameter, so titles are generated again with models that reject it.
- New interface text is available in all five interface languages.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.19-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.19-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.19`. macOS bundle and download version: `1.2.19`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.19`; all five in-app release-note languages contain four highlights and six improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`); bundled in-app release notes match the source file.
- The application bundle reports version `1.2.19` and identifier `com.vela.desktop`. The ZIP was extracted and contains a single `Vela.app` at version `1.2.19`; the DMG checksum verified.
- Signed SHA-256 checksums were generated (`pnpm sign:release`). The signature was verified using the application’s `verifySignature` function and built-in `updatePublicKeys`, and both package hashes were recomputed and match.
- The automated test suites were not run for this release.
