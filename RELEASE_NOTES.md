# Vela 1.2.24

Vela 1.2.24 adds a switch for suggested prompts, fixes the permission display at startup and untitled chat labels, and refines composer feedback and pinned workspace animations.

## New

- **Suggested prompt visibility**: turn off **Settings → Interface → Suggested prompts** to hide prompt cards on the new chat start page while keeping the greeting and background. Cards remain enabled by default; this preference is separate from Minimal start page.

## Improved

- **Correct permission display at startup**: the permission control uses a saved startup hint, then loads the actual setting without waiting for Git, branch or pull-request queries. A previously selected permission level no longer initially appears as Manual. Startup hints affect the display, not runtime permission enforcement.
- **Localized untitled chats**: placeholder titles use the current interface language in chat headers, the sidebar, tabs, search and archived chats without rewriting stored titles. Renaming an untitled chat starts with an empty field instead of the stored placeholder.
- **Consistent composer feedback**: text controls share hover-color behavior, round icon buttons use a gray hover background, and controls with capsule backgrounds retain appropriate hover feedback. The combined mode menu no longer shows icons or mode-specific button colors.
- **Visible start-page shadows**: Classic, Calm and Capsule composers use a soft shadow that separates the input from the background without the floating dock's downward shadow.
- **Clearer layout settings**: Information layout and Composer layout each show a general introduction and a separate description of the selected option. Right-side layout descriptions use the same column layout for all three choices.
- **Smoother pinned workspaces**: the Pinned section expands and collapses with the same transition as workspace groups. Pinning or unpinning moves a workspace directly between sections without briefly showing duplicate rows or animating neighboring rows.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.24-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.24-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.24`. macOS bundle and download version: `1.2.24`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.24`; all five in-app release-note languages contain four highlights and four improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The local app, app extracted from the ZIP, and app in the mounted DMG all passed strict code-signature verification and bundle version / identifier checks. Their application archives are identical, contain the final in-app release notes, and include the trusted update public key.
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- Both package SHA-256 checksums and the Ed25519 checksum signature were verified using the application's `verifySignature` and trusted update public keys.

The automated test suites were not run for this release, as requested.
