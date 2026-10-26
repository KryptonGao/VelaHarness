# Vela 1.2.5

Vela 1.2.5 makes streamed text feel smoother and keeps the app responsive on huge repositories. Reply and thinking text can now fade in and bounce as it arrives, the stats under the composer rotate between cache hit rate and total tokens, the turn review shows changed files as a tree, and Plan mode checks shell commands much more strictly before letting them run.

## New

- **Streaming text animation**: new text in a streamed reply and in thinking fades in from transparent and can hop up slightly before settling back. Reply text (including the thinking summary in the "Like reply" style) and thinking text each have their own **Fade-in** and **Bounce** switches in Settings → Conversation display; with both off the text appears at once. Thinking summaries now appear at the same pace as the reply instead of all at once, while summaries in older history still open instantly.
- **Turn review as a file tree**: the list of files changed in a turn now uses the same tree as the file explorer, with foldable folders and the added and removed line counts beside each file.
- **Rotating stats under the composer**: cache hit rate and total tokens now take turns in the same spot every 30 seconds; the output speed stays fixed. The cost estimate hint has a × button that closes it permanently.

## Improved

- **Stricter read-only guard in Plan mode**: shell commands in Plan mode and in read-only subagents are now split into words the way a shell reads them, instead of being matched with patterns. Command substitution, variable expansion, sub-shells, background jobs and redirects that write files are refused, each allowed command is checked against its own argument rules (for example `find` without `-delete` or `-exec`, `sed` and `awk` scripts that cannot write files), and anything uncertain is refused. Ordinary look-up commands still work.
- **Huge git diffs**: file, commit, stash and release-range diffs are now cut off while they are read, rather than loaded whole and trimmed afterwards. Git output is capped, the history page shows a notice when only the first part of a commit's diff is displayed, and splitting a very large file diff into hunks is refused with a clear message instead of stalling.
- **Subagent limit**: subagents that are finished, failed or stopped no longer count toward the per-conversation limit; only those that are running, paused or waiting do. They stay in the tree for viewing and follow-ups.
- **Writes through symbolic links**: a file write is now judged by its real path, so a symbolic link inside the workspace that points outside it asks for approval like any other outside path.
- **Following a streaming reply**: when the content gets shorter, for example when a thinking summary replaces a longer line, the browser pulling the scroll position back is no longer mistaken for you scrolling up, so the view keeps following the bottom.
- **Smoother streaming**: the app now only watches whether a conversation is empty instead of the whole message list, so the whole window no longer re-renders on every streamed frame.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.5-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.5-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.5`. macOS bundle and download version: `1.2.5`.

## Validation

- Type checks passed for all packages, and unit tests passed in the agent (762 tests, 761 passed and one skipped), workspace (208) and desktop (1054) packages (`pnpm test`). One workspace test (`gh-run`, which starts a child process under a 1-second limit) timed out once during the first parallel run; it passed three times on its own and in the full re-run.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of the fourteen real-Electron smoke suites passed (`pnpm test:smoke`). Task Recipes failed with `Missing button 编辑` and PR Inbox with `Loaded PRs did not refresh while working outside the inbox`; both are the same symptoms already documented in earlier releases and neither touches code changed here. The other twelve suites passed.
- macOS arm64 packaging completed (`pnpm package:mac`); the application bundle reports version `1.2.5` and identifier `com.vela.desktop`, the ZIP contains a single `Vela.app`, the DMG checksum verifies, and the packaged `app.asar` contains `icon.png`, `tray-template.png` and `release-notes.json` under `out/main`.
- The signed checksum file was generated for the DMG and ZIP (`pnpm sign:release`), and its signature verifies against the public key bundled in the app.
