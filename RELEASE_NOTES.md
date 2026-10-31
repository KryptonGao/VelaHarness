# Vela 1.2.16

Vela 1.2.16 makes the app noticeably smoother when many subagents stream at once, and removes the blank gap that could appear under short expanded thinking groups.

## Improved

- **Smoother with many subagents**: streamed text and thinking from subagents are coalesced before they reach the interface, so a busy roster no longer floods the window with updates.
- **Fewer redundant refreshes**: full state broadcasts triggered by the main agent’s tool calls are throttled, and no-op agent updates are skipped, which cuts idle CPU and IPC traffic during long runs.
- **Lighter rendering**: the agent roster, chat view and entry animations avoid repeated full scans, the elapsed-time clocks share a single ticker, and completed turns are rendered lazily.
- **Thinking groups fit their content**: when a thinking group grows together with its details, a short group now shrinks to its content instead of leaving an empty gap.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.16-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.16-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.16`. macOS bundle and download version: `1.2.16`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.16`; all five in-app release-note languages contain four highlights and four improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`); bundled in-app release notes match the source file.
- The application bundle reports version `1.2.16` and identifier `com.vela.desktop`. The ZIP was extracted and contains a single `Vela.app` at version `1.2.16`; the DMG checksum verified and the image mounted successfully with the matching application.
- Signed SHA-256 checksums were generated (`pnpm sign:release`). The signature was verified using the application’s `verifySignature` function and built-in `updatePublicKeys`, and both package hashes were recomputed and match.
- The automated test suites were not run for this release.
