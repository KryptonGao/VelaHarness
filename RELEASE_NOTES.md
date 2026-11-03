# Vela 1.2.20

Vela 1.2.20 adds an experimental draggable split view to the workbench, a much fuller application menu, and a headless runner for running a Vela task without Electron. It also renders browser snapshots as a readable list and fixes several streaming-output annoyances.

## New

- **Workbench split view (experimental)**: turn on **Settings → Interface → Workbench split view (experimental)** to drag tabs in the workbench and split it into up to four panes shown side by side. Drop a tab on a pane edge to split, on another pane's tab strip to move it, or on a pane's middle to swap pages. Dividers can be dragged or nudged with the arrow keys, a pane can be maximized, and closing a pane keeps its tabs. It is off by default; turning it off merges existing splits back into one pane without closing any tab.
- **Fuller application menu**: the menu bar now has New Tab, Toggle Sidebar and Toggle Info Panel, a **Go** menu (Back, Forward, Home, Scheduled Tasks, Task Recipes, Agent Inbox, Pull Request) and a **Workbench** menu (Terminal, Files, Browser, Changes).
- **Headless runner**: `pnpm runner run` executes a single Vela task without starting Electron, with text or JSONL output, exit codes that tell results apart, and per-run session, trace and result directories that leave the desktop app's sessions and settings untouched. The same flow is available as the `runHeadless` Node API.
- **Readable browser snapshots**: the result of a browser snapshot is now shown as a list of elements instead of raw text.

## Improved

- **Streaming output**: a streamed reply no longer keeps pulling the view down once you scroll up to read earlier output.
- **File diffs**: you can collapse a file diff while it is still streaming.
- **Created files**: the dot marking a created file is smaller and always blue.
- **Serif reply text**: uses a thin stroke instead of a heavier weight, so text looks lighter and cleaner.
- **Pull request inbox**: fixed a crash where the cache read the clock with a detached `Date.now`.
- New interface text is available in all five interface languages.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.20-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.20-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.20`. macOS bundle and download version: `1.2.20`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.20`; all five in-app release-note languages contain four highlights and six improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`).
- The automated test suites were not run for this release.
