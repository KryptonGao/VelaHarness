# Vela 1.2.21

Vela 1.2.21 adds an optional minimal start page, restyles command blocks and skill reads, and reports how long a turn took more clearly. It also stops clicked buttons and text inputs from drawing stray focus outlines.

## New

- **Minimal start page**: turn on **Settings → Interface → Minimal start page** and a new chat shows only the composer, without the greeting, suggested prompts or background mark. It is off by default.
- **Restyled command blocks**: command output now sits in a bordered block. The command is clamped to two lines (click to expand), a copy button appears on hover, and the command line and its output share a single height limit, with the output scrolling inside the remaining space. The thinking-group **Command detail height limit** and **Edit detail height limit** are now separate settings; the command limit falls back to the previous shared value.
- **Skill reads you can open**: reading a skill now shows as "Read <skill> skill" with a flat SKILL.md icon, and clicking the skill name opens SKILL.md in the preview pane.
- **Clearer turn timing**: turn time is shown in whole seconds, and a turn you stop yourself reads "You stopped after Xs" (wall-clock time) instead of a sum of tool durations. Compact tool rows also show how long each tool took.

## Improved

- **Focus outlines**: outlines on buttons and rows now appear only after you press Tab, so a button you clicked no longer gets a blue box on later keypresses.
- **Text inputs**: they no longer draw an outline or a blue border and glow when focused; the caret is the indicator.
- **Changes view**: diff headers are simpler, rows without a counterpart on the other side are hatched, and the turn's undo button is labelled "Undo".
- New interface text is available in all five interface languages.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.21-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.21-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.21`. macOS bundle and download version: `1.2.21`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.21`; all five in-app release-note languages contain four highlights and six improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`).
- The automated test suites were not run for this release.
