# Vela 1.2.3

Vela 1.2.3 lets you cap what a task may cost, with an estimate before it starts, and lets the main agent run long commands in the background. Side chats are now saved per project with a searchable list, and a new Ultra thinking level asks the model to use its highest effort and bring in subagents more readily.

## New

- **Task cost limit**: Settings › Defaults and permissions › Task usage limits has a new **Cost limit**, set in CNY or USD, next to the time and token limits; a single conversation can override it in its Usage limits tab. Cost covers the whole agent tree and is calculated from the model prices you registered. CNY and USD are never converted, and a model with no price (or priced in the other currency) is not counted — the chat says how many models were left out, so "not over the limit" is not mistaken for "cheap". At 80% the chat warns you, and at 100% the agent tree stops and offers a handoff. Cost also sends one inbox reminder at 80% and one at 100%.
- **Cost estimate before a task starts**: once at least three similar tasks have finished on this machine (conversations and recipes are estimated separately, same model first), the composer shows the median cost and the range the middle half of those tasks fell in. Nothing is shown without enough history or a usable price.
- **Background commands**: `bash` accepts `run_in_background`, so a dev server, a watcher or a slow build keeps running while the main agent continues. `bash_output` reads new output (and can wait up to 600 seconds), `bash_kill` stops the command and its child processes, and when a command finishes, fails or times out the main agent is woken with the result. Commands go through the same permission gate as foreground ones; subagents and Plan mode keep synchronous `bash`.
- **Side chats saved per project**: the side chat tab opens a list of the project's chats, newest first, with a preview and time on every row. The search box looks through names and every message and highlights the match. A trash button on each row asks for confirmation before it deletes. Going back to the list does not interrupt a reply that is still arriving, and chats survive a restart (up to 50 per project, 400 messages each).
- **Ultra thinking level**: Ultra sits at the end of the thinking slider for every model. It uses the highest effort the model actually supports and asks the model to use subagents more readily. You can switch to and from it at any time and the next turn picks it up.
- **Recommended actions**: when the model finishes a task it can offer one to three next steps, such as committing the changes, as a card you can dismiss. A click sends the instruction the model wrote as your next message, with no extra model request. Settings › Conversation display can turn it off.
- **Quote selected text**: select text in a conversation to quote it in the side chat or to write a reply that sits as a card above the composer. When a side chat is already open the quote joins that chat; otherwise a new one starts.

## Improved

- Registered model prices are also handed to the main process (`model-prices.json` in the data folder) and re-synced at startup, so cost limits and estimates are calculated with the same prices the settings page shows.
- The task usage banner and Usage limits tab show cost used against the limit. The thinking-level control shows a small glyph for the chosen level, with a blue-violet gradient for Ultra, and choosing Ultra suggests switching to Full access.
- Japanese, Korean and Traditional Chinese translations for the new text are included.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Side chats from earlier versions only existed in the open tab and are not carried over. Background commands live only inside the running app and stop when it quits.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.3-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.3-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.3`. macOS bundle and download version: `1.2.3`.

## Validation

- Type checks passed for all packages, and unit tests passed in the agent (750 tests, 749 passed and one skipped), workspace (200) and desktop (1033) packages (`pnpm typecheck` and `pnpm -r --if-present --workspace-concurrency=1 test`). One timing-sensitive test in `packages/workspace/test/gh-run.test.ts` hit its own 1000 ms spawn timeout in the first run and passed when the workspace package was run again.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of the fourteen real-Electron smoke suites passed (`pnpm test:smoke`). Task Recipes failed with `Missing button 编辑` and PR Inbox with `Loaded PRs did not refresh while working outside the inbox`; both are the same symptoms already documented in earlier releases and neither touches code changed here. The other twelve suites passed.
- macOS arm64 packaging completed (`pnpm package:mac`); the application bundle reports version `1.2.3` and identifier `com.vela.desktop`, the ZIP contains a single `Vela.app`, and the DMG checksum verifies.
- The signed checksum file was generated for the DMG and ZIP with the bundled-public-key check (`pnpm sign:release`).
