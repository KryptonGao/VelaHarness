# Vela 1.2.17

Vela 1.2.17 adds an optional translucent sidebar card, and makes thinking groups follow the model that actually wrote each message instead of the one currently selected.

## New

- **Translucent sidebar card**: in the Categories navigation layout, **Settings → Appearance → Sidebar card** lets the card laid over the window glass show the glass through it. It stays more opaque than the surrounding frame and keeps its own color, so the two remain distinct. The option is available in all five interface languages.

## Improved

- **Thinking groups follow the source model**: grouped thinking is applied only to messages written by GPT models, judged by each message’s own model and provider rather than the model selected in the composer. Messages of unknown origin fall back to ordinary thinking.
- **Raw thinking summaries restored**: messages from other models show their original thinking summary again instead of being folded into a group.
- **Correct in mixed conversations**: switching models mid-conversation no longer changes how earlier messages are displayed, in the main chat and in subagent panes. The runtime now reports the model and provider with each assistant message.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.17-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.17-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.17`. macOS bundle and download version: `1.2.17`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.17`; all five in-app release-note languages contain four highlights and four improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`); bundled in-app release notes match the source file.
- The application bundle reports version `1.2.17` and identifier `com.vela.desktop`. The ZIP was extracted and contains a single `Vela.app` at version `1.2.17`; the DMG checksum verified and the image mounted successfully with the matching application.
- Signed SHA-256 checksums were generated (`pnpm sign:release`). The signature was verified using the application’s `verifySignature` function and built-in `updatePublicKeys`, and both package hashes were recomputed and match.
- The automated test suites were not run for this release.
