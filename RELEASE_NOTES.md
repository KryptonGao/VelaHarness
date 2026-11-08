# Vela 1.2.26

Vela 1.2.26 adds a copy button for command output and a running-seconds clock on tool lines, unifies todo list styling with the run view, and makes the edge blur follow scrolling without lag.

## New

- **Copy command output**: hover over a command's output to show a button that copies it to the clipboard.
- **Running-seconds clock on tool lines**: tool calls that are still running show how many seconds they have been going, like command lines already did. The count keeps its start time when you switch sessions and come back.

## Improved

- **One look for todo lists**: todo lists in tool cards use the same marks as the run view (dashed, spinning, filled check). An item left in progress when its task ends shows a solid ring with three dots. The run view's todo list stays below the conversation after the run ends, without the status bar.
- **Edge blur that keeps up with scrolling**: the soft blur at the top and bottom of scrolling areas follows the scroll position directly through a CSS scroll timeline, instead of appearing a few frames after text has already moved under the edge. It only runs while content overflows and reaches full strength after 8 px of scrolling.
- **Consistent buttons**: remaining pill-shaped buttons across cards, panels, and settings now use the rounded-rectangle button style.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.26-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.26-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.26`. macOS bundle and download version: `1.2.26`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.26`; all five in-app release-note languages contain four highlights and four improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The local app and the app extracted from the ZIP passed strict code-signature verification and bundle version / identifier checks; the app in the mounted DMG passed strict code-signature verification. The packaged app contains the final in-app release notes (`1.2.26`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- The Ed25519 checksum signature was verified using the application's `verifySignature` and trusted update public keys, and both package SHA-256 checksums match `SHA256SUMS.txt`.

The automated test suites were not run for this release, as requested.
