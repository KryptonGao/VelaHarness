# Vela 1.2.2

Vela 1.2.2 adds cost tracking to usage statistics: register a price for each model and every usage view shows what a conversation cost, in CNY or USD. Tool cards now say what a command actually did, edit and write calls appear while the model is still writing their arguments, and the context card shows the free space left in the window.

## New

- **Model prices and costs**: Settings › Usage statistics has a new **Model pricing** section. Register the input, output, cache write and cache read price of a model per 1M tokens, in CNY or USD, and usage statistics calculate costs from it. The overview shows an estimated cost, the Usage table shows a cost per model, and a conversation's usage also shows what its latest task cost — that is, every request made since your last message. Prices stay on this machine, CNY and USD are totalled separately and never converted, and a model without a price is reported by name and left out of the totals instead of being counted as 0.
- **Bash commands say what they do**: `ls`, `cat`, `grep`, `find` and script runs are labelled List, Read, Search, Find and Script with a matching icon, and the card shows the directory, file or search term (plus "in src" for the search scope) instead of the raw command line. A command that chains several recognisable steps shows "+N more".
- **Per-tool icons**: updates to the todo list, the outcome, questions, sub-agent messages, scheduled tasks and memory have their own icons, coloured by tool family, in both full and compact tool cards. A todo card shows the item in progress (or the next one) and an outcome card shows its first line.
- **Live preview while edit and write arguments stream**: the card appears as soon as the model starts writing the arguments, the diff and its +/− counts grow with the content, and the view follows the end. If the model never finishes the call, the card ends with a note that nothing was changed.
- **Free space in the context card**: the context usage card lists Free space next to system, rules, skills and conversation, and every row shows its share of the window.

## Improved

- **Usage statistics open without reading whole traces**: only the request and usage records are streamed from each trace file, four conversations at a time, and the page updates once when loading finishes. A long history no longer loads hundreds of megabytes of trace into memory or recomputes the page dozens of times.
- **Compact tool groups**: mixed Bash groups count listed directories and searches separately ("Listed 3 directories · Ran 2 searches"), and each row keeps its own action word and icon instead of inheriting one for the whole group.
- **Run view**: write calls show "Writing Files", and a step whose tools have all finished goes back to thinking instead of still claiming to write a reply.
- **Jump orb**: each style now plays one to six full loops instead of a fixed three seconds, so a style change starts from the pose at the beginning of the loop. Edit and write calls count as command activity.
- **Composer**: the input grows while you type with an IME (Zhuyin, Pinyin) instead of waiting for the next keystroke, a long placeholder or prediction is truncated to one line instead of adding a horizontal scrollbar, and the plus button keeps its width when the text gets long. In the capsule layout the queue hint sits outside the capsule.
- **Context card layout**: rows align in three columns (name, tokens, share), the total no longer repeats "tokens" twice, and the percentage is easier to read in the information cards.
- Japanese, Korean and Traditional Chinese translations for the new text are included.

## Fixed

- Model identifiers in usage records are no longer rewritten when an MCP secret happens to be a substring of them, so requests stay grouped under the real model and registered prices match.
- A tool call that was already announced while its arguments streamed is counted once in the conversation's tool count, not twice.
- A step that called tools after writing text no longer stays on "Writing a reply" while waiting for the next model response.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Registered model prices are stored in your local UI state and are kept across the update.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.2-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.2-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.2`. macOS bundle and download version: `1.2.2`.

## Validation

- Type checks passed for all packages, and unit tests passed sequentially in the agent (719 tests, 718 passed and one skipped), workspace (191) and desktop (997) packages (`pnpm typecheck` and `pnpm -r --if-present --workspace-concurrency=1 test`). One timing-sensitive test in `packages/workspace/test/gh-run.test.ts` hit its own 1000 ms spawn timeout in a parallel run of `pnpm test` and passed on every run afterwards.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of the fourteen real-Electron smoke suites passed (`pnpm test:smoke`). Task Recipes failed with `Missing button 编辑` and PR Inbox with `Loaded PRs did not refresh while working outside the inbox`; both are the same symptoms already documented in earlier releases and neither touches code changed here. All other twelve suites — PI SDK, profile, Browser, Browser auth, Browser Use, MCP, Scheduled Tasks, Handoff, PR Review Response, Notification Sounds, Settings and Thinking Blur — passed.
- macOS arm64 packaging completed (`pnpm package:mac`); the application bundle reports version `1.2.2` and identifier `com.vela.desktop`, the ZIP contains a single `Vela.app`, and the DMG checksum verifies.
- The signed checksum file was generated for the DMG and ZIP with the bundled-public-key check (`pnpm sign:release`).
