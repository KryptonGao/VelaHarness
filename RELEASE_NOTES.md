# Vela 1.1.7

Vela 1.1.7 adds task usage limits: cap how long and how many tokens a single task may use, and get a handoff pack ready when the cap is reached. The Git panel also gets a visual refresh.

## New

- **Task usage limits**: In Settings → Agent defaults, turn on a time limit (in minutes) and/or a token limit for a single task. A task runs from your message until the root agent and every subagent are idle, and usage is counted across the whole agent tree (tokens are input plus output, excluding cache reads). You are warned at 80% of a limit; when the limit is reached Vela stops making new model requests.
- **Per-conversation limits**: Any conversation can use its own limits instead of the global default, and a banner in the conversation shows current usage against the limit.
- **Handoff after a limit**: When a task hits its limit, the handoff pack can be prepared from the conversation record alone, without sending another request to the model, so you can continue the work in a fresh conversation.

## Improved

- The Git panel (Changes and History) has a refreshed layout and styling, with clearer empty states for a clean workspace and for an unselected file.
- Task limit settings and messages are available in all five interface languages.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Task usage limits are off by default, so existing conversations behave exactly as before until you turn them on.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.7-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.7-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.7`. macOS bundle and download version: `1.1.7`.

## Validation

- Type checks and all 1,675 unit tests passed (`pnpm test`): 185 workspace, 599 agent, and 891 desktop tests.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases; these existing failures remain unresolved.
- The packaged 1.1.7 app launched with isolated data and stayed running.
- Both package SHA-256 checksums matched `SHA256SUMS.txt`, and the signed checksum file verified.
- The ad-hoc signed application bundle has version `1.1.7` and identifier `com.vela.desktop`; the ZIP contains only `Vela.app`, and the DMG mounted successfully with a valid application signature.
