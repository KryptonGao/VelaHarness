# Vela 1.1.5

Vela 1.1.5 adds Racing: try the same task in parallel, compare the evidence, and adopt one solution. Four new built-in themes expand the light and dark palettes.

## New

- **Try multiple approaches at once**: Choose Racing in the composer mode menu. Run the same task in 2–4 independent Git worktrees, each with its own model, reasoning level, and optional instructions. Racing requires a Git repository with at least one commit; lanes start from the current commit and do not include uncommitted changes.
- **Compare evidence side by side**: The Racing panel shows status, elapsed time, token use, file changes, and acceptance evidence. Add a shared verification command to check every lane. Badges identify factual best results; Vela does not score solutions or choose a winner for you.
- **Adopt a solution when you are ready**: After every lane finishes, confirm your choice to squash its changes into the main workspace's staging area. Commit them yourself. Adoption requires a clean tracked working tree; conflicts restore the workspace so you can choose another lane. Discarding a race stops its lanes and cleans up its worktrees and branches.
- **Four more built-in themes**: Try Lilac and Blossom in light mode, or Forest and Tide in dark mode. Select them in Settings → Appearance or during onboarding.

## Improved

- Race conversations run in the background without switching your active conversation or workspace; lane token totals include sub-agents.
- Shared verification runs one lane at a time, with a ten-minute timeout and redacted output. Verification runs after all lanes finish.
- Unfinished races are marked interrupted after restarting the app. Lane conversations remain available for review, and failed cleanup can be retried.
- Racing controls and the new theme names are available in all five interface languages. Racing supports up to two concurrent races and uses a separate model session for each lane.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.5-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.5-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.5`. macOS bundle and download version: `1.1.5`.

## Validation

- Type checks and all 1,650 unit tests passed (`pnpm test`): 178 workspace, 583 agent, and 889 desktop tests.
- All 32 targeted Racing tests passed (`pnpm --filter @vela/desktop test:race`).
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- The Racing and acceptance real-Electron UI suites passed, covering evidence, badges, adoption confirmation, conflicts, discard, dark mode, narrow layouts, and the setup dialog.
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes (missing Edit button) and PR Inbox (idle refresh timeout) failed with the same symptoms already documented in the 1.1.4 release; these existing failures remain unresolved.
- The packaged 1.1.5 app launched with isolated data, served release notes in all five languages, and passed Racing IPC, all four new theme selections, theme persistence after reload, and release-card dismissal persistence checks.
- Pi production session creation and restoration passed using dependencies from the packaged `app.asar`.
- The ad-hoc signed application bundle has version `1.1.5` and identifier `com.vela.desktop`; the ZIP contains only `Vela.app`, and the DMG mounted successfully with a valid application signature.
- The updater verified the checksum signature against its built-in public key, and both package SHA-256 checksums matched.
