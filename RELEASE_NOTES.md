# Vela 1.2.31

Vela 1.2.31 lets you choose whether files open in a new tab or replace the current preview, and opens the full-screen viewer from images in the right preview panel. Long conversations and streaming diffs stay smoother, and the composer keeps its usage stats visible whenever they fit.

## New

- **File opening mode**: Settings → Interface has a File opening choice: New tab or Current tab. Current tab replaces only file previews, and both modes reuse a Files tab that is not yet displaying a file. Tab positions, split panes, and search line jumps are preserved.
- **Full-screen image viewer from the preview panel**: clicking an image in the right preview panel now opens the full-screen viewer.

## Improved

- **Smoother streaming diffs**: syntax highlighting now tokenizes only the lines appended to a streaming diff, in short slices, instead of re-tokenizing the whole diff on every pass. The view no longer blanks or stalls while scrolling during long edits.
- **Faster long conversations**: completed turns no longer re-render on every streaming frame, so the cost of each update no longer grows with the length of the history.
- **Composer stats**: the tray measures its real content and keeps speed, token totals, and context usage visible whenever they fit, collapsing them in priority order only when space runs out.
- **Jump to latest**: the arrow appears on hover and keyboard focus.
- **Cleaner tool operations**: tool operations no longer end with a trailing failure cross.
- **Plan markers**: status glyphs stay centered in every plan marker size.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.31-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.31-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.31`. macOS bundle and download version: `1.2.31`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.31`; all five in-app release-note languages contain four highlights and three improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version checks; the bundle identifier is `com.vela.desktop`. The packaged app contains the final in-app release notes (`1.2.31`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- The Ed25519 checksum signature was verified using the application's `verifySignature` and trusted update public keys, and both package SHA-256 checksums match `SHA256SUMS.txt`.

The automated test suites were not run for this release, as requested.
