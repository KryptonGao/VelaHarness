# Vela 1.2.11

Vela 1.2.11 adds hover tooltips to icon buttons that show the action and its keyboard shortcut, and softens the translucent frame in dark mode so it sits better against the content area.

## New

- **Button tooltips**: hovering an icon button for a moment shows a small dark tooltip with the action name and, when there is one, its keyboard shortcut (for example "Browser" with ⇧⌘B). The first tooltip appears after about a second; once one has been shown, neighboring buttons respond after half a second, and moving between buttons slides the tooltip along instead of flickering. Keyboard focus shows it immediately, and it hides on click, key press, scroll or window blur. It also applies to the rename button next to the chat title and the navigation rail items. Settings, the file tree and expand/collapse toggles (thinking, tool cards and similar) never show it, and it respects reduced-motion preferences.

## Improved

- **Dark-mode translucent frame**: in dark mode the system blur no longer shows a pale gray rim from bright wallpapers next to the near-black content area. The default theme tint is now about 85% opaque and the Light/Dark tint is deeper (62% black instead of 50%).
- **Native blur follows Vela's appearance**: the window's system blur material now follows Vela's own light/dark setting instead of the OS appearance, so a light Vela on a dark system (or the reverse) no longer shows a mismatched gray.
- **Translucent area tint**: in dark mode, **None** now falls back to the Light/Dark look, and the setting's description says so.
- **Localization**: the updated description is available in Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Your translucent area tint choice is kept; only the dark-mode appearance of the existing options changes.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.11-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.11-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.11`. macOS bundle and download version: `1.2.11`.

## Validation

- The unit, UI and smoke test suites were not run for this release. The in-app release-notes file was checked by hand: version `1.2.11` with matching highlight and improvement counts in all five languages.
- The production build and macOS arm64 packaging completed (`pnpm package:mac`). The application bundle reports version and build `1.2.11` with identifier `com.vela.desktop` and an ad-hoc signature; the ZIP extracts to a single `Vela.app`, and the DMG checksum verifies.
- The packaged `app.asar` contains `release-notes.json` for `1.2.11`.
- Signed checksums were generated (`pnpm sign:release`). Both package hashes match, and the Ed25519 signature passes the application's `verifySignature` check with `updatePublicKeys`.
