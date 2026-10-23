# Vela 1.1.12

Vela 1.1.12 lets you cap how much context a conversation can use, adds a Context tab to the top bar, and gives new chats a calmer home screen.

## New

- **Context length limit**: Set a default cap on conversation context in Settings → Defaults & permissions (minimum 32K, empty means no limit). Once the cap is reached, earlier content is compacted sooner. The cap never exceeds the model's own window, and each conversation can override it from its own Context tab.
- **Context tab**: A new tab in the top bar breaks down what fills the context — system prompt, tool definitions, rules, Skills and the conversation itself — and shows the model window, your limit and the point where auto-compaction starts.
- **New-chat home**: An empty chat now centers a greeting, the input and a few preset prompts, with a line-art Vela mark behind them. Pick the project with the workspace chip above the input.
- **Replies in your language**: The agent now writes its progress notes before and between tool calls in the language you use (or your interface language when unclear) instead of drifting into English.

## Improved

- Subagent results and step lists are no longer truncated, so long findings reach the main agent in full.
- The Capsule composer layout now places the model picker in its tray.
- Tabs that need messages (Trace, Usage and Context) are greyed out until the first message is sent.
- The agent treats instructions found in web pages, files, MCP output and tool results as data rather than as commands from you.
- The context limit settings are translated into Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.12-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.12-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.12`. macOS bundle and download version: `1.1.12`.

## Validation

- Type checks and unit tests passed (`pnpm test`): 188 workspace, 639 agent and 908 desktop tests passed; one agent test was skipped.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases; these failures remain unresolved.
