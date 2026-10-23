# Vela 1.1.14

Vela 1.1.14 makes the top bar and the composer tray adapt to narrow windows instead of wrapping or getting cut off.

## New

- **Top-bar tabs that fit narrow panels**: When the Conversation, Trace, Version Control, Usage, Context and Usage limit tabs no longer fit, they first drop their icons and keep the text, then keep only the icons. Every tab still shows its name on hover.
- **A composer tray that never wraps**: The row under the input stays on a single line. When space runs out, the stats are hidden step by step: output speed first, then tokens and cache hits, then the usage percentage and ring. Mode, permissions and model always stay visible.

## Improved

- Top-bar tab labels no longer wrap, and the tab strip can scroll sideways as a last resort.
- Tabs now carry an accessible label, so screen readers still announce them when only the icon is visible.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.14-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.14-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.14`. macOS bundle and download version: `1.1.14`.

## Validation

- Type checks and unit tests passed (`pnpm test`): 191 workspace, 695 agent and 920 desktop tests passed; one agent test was skipped. The first run hit the timing-sensitive `gh-run` test under load; it passes in isolation and on rerun.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases; these failures remain unresolved.
