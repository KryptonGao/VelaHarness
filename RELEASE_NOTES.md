# Vela 1.2.12

Vela 1.2.12 turns the results of built-in tools into readable, structured cards instead of raw text: background shell commands, memory, scheduled tasks, tool discovery, MCP resources and goals now each show what actually happened.

## New

- **Structured tool results**: the result of a background command, a memory read or write, a scheduled-task action, a tool search, an MCP resource read and a goal update is now shown as a purpose-built details view (status, command, working directory, exit code, entries, task and run tables, matched tools, resource contents) rather than a block of JSON or plain text. Values that have no dedicated layout fall back to a compact, expandable structured view.
- **Safe by construction**: results are validated and bounded before they reach the interface (size, depth and node limits, no executable content), and oversized results say they were shortened. If a record cannot be parsed fully, Vela shows the original response instead of a half-rendered card.
- **Old conversations keep working**: results saved by earlier versions are reorganized into the new view where possible and marked as derived from the legacy format; a tool call that was only requested is labeled as a request, not a success.

## Improved

- **MCP tool cards** share the same structured renderer, so images, resource metadata and the full-output path are laid out consistently.
- **Scheduled tasks page** reuses the same task and run formatting as the chat cards, so the two always agree.
- **Compact diffs and the chat workbench** were adjusted so the new cards sit cleanly inside collapsed turns and tool groups.
- **Localization**: all new labels are available in Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before; their older tool results are shown in the new layout where the stored data allows it.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.12-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.12-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.12`. macOS bundle and download version: `1.2.12`.

## Validation

- The unit, UI and smoke test suites were not run for this release.
- The in-app release-notes file was checked by hand: version `1.2.12` with matching highlight and improvement counts in all five languages.
- macOS arm64 packaging completed (`pnpm package:mac`). The application bundle reports version `1.2.12` with identifier `com.vela.desktop`; the ZIP extracts to a single `Vela.app`, and the DMG checksum verifies.
- Signed checksums were generated (`pnpm sign:release`) for both packages.
