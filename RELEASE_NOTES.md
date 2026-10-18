# Vela 1.1.9

Vela 1.1.9 adds input prediction, lets you start independent chats inside the workbench panel, puts file checkpoints under your control, and moves the main conversation and sub-agents onto a new Vela-specific system prompt by default.

## New

- **Input prediction**: After each reply, Vela can predict what you may type next and show it in gray in the empty message box. Press Tab to fill it in, or press Enter (or click Send) on an empty box to send it as is. It is off by default and can be turned on in Settings → Conversation display; each prediction makes one extra model request, and you can follow the current chat's model or pick a separate, faster or cheaper one.
- **Chats in the workbench**: The workbench start page has a new Chat option that opens an independent conversation in a tab beside your files, terminal, browser and diffs. Each tab has its own session, input and skill menu, and stays mounted while hidden so replies keep arriving.
- **Checkpoint controls**: A new "Record file checkpoints" switch in Settings → Storage turns file recording off for new turns. "Delete all records" removes every finished checkpoint and frees the disk space, and the checkpoint timeline can delete a conversation's records up to a chosen turn. Conversations that are replying are never touched.
- **Vela system prompt**: The main conversation and sub-agents now use a Vela-specific system prompt (`v2`) by default instead of the base prompt from the underlying framework. Set `VELA_SYSTEM_PROMPT=v1` to switch back. Model-level evaluation of the new prompt has not been done yet.

## Improved

- Turns without a checkpoint now explain why: they ran together with the previous turn, checkpoints were off, or the record was deleted.
- New workbench tabs show a pending state while the session starts and display an error if it fails.
- The skill menu can be used in more than one message box at a time without its options colliding.
- New-chat options are validated in the main process, and invalid requests return a clear error.
- Added Traditional Chinese, Japanese and Korean translations for the new settings.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.9-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.9-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.9`. macOS bundle and download version: `1.1.9`.

## Validation

- Type checks and all 1,702 unit tests ran (`pnpm test`): 188 workspace, 620 agent (1 skipped), and 894 desktop tests. The only failure on the first run was a one-second timeout in an unrelated `gh-run` test; it passed on the immediate full rerun.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases; these existing failures remain unresolved. The Settings suite failed once on a scrollbar-fade timing check and passed on two reruns.
- The packaged 1.1.9 app launched with isolated data and stayed running.
- Both package SHA-256 checksums match `SHA256SUMS.txt`, and the signed checksum file was generated with the bundled-key check.
- The ad-hoc signed application bundle has version `1.1.9` and identifier `com.vela.desktop`; the ZIP contains only `Vela.app`, and the DMG mounted successfully with a valid application signature.
