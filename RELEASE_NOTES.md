# Vela 1.2.14

Vela 1.2.14 adds back and forward navigation, pinned workspaces, and workspace hover cards. It also makes expanded tool details easier to recognize and opens subagent tabs when you choose them.

## New

- **Back and forward navigation**: move between pages and conversations with the window navigation buttons, ⌘[ and ⌘] shortcuts on macOS, or mouse side buttons. Navigation skips conversations that have been deleted.
- **Pinned workspaces**: keep frequently used workspaces in a separate Pinned section. Pins and the section’s collapsed state are remembered.
- **Workspace hover cards**: hover over a workspace to see its chat count and folder paths, pin or unpin it, or open its settings.

## Improved

- **Subagent tabs on demand**: agent panes open when you select an agent, keeping the workbench focused on the panes you choose.
- **Clearer expanded state**: expanded tool and thinking rows keep their chevrons visible without revealing the arrows of nested, collapsed items.
- **File creation indicator**: completed file writes show a small creation indicator in both regular and compact tool cards.
- **Easier-to-read file changes**: compact tool rows show added and removed line counts before the detail toggle, with lighter typography for change counts in tool cards.
- **Smoother workspace collapse**: workspace groups close with a gentler animation while retaining their quick opening transition.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.14-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.14-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.14`. macOS bundle and download version: `1.2.14`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.14`; all five in-app release-note languages contain four highlights and four improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`); bundled in-app release notes match the source file.
- The application bundle reports version `1.2.14` and identifier `com.vela.desktop`. The ZIP was extracted and contains a single `Vela.app`; the DMG checksum verified and the image mounted successfully with the matching application.
- Signed SHA-256 checksums were generated (`pnpm sign:release`) and verified for both packages. The signature was verified using the application’s `verifySignature` function and built-in `updatePublicKeys`.
