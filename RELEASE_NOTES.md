# Vela 1.2.13

Vela 1.2.13 refines how thinking is shown: when a model writes several short progress summaries in a single thought, they now appear as a clean one-per-line list instead of being squeezed into one title.

## New

- **Every thinking summary, in order**: some models return several short summaries inside one thought (for example "Reviewing test changes", then "Reverting original tests"). Vela now lists each one on its own line beside the thinking icon rather than showing only the first.
- **Live title follows the latest step**: while a coherent group is still working, its title tracks the most recent summary, so it always reflects what the model is doing right now.

## Improved

- **No half-written titles**: a summary that is still being streamed is held back until its line is finished, so unfinished titles no longer flash on screen.
- **Glued summaries are split**: summaries that arrive joined together without a line break are separated into their own lines.
- **Wrapping in narrow panes**: long summaries wrap onto the next row instead of overflowing.
- **No misleading fold control**: a thought made only of summaries has nothing to expand, so it is shown as a plain list rather than a collapsible row.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.13-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.13-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.13`. macOS bundle and download version: `1.2.13`.

## Validation

- The unit, UI and smoke test suites were not run for this release.
- The in-app release-notes file was checked by hand: version `1.2.13` with matching highlight and improvement counts in all five languages.
- macOS arm64 packaging completed (`pnpm package:mac`). The application bundle reports version `1.2.13` with identifier `com.vela.desktop`; the ZIP extracts to a single `Vela.app`, and the DMG checksum verifies.
- Signed checksums were generated (`pnpm sign:release`) for both packages.
