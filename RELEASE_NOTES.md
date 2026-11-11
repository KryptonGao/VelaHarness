# Vela 1.2.33

Vela 1.2.33 adds user-configurable command lifecycle Hooks, refines the compact diff view, and adds a shortcut to restore the default window size. It also includes several visual polish fixes.

## New

- **Command lifecycle Hooks**: run your own commands on five events (`PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, and `PreCommit`). Hooks can be configured globally or per project from the new Hooks settings page, with native-code authorization, bounded execution, test runs, run history, and trace metadata. A `PreCommit` hook can guard Git commits.
- **Restore default window size**: press `Cmd+Option+0` or use the Window menu to return the focused window to 1280 x 840, including from full screen or maximized mode.
- **Elastic scrolling (experimental)**: an optional setting, off by default, lets inner scroll areas rubber-band past their edges.
- **Reveal in Finder from diff cards**: the file name on a diff card now reveals the file in Finder, and the name is larger.

## Improved

- **Sharper compact diffs**: changed words are highlighted inside paired added and removed lines, edge context is trimmed to the size of the change, long lines stay on one row with a horizontally scrollable diff and a sticky, tinted gutter, and a wheel gesture locks to one axis. Tool text in compact mode is one pixel larger.
- **Syntax highlighting**: all themes share one palette, symbolic operators keep the body color, and only function names are colored instead of whole call expressions.
- **Lighter emphasis in replies**: inline code is pinned to weight 400 and bold text to 600 instead of inheriting the heavier reply weight.
- **Stable chat column**: the column no longer shifts by about 2px when a group opens or closes, because the scrollbar gutter is now reserved permanently.
- **Thinking group collapse**: the top edge fade stays visible while a thinking group collapses.
- **Tooltips**: native tooltips are suppressed across the whole hovered ancestor chain, including titles refreshed during streaming.
- **Settings**: task budget inputs now show the loaded value immediately instead of being blank for one frame.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.33-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.33-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.33`. macOS bundle and download version: `1.2.33`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.33`; all five in-app release-note languages contain four highlights and five improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version checks; the bundle identifier is `com.vela.desktop`. The packaged app contains the final in-app release notes (`1.2.33`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.

The automated test suites were not run for this release, as requested.
