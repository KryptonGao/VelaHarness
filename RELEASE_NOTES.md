# Vela 1.2.35

Vela 1.2.35 moves the workbench and right-panel toggles into fixed window-level actions, adds a scrollable full-path breadcrumb for file previews, and gives compact tool display a minimal mode and a directory display setting. It also refines diff styling, scrolling, and step-row fonts.

## New

- **Fixed layout actions**: the workbench and right-panel toggles now sit in the window-level layout actions and stay in place. Panels slide open and closed under a stationary clip instead of moving the toggles with them.
- **Full-path breadcrumb**: file previews show the full path as a scrollable breadcrumb. Clipped segments fade out at the edge, and hovering expands the path faster.
- **Minimal compact tool display**: under compact tool display, a new minimal mode hides file icons and paths and underlines file names with a dashed gray line.
- **Directory display setting**: a new setting shows or hides directories on file read, edit, and create rows.

## Improved

- **Breadcrumb polish**: the current segment, the gap between separators, and the hover-leave cooldown are tuned so the breadcrumb feels steadier.
- **Lighter compact diffs**: compact diff tints are lighter (11% on rows, 8% on the gutter) and the gutter divider is thinner (2px).
- **Diff edge fade**: the edge fade now also covers the sticky line-number column.
- **Scroll inertia**: during scroll inertia, the wheel axis lock can switch direction, and a fresh flick or reversal starts a new wheel gesture.
- **Step row font**: expanded step rows in coherent groups follow the reply font.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.35-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.35-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.35`. macOS bundle and download version: `1.2.35`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.35`; all five in-app release-note languages contain four highlights and five improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version checks; the bundle identifier is `com.vela.desktop`. The packaged app contains the final in-app release notes (`1.2.35`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.

The automated test suites were not run for this release, as requested.
